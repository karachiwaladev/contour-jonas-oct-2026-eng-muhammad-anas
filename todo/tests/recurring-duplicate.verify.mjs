// Regression: rapid double-tap on a recurring task's check must NOT spawn two
// next occurrences. The bug: check.onclick captured the render-time `task`, so
// two clicks before refresh both saw spawnedNext=false and each added an
// occurrence. Run:
//   node .claude/skills/factory-loop/scripts/verify-in-edge.mjs todo/index.html todo/tests/recurring-duplicate.verify.mjs todo/screenshots
const wait = 'await new Promise(r => setTimeout(r, 300));';

const addDailyRecurring = (title) => `(async () => {
  document.getElementById('title').value = ${JSON.stringify(title)};
  document.getElementById('due').value = '2027-03-10';
  document.getElementById('repeat').value = 'daily';
  document.getElementById('new-task').requestSubmit();
  ${wait}
})()`;

// Count how many stored tasks have this title (the source of truth = IndexedDB).
const countByTitle = (title) => `new Promise(res => {
  const r = indexedDB.open('todo-app', 1);
  r.onsuccess = () => {
    const q = r.result.transaction('tasks').objectStore('tasks').getAll();
    q.onsuccess = () => { res(q.result.filter(t => t.title === ${JSON.stringify(title)}).length); r.result.close(); };
  };
})`;

// Fire the check twice synchronously, as a fast double-tap would, before refresh rebinds.
const doubleTapCheck = (title) => `(async () => {
  const li = [...document.querySelectorAll('#list li')].find(li => li.querySelector('.title')?.textContent === ${JSON.stringify(title)});
  const btn = li.querySelector('.check');
  btn.click();
  btn.click();
  ${wait}
})()`;

export default async page => {
  await page.eval(addDailyRecurring('Water plants'));
  page.check('one task to start', (await page.eval(countByTitle('Water plants'))) === 1);

  await page.eval(doubleTapCheck('Water plants'));
  // Completing a recurring task spawns exactly one next occurrence, so a correct
  // app has 2 (the completed one + the next). The bug produced 3.
  const n = await page.eval(countByTitle('Water plants'));
  page.check('double-tap spawns exactly one next occurrence (2 total, not 3)', n === 2);
  await page.screenshot('recurring-duplicate-after-doubletap');
};
