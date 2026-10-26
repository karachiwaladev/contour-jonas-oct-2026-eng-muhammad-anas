# Todo app

Ticket #4 ("Ticket #3: Todo app"). A single-page todo list: create a task, mark it done, delete it.

- **Run it:** open `index.html` in a browser. No build step, no server, no dependencies.
- **Storage:** IndexedDB (a client-side database). Database `todo-app`, object store `tasks`, records `{id, title, done, createdAt}` with an auto-increment `id`. Data persists per browser and is never sent anywhere.
- **Code:** everything is in `index.html`. The `tasks` object wraps the IndexedDB calls (`all`, `add`, `put`, `remove`), and `render` rebuilds the list after each change.
