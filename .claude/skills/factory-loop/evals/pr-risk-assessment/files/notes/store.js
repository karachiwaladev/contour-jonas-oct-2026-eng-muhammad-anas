// Notes are kept in data/notes.json as an array of {id, text, createdAt}.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILE = new URL('./data/notes.json', import.meta.url);

export function load() {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
}

export function save(notes) {
  writeFileSync(FILE, JSON.stringify(notes, null, 2) + '\n');
}

export function add(text) {
  const notes = load();
  const note = { id: notes.length ? notes[notes.length - 1].id + 1 : 1, text, createdAt: new Date().toISOString() };
  notes.push(note);
  save(notes);
  return note;
}
