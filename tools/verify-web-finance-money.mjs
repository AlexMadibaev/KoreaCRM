import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:3005';
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) }).then(response => response.json());
const target = (await fetch('http://127.0.0.1:9225/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target, 'Web preview tab is open');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const pending = new Map();
let nextId = 0;
socket.addEventListener('message', event => {
  const reply = JSON.parse(event.data);
  const task = pending.get(reply.id);
  if (task) { pending.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); }
});
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-900)')}`); }
const expenseForm = `[...document.querySelectorAll('section')].find(section => section.querySelector(':scope > h2')?.textContent === 'Расходы')?.querySelectorAll('form')[1]`;
const shiftSection = `[...document.querySelectorAll('section')].find(section => section.querySelector(':scope > h2')?.textContent === 'Кассовые смены')`;
try {
  await call('Page.enable'); await call('Runtime.enable');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(login.accessToken)})`);
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/finance' });
  await waitFor('document.querySelector("h1")?.textContent === "Финансы" && document.body.innerText.includes("Хозяйственные расходы")');
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  assert.ok(await evaluate('document.body.innerText.includes("1 900,00 сомони") || document.body.innerText.includes("1\u00a0900,00 сомони")'), 'summary displays major units');
  await evaluate(`(() => { const el = (${expenseForm}).querySelectorAll('select')[1]; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, 'CARD'); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await evaluate(`(() => { const el = (${expenseForm}).querySelector('input[inputmode=decimal]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, '12,50'); el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); el.blur(); })()`);
  await waitFor(`(${expenseForm})?.querySelector('input[inputmode=decimal]')?.value === '12,50'`);
  await evaluate(`(${expenseForm}).requestSubmit()`);
  await waitFor('document.body.innerText.includes("12,50 сомони") || !!document.querySelector("[role=alert]")');
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  const rows = await fetch(`${base}/stores/demo-store/finance/expenses?limit=100`, { headers: { Authorization: `Bearer ${login.accessToken}` } }).then(response => response.json());
  assert.ok(rows.items.some(item => item.amountMinor === '1250' && item.paymentMethod === 'CARD'));
  await evaluate(`(() => { const el = (${shiftSection}).querySelector('form input[inputmode=decimal]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, '12,50'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await evaluate(`(${shiftSection}).querySelector('form').requestSubmit()`);
  await waitFor(`(${shiftSection})?.innerText.includes('Ожидается: 12,50 сомони') || !!document.querySelector('[role=alert]')`);
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  await evaluate(`(() => { const el = (${shiftSection}).querySelectorAll('form')[1].querySelectorAll('select')[1]; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, 'CORRECTION'); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await evaluate(`(() => { const form = (${shiftSection}).querySelectorAll('form')[1]; const el = form.querySelector('input[inputmode=decimal]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, '-2,25'); el.dispatchEvent(new Event('input', { bubbles: true })); const comment = form.querySelector('input:not([inputmode=decimal])'); setter.call(comment, 'Проверка пересчёта'); comment.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await evaluate(`(${shiftSection}).querySelectorAll('form')[1].requestSubmit()`);
  await waitFor(`(${shiftSection})?.innerText.includes('Ожидается: 10,25 сомони') || !!document.querySelector('[role=alert]')`);
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/web/preview-finance.png', Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ loaded: true, summaryMajorUnits: true, expenseMinor: '1250', signedCorrectionMinor: '-225', persisted: true }));
} finally { socket.close(); }
