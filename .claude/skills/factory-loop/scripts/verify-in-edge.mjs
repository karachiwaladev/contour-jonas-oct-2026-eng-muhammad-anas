// Fallback browser verification when the chrome-devtools MCP tools aren't loaded.
// Drives headless Microsoft Edge over the DevTools protocol. Needs only Node 22+ (built-in fetch/WebSocket).
//
// Usage: node verify-in-edge.mjs <page-url-or-path> <steps.mjs> <screenshot-dir>
//
// steps.mjs default-exports an async function that receives a page helper:
//   export default async page => {
//     await page.eval(`document.querySelector('#title').value = 'Buy milk'`);
//     page.check('adds a task', await page.eval(`document.querySelectorAll('li').length`) === 1);
//     await page.reload();
//     await page.screenshot('issue-5-added');   // -> <screenshot-dir>/issue-5-added.png
//   };
// Each run uses a fresh throwaway Edge profile, so the user's own browser data is never touched.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , target, stepsFile, shotDir] = process.argv;
if (!target || !stepsFile || !shotDir) {
  console.error('usage: node verify-in-edge.mjs <page-url-or-path> <steps.mjs> <screenshot-dir>');
  process.exit(2);
}
const url = /^[a-z]+:\/\//.test(target) ? target : pathToFileURL(resolve(target)).href;
const EDGE = process.env.EDGE_PATH || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const PORT = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), 'edge-verify-'));
mkdirSync(shotDir, { recursive: true });

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const exited = new Promise(r => edge.once('exit', r));
const cleanup = async () => {
  edge.kill();
  await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
let tab;
for (let i = 0; i < 50 && !tab; i++) {
  await sleep(200);
  try { tab = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); } catch {}
}
if (!tab) { await cleanup(); throw new Error(`Edge did not start (${EDGE})`); }

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise(r => { const id = ++nextId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

const results = [];
const page = {
  async eval(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result.result.value;
  },
  async reload() { await send('Page.reload'); await sleep(800); },
  async goto(u) { await send('Page.navigate', { url: u }); await sleep(800); },
  wait: sleep,
  async screenshot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(shotDir, `${name}.png`);
    writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    console.log(`SHOT  ${file}`);
  },
  check(name, ok, detail) {
    results.push({ name, ok: !!ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  ' + JSON.stringify(detail)}`);
  },
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await page.goto(url);
  const steps = (await import(pathToFileURL(resolve(stepsFile)).href)).default;
  await steps(page);
  page.check('no console errors', consoleErrors.length === 0, consoleErrors);
} catch (err) {
  page.check(`steps ran without throwing: ${err.message}`, false);
} finally {
  ws.close();
  await cleanup();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
