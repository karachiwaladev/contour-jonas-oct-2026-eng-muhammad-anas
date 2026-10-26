const wait = 'await new Promise(r => setTimeout(r, 200));';
const dateOffset = n => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Add a task through the real form: type title, set date, type tags into the chip editor with Enter.
const add = (title, due, tags) => `(async () => {
  document.getElementById('title').value = ${JSON.stringify(title)};
  document.getElementById('due').value = ${JSON.stringify(due)};
  const ti = document.querySelector('#new-task .tag-editor input');
  for (const t of ${JSON.stringify(tags)}) {
    ti.value = t;
    ti.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }
  document.getElementById('new-task').requestSubmit();
  ${wait}
})()`;
const titles = `[...document.querySelectorAll('#list li .title')].map(e => e.textContent)`;
const click = sel => `(async () => { ${sel}.click(); ${wait} })()`;

export default async page => {
  await page.eval(add('Pay rent', dateOffset(-2), ['home', 'bills']));
  await page.eval(add('Write report', dateOffset(3), ['work']));
  await page.eval(add('Call mom', '', ['home']));
  await page.eval(add('Plan sprint', dateOffset(1), ['work', 'urgent']));

  page.check('sorted by due date, undated last',
    (await page.eval(titles)).join() === 'Pay rent,Plan sprint,Write report,Call mom', await page.eval(titles));
  page.check('chips saved as tags',
    await page.eval(`[...document.querySelectorAll('#list li')][0].querySelector('.meta').textContent.includes('#bills')`));
  page.check('overdue task marked red', await page.eval(`!!document.querySelector('#list li .due.overdue')`)
    && await page.eval(`document.querySelector('#list li .due.overdue').textContent.startsWith('Overdue')`));
  page.check('future task shows Due date', await page.eval(`[...document.querySelectorAll('#list li .due')].some(d => d.textContent.startsWith('Due '))`));
  page.check('tag filter lists all tags',
    (await page.eval(`[...document.querySelectorAll('#tag-filters [data-tag]')].map(b => b.dataset.tag)`)).join() === 'bills,home,urgent,work');
  await page.screenshot('issue-5-list');

  // Multi-tag filter (match any)
  await page.eval(click(`document.querySelector('#tag-filters [data-tag="bills"]')`));
  page.check('one tag filter (#bills)', (await page.eval(titles)).join() === 'Pay rent');
  await page.eval(click(`document.querySelector('#tag-filters [data-tag="urgent"]')`));
  page.check('two tags = match any (#bills or #urgent)', (await page.eval(titles)).join() === 'Pay rent,Plan sprint');
  await page.screenshot('issue-5-tag-filter');
  await page.eval(click(`document.querySelector('#tag-filters .clear')`));
  page.check('Clear resets tag filter', (await page.eval(titles)).length === 4);

  // Status filters + combined with tags
  await page.eval(click(`document.querySelectorAll('#list .check')[1]`));    // Plan sprint done
  await page.eval(click(`document.querySelector('[data-filter=done]')`));
  page.check('Completed filter', (await page.eval(titles)).join() === 'Plan sprint');
  await page.eval(click(`document.querySelector('[data-filter=active]')`));
  page.check('Incomplete filter', (await page.eval(titles)).join() === 'Pay rent,Write report,Call mom');
  await page.eval(click(`document.querySelector('#tag-filters [data-tag="work"]')`));
  page.check('status + tag together (Incomplete + #work)', (await page.eval(titles)).join() === 'Write report');
  await page.eval(click(`document.querySelector('#tag-filters .clear')`));
  await page.eval(click(`document.querySelector('[data-filter=all]')`));

  // Clicking a tag pill on a task filters by it
  await page.eval(click(`[...document.querySelectorAll('#list .meta .tag')].find(t => t.textContent === '#home')`));
  page.check('tag pill click filters by that tag', (await page.eval(titles)).join() === 'Pay rent,Call mom');
  await page.eval(click(`document.querySelector('#tag-filters .clear')`));

  // Inline edit: change date, add a tag, remove a tag, then save
  await page.eval(click(`[...document.querySelectorAll('#list li')].find(li => li.querySelector('.title')?.textContent === 'Call mom').querySelector('.edit')`));
  page.check('edit form opens', await page.eval(`!!document.querySelector('#list .edit-form')`));
  await page.screenshot('issue-5-editing');
  await page.eval(`(async () => {
    const f = document.querySelector('#list .edit-form');
    f.querySelector('.title-input').value = 'Call mom back';
    f.querySelector('input[type=date]').value = ${JSON.stringify(dateOffset(0))};
    const ti = f.querySelector('.tag-editor input');
    ti.value = 'family';
    ti.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    f.querySelector('.chip button').click();            // remove #home
    f.requestSubmit();
    ${wait}
  })()`);
  const edited = await page.eval(`(() => { const li = [...document.querySelectorAll('#list li')].find(li => li.querySelector('.title')?.textContent === 'Call mom back'); return li && li.querySelector('.meta').textContent; })()`);
  page.check('edit saved title, date and tags', !!edited && edited.includes('#family') && !edited.includes('#home') && edited.includes('Due'), edited);

  // Escape cancels an edit
  await page.eval(click(`document.querySelector('#list li .edit')`));
  await page.eval(`(async () => {
    const f = document.querySelector('#list .edit-form');
    f.querySelector('.title-input').value = 'SHOULD NOT SAVE';
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ${wait}
  })()`);
  page.check('Escape cancels edit', !(await page.eval(titles)).includes('SHOULD NOT SAVE') && !(await page.eval(`!!document.querySelector('#list .edit-form')`)));

  // Persistence
  await page.reload();
  const after = await page.eval(titles);
  page.check('everything persists after reload', after.length === 4 && after.includes('Call mom back'), after);
  page.check('tags persist after reload', (await page.eval(`[...document.querySelectorAll('#tag-filters [data-tag]')].map(b => b.dataset.tag).join()`)) === 'bills,family,home,urgent,work');
  await page.screenshot('issue-5-after-reload');
};
