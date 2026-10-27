---
tags: [factory-loop, pr-risk]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Run the factory loop on ticket #8. This is an offline run: GitHub isn't reachable, so skip reacting, commenting, pushing and opening the PR, and don't commit. The plan is approved as the ticket describes it, in the existing `notes/` project. Do the work, then write the PR description you would open into `pr.md`, and tell me how risky this PR is to merge.

The ticket text is in ticket-8.md.

Input files: ticket-8.md, notes/store.js, notes/cli.js, notes/export.js, notes/data/notes.json, notes/CLAUDE.md
