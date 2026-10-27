#!/usr/bin/env node
// Deterministic screen for factory tickets, plans and diffs.
//
//   node screen.mjs ticket <issue.json>   # gh issue view N --json number,title,body,author,labels,comments
//   node screen.mjs text   <file.md>      # a plan or any text the loop is about to act on
//   node screen.mjs diff   <file.diff>    # git diff origin/main...HEAD
//   (use - for stdin; add --self <login> to skip the loop's own comments)
//
// Prints JSON: { verdict: "clean" | "hold", score, flags: [{ id, category, severity, where, excerpt }] }
// and exits 0 for clean, 10 for hold.
//
// This is the floor, not the ceiling. Harmful tickets are often written to
// look like ordinary features, so the signals below look at what the work
// would DO (where data goes, what code gets loaded, what the factory itself
// would change), not only at obviously hostile words. The skill adds a model
// review on top; either one can hold a ticket, neither can release one the
// other held.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HIGH = 3, MEDIUM = 2, LOW = 1;

// Hosts that ordinary tickets may mention without raising a flag.
const KNOWN_HOSTS = /(^|\.)(github\.com|githubusercontent\.com|github\.io|wikipedia\.org|wikimedia\.org|developer\.mozilla\.org|mdn\.io|w3\.org|whatwg\.org|nodejs\.org|npmjs\.com|python\.org|stackoverflow\.com|anthropic\.com|claude\.ai|claude\.com|example\.com|example\.org|localhost|127\.0\.0\.1|pbs\.gov\.pk|britannica\.com|un\.org|worldbank\.org)$/;

