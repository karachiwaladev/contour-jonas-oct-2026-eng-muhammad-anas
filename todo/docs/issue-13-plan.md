# Task priority (#13): implementation plan

**Goal:** tasks get a priority (High, Medium, Low or None) that you can set when adding a task, change in inline edit, filter by, and see on each task.

**Architecture:**
- Everything is in `todo/index.html`, like the earlier features.
- Each task gets a new optional field, `priority`, set to `'high' | 'medium' | 'low' | 'none'`.
- Tasks saved before this change have no `priority` field and are read as `'none'`. Nothing is migrated or rewritten, and the IndexedDB version stays at 1.

**Tech stack:**
- Vanilla JS and IndexedDB.
- Browser checks driven by `.claude/skills/factory-loop/scripts/verify-in-edge.mjs` (headless Edge).

**Decisions (agreed on #13):**
- Levels are High, Medium, Low and None. None is the default.
- Old tasks show as None.
- The list stays sorted by due date. Priority only breaks ties, in the order High, Medium, Low, None. Tasks still tied after that keep the order they were added.
- The priority filter is multi-select chips, like the tag filter. Chosen chips match a task with any of them. The chip filter combines (AND) with All / Incomplete / Completed and with the tag filter.

## Global constraints

- No dependencies or build step; the app stays a single file.
- Existing features must keep working: filters, tags, due dates, overdue, recurring tasks and inline edit. The checks in `issue-5.verify.mjs` and `issue-6.verify.mjs` must still pass.
- Keep accessibility: labelled controls, `aria-pressed` on chips, 44px tap targets and the existing colour tokens. Priority isn't shown by colour alone; the badge has a text label.

## Review focus

1. **Old tasks with no `priority` field:** they show no badge, match the None chip, sort as None, and editing one without touching the priority saves it as `'none'`.
2. **Recurring tasks:** the next occurrence keeps the priority. Editing the priority doesn't spawn a new occurrence or affect `spawnedNext`.
3. **Combining filters:** Completed plus #work plus High shows only tasks that match all three. The empty state says "No matching tasks" when a priority or tag filter hides everything.
4. **After adding a task:** the add form's priority select resets to None, like the repeat select does.
5. **After a reload:** a task's priority is still saved. The chip selection is view state only, like the tag filter, so it resets on reload.

## Task 1: priority on add, edit, badge, sort and filter

**Files:**
- Modify `todo/index.html`:
  - the `#new-task` form: add a `<select id="priority" aria-label="Priority">`
  - the data-model comment
  - `byDue`
  - `toggleDone`
  - `editForm`
  - `render`
  - a new `renderPriorityFilters`
  - the add handler
  - CSS for `.priority` badges and the `#priority-filters` chips, reusing the `.tag-filters` styles
- Test: create `todo/tests/issue-13.verify.mjs`.
- Docs: `todo/CLAUDE.md` (data model, features, tests line).

**Interfaces:**
- `PRIORITIES = ['high', 'medium', 'low', 'none']`. This order is also the sort order.
- `PRIORITY_LABEL = {high: 'High', medium: 'Medium', low: 'Low', none: 'None'}`
- `priorityOf(task)`: returns `task.priority`, or `'none'` when it's missing.
- `selectedPriorities`: a `Set`. When it's empty, all tasks show.
- DOM hooks the test uses:
  - `#priority` (the add form)
  - `.edit-form select[aria-label=Priority]`
  - `li .priority` (the badge text: High, Medium or Low; None tasks get no badge)
  - `#priority-filters button[data-priority=<level>]`

**Steps:**

- [ ] **Write `todo/tests/issue-13.verify.mjs` first.** Same style as `issue-6.verify.mjs`: it reads rows from IndexedDB and checks:
  1. Adding tasks with each priority saves the right `priority` value. The add form resets to None.
  2. The badge text shows on High, Medium and Low tasks, and there's no badge on None.
  3. A task added straight into IndexedDB with no `priority` field shows no badge and matches the None chip.
  4. Ordering on the same due date is High, Medium, Low, None. A task with an earlier date still comes first whatever its priority, and undated tasks are still last.
  5. Chip filtering:
     - High alone shows only High tasks.
     - High and Low together show both.
     - Clear shows all of them again.
     - High combined with Completed and with a tag gives only the intersection.
     - The empty state reads "No matching tasks".
  6. Inline edit changes Low to High, and the badge and order update. Esc cancels without saving.
  7. Ticking a recurring High task done creates the next occurrence with priority `'high'`.
  8. Priorities survive a reload.

  Screenshots:
  - `issue-13-list`
  - `issue-13-filter-high`
  - `issue-13-editing`
  - `issue-13-after-reload`
- [ ] **Run it and watch it fail:**
  `node .claude/skills/factory-loop/scripts/verify-in-edge.mjs todo/index.html todo/tests/issue-13.verify.mjs todo/screenshots`
  It should fail because `#priority` doesn't exist yet.
- [ ] **Implement the change in `todo/index.html`:**
  - the select on the add form
  - the select in the edit form
  - the badge
  - `byDue`'s tie-break, using `PRIORITIES.indexOf(priorityOf(t))`
  - `toggleDone` copying `priority` to the next occurrence
  - the chip row, always visible, with a Clear button when chips are selected
  - the filter step in `render`
  - the empty-state text
- [ ] **Run `issue-13.verify.mjs` again.** All checks should pass with no console errors.
- [ ] **Run `issue-5.verify.mjs` and `issue-6.verify.mjs` again.** Both should still pass. If either needs a change, it should only be one that comes from the new chip row; any change gets explained in the PR.
- [ ] **Update `todo/CLAUDE.md`, then commit** on `ticket-13-task-priority` with the message `Todo: task priority (#13)` and `Closes #13` in the body.

## Then, per the factory loop

- Run a Claude Security scan of the branch diff against `main` (medium effort).
- Run the self-review with `superpowers:requesting-code-review`.
- Push the branch.
- Open the PR, with screenshots, the verification checklist and a Security section, and don't merge it.
- Comment on #13 with the PR link and a screenshot.
