# Ticket #19 — Search box (plan)

**Goal:** A search box that filters tasks by **title and tag** as you type, combining with the existing status/tag/priority filters. Clearing it shows everything.

**Clarified:** match against title **and** tags (case-insensitive substring); the query **resets on reload** (in-memory, like the status filter — no stored data).

## Files
- **Modify** `todo/index.html` (single-file app) — add the input, the state, and one filter step.
- **Create** `todo/tests/issue-19.verify.mjs` — browser checks (written first).
- **Update** `todo/CLAUDE.md` (document search) and the root `CLAUDE.md` todo row.

## How it works
- A `<input type="search" id="search" aria-label="Search tasks" placeholder="Search tasks…">` above the filter row.
- `let query = ''`; on `input`, `query = value.trim().toLowerCase(); refresh(db)`.
- One added step in the existing `visible` pipeline:
  `.filter(t => !query || t.title.toLowerCase().includes(query) || (t.tags||[]).some(tag => tag.toLowerCase().includes(query)))`.
- Empty query → the `!query` guard shows everything. It is just another `.filter` in the chain, so it combines with status, tag and priority filters automatically.
- a11y: `type="search"`, `aria-label`, the app's existing visible focus ring and 44px target.

## Browser verification (headless Edge, `verify-in-edge.mjs`)
1. Add tasks "Buy milk" #home, "Work report" #work, "Walk dog" #home. Type `work` → only "Work report" (title match) and nothing else; `report` → "Work report"; `home` → the two #home tasks (tag match). Case: `WORK` behaves like `work`.
2. Combine: set status = Incomplete, type `home` → only incomplete #home tasks.
3. Clear the box → all tasks return.
4. Reload → box is empty, all tasks shown (no persisted query).
5. Console clean; screenshots of the empty, searching and combined states.

## Safety
- **Network:** none.
- **Third-party code:** none.
- **Stored data:** none changed — the query is in-memory and resets on reload; existing task records are read as-is, never rewritten.
- **Outside the project folder:** none (only `todo/`).
- **Credentials:** none.
