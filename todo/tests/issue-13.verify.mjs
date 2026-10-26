// Verifies task priority (#13) in headless Edge. Run:
//   node .claude/skills/factory-loop/scripts/verify-in-edge.mjs todo/index.html todo/tests/issue-13.verify.mjs todo/screenshots
const wait = 'await new Promise(r => setTimeout(r, 250));';
const add = (title, priority, due = '', tags = [], repeat = 'none') => `(async () => {
  document.getElementById('title').value = ${JSON.stringify(title)};
  document.getElementById('due').value = ${JSON.stringify(due)};
  document.getElementById('repeat').value = ${JSON.stringify(repeat)};
  document.getElementById('priority').value = ${JSON.stringify(priority)};
  const ti = document.querySelector('#new-task .tag-editor input');
  for (const t of ${JSON.stringify(tags)}) {
    ti.value = t;
    ti.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }
  document.getElementById('new-task').requestSubmit();
  ${wait}
})()`;
// All task rows from IndexedDB, the source of truth. Missing priority is kept as undefined here.
const rows = `new Promise(res => {
  const r = indexedDB.open('todo-app', 1);
  r.onsuccess = () => {
    const q = r.result.transaction('tasks').objectStore('tasks').getAll();
    q.onsuccess = () => { res(q.result.map(t => ({ title: t.title, done: t.done, due: t.due, priority: t.priority, repeat: t.repeat }))); r.result.close(); };
  };
})`;
// A task saved before priority existed: written straight into IndexedDB with no priority field.
const addLegacy = (title, due) => `new Promise(res => {
  const r = indexedDB.open('todo-app', 1);
  r.onsuccess = () => {
    const tx = r.result.transaction('tasks', 'readwrite');
    tx.objectStore('tasks').add({ title: ${JSON.stringify(title)}, done: false, createdAt: Date.now(), due: ${JSON.stringify(due)}, tags: [] });
    tx.oncomplete = () => { r.result.close(); res(); };
  };
})`;
const visibleTitles = `[...document.querySelectorAll('#list li .title')].map(e => e.textContent)`;
const liFor = title => `[...document.querySelectorAll('#list li')].find(li => li.querySelector('.title')?.textContent === ${JSON.stringify(title)})`;
const badge = title => `(${liFor(title)}?.querySelector('.priority')?.textContent ?? null)`;
const chip = p => `(async () => { document.querySelector('#priority-filters button[data-priority=${p}]').click(); ${wait} })()`;
const clearChips = `(async () => { document.querySelector('#priority-filters .clear').click(); ${wait} })()`;
const status = f => `(async () => { document.querySelector('[data-filter=${f}]').click(); ${wait} })()`;
const of = (all, title) => all.filter(t => t.title === title);

