// Repo-level integrity checks for the root CLAUDE.md index.
//
// CLAUDE.md calls itself "the source of truth" and enforces "one project per
// folder". A merge once left a duplicate `todo/` row in the Projects table
// (one stale, one current), which these checks would have caught. They also
// pin the file's own "under 100 lines" rule.
//
// Run: node --test tests/claude-md-index.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8');

// Pull the folder cell (first column) from every Projects-table row. Rows look
// like `| \`todo/\` | #4, #5 | ... |`; the folder is the first backticked cell.
function projectFolders(md) {
  const lines = md.split('\n');
  const start = lines.findIndex(l => l.trim() === '### Projects');
  assert.notEqual(start, -1, 'CLAUDE.md must have a "### Projects" section');
  const folders = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('### ')) break;            // next section ends the table
    if (!line.startsWith('|')) continue;
    const first = line.split('|')[1]?.trim() ?? '';
    const m = first.match(/^`([^`]+)`$/);           // a backticked folder cell
    if (m) folders.push(m[1]);
  }
  return folders;
}

test('each project folder appears once in the Projects index', () => {
  const folders = projectFolders(claudeMd);
  assert.ok(folders.length > 0, 'expected at least one project row');
  const seen = new Set();
  const dupes = [];
  for (const f of folders) {
    if (seen.has(f)) dupes.push(f);
    seen.add(f);
  }
  assert.deepEqual(dupes, [], `duplicate project rows in the index: ${dupes.join(', ')}`);
});

test('CLAUDE.md stays under 100 lines (its own rule)', () => {
  const n = claudeMd.split('\n').length;
  assert.ok(n <= 100, `CLAUDE.md is ${n} lines; the file requires under 100`);
});
