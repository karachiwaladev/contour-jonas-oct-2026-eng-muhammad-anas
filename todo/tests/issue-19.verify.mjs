// Verifies the search box (#19) in headless Edge. Run:
//   node .claude/skills/factory-loop/scripts/verify-in-edge.mjs todo/index.html todo/tests/issue-19.verify.mjs todo/screenshots
const wait = 'await new Promise(r => setTimeout(r, 250));';

const add = (title, tags = []) => `(async () => {
  document.getElementById('title').value = ${JSON.stringify(title)};
  const ti = document.querySelector('#new-task .tag-editor input');
  for (const t of ${JSON.stringify(tags)}) {
    ti.value = t;
    ti.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }
  document.getElementById('new-task').requestSubmit();
  ${wait}
})()`;

const search = text => `(async () => {
  const s = document.getElementById('search');
  s.value = ${JSON.stringify(text)};
  s.dispatchEvent(new Event('input', { bubbles: true }));
  ${wait}
})()`;

const status = f => `(async () => { document.querySelector('[data-filter=${f}]').click(); ${wait} })()`;
const completeTask = title => `(async () => {
  const li = [...document.querySelectorAll('#list li')].find(li => li.querySelector('.title')?.textContent === ${JSON.stringify(title)});
  li.querySelector('.check').click();
  ${wait}
})()`;
const visibleTitles = `[...document.querySelectorAll('#list li .title')].map(e => e.textContent).sort()`;

export default async page => {
  await page.eval(add('Buy milk', ['home']));
  await page.eval(add('Work report', ['work']));
  await page.eval(add('Walk dog', ['home']));

  // A search box exists and is empty by default: everything shows.
  page.check('search box exists', await page.eval(`!!document.getElementById('search')`));
  page.check('all three shown at first', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(['Buy milk', 'Walk dog', 'Work report']));
  await page.screenshot('issue-19-all');

  // Title match: "work" -> only "Work report".
  await page.eval(search('work'));
  page.check('title match', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(['Work report']));
  await page.screenshot('issue-19-title-match');

  // Case-insensitive.
  await page.eval(search('WORK'));
  page.check('case-insensitive', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(['Work report']));

  // Tag match: "home" -> the two #home tasks, not "Work report".
  await page.eval(search('home'));
  page.check('tag match', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(['Buy milk', 'Walk dog']));
  await page.screenshot('issue-19-tag-match');

  // Combines with the status filter: complete "Buy milk", filter Incomplete, search "home" -> only "Walk dog".
  await page.eval(search(''));
  await page.eval(completeTask('Buy milk'));
  await page.eval(status('active'));
  await page.eval(search('home'));
  page.check('combines with status filter', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(['Walk dog']));
  await page.screenshot('issue-19-combined');

  // Clearing the box shows everything again (within the current status filter).
  await page.eval(status('all'));
  await page.eval(search(''));
  page.check('clearing restores all', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(['Buy milk', 'Walk dog', 'Work report']));

  // No match -> empty list, and the box keeps its text.
  await page.eval(search('zzz-nothing'));
  page.check('no match shows nothing', (await page.eval(`document.querySelectorAll('#list li').length`)) === 0);

  // Reload: the query does not persist (resets, like the status filter).
  await page.eval(search('work'));
  await page.reload();
  page.check('query is empty after reload', (await page.eval(`document.getElementById('search').value`)) === '');
  page.check('all shown after reload', JSON.stringify(await page.eval(visibleTitles)) === JSON.stringify(['Buy milk', 'Walk dog', 'Work report']));
};
