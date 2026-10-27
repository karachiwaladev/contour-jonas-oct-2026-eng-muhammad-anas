# Notes

A tiny notes app as plain ES modules, no dependencies.

- **Storage:** `data/notes.json`, an array of `{id, text, createdAt}`. This file holds the user's real notes.
- **Code:** `store.js` (load, save, add), `cli.js` (`add` / `list`), `export.js` (Markdown for the weekly digest).
- **Tests:** none yet. Use Node's built-in runner (`node --test`).
