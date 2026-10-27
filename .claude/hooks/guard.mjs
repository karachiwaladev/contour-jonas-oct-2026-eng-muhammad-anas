#!/usr/bin/env node
// PreToolUse guard: the last line of defence when a ticket tries to make the
// agent do something harmful. The factory loop fetches tickets every minute and
// ticket text is untrusted, so this hook checks every tool call the agent makes,
// whatever the agent was persuaded to do.
//
// It reads the hook input on stdin and answers with a PreToolUse decision:
//   deny: the call never runs (destructive git/gh, secrets, exfiltration, ...)
//   ask:  a person must confirm (edits to the guard itself, installs, ...)
//   (no output): the call goes through the normal permission flow.
// Every deny/ask is appended to .claude/guard-log.jsonl.
// If the hook itself fails, it denies (fails closed).

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Credentials that must never be written to a file, a comment or a URL.
export const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\bsk-[A-Za-z0-9]{32,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export const hasSecret = text => SECRET_PATTERNS.some(re => re.test(text));

// One shell "segment" never crosses ; & | or a newline, so a rule can't match
// across two separate commands.
const SEG = '[^;&|\\n]*';

// Bash rules, checked in order. `test` gets the whole command string.
const BASH_RULES = [
  // git history and branches
  { id: 'git-force-push', decision: 'deny', reason: 'Force-pushing rewrites published history.',
    test: c => new RegExp(`\\bgit\\b${SEG}\\bpush\\b${SEG}(\\s--force(-with-lease)?\\b|\\s-[a-zA-Z]*f\\b|\\s\\+\\S)`).test(c) },
  { id: 'git-push-main', decision: 'deny', reason: 'Work reaches main only through a reviewed pull request.',
    test: c => new RegExp(`\\bgit\\b${SEG}\\bpush\\b${SEG}\\s(\\S+:)?(refs/heads/)?(main|master)\\b`).test(c) },
  { id: 'git-push-delete', decision: 'deny', reason: 'Deleting remote branches is destructive.',
    test: c => new RegExp(`\\bgit\\b${SEG}\\bpush\\b${SEG}(\\s--delete\\b|\\s-d\\b|\\s:\\S)`).test(c) },
  { id: 'git-destructive', decision: 'deny', reason: 'This git command throws work away or rewrites history.',
    test: c => new RegExp(`\\bgit\\b${SEG}\\s(reset\\s${SEG}--hard|clean\\s${SEG}-[a-zA-Z]*f|rebase\\b|filter-branch|filter-repo|update-ref\\s${SEG}-d|reflog\\s+expire|branch\\s${SEG}(-D\\b|--delete\\s${SEG}--force|-[a-zA-Z]*D))`).test(c) },
  { id: 'git-code-execution', decision: 'deny', reason: 'This git transport or config option runs an arbitrary command.',
    // ext::/fd:: transports, and the -c config keys / --pack options git uses to run a helper, are remote-code-execution vectors.
    test: c => /\bgit\b/.test(c) && (
      /(^|[\s"'=:(])(ext|fd)::/.test(c)
      || /\s-c\s+(core\.(sshcommand|fsmonitor|gitproxy|pager|editor|askpass|hookspath)|protocol\.[\w.]*\.allow|uploadpack\.packobjectshook|diff\.external|sendemail\.smtpserver)/i.test(c)
      || /\s--(upload-pack|receive-pack|exec)[=\s]/.test(c)) },
  { id: 'git-discard-all', decision: 'ask', reason: 'Discarding all local changes needs a person to confirm.',
    test: c => new RegExp(`\\bgit\\b${SEG}\\s(checkout|restore)\\s+(--\\s+)?\\.(\\s|$)`).test(c) },
  { id: 'git-remote-or-config', decision: 'deny', reason: 'Changing remotes or global git config could send the code somewhere else.',
    test: c => new RegExp(`\\bgit\\b${SEG}\\s(remote\\s+(add|set-url|rename|remove|rm)\\b|config\\s${SEG}(--global|--system|core\\.hookspath|credential\\.|url\\.))`, 'i').test(c) },

  // GitHub
  { id: 'gh-merge', decision: 'deny', reason: 'The agent never merges or approves pull requests; a person does.',
    test: c => /\bgh\s+pr\s+merge\b/.test(c) || /\bgh\s+pr\s+review\b[^;&|\n]*--approve/.test(c)
      || /\bgh\s+api\b[^;&|\n]*\/pulls\/\d+\/merge\b/.test(c) || /\bgh\s+pr\b[^;&|\n]*--auto\b/.test(c) },
  { id: 'gh-destructive', decision: 'deny', reason: 'This gh command deletes or reconfigures repository or account settings.',
    test: c => /\bgh\s+(repo\s+(delete|archive|rename|edit)|secret|variable|ssh-key|gpg-key|auth\s+(token|logout|refresh)|release\s+delete|issue\s+(delete|transfer|lock)|label\s+delete|workflow\s+(run|enable|disable)|run\s+(delete|cancel|rerun)|cache\s+delete)\b/.test(c) },
  { id: 'gh-api-write', decision: 'deny', reason: 'Only GET and POST calls are allowed through gh api.',
    test: c => /\bgh\s+api\b[^;&|\n]*(-X|--method)[\s=]*['"]?(DELETE|PUT|PATCH)\b/i.test(c)
      || /\bgh\s+api\b[^;&|\n]*\/(collaborators|keys|hooks|actions\/secrets|actions\/variables|branches\/[^\s/]+\/protection|invitations)\b/.test(c) },
  { id: 'approval-label', decision: 'deny', reason: 'Only a person may add the screen-approved label.',
    // Adding the label (not mentioning it: the hold comment tells maintainers its name).
    test: c => /\bgh\s+(issue|pr)\s+(edit|create)\b[^;&|\n]*--(add-)?label[\s=]+['"]?[^\s'"]*screen-approved/.test(c)
      || /\bgh\s+api\b[^;&|\n]*\/labels\b[^;&|\n]*screen-approved/.test(c)
      || /\bgh\s+label\s+(create|edit|clone)\b[^;&|\n]*screen-approved/.test(c) },
  { id: 'gh-mass-close', decision: 'deny', reason: 'The loop closes one ticket at a time, never in bulk.',
    test: c => (c.match(/\bgh\s+issue\s+close\b/g) || []).length > 1
      || /\bxargs\b[^;&\n]*\bgh\s+(issue|pr)\s+close\b/.test(c)
      || /\b(for|while)\b[\s\S]*\bgh\s+(issue|pr)\s+close\b/.test(c)
      || /\bgh\s+issue\s+close\s+\d+\s+\d+/.test(c) },

  // files
  { id: 'rm-dangerous', decision: 'deny', reason: 'Recursive delete of a path outside the project or of the project itself.',
    test: (c, ctx) => dangerousRm(c, ctx) },
  { id: 'find-delete', decision: 'ask', reason: 'Bulk deletes with find need a person to confirm.',
    test: c => /\bfind\b[^;&|\n]*(\s-delete\b|-exec\s+rm\b)/.test(c) },
  { id: 'guard-tamper', decision: 'deny', reason: 'The guard, settings and CI config can only be changed by a person.',
    test: c => writesProtected(c) },

  // running code from the internet
  { id: 'remote-exec', decision: 'deny', reason: 'Piping downloaded code into a shell or interpreter runs code nobody reviewed.',
    test: c => /\b(curl|wget)\b[^;&\n]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/.test(c)
      || /\b(curl|wget)\b[^;&\n]*\|\s*(python3?|node|perl|ruby)\b/.test(c)
      || /\b(ba|z)?sh\s+(-c\s+)?["']?\$?\(?<?\(\s*(curl|wget)\b/.test(c)
      || /\$\(\s*(curl|wget)\b[^)]*\)\s*$/.test(c) && /\beval\b/.test(c)
      || /\bbase64\s+(-d|--decode|-D)\b[^;&\n]*\|\s*(ba|z)?sh\b/.test(c) },

  // secrets
  { id: 'secret-read', decision: 'deny', reason: 'Reading credentials is never part of a ticket.',
    test: c => /(~|\$HOME|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/\.(ssh|aws|gnupg|netrc|docker\/config\.json|npmrc|pypirc|config\/gh|kube)/.test(c)
      || /\bid_(rsa|ed25519|ecdsa|dsa)\b/.test(c)
      || /\bgh\s+auth\s+token\b/.test(c)
      || /\bgit\s+credential\b/.test(c)
      || /\bsecurity\s+(find-generic-password|find-internet-password|dump-keychain)\b/.test(c)
      || /(^|[;&|]\s*)(printenv|env|set|export\s+-p)\s*($|[;&|>])/.test(c)
      || /\$\{?[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY|CREDENTIALS?)[A-Z0-9_]*\}?/.test(c)
      || /(^|[\s'"/])\.env(\.[a-z]+)?(['"\s]|$)/.test(c) && /\b(cat|less|more|head|tail|grep|sed|awk|cp|curl|base64|xxd|strings|open)\b/.test(c) },
  { id: 'secret-in-output', decision: 'deny', reason: 'The command contains what looks like a credential.',
    test: (c, ctx) => hasSecret(c) || bodyFileHasSecret(c, ctx) },

  // sending data out
  { id: 'exfiltration', decision: 'deny', reason: 'Uploading data to a host other than GitHub could leak code or secrets.',
    test: c => uploadsToForeignHost(c)
      || /(^|[;&|]\s*|\s)(nc|ncat|netcat|telnet|socat|scp|sftp|ftp)\s/.test(c)
      || /(^|[;&|]\s*)ssh\s+\S/.test(c)
      || /\brsync\b[^;&|\n]*\s\S+@?\S*:/.test(c) },

  // the machine itself
  { id: 'system', decision: 'deny', reason: 'System-level changes are outside any ticket.',
    test: c => /(^|[;&|]\s*|\s)(sudo|su|doas)\s/.test(c)
      || /\b(crontab|launchctl|systemctl|shutdown|reboot|halt|mkfs\w*|diskutil|osascript|csrutil|spctl)\b/.test(c)
      || /\bdefaults\s+write\b/.test(c)
      || /\bchmod\s+(-R\s+)?[0-7]*777\b/.test(c)
      || /\bdd\s+if=/.test(c)
      || /\bkill(all)?\s+-9\s+-1\b/.test(c)
      || />\s*\/(etc|usr|bin|sbin|System|Library)\//.test(c)
      || /(>|\btee\b)\s*(-a\s+)?(~|\$HOME)\/\.(zshrc|bashrc|bash_profile|profile|zprofile|gitconfig)\b/.test(c) },

  // packages
  { id: 'publish', decision: 'deny', reason: 'Publishing packages is never part of a ticket.',
    test: c => /\b(npm|yarn|pnpm)\s+publish\b/.test(c) || /\btwine\s+upload\b/.test(c) || /\bgem\s+push\b/.test(c) || /\bcargo\s+publish\b/.test(c) },
  { id: 'install', decision: 'ask', reason: 'Installing packages pulls in third-party code; a person should confirm.',
    test: c => /\b(npm|pnpm|yarn)\s+(i|install|add)\b/.test(c) || /\bpip3?\s+install\b/.test(c)
      || /\bbrew\s+install\b/.test(c) || /\bgem\s+install\b/.test(c) || /\bcargo\s+install\b/.test(c)
      || /\bnpx\s+(-y\s+|--yes\s+)?[a-z@]/.test(c) },
];

// rm -r / -f on the project root, .git, home, / or anything outside the
// project and temp dirs.
function dangerousRm(command, ctx) {
  for (const m of command.matchAll(/(?:^|[;&|\s(])rm\s+([^;&|\n]*)/g)) {
    const tokens = m[1].trim().split(/\s+/).filter(Boolean);
    const flags = tokens.filter(t => t.startsWith('-')).join('');
    if (!/[rRf]/.test(flags) && !/--recursive|--force/.test(flags)) continue;
    const targets = tokens.filter(t => !t.startsWith('-')).map(t => t.replace(/^['"]|['"]$/g, ''));
    for (const t of targets) {
      if (['/', '/*', '~', '~/', '$HOME', '.', './', '..', '../', '*', '.*', '.git', './.git'].includes(t)) return true;
      if (/^(~|\$HOME)\//.test(t)) return true;
      if (/(^|\/)\.git(\/|$)/.test(t)) return true;
      if (t.startsWith('/') && !insideAllowed(t, ctx)) return true;
      if (t.startsWith('..')) {
        const abs = path.resolve(ctx.cwd || ctx.projectDir, t);
        if (!insideAllowed(abs, ctx)) return true;
      }
      if (t.startsWith('/') && path.resolve(t) === path.resolve(ctx.projectDir)) return true;
    }
  }
  return false;
}

// A shell command that writes to, moves, deletes or re-permissions one of the
// guard's own files. Reading them (cat, grep, node --test, cp FROM them) is fine.
const PROTECTED_IN_SHELL = /(\.claude\/hooks\/|\.claude\/settings(\.local)?\.json|\.mcp\.json|\.git\/hooks|\.github\/workflows|ticket-screen\/(scripts\/|SKILL\.md)|factory-loop\/SKILL\.md)/;
function writesProtected(command) {
  for (const seg of command.split(/&&|\|\||[;|\n]/)) {
    if (!PROTECTED_IN_SHELL.test(seg)) continue;
    // Redirect or tee into a protected path.
    for (const m of seg.matchAll(/(?:\d?>>?|\btee(?:\s+-a)?)\s*['"]?([^\s'"]+)/g)) if (PROTECTED_IN_SHELL.test(m[1])) return true;
    const words = seg.trim().split(/\s+/);
    const cmd = words[0];
    const args = words.slice(1).filter(w => !w.startsWith('-'));
    if (['rm', 'unlink', 'chmod', 'chown', 'truncate', 'shred'].includes(cmd) && args.some(a => PROTECTED_IN_SHELL.test(a))) return true;
    if (['mv', 'cp', 'ln', 'install', 'rsync'].includes(cmd)) {
      if (args.length && PROTECTED_IN_SHELL.test(args[args.length - 1])) return true;   // destination
      if (cmd === 'mv' && args.some(a => PROTECTED_IN_SHELL.test(a))) return true;       // moving it away
    }
    if (/^(sed|perl|gsed)$/.test(cmd) && /\s-[a-zA-Z]*i/.test(seg) && args.some(a => PROTECTED_IN_SHELL.test(a))) return true;
    if (cmd === 'git' && /\b(checkout|restore|rm|mv)\b/.test(seg) && args.some(a => PROTECTED_IN_SHELL.test(a))) return true;
  }
  return false;
}

// Remove the bodies of heredocs that only feed cat/tee (writing a file).
// Heredocs fed to a shell or interpreter are code and are kept.
export function stripDataHeredocs(command) {
  const lines = command.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = line.match(/(?:^|[;&|(]\s*|\s)(\S+)[^\n]*?<<-?\s*(['"]?)([A-Za-z_][\w]*)\2/);
    if (!m) continue;
    const segStart = line.slice(0, line.indexOf('<<')).split(/&&|\|\||[;|(]/).pop().trim();
    const consumer = segStart.split(/\s+/)[0];
    if (!['cat', 'tee'].includes(consumer)) continue;
    const end = m[3];
    let j = i + 1;
    while (j < lines.length && lines[j].replace(/^\t+/, '') !== end) j++;
    if (j >= lines.length) continue;          // unterminated: treat as code
    out.push(end);
    i = j;
  }
  return out.join('\n');
}

// curl/wget sending a body or a file anywhere but GitHub.
function uploadsToForeignHost(command) {
  for (const m of command.matchAll(/\b(curl|wget)\b([^;&|\n]*)/g)) {
    const args = m[2];
    const sends = /\s(-d|--data\S*|-F|--form\S*|-T|--upload-file|--post-data|--post-file|--body-data|--body-file)\b/.test(args)
      || /\s(-X|--request|--method)[\s=]*['"]?(POST|PUT|PATCH|DELETE)\b/i.test(args);
    if (!sends) continue;
    const hosts = [...args.matchAll(/https?:\/\/([^/\s'"?:]+)/g)].map(h => h[1].toLowerCase());
    if (hosts.length === 0 || hosts.some(h => !/(^|\.)github\.com$/.test(h))) return true;
  }
  return false;
}

// gh issue comment / pr create --body-file <path>: scan the file too.
function bodyFileHasSecret(command, ctx) {
  for (const m of command.matchAll(/--body-file[\s=]+['"]?([^\s'"]+)/g)) {
    const file = path.resolve(ctx.cwd || ctx.projectDir, m[1]);
    try { if (hasSecret(readFileSync(file, 'utf8'))) return true; } catch { /* unreadable: gh will fail on its own */ }
  }
  return false;
}

function insideAllowed(p, ctx) {
  const abs = path.resolve(p);
  const roots = [ctx.projectDir, '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];
  return roots.some(r => abs === r ? r !== ctx.projectDir : abs.startsWith(r.endsWith('/') ? r : r + '/'));
}

// Files the agent may not touch without a person: the guard itself, the
// settings that load it, the screening skill and CI.
const PROTECTED = [
  { re: /^\.git\//, decision: 'deny', reason: 'Writing inside .git can rewrite history or plant git hooks.' },
  { re: /^\.claude\/hooks\//, decision: 'ask', reason: 'Changing the guard hooks needs a person to confirm.' },
  { re: /^\.claude\/settings(\.local)?\.json$/, decision: 'ask', reason: 'Changing permissions or hooks needs a person to confirm.' },
  { re: /^\.mcp\.json$/, decision: 'ask', reason: 'Changing MCP servers needs a person to confirm.' },
  { re: /^\.github\/workflows\//, decision: 'ask', reason: 'Changing CI workflows needs a person to confirm.' },
  { re: /^\.claude\/skills\/ticket-screen\/(SKILL\.md|scripts\/)/, decision: 'ask', reason: 'Changing the ticket screen needs a person to confirm.' },
  { re: /^\.claude\/skills\/factory-loop\/SKILL\.md$/, decision: 'ask', reason: 'Changing the loop rules needs a person to confirm.' },
];

const HOME_DENY = /^(\.ssh|\.aws|\.gnupg|\.config\/gh|\.netrc|\.npmrc|\.pypirc|\.docker|\.kube|\.zshrc|\.zprofile|\.bashrc|\.bash_profile|\.profile|\.gitconfig|\.claude\/settings(\.local)?\.json|Library\/LaunchAgents)(\/|$)/;
const SECRET_FILE = /(^|\/)(\.env(\.[\w-]+)?|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|credentials(\.json)?|.*\.pem|.*\.key)$/;

function checkPath(filePath, ctx, { writing }) {
  if (!filePath) return null;
  const abs = path.resolve(ctx.cwd || ctx.projectDir, filePath);
  const home = ctx.home;
  if (abs.startsWith(home + '/')) {
    const rel = abs.slice(home.length + 1);
    if (HOME_DENY.test(rel)) return { id: 'home-sensitive', decision: 'deny', reason: `${writing ? 'Writing' : 'Reading'} ~/${rel.split('/')[0]} is never part of a ticket.` };
  }
  if (SECRET_FILE.test(abs) && !/\.example$|\.sample$/.test(abs)) {
    // Eval fixtures carry fake canary secrets on purpose; everything else is real.
    if (!(writing === false && /\/evals\/[^/]+\/files\//.test(abs))) {
      return { id: 'secret-file', decision: 'deny', reason: 'Credential files are off limits.' };
    }
  }
  if (!writing) return null;
  if (abs.startsWith(ctx.projectDir + '/')) {
    const rel = abs.slice(ctx.projectDir.length + 1);
    for (const p of PROTECTED) if (p.re.test(rel)) return { id: 'protected-file', decision: p.decision, reason: p.reason };
    return null;
  }
  if (insideAllowed(abs, ctx) || abs.startsWith(path.join(home, '.claude', 'projects') + '/')) return null;
  return { id: 'write-outside-project', decision: 'ask', reason: 'Writing outside the project needs a person to confirm.' };
}

export function evaluate(input, ctx) {
  const tool = input.tool_name;
  const ti = input.tool_input || {};
  ctx = { cwd: input.cwd, ...ctx };

  if (tool === 'Bash') {
    const full = String(ti.command || '');
    // Text written to a file through `cat <<EOF > file` is data, not commands,
    // so the command rules skip it. Credentials in it are still caught.
    const command = stripDataHeredocs(full);
    if (command !== full && hasSecret(full)) {
      return { id: 'secret-in-output', decision: 'deny', reason: 'The command contains what looks like a credential.' };
    }
    if (/\bgit\b[^;&|\n]*\bpush\b/.test(command) && /^(main|master)$/.test(ctx.branch || '')
      && !/\bpush\b[^;&|\n]*\s(-u\s+)?\S+\s+\S*ticket-/.test(command)) {
      return { id: 'git-push-from-main', decision: 'deny', reason: 'You are on main; work reaches main only through a reviewed pull request.' };
    }
    for (const rule of BASH_RULES) {
      if (rule.test(command, ctx)) return { id: rule.id, decision: rule.decision, reason: rule.reason };
    }
    return null;
  }

  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const p = ti.file_path || ti.notebook_path;
    const hit = checkPath(p, ctx, { writing: true });
    if (hit) return hit;
    const text = [ti.content, ti.new_string, ti.new_source, ...(ti.edits || []).map(e => e.new_string)].filter(Boolean).join('\n');
    if (hasSecret(text)) return { id: 'secret-in-file', decision: 'deny', reason: 'The new content contains what looks like a credential.' };
    return null;
  }

  if (tool === 'Read') return checkPath(ti.file_path, ctx, { writing: false });

  if (tool === 'WebFetch') {
    if (hasSecret(String(ti.url || '')) || hasSecret(String(ti.prompt || ''))) {
      return { id: 'secret-in-url', decision: 'deny', reason: 'The request carries what looks like a credential.' };
    }
    return null;
  }
  return null;
}

function currentBranch(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}

function respond(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: `Factory guard: ${reason}` },
  }));
}

function main() {
  let input;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
    const ctx = { projectDir, home: homedir(), branch: currentBranch(input.cwd || projectDir) };
    const hit = evaluate(input, ctx);
    if (!hit) return;
    respond(hit.decision, hit.reason);
    try {
      const log = path.join(projectDir, '.claude', 'guard-log.jsonl');
      if (existsSync(path.dirname(log))) {
        const ti = input.tool_input || {};
        const what = String(ti.command || ti.file_path || ti.url || '').replace(/\s+/g, ' ').slice(0, 200);
        appendFileSync(log, JSON.stringify({ ts: new Date().toISOString(), session: input.session_id, tool: input.tool_name, rule: hit.id, decision: hit.decision, what: hasSecret(what) ? '[redacted]' : what }) + '\n');
      }
    } catch { /* logging is best effort */ }
  } catch (err) {
    respond('deny', `the guard hook failed (${err.message}), so the call was blocked. Check .claude/hooks/guard.mjs.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