export default async page => {
  // Same due date for four tasks so priority decides their order; one earlier, one undated.
  await page.eval(add('Low thing', 'low', '2027-03-10', ['home']));
  await page.eval(add('No-priority thing', 'none', '2027-03-10'));
  await page.eval(add('High thing', 'high', '2027-03-10', ['work']));
  await page.eval(add('Medium thing', 'medium', '2027-03-10', ['work']));
  await page.eval(add('Early low', 'low', '2027-03-01'));
  await page.eval(add('Undated high', 'high', ''));

  let all = await page.eval(rows);
  page.check('add saves each priority', of(all, 'High thing')[0].priority === 'high' && of(all, 'Medium thing')[0].priority === 'medium'
    && of(all, 'Low thing')[0].priority === 'low' && of(all, 'No-priority thing')[0].priority === 'none', all);
  page.check('add form resets priority to None', await page.eval(`document.getElementById('priority').value`) === 'none');
  page.check('badges show High / Medium / Low', await page.eval(`[${badge('High thing')}, ${badge('Medium thing')}, ${badge('Low thing')}].join()`) === 'High,Medium,Low');
  page.check('no badge on None', await page.eval(badge('No-priority thing')) === null);
  page.check('badge is announced as "High priority"', await page.eval(`${liFor('High thing')}.querySelector('.priority').getAttribute('aria-label')`) === 'High priority');

  page.check('order: date first, priority breaks ties, undated last', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(
    ['Early low', 'High thing', 'Medium thing', 'Low thing', 'No-priority thing', 'Undated high']), await page.eval(visibleTitles));

  // A task saved before this feature existed reads as None.
  await page.eval(addLegacy('Old task', '2027-03-10'));
  await page.reload();
  page.check('old task without priority shows no badge', await page.eval(badge('Old task')) === null);
  page.check('old task sorts with None', JSON.stringify(await page.eval(visibleTitles)).includes('"Low thing","No-priority thing","Old task"'), await page.eval(visibleTitles));
  await page.screenshot('issue-13-list');

  // Chip filters
  await page.eval(chip('high'));
  page.check('High chip shows only High tasks', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(['High thing', 'Undated high']), await page.eval(visibleTitles));
  page.check('chip is pressed', await page.eval(`document.querySelector('#priority-filters button[data-priority=high]').getAttribute('aria-pressed')`) === 'true');
  await page.screenshot('issue-13-filter-high');
  await page.eval(chip('low'));
  page.check('High + Low chips show both', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(['Early low', 'High thing', 'Low thing', 'Undated high']), await page.eval(visibleTitles));
  await page.eval(clearChips);
  page.check('Clear shows everything again', (await page.eval(visibleTitles)).length === 7);
  await page.eval(chip('none'));
  page.check('None chip matches None and old tasks', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(['No-priority thing', 'Old task']), await page.eval(visibleTitles));
  await page.eval(clearChips);

  // Combined with tag and status filters: High AND #work AND Incomplete
  await page.eval(`(async () => { document.querySelector('#tag-filters button[data-tag=work]').click(); ${wait} })()`);
  await page.eval(chip('high'));
  await page.eval(status('active'));
  page.check('priority + tag + status filters intersect', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(['High thing']), await page.eval(visibleTitles));
  await page.eval(status('done'));
  page.check('empty state says No matching tasks', await page.eval(`document.getElementById('empty-title').textContent`) === 'No matching tasks');
  await page.eval(status('all'));
  await page.eval(clearChips);
  await page.eval(`(async () => { document.querySelector('#tag-filters .clear').click(); ${wait} })()`);

  // Inline edit: Low -> High moves it up; Esc cancels.
  await page.eval(`(async () => { ${liFor('Low thing')}.querySelector('.edit').click(); ${wait} })()`);
  await page.eval(`(async () => { document.querySelector('#list .edit-form select[aria-label=Priority]').value = 'medium';
    document.querySelector('#list .edit-form').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ${wait} })()`);
  page.check('Esc cancels a priority edit', of(await page.eval(rows), 'Low thing')[0].priority === 'low');
  await page.eval(`(async () => { ${liFor('Low thing')}.querySelector('.edit').click(); ${wait} })()`);
  page.check('edit form shows current priority', await page.eval(`document.querySelector('#list .edit-form select[aria-label=Priority]').value`) === 'low');
  page.check('edit form fits the page column (no overflow)', await page.eval(`(() => {
    const main = document.querySelector('main').getBoundingClientRect(), form = document.querySelector('#list .edit-form').getBoundingClientRect();
    return form.right <= main.right && document.documentElement.scrollWidth <= innerWidth; })()`));
  // Phones just above the 420px breakpoint (e.g. 430px): narrow the column and check nothing spills out.
  page.check('add form and edit row fit a 430px-wide column', await page.eval(`(async () => {
    const main = document.querySelector('main'); main.style.maxWidth = '430px'; ${wait}
    const fits = sel => { const row = document.querySelector(sel), r = row.getBoundingClientRect();
      return [...row.querySelectorAll('*')].every(el => el.getBoundingClientRect().right <= r.right + 0.5); };
    const ok = fits('#new-task .details') && fits('#list .edit-form .row');
    main.style.maxWidth = ''; ${wait}
    return ok; })()`));
  await page.screenshot('issue-13-editing');
  await page.eval(`(async () => { const f = document.querySelector('#list .edit-form'); f.querySelector('select[aria-label=Priority]').value = 'high'; f.requestSubmit(); ${wait} })()`);
  page.check('edit saves new priority', of(await page.eval(rows), 'Low thing')[0].priority === 'high');
  page.check('edited badge and order update', await page.eval(badge('Low thing')) === 'High'
    && (await page.eval(visibleTitles)).indexOf('Low thing') < (await page.eval(visibleTitles)).indexOf('Medium thing'), await page.eval(visibleTitles));

  // Editing an old task without touching priority saves it as None.
  await page.eval(`(async () => { ${liFor('Old task')}.querySelector('.edit').click(); ${wait} document.querySelector('#list .edit-form').requestSubmit(); ${wait} })()`);
  page.check('saving an old task stores priority none', of(await page.eval(rows), 'Old task')[0].priority === 'none');

  // Recurring: next occurrence keeps the priority.
  await page.eval(add('Weekly review', 'high', '2027-04-02', [], 'weekly'));
  await page.eval(`(async () => { ${liFor('Weekly review')}.querySelector('.check').click(); ${wait} })()`);
  all = of(await page.eval(rows), 'Weekly review');
  page.check('recurring next occurrence keeps priority', all.some(t => !t.done && t.due === '2027-04-09' && t.priority === 'high'), all);
  // Changing a recurring task's priority in edit doesn't spawn another occurrence.
  await page.eval(`(async () => { const li = [...document.querySelectorAll('#list li')].find(l => l.querySelector('.title')?.textContent === 'Weekly review' && !l.classList.contains('done'));
    li.querySelector('.edit').click(); ${wait}
    const f = document.querySelector('#list .edit-form'); f.querySelector('select[aria-label=Priority]').value = 'low'; f.requestSubmit(); ${wait} })()`);
  const after = of(await page.eval(rows), 'Weekly review');
  page.check('editing priority spawns no extra occurrence', after.length === all.length && after.some(t => !t.done && t.priority === 'low'), after);

  // Persistence
  const before = JSON.stringify(await page.eval(rows));
  await page.reload();
  page.check('priorities persist after reload', JSON.stringify(await page.eval(rows)) === before);
  page.check('badges still shown after reload', await page.eval(badge('High thing')) === 'High');
  await page.screenshot('issue-13-after-reload');
};
