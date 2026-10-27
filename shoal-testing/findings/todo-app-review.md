# Todo app — persona friction report

A Shoal-style swarm review of `todo/index.html`, run as five local Claude
subagent "AI users" (no API key), each working through the app in character.
Personas are defined in [`../personas.yaml`](../personas.yaml); tasks in
[`../tasks.yaml`](../tasks.yaml).

- **Reviewed:** `todo/index.html` at `main` (before the #19 search box).
- **Personas:** Elder Eleanor, Deaf Dana, Blind Bruno, Child Kai, Multilingual Mara.
- **Nothing was changed.** These are findings for a maintainer to triage, not fixes.

> Line numbers are the reviewers' own and may drift as the file changes; treat
> them as pointers, not exact anchors.

## Friction map — ranked by how many personas hit it and how hard

| # | Friction | Severity | Hit by | One-line fix |
|---|----------|----------|--------|--------------|
| 1 | **Delete is one tap, instant, no confirm or undo** | **blocker** | Eleanor, Kai, Dana, Bruno | Add an "Deleted — Undo" snackbar (visual) or a confirm step. |
| 2 | **Screen reader: focus is lost after complete/delete** (the focused button is destroyed, focus falls to `<body>`) | **blocker** | Bruno | After refresh, move focus to the next task's matching control or a live region. |
| 3 | **List changes (add/delete/complete/filter) are never announced** (`#list` has no `aria-live`; status-filter changes are fully silent) | **major** | Bruno | Add a visually-hidden `aria-live="polite"` region posting "Task added/deleted", "Showing N completed". |
| 4 | **Whitespace-only / empty title fails silently** (`if (!title) return;` with no visible message) | **major** | Dana, Kai, Bruno | Mark the input invalid + a short inline error instead of a silent return. |
| 5 | **Jargon labels** — "Incomplete", "Priority", "Repeat", "Overdue" are abstract/reversed-sounding to a limited-English reader | **major** | Mara | "To do" / "Importance" (or dots only) / "Every day…" / "Late"; pair icons with plain words. |
| 6 | **Edit & Delete are icon-only, unlabeled, and close together** — easy to confuse and mis-tap (delete is destructive) | **major** | Eleanor, Mara, Kai | Add visible text/tooltips, separate them, make delete clearly red. |
| 7 | **"Mark done" is a tiny (26px) icon-only circle** — under the 44px target and unrecognisable as a control | **major** | Eleanor (also Bruno OK via aria) | Enlarge the hit area to ≥44px; add a "Done" label/tooltip. |
| 8 | **Recurring task: rapid taps / stale closure can spawn duplicate next occurrences** (the dup-guard tests a render-time `task` object, not fresh DB state) | **major** (correctness) | Kai, Dana | Re-read the task from the store inside `toggleDone`, or debounce/disable the check while the await is in flight. |
| 9 | **Add while the "Completed" filter is active → task saves but no visible row appears** (primary confirmation missing) | **major** | Dana, Bruno | After add, switch to a filter that shows it, or flash "Task added". |
| 10 | **Double-submitting Add creates duplicates** (`input.value` cleared only after the await) | **minor** | Kai | Clear/disable the input synchronously before the await, or guard with an in-flight flag. |
| 11 | **Tag chip editor: no visible hint that Enter commits; nothing announced** | **major** | Eleanor, Bruno | Show "Type a tag and press Enter"; announce "Added tag …" via live region. |
| 12 | **Add button loses its only label at ≤420px** (`.add span { display:none }`, SVG is `aria-hidden`) | **minor** | Eleanor, Bruno | Add `aria-label="Add task"` and/or keep the text on small screens. |
| 13 | **Small secondary text** (meta `.8rem`, tags `.75rem`) and **sub-44px targets** (filters 40px, chip-remove 20px) | **minor** | Eleanor | Raise secondary text toward ~1rem; bump targets to 44px. |
| 14 | **No visible labels on Due date / placeholders read as questions** ("What needs doing?") | **minor** | Eleanor, Mara | Add visible labels; use "Write a task". |
| 15 | **Inline-edit chips/tag buttons: purpose conveyed only by `title`, not `aria-label`** | **minor** | Bruno | `aria-label="Filter by #work"` on list tag buttons. |

## What every persona praised (keep these)
- **Icon buttons are properly named** — per-task controls all set `aria-label` + `aria-pressed`; no "button button" (Bruno).
- **State isn't colour-only** — overdue/priority/repeat render as real text ("Overdue · Oct 5", "High priority"); done shows a filled check + strikethrough (Dana, Bruno).
- **Strong visible focus** (`:focus-visible` 3px outline) and mostly 44px targets (all).
- **No audio dependence** — every success is shown visually (Dana).
- **Forgiving inputs & satisfying check** — emoji/gibberish accepted, long text wraps, the check fill is rewarding (Kai).

## Per-persona summaries

### Elder Eleanor (older, first-time) — patience low
Core task (ticking something off) rides on a tiny unlabeled circle she didn't recognise; delete vanished a task with no "Are you sure?" or undo, which frightened her; tag entry gave no readable hint that Enter commits; lots of small text. Praised plain-word filters and the big "Add" button.

### Deaf Dana (visual-only feedback) — patience medium
Relieved by zero audio dependence; every success is visible. But whitespace-only add fails with no on-screen message, and adding while "Completed" is active shows no new row — her primary confirmation is missing. Delete gives no acknowledgement beyond the row disappearing.

### Blind Bruno (screen reader + keyboard) — patience medium
The most technical review. Strong baseline (named icon buttons, `aria-pressed`, real `<label>`, focus into edit). Blockers/majors: **focus falls to `<body>` after complete/delete**, list mutations are **never announced** (no `aria-live` on the list), chip add/remove is silent, and inline-edit close doesn't restore focus to the Edit button.

### Child Kai (impatient, random taps) — patience very-low
Loved the check animation and forgiving inputs. Hit real bugs by mashing: **delete is gone-forever with no undo**, **rapid-tapping a recurring task spawns duplicate occurrences**, and **double-submit creates duplicate tasks**; empty add does nothing visible (looks broken).

### Multilingual Mara (limited English) — patience low
Stalled on jargon: "Incomplete" reads as "finished", "Priority"/"Repeat"/"Overdue" are unknown words, the placeholder is a question, icon-only edit/delete have no words. Praised the "+" / "Add" pairing, meaningful red = attention, and the symbol-readable done state.

## Suggested next steps (for a maintainer)
These are app-behaviour changes and several need a product call, so they belong
in tickets, not an automatic fix:
1. **Delete safety** (undo snackbar or confirm) — hit by 4/5 personas; highest-value single change.
2. **Screen-reader focus management + a live region** — closes Bruno's blocker and most majors at once.
3. **The recurring-task duplicate-spawn bug** — a genuine correctness defect (re-read from store / debounce).
4. **Plain-language + icon-with-label pass** on filter and badge wording.
5. **Visible "Mark done" affordance** and consistent 44px targets.