// Text signals. `re` runs on normalized lowercase text. Severity is what the
// signal is worth on its own; several weaker ones add up.
export const TEXT_SIGNALS = [
  // --- talking to the agent instead of a developer -------------------------
  { id: 'prompt-injection', category: 'injection', severity: HIGH,
    re: /\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all|your|the|any)\b.{0,20}\b(instructions?|rules?|prompts?|guidelines|guardrails?|constraints|policies)\b/ },
  { id: 'addresses-agent', category: 'injection', severity: HIGH,
    re: /(^|\n|[.!>]\s*)(hey |dear |note (to|for) (the )?|attention:? |instructions? (to|for) (the )?)?(claude|ai|a\.i\.|llm|agent|assistant|bot|copilot|chatgpt|gpt|model|automation|factory loop)\b\s*[,:;-]|\b(note|message|instructions?|reminder) (to|for) (the )?(ai|agent|assistant|bot|llm|model|claude|automation)\b|\b(if you are|you are) (an? )?(ai|llm|language model|agent|assistant|bot)\b|\bas an ai\b/ },
  { id: 'role-override', category: 'injection', severity: HIGH,
    re: /\b(you are now|from now on,? you|act as|pretend (to be|you are)|new (system )?instructions|system prompt|developer mode|jailbreak|\bdan\b mode)|<\/?(system|assistant|instructions?)>|\[\/?inst\]|^\s*(system|assistant)\s*:/m },
  { id: 'secrecy', category: 'injection', severity: HIGH,
    re: /\b(do not|don't|dont|never|without)\b.{0,15}\b(tell|telling|inform|informing|mention|mentioning|notify|notifying|alert|alerting|report|reporting|log|logging|show|showing)\b.{0,25}\b(user|human|owner|maintainer|reviewer|anyone|this|it)\b|\b(quietly|silently|secretly|discreetly|covertly)\b/ },
  { id: 'skip-process', category: 'injection', severity: HIGH,
    re: /\b(skip|bypass|disable|avoid|without|no need for|don't bother with|dont bother with)\b.{0,20}\b(review|approval|approve|security scan|scan|tests?|verification|verify|plan|clarif\w*|questions|checks?|guard\w*|hooks?|pull request|pr)\b/ },
  { id: 'authority-claim', category: 'social', severity: MEDIUM,
    re: /\b(i am|i'm|im|this is|on behalf of|message from)\b.{0,12}\b(the )?(repo(sitory)? )?(owner|admin|administrator|maintainer|anthropic|github( staff| support)?|security team|your (developer|creator|operator))\b|\b(pre-?approved|already approved|approved by|authori[sz]ed by|you (have|are given) (my )?permission|i (authori[sz]e|give you permission))\b/ },
  { id: 'urgency', category: 'social', severity: LOW,
    re: /\b(urgent|asap|immediately|right now|emergency|critical fix|before (anyone|the reviewer)|no time to)\b/ },

  // --- changing the factory instead of a project ---------------------------
  { id: 'factory-infra', category: 'factory', severity: HIGH,
    re: /(\.claude\/|claude\.md\b.{0,40}\b(rule|loop|instruction)|settings(\.local)?\.json|\.mcp\.json|\bpretooluse\b|\bstop hook\b|guard\.mjs|ticket-screen|factory[- ]loop|screen-approved|needs-human-review|\.github\/workflows|github actions? workflow|\bci (config|pipeline|workflow)\b)/ },
  { id: 'loop-behaviour', category: 'factory', severity: HIGH,
    re: /\b(auto-?merge|merge (it|the pr|this pr|your pr|the pull request|directly|automatically|yourself)|push (it |directly |straight )?(to|into) (main|master)|commit (directly |straight )?(to|on|into) (main|master)|(close|delete|lock|edit) (all|every|other|the other|older|stale|remaining|duplicate)( (other|open|the|stale|remaining|older|duplicate))* (issues|tickets|prs|pull requests)|approve (the|your|this|own) (pr|pull request)|grant .{0,20}(access|permission|admin|write)|add .{0,20}as (a )?(collaborator|admin|maintainer))\b/ },

  // --- destructive ---------------------------------------------------------
  { id: 'destructive-git', category: 'destructive', severity: HIGH,
    re: /\b(force[- ]?push|push (-f|--force)|reset --hard|rewrite (the )?(git )?history|delete (the )?(repo|repository|branch(es)?|history|main|master|tags?|releases?)|git clean -f|filter-branch|rebase (main|master|onto))\b/ },
  { id: 'destructive-fs', category: 'destructive', severity: HIGH,
    re: /\brm\s+-[a-z]*[rf]|\b(wipe|format|shred) (the )?(disk|drive|machine|home|repo|directory|folder)|\bdrop (table|database|schema)\b|\bdeltree\b|\bmkfs\b/ },
  { id: 'data-loss-feature', category: 'destructive', severity: HIGH,
    re: /\b(clear|reset|wipe|purge|erase|delete|remove|drop|overwrite|truncate|reinitiali[sz]e)\b.{0,25}\b(all|every|existing|old|stored|saved|users?'?|previous|the)\b.{0,20}\b(data|tasks|todos|notes|records|database|db|indexeddb|localstorage|storage|history|entries|files)\b.{0,40}(\b(on (load|start|startup|open|update|upgrade|every)|automatically|each time|without (asking|confirm\w*|a backup|backup)|no (backup|confirm\w*))\b)/ },

  // --- secrets ---------------------------------------------------------------
  { id: 'secret-access', category: 'secrets', severity: HIGH,
    re: /\b(print|show|echo|cat|dump|reveal|send|post|share|paste|upload|leak|output|include|list|display|log|return|expose|read|copy|attach|commit)(s|ed|ing)?\b.{0,40}\b(tokens?|secrets?|api[ _-]?keys?|passwords?|passwd|credentials?|ssh[ _-]?keys?|private[ _-]?keys?|\.env\b|env(ironment)? var(iable)?s|process\.env|gh auth|cookies?|session ids?|keychain|hosts\.yml)\b/ },
  { id: 'secret-paths', category: 'secrets', severity: HIGH,
    re: /(~|\$home|\/users\/[^/\s]+|\/home\/[^/\s]+)\/\.(ssh|aws|gnupg|config\/gh|netrc|npmrc|docker|kube)|\bid_(rsa|ed25519|ecdsa)\b|\bgh auth token\b|\bprintenv\b|\b(github|gh|anthropic|openai|aws|npm)_(token|api_key|secret\w*)\b/ },
  { id: 'credential-handling', category: 'secrets', severity: HIGH,
    re: /\b(store|save|keep|cache|persist|hard-?code|embed|put|write)\b.{0,30}\b(token|password|api[ _-]?key|secret|credential)s?\b.{0,40}\b(localstorage|indexeddb|cookie|source|code|repo|file|html|js|config|plain ?text)\b|\b(hard-?code|embed)\b.{0,20}\b(token|key|password|secret)/ },

  // --- data leaving the machine (often dressed up as a feature) --------------
  { id: 'send-data-out', category: 'exfiltration', severity: HIGH,
    re: /\b(send|post|upload|sync|report|forward|beacon|stream|mirror|transmit|submit|push|ship|pipe|relay|copy|back ?up)\b.{0,50}\b(to|into|with|via)\b.{0,15}(https?:\/\/|\b(our|my|a|an|the|external|remote|third[- ]party|central|cloud)\b.{0,15}\b(server|endpoint|webhook|url|api|collector|service|backend|bucket|cloud|domain)\b)/ },
  { id: 'data-in-url', category: 'exfiltration', severity: HIGH,
    // User data folded into a URL (image src, link, query string) leaves the machine with every request.
    re: /\b(src|url|href|link|query( string)?|param(eter)?s?|seed|path)\b.{0,80}\b(followed by|joined|concatenat\w*|append\w*|plus|\+|with|containing|including|built from|made from|set to)\b.{0,40}\b(all |every |the |each )?(the )?(task|todo|note|item|entry|record|user|search|form|input|title|content|text|name|email|data|list)s?\b.{0,30}\b(titles?|names?|text|content|data|list|values?|input|fields?|ids?)?\b/ },
  { id: 'telemetry', category: 'exfiltration', severity: MEDIUM,
    re: /\b(telemetry|analytics|tracking (pixel|script|code)|tracker|phone home|usage (data|stats|reporting)|error reporting to|fingerprint\w*|geolocation)\b/ },
  { id: 'surveillance', category: 'exfiltration', severity: HIGH,
    re: /\b(keystrokes?|keylog\w*|key ?presses|clipboard|session replay|screen ?(capture|recording)|record (the )?(screen|camera|microphone|audio)|camera|microphone)\b/ },
  { id: 'exfil-service', category: 'exfiltration', severity: HIGH,
    re: /\b(webhook\.site|requestbin|pipedream|pastebin|hastebin|ngrok|burpcollaborator|interact\.sh|oast\.\w+|canarytokens|transfer\.sh|file\.io|discord(app)?\.com\/api\/webhooks|hooks\.slack\.com)\b/ },

  // --- running or loading code nobody reviewed -------------------------------
  { id: 'remote-exec', category: 'remote-code', severity: HIGH,
    re: /\b(curl|wget|iwr|invoke-webrequest)\b[^\n]{0,120}\|\s*(sudo\s+)?(ba|z)?sh\b|\bbash\s+<\(|\b(download|fetch|get|pull)\b.{0,30}\b(and|then)\b.{0,10}\b(run|execute|exec|source|eval|install)\b|\b(run|execute|exec)\b.{0,20}\b(this|the following|the attached|that) (script|command|payload|binary|snippet|one-?liner)\b/ },
  { id: 'instructions-by-reference', category: 'remote-code', severity: HIGH,
    re: /\b(follow|apply|use|run|execute|read and follow|do what)\b.{0,30}\b(instructions|steps|script|config|setup|commands?|playbook|runbook|prompt)\b.{0,20}\b(at|from|in|on|found at|hosted at)\b.{0,10}(https?:\/\/|gist|pastebin|this (link|url|doc))/ },
  { id: 'third-party-code', category: 'remote-code', severity: MEDIUM,
    re: /<script[^>]*\bsrc\s*=\s*["']?(https?:)?\/\/|\bimport\b[^\n]{0,40}["']https?:\/\/|\b(load|include|embed|inject|add)\b.{0,30}\b(script|widget|snippet|sdk|library|js)\b.{0,30}\b(from|via|hosted)\b.{0,20}(https?:\/\/|\bcdn\b|\bour\b|\btheir\b)|@latest\b/ },
  { id: 'install-hooks', category: 'remote-code', severity: HIGH,
    re: /\b(postinstall|preinstall|prepare)\b.{0,30}\b(script|hook)?|\b(npm|pip|yarn|pnpm) (i|install|add)\b[^\n]{0,60}(https?:\/\/|git\+|\.tgz|\.tar\.gz|github:)/ },
  { id: 'new-dependency', category: 'remote-code', severity: LOW,
    re: /\b(npm|pip|yarn|pnpm|brew|gem|cargo) (i|install|add)\b|\badd (the |a )?(dependency|package|library) /},
  { id: 'unsafe-code', category: 'weakening', severity: MEDIUM,
    re: /\beval\s*\(|\bnew function\s*\(|\bdocument\.write\b|\binnerhtml\b.{0,30}\b(user|input|param|query|url|hash|ticket|comment)|\bdangerouslysetinnerhtml\b|\bchild_process\b|\bexecsync\b/ },
  { id: 'weaken-security', category: 'weakening', severity: HIGH,
    re: /\b(disable|remove|turn off|bypass|loosen|relax|drop|skip)\b.{0,25}\b(csp|content[- ]security[- ]policy|cors|auth\w*|login|password check|validation|sanitiz\w*|escap\w*|https|ssl|tls|certificate|signature|2fa|mfa|rate limit\w*|sandbox|permissions?|security)\b|access-control-allow-origin:\s*\*|--no-verify\b|\bverify\s*=\s*false\b|rejectunauthorized\s*:\s*false/ },
  { id: 'backdoor', category: 'weakening', severity: HIGH,
    re: /\b(backdoor|master password|admin password|hidden (\w+ )?(admin|route|page|panel|account|endpoint|user|feature|login)|secret (route|endpoint|page|admin|login|url)|debug (route|endpoint|page)\b.{0,30}\b(show|return|expose|dump|list)|bypass (login|auth))\b/ },
  { id: 'crypto-mining', category: 'abuse', severity: HIGH,
    re: /\b(crypto ?miner|coinhive|xmrig|monero|mining script|wallet address|bitcoin address|eth address)\b/ },

  // --- reaching outside the project ------------------------------------------
  { id: 'outside-project', category: 'scope', severity: HIGH,
    re: /(^|[\s`'"(])(\/etc\/|\/usr\/|\/bin\/|\/system\/|\/library\/|~\/|\$home\/|\.\.\/\.\.\/|c:\\)|\b(other|another|different|third[- ]party) (repo|repository|organization|org|account)\b|\bfork (it|this) (to|into)\b|\b(git remote (add|set-url)|change the (remote|origin))\b/ },
];

// Structural tricks: things meant to hide text from the human reading the ticket.
function structuralSignals(raw) {
  const flags = [];
  if (/[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD]/.test(raw)) flags.push({ id: 'zero-width-chars', category: 'hidden', severity: HIGH, excerpt: 'zero-width or soft-hyphen characters' });
  if (/[\u202A-\u202E\u2066-\u2069]/.test(raw)) flags.push({ id: 'bidi-control-chars', category: 'hidden', severity: HIGH, excerpt: 'bidirectional override characters' });
  if (/[\uE000-\uF8FF]|[\u{E0000}-\u{E007F}]/u.test(raw)) flags.push({ id: 'tag-or-private-chars', category: 'hidden', severity: HIGH, excerpt: 'Unicode tag / private-use characters' });
  for (const w of raw.match(/[\p{L}]{3,}/gu) || []) {
    const latin = /[a-zA-Z]/.test(w), other = /[\u0370-\u03FF\u0400-\u04FF\u0500-\u052F]/.test(w);
    if (latin && other) { flags.push({ id: 'homoglyphs', category: 'hidden', severity: HIGH, excerpt: `mixed-script word "${sanitize(w)}"` }); break; }
  }
  if (/<(span|div|p|font|sub|sup)[^>]*style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|opacity\s*:\s*0|color\s*:\s*(white|#fff\b|#ffffff|transparent))/i.test(raw)
    || /<[^>]+\bhidden\b[^>]*>/i.test(raw) && !/<details/i.test(raw)) {
    flags.push({ id: 'css-hidden-text', category: 'hidden', severity: HIGH, excerpt: 'text styled to be invisible' });
  }
  if (/\[[^\]]*\]\(\s*(javascript|data|vbscript):/i.test(raw)) flags.push({ id: 'script-link', category: 'hidden', severity: HIGH, excerpt: 'javascript:/data: link' });
  for (const m of raw.matchAll(/\[(https?:\/\/[^\]\s]+)\]\((https?:\/\/[^)\s]+)\)/gi)) {
    if (hostOf(m[1]) !== hostOf(m[2])) { flags.push({ id: 'misleading-link', category: 'hidden', severity: MEDIUM, excerpt: `link text ${hostOf(m[1])} points to ${hostOf(m[2])}` }); break; }
  }
  if (/(\\x[0-9a-f]{2}){6,}|(\\u[0-9a-f]{4}){6,}|(%[0-9a-f]{2}){10,}/i.test(raw)) flags.push({ id: 'escaped-payload', category: 'hidden', severity: MEDIUM, excerpt: 'long escaped byte sequence' });
  if (/\b(rot13|base64|b64|hex)\b.{0,20}\b(decode|decoded|encoded|this)\b/i.test(raw)) flags.push({ id: 'decode-request', category: 'hidden', severity: MEDIUM, excerpt: 'asks to decode something' });
  return flags;
}

// Inner content that a reader doesn't see rendered: HTML comments, base64
// blobs (decoded), <details> bodies. Each is screened again as text, and
// anything found inside it counts one level more severe.
function hiddenLayers(raw) {
  const layers = [];
  for (const m of raw.matchAll(/<!--([\s\S]*?)(-->|$)/g)) if (m[1].trim()) layers.push({ where: 'html-comment', text: m[1] });
  for (const m of raw.matchAll(/[A-Za-z0-9+/]{40,}={0,2}/g)) {
    try {
      const decoded = Buffer.from(m[0], 'base64').toString('utf8');
      if (/^[\x09\x0A\x0D\x20-\x7E]{20,}$/.test(decoded)) layers.push({ where: 'base64', text: decoded });
    } catch { /* not base64 */ }
  }
  return layers;
}

const hostOf = u => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

export function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[ \t]+/g, ' ');
}

// Short, safe excerpt for the report: no control chars, no secrets, capped.
function sanitize(s) {
  return String(s).replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, ' ')
    .replace(/\b(gh[pousr]_|github_pat_|sk-ant-|sk-|AKIA)[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
}

function urlSignals(raw) {
  const flags = [];
  const hosts = new Set([...raw.matchAll(/https?:\/\/([^/\s'"<>)\]]+)/gi)].map(m => m[1].toLowerCase().replace(/:\d+$/, '')));
  const unknown = [...hosts].filter(h => !KNOWN_HOSTS.test(h));
  if (unknown.length) flags.push({ id: 'unknown-host', category: 'exfiltration', severity: LOW, excerpt: unknown.slice(0, 3).join(', ') });
  for (const h of hosts) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) && !/^(127\.|10\.|192\.168\.)/.test(h)) flags.push({ id: 'raw-ip-host', category: 'exfiltration', severity: MEDIUM, excerpt: h });
  }
  if (/https?:\/\/[^\s)]+\.(sh|ps1|bat|exe|bin|dmg|pkg|msi|py|scr)(\b|$)/i.test(raw)) flags.push({ id: 'script-download', category: 'remote-code', severity: MEDIUM, excerpt: 'link to an executable or script' });
  return flags;
}

export function screenText(raw, where = 'body', { bump = 0 } = {}) {
  const flags = [];
  const text = normalize(raw);
  for (const s of TEXT_SIGNALS) {
    const m = text.match(s.re);
    if (m) flags.push({ id: s.id, category: s.category, severity: Math.min(HIGH, s.severity + bump), where, excerpt: sanitize(m[0]) });
  }
  if (/\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{22,}|sk-ant-[\w-]{20,}|AKIA[0-9A-Z]{16})|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(raw)) {
    flags.push({ id: 'credential-in-text', category: 'secrets', severity: HIGH, where, excerpt: '[credential-shaped string]' });
  }
  for (const f of [...structuralSignals(raw), ...urlSignals(raw)]) flags.push({ ...f, where, severity: Math.min(HIGH, f.severity + bump) });
  if (bump === 0) {
    for (const layer of hiddenLayers(raw)) {
      const inner = screenText(layer.text, `${where}:${layer.where}`, { bump: 1 });
      // A hidden layer is itself worth flagging once; what's inside it counts more.
      flags.push({ id: `hidden-${layer.where}`, category: 'hidden', severity: inner.length ? HIGH : LOW, where, excerpt: sanitize(layer.text) });
      flags.push(...inner);
    }
  }
  return flags;
}

// Diff signals: what the change would actually do once merged.
export function screenDiff(diff) {
  const flags = [];
  const files = [...diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)].map(m => m[2]);
  for (const f of files) {
    if (/^(\.claude\/|\.github\/|\.mcp\.json$|\.git\/|\.gitattributes$|\.gitmodules$)/.test(f)) {
      flags.push({ id: 'diff-touches-factory', category: 'factory', severity: HIGH, where: f, excerpt: f });
    }
    if (/(^|\/)package(-lock)?\.json$|requirements[^/]*\.txt$|pyproject\.toml$|Gemfile|Cargo\.toml$/.test(f)) {
      flags.push({ id: 'diff-dependency-change', category: 'remote-code', severity: MEDIUM, where: f, excerpt: f });
    }
  }
  const added = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)).join('\n');
  const checks = [
    ['diff-network-call', 'exfiltration', HIGH, /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket|new\s+EventSource|\.src\s*=\s*['"`]https?:|axios\.|\$\.(ajax|post|get)\(|https?\.request\(/],
    ['diff-external-script', 'remote-code', HIGH, /<script[^>]*\bsrc\s*=\s*["']?(https?:)?\/\/|<link[^>]*href\s*=\s*["']?(https?:)?\/\/(?!fonts\.googleapis)|\bimport\s*\(?\s*["'`]https?:/],
    ['diff-dynamic-code', 'weakening', HIGH, /(?<![.\w$])eval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*["'`]|document\.write\s*\(/],
    ['diff-process-access', 'secrets', HIGH, /\bprocess\.env\b|\bchild_process\b|\bexecSync\b|\bspawnSync?\b|require\(\s*['"]fs['"]\s*\)/],
    ['diff-credential-storage', 'secrets', HIGH, /(localStorage|sessionStorage|indexedDB|document\.cookie)[^\n]{0,80}\b(token|password|secret|api.?key|credential)/i],
    ['diff-install-hook', 'remote-code', HIGH, /"(postinstall|preinstall|prepare|install)"\s*:/],
    ['diff-unsafe-html', 'weakening', MEDIUM, /\.innerHTML\s*\+?=\s*`[^`]*\$\{|\.innerHTML\s*\+?=\s*[^;\n]*\+\s*[a-z_$]|\.outerHTML\s*=|insertAdjacentHTML\s*\(/i],
    ['diff-weakened-security', 'weakening', HIGH, /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*|rejectUnauthorized\s*:\s*false|unsafe-eval|unsafe-inline|--no-verify/],
    ['diff-data-in-url', 'exfiltration', HIGH, /["'`]https?:\/\/[^"'`\s]+["'`]\s*\+\s*[a-z_$]|`https?:\/\/[^`\s]*\$\{/i],
    ['diff-destructive-storage', 'destructive', MEDIUM, /indexedDB\.deleteDatabase|(local|session)Storage\.clear\s*\(|deleteObjectStore|objectStore\([^)]*\)\.clear\s*\(/],
  ];
  for (const [id, category, severity, re] of checks) {
    const m = added.match(re);
    if (m) flags.push({ id, category, severity, where: 'added lines', excerpt: sanitize(m[0]) });
  }
  const hosts = new Set([...added.matchAll(/https?:\/\/([^/\s'"`<>)]+)/g)].map(m => m[1].toLowerCase()));
  const unknown = [...hosts].filter(h => !KNOWN_HOSTS.test(h) && !/(^|\.)(w3\.org|googleapis\.com|gstatic\.com)$/.test(h));
  if (unknown.length) flags.push({ id: 'diff-new-host', category: 'exfiltration', severity: MEDIUM, where: 'added lines', excerpt: unknown.slice(0, 3).join(', ') });
  if (/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/.test(added)) flags.push({ id: 'diff-hidden-chars', category: 'hidden', severity: HIGH, where: 'added lines', excerpt: 'invisible or bidi characters' });
  if (/[A-Za-z0-9+/]{120,}={0,2}/.test(added)) flags.push({ id: 'diff-encoded-blob', category: 'hidden', severity: MEDIUM, where: 'added lines', excerpt: 'long encoded blob' });
  if (/\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{22,}|sk-ant-[\w-]{20,}|AKIA[0-9A-Z]{16})|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(added)) {
    flags.push({ id: 'diff-secret', category: 'secrets', severity: HIGH, where: 'added lines', excerpt: '[credential-shaped string]' });
  }
  return flags;
}

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// issue: gh issue view --json (author.login, labels[].name, comments[].author.login,
// comments[].authorAssociation) or the REST shape (user.login, author_association).
export function screenIssue(issue, { self } = {}) {
  const flags = [];
  flags.push(...screenText(issue.title || '', 'title'));
  flags.push(...screenText(issue.body || '', 'body'));
  for (const [i, c] of (issue.comments || []).entries()) {
    const login = c.author?.login || c.user?.login;
    if (self && login === self) continue;
    const assoc = c.authorAssociation || c.author_association;
    const cf = screenText(c.body || '', `comment ${i + 1} by ${login || 'unknown'}`);
    // A stranger's comment that steers the work is worth more than the same words from the owner.
    if (assoc && !TRUSTED.has(assoc)) cf.forEach(f => { if (f.severity === MEDIUM) f.severity = HIGH; });
    flags.push(...cf);
  }
  const assoc = issue.authorAssociation || issue.author_association;
  if (assoc && !TRUSTED.has(assoc)) flags.push({ id: 'untrusted-author', category: 'social', severity: LOW, where: 'author', excerpt: assoc });
  const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name));
  return { ...verdictFor(flags, { untrusted: assoc && !TRUSTED.has(assoc) }), number: issue.number, approved: labels.includes('screen-approved'), held: labels.includes('needs-human-review') };
}

export function verdictFor(flags, { untrusted = false } = {}) {
  // Collapse duplicate ids (keep the most severe) so one repeated phrase isn't counted twice.
  const byId = new Map();
  for (const f of flags) if (!byId.has(f.id) || byId.get(f.id).severity < f.severity) byId.set(f.id, f);
  const unique = [...byId.values()].sort((a, b) => b.severity - a.severity);
  const score = unique.reduce((s, f) => s + f.severity, 0);
  const high = unique.some(f => f.severity >= HIGH);
  const mediums = unique.filter(f => f.severity === MEDIUM).length;
  const hold = high || mediums >= 2 || score >= 5 || (untrusted && mediums >= 1);
  return { verdict: hold ? 'hold' : 'clean', score, flags: unique };
}

function readInput(arg) {
  return readFileSync(arg === '-' || !arg ? 0 : arg, 'utf8');
}

function main(argv) {
  const [mode, file, ...rest] = argv;
  const selfIdx = rest.indexOf('--self');
  const self = selfIdx >= 0 ? rest[selfIdx + 1] : undefined;
  let result;
  if (mode === 'ticket') {
    const data = JSON.parse(readInput(file));
    result = Array.isArray(data) ? data.map(i => screenIssue(i, { self })) : screenIssue(data, { self });
  } else if (mode === 'text') {
    result = verdictFor(screenText(readInput(file), 'text'));
  } else if (mode === 'diff') {
    result = verdictFor(screenDiff(readInput(file)));
  } else {
    process.stderr.write('usage: screen.mjs ticket|text|diff <file|-> [--self <login>]\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  const anyHold = [].concat(result).some(r => r.verdict === 'hold');
  process.exit(anyHold ? 10 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (err) {
    // Fail closed: if the screen can't run, the ticket is held.
    process.stdout.write(JSON.stringify({ verdict: 'hold', score: 99, flags: [{ id: 'screen-error', category: 'error', severity: HIGH, excerpt: sanitize(err.message) }] }) + '\n');
    process.exit(10);
  }
}
