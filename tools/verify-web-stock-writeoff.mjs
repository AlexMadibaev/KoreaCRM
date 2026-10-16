import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:3005';
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) }).then(response => response.json());
const target = (await fetch('http://127.0.0.1:9225/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target, 'Web preview tab is open');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-900)')}`); }
const input = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`;
try {
  await call('Page.enable'); await call('Runtime.enable');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(login.accessToken)})`);
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/stock' });
  await waitFor('!![...document.querySelectorAll("tbody tr")].find(row => row.textContent.includes("KR-001"))');
  const before = await evaluate('Number([...document.querySelectorAll("tbody tr")].find(row => row.textContent.includes("KR-001"))?.children[2]?.textContent)');
  await evaluate('[...document.querySelectorAll("tbody tr")].find(row => row.textContent.includes("KR-001")).querySelector("button").click()');
  await waitFor('!!document.querySelector("#stock-editor input[aria-label^=Количество]")');
  await evaluate(`(() => { const original = window.fetch.bind(window); window.fetch = (resource, options) => { if (String(resource).includes('/stock/write-offs')) window.__writeOffRequest = JSON.parse(options.body); return original(resource, options); }; })()`);
  await evaluate(input('#stock-editor input[aria-label="Количество для списания"]', '2'));
  await evaluate(input('#stock-editor input[aria-label="Причина списания"]', 'Повреждена упаковка'));
  await evaluate('document.querySelector("#stock-editor form:has(input[aria-label^=Количество])").requestSubmit()');
  await waitFor(`document.querySelector('#stock-editor')?.textContent.includes('Сейчас в магазине: ${before - 2} шт.') && document.querySelector('#stock-editor')?.textContent.includes('Списание')`);
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  const payload = await evaluate('window.__writeOffRequest');
  assert.equal(payload.quantity, 2);
  const headers = { Authorization: `Bearer ${login.accessToken}`, 'Content-Type': 'application/json' };
  const replay = await fetch(`${base}/stores/demo-store/stock/write-offs`, { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(replay.status, 200);
  const excessive = await fetch(`${base}/stores/demo-store/stock/write-offs`, { method: 'POST', headers, body: JSON.stringify({ ...payload, operationId: crypto.randomUUID(), quantity: before + 1 }) });
  assert.equal(excessive.status, 409);
  const stock = await fetch(`${base}/stores/demo-store/stock`, { headers }).then(response => response.json());
  assert.equal(stock.items.find(item => item.productId === payload.productId).quantity, before - 2);
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/web/preview-stock-writeoff.png', Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ before, after: before - 2, movement: 'WRITE_OFF', replaySafe: true, excessiveRejected: true }));
} finally { socket.close(); }
