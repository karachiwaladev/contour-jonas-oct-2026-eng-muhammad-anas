# shoal-testing — persona AI-user testing for the todo app

A dev tool that puts a **swarm of persona "AI users"** through our todo app and
collects the friction they hit — inspired by [Shoal](https://github.com/Raynan00/shoal)
("a swarm of AI users that test your website in real browsers"). This folder is
self-contained and does **not** touch the todo app's code.

The persona set here is deliberately **accessibility- and inclusion-first**: an
older user, a Deaf user, a blind user, a child, and a user with limited English.
A swarm like this surfaces problems a typical able, fluent, experienced tester
walks straight past.

## Two ways to run it

### 1. Local persona reviewers (no API key) — the default
Each persona is run as a **local Claude subagent** that reads `todo/index.html`,
works through the app in character, and files friction findings. No Shoal
install, no Playwright, no LLM API key, no spend. This is how
[`findings/todo-app-review.md`](findings/todo-app-review.md) was produced.

To refresh the review: ask Claude Code, in this repo, to
"run the shoal-testing personas against the todo app" — it dispatches one
subagent per persona in [`personas.yaml`](personas.yaml) and re-collates the
report. (A persona reviewer only reads the app and reports; it changes nothing.)

### 2. QuickE2E + Jev — fast behavioural runs (uses your key) — opt-in
For a **fast** pass, [`quicke2e/`](quicke2e/) drives a real browser with
[QuickE2E](https://github.com/dmoka/quicke2e) and the **Jev** decision model
(~300 ms/decision). Each persona becomes a plain-English flow (goal + assertions)
in [`quicke2e/specs/personas.spec.mjs`](quicke2e/specs/personas.spec.mjs); the
model clicks toward the goal and code checks the result. This answers *"can each
persona complete its task-path?"* — fast. The **accessibility depth** (ARIA,
labels, screen reader) stays with mode 1's subagent reviewers.

```bash
cd quicke2e
npm install && npx playwright install chromium
bash run.sh --check     # validate the specs — NO model calls, no key
bash run.sh             # real runs — loads your key, makes paid calls
```

`run.sh` loads your Jev key from the gitignored `.claude/.env` (`jev_api_key=…`)
**at runtime only** — never committed, logged, or printed — and maps it to
`OPENROUTER_API_KEY`, which QuickE2E's `jev` engine reads. The jev engine sends
each page's URL/title/elements/goal to OpenRouter (a third party) and spends on
your key; it's our own todo app, so no secrets leave. If the key is a Vercel AI
Gateway key instead, use `--engine vercel`; the keyless `local` engine (Apple
Silicon) needs no key. `node_modules/` and `results/` are gitignored.

### 3. A real Shoal run (needs a key) — opt-in
`personas.yaml` is written to Shoal's persona schema, so you can drop it into a
real Shoal checkout and drive actual browsers:

```bash
# in a Shoal checkout (see https://github.com/Raynan00/shoal)
npm install
npx playwright install chromium
export ANTHROPIC_API_KEY=...        # your key, at runtime only — never commit it
npx serve /path/to/this-repo/todo   # serve the todo app locally
npm run shoal -- run http://localhost:3000 --task "Add a task, give it a due date and a tag, complete it, then delete it" --personas /path/to/personas.yaml
```

This makes real LLM calls and costs tokens. This training repo's rule is **no
real keys** — so keep the key in your environment at runtime and never commit it.

## Files
- [`personas.yaml`](personas.yaml) — the five accessibility personas (Shoal schema).
- [`tasks.yaml`](tasks.yaml) — the user tasks the personas attempt.
- [`findings/todo-app-review.md`](findings/todo-app-review.md) — the collated
  friction report from the local persona reviewers.

## Safety
- The local reviewers only **read** `todo/index.html` and report; they modify nothing.
- No network calls and no API key in the default (local-reviewer) path.
- A real Shoal run is opt-in, uses a key you supply at runtime, and is never
  wired up with a committed secret.
