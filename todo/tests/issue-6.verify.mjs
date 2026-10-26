// Verifies recurring tasks (#6) in headless Edge. Run:
//   node .claude/skills/factory-loop/scripts/verify-in-edge.mjs todo/index.html todo/tests/issue-6.verify.mjs todo/screenshots
const wait = 'await new Promise(r => setTimeout(r, 250));';
const add = (title, due, repeat, tags = []) => `(async () => {
  document.getElementById('title').value = ${JSON.stringify(title)};
  document.getElementById('due').value = ${JSON.stringify(due)};
  document.getElementById('repeat').value = ${JSON.stringify(repeat)};
  const ti = document.querySelector('#new-task .tag-editor input');
  for (const t of ${JSON.stringify(tags)}) {
    ti.value = t;
    ti.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }
  document.getElementById('new-task').requestSubmit();
  ${wait}
})()`;
// All task rows as {title, done, due, repeat} read from IndexedDB, the source of truth.
const rows = `new Promise(res => {
  const r = indexedDB.open('todo-app', 1);
  r.onsuccess = () => {
    const q = r.result.transaction('tasks').objectStore('tasks').getAll();
    q.onsuccess = () => { res(q.result.map(t => ({ title: t.title, done: t.done, due: t.due, repeat: t.repeat || 'none', tags: t.tags || [] }))); r.result.close(); };
  };
})`;
const liFor = (title, done) => `[...document.querySelectorAll('#list li')].find(li => li.querySelector('.title')?.textContent === ${JSON.stringify(title)} && li.classList.contains('done') === ${done})`;
const tick = (title, done = false) => `(async () => { ${liFor(title, done)}.querySelector('.check').click(); ${wait} })()`;
const of = (all, title) => all.filter(t => t.title === title);

export default async page => {
  await page.eval(add('Water plants', '2027-01-10', 'daily', ['home']));
  await page.eval(add('Team sync', '2027-01-11', 'weekly', ['work']));
  await page.eval(add('Pay rent', '2027-01-31', 'monthly', ['bills']));
  await page.eval(add('No date daily', '', 'daily'));
  await page.eval(add('One-off', '2027-01-12', 'none'));

  let all = await page.eval(rows);
  page.check('repeat saved on each task', of(all, 'Water plants')[0].repeat === 'daily' && of(all, 'Team sync')[0].repeat === 'weekly' && of(all, 'Pay rent')[0].repeat === 'monthly' && of(all, 'One-off')[0].repeat === 'none', all);
  const today = await page.eval(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })()`);
  page.check('repeat without a date defaults due to today', of(all, 'No date daily')[0].due === today, of(all, 'No date daily'));
  page.check('repeat badge shown', await page.eval(`${liFor('Team sync', false)}.querySelector('.repeat').textContent === 'Weekly'`));
  page.check('no badge on one-off task', await page.eval(`!${liFor('One-off', false)}.querySelector('.repeat')`));
  await page.screenshot('issue-6-list');

  // Completing creates the next occurrence
  await page.eval(tick('Water plants'));
  all = await page.eval(rows);
  page.check('daily: done copy kept + next one +1 day', of(all, 'Water plants').some(t => t.done && t.due === '2027-01-10') && of(all, 'Water plants').some(t => !t.done && t.due === '2027-01-11' && t.repeat === 'daily'), of(all, 'Water plants'));
  await page.eval(tick('Team sync'));
  all = await page.eval(rows);
  page.check('weekly: next one +7 days, tags kept', of(all, 'Team sync').some(t => !t.done && t.due === '2027-01-18' && t.tags.join() === 'work'), of(all, 'Team sync'));

  // Monthly from the 31st: clamps in February, returns to the 31st in March
  await page.eval(tick('Pay rent'));
  all = await page.eval(rows);
  page.check('monthly Jan 31 -> Feb 28', of(all, 'Pay rent').some(t => !t.done && t.due === '2027-02-28'), of(all, 'Pay rent'));
  await page.eval(tick('Pay rent'));
  all = await page.eval(rows);
  page.check('monthly Feb 28 -> Mar 31 (keeps the 31st)', of(all, 'Pay rent').some(t => !t.done && t.due === '2027-03-31'), of(all, 'Pay rent'));

  // Untick then re-tick must not create a duplicate
  const before = of(await page.eval(rows), 'Water plants').length;
  await page.eval(tick('Water plants', true));   // untick the done Jan 10 task
  await page.eval(tick('Water plants', false));  // re-tick it (it sorts first among open ones)
  const after = of(await page.eval(rows), 'Water plants');
  page.check('untick + re-tick creates no duplicate occurrence',
    after.length === before && after.filter(t => t.due === '2027-01-11').length === 1 && after.find(t => t.due === '2027-01-10').done, { before, after });

  // One-off tasks never spawn
  const n = (await page.eval(rows)).length;
  await page.eval(tick('One-off'));
  page.check('completing a one-off task creates nothing', (await page.eval(rows)).length === n);

  // Completed filter shows the history
  await page.eval(`(async () => { document.querySelector('[data-filter=done]').click(); ${wait} })()`);
  page.check('Completed filter shows past occurrences', (await page.eval(`document.querySelectorAll('#list li').length`)) >= 4);
  await page.screenshot('issue-6-completed-history');
  await page.eval(`(async () => { document.querySelector('[data-filter=all]').click(); ${wait} })()`);

  // Edit: change repeat on the one-off... (open copy of Team sync) to monthly
  await page.eval(`(async () => { ${liFor('Team sync', false)}.querySelector('.edit').click(); ${wait} })()`);
  await page.screenshot('issue-6-editing');
  await page.eval(`(async () => {
    const f = document.querySelector('#list .edit-form');
    f.querySelector('select').value = 'monthly';
    f.requestSubmit();
    ${wait}
  })()`);
  all = await page.eval(rows);
  page.check('edit changes repeat (weekly -> monthly)', of(all, 'Team sync').some(t => !t.done && t.repeat === 'monthly'), of(all, 'Team sync'));
  page.check('edited badge updates', await page.eval(`${liFor('Team sync', false)}.querySelector('.repeat').textContent === 'Monthly'`));

  // Turn repeat off
  await page.eval(`(async () => { ${liFor('Team sync', false)}.querySelector('.edit').click(); ${wait}
    const f = document.querySelector('#list .edit-form'); f.querySelector('select').value = 'none'; f.requestSubmit(); ${wait} })()`);
  page.check('edit can turn repeat off', await page.eval(`!${liFor('Team sync', false)}.querySelector('.repeat')`));

  // Persistence
  const count = (await page.eval(rows)).length;
  await page.reload();
  page.check('everything persists after reload', (await page.eval(rows)).length === count
    && await page.eval(`!!${liFor('Water plants', false)}.querySelector('.repeat')`));
  await page.screenshot('issue-6-after-reload');
};
