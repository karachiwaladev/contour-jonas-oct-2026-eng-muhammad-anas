---
name: self-improve
description: Run a self-improvement round on this repo: trace real problems (failing or missing tests, gaps in the ticket screen or guard hook, guard false positives, drift between CLAUDE.md and the skills, open review comments, known project bugs), fix the top few test-first on a branch, and open one PR for review. Use when asked to harden, improve, tighten or "make the repo more concrete", or to run the self-improvement loop. Never merges; a person reviews every PR.
---

# Self-improve

A round that makes the factory and its projects more solid, one reviewed PR at a time. It finds problems from evidence, fixes the most serious few test-first, and proves nothing else broke. It never merges and never weakens a safety check to make a test pass.

**This runs under the factory's own rules.** The `ticket-screen` and guard tests, and every benign past ticket, are the floor: a round may raise the bar but never lower it. The guard hook still asks a person before editing hooks, settings, CI or skills.

## Each round

### 1. Trace — gather real problems, with evidence

Run these and record what they show. A problem counts only if a command shows it, never from memory.

```bash
node --test .claude/skills/ticket-screen/tests/screen.test.mjs   # screen
node --test .claude/hooks/tests/guard.test.mjs                   # guard
# project suites, e.g. the todo app:
node .claude/skills/factory-loop/scripts/verify-in-edge.mjs todo/index.html todo/tests/issue-5.verify.mjs todo/screenshots
```

Then look for:

- **Failing or missing tests:** any red test, and any behaviour in a project's `CLAUDE.md` with no test behind it.
- **Screen gaps:** probe `screen.mjs` with fresh hostile phrasings the committed tests don't cover (new exfil wording, obfuscation, dynamic code, factory tampering). A miss that a reasonable reviewer would call an attack is a finding.
- **Guard false positives:** read `.claude/guard-log.jsonl`. A block of a command the factory loop legitimately runs is a finding. (A block of a genuinely dangerous or test command is the guard working — not a finding.)
- **Rule drift:** claims in the root `CLAUDE.md` or a skill that no longer match the code (a renamed file, a removed flag, a step that can't run).
- **Open review comments** on this repo's PRs, and project bugs earlier rounds logged in `docs/improvement-log.md`.

**Verify before trusting a lead.** A remembered bug, or one a past agent reported, is a lead, not a fact. Reproduce it against the current code first; drop it if it doesn't reproduce, and say so in the log.

### 2. Rank and pick

Order by how much harm the problem does if left: a screen or guard gap that lets a real attack through, then a failing test, then a false positive, then drift. **Take at most 3 per round** so the PR stays reviewable. Skip anything whose fix would need the user's design decision; raise it in the report instead.

### 3. Fix, test-first

For each picked problem, following `superpowers:test-driven-development`:

1. Write the test that fails because of the problem, and run it to watch it fail for the right reason.
2. Make the smallest change that fixes it.
3. Run the **whole** suite for that area, not just the new test. Every previously-green test, and every benign past ticket, must stay green. If a fix turns one red, the fix is wrong — revise it, don't edit the old test to match.

Hard limits, from the loop's rules:
- Never edit a safety test to make the suite pass.
- Never loosen the screen or the guard to clear a false positive without a new benign test that pins the intended behaviour.
- One branch per round: `factory/improve-<yyyy-mm-dd>-<n>`, from an up-to-date `origin/main`.

### 4. Log

Append a round entry to `docs/improvement-log.md`: the date, each finding with its evidence, what was changed, and anything dropped (and why). Later rounds read this so they don't redo settled work.

### 5. PR (never merge)

Open one PR for the round, with the Risk section the factory loop requires, and run `screen.mjs diff` on the branch first. Report the PR URL. Don't merge, don't approve, don't auto-merge.

## Stopping

Stop when a full trace turns up nothing new to fix, or after 3 rounds in a sitting, whichever comes first. Say which, and list anything found but deferred (needs the user) so it isn't lost.

## Tests

The round's own safety net is the existing suites; keep them green:

```bash
node --test .claude/skills/ticket-screen/tests/screen.test.mjs
node --test .claude/hooks/tests/guard.test.mjs
```
