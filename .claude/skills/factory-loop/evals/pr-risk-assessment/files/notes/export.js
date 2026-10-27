// Exports notes as Markdown for the weekly digest email.
import { load } from './store.js';

export function toMarkdown(notes = load()) {
  return notes.map(n => `- ${n.text} _(${n.createdAt.slice(0, 10)})_`).join('\n');
}
