import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:3002';
const token = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) }).then(response => response.json()).then(value => value.accessToken);
const get = path => fetch(base + path, { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
const targets = await fetch('http://127.0.0.1:9223/json').then(response => response.json());
const target = targets.find(item => item.url === 'http://tauri.localhost/');
if (!target) throw Error('POS WebView not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0; const tasks = new Map();
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const answer = await call('Runtime.evaluate', { expression, returnByValue: true }); if (answer.exceptionDetails) throw Error(answer.exceptionDetails.text); return answer.result.value; }
async function waitFor(expression, timeout = 30000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 250)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(0,1400)')}`); }
function setInput(selector, value) { return `(() => { const element=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('input',{bubbles:true})); })()`; }
try {
  await call('Runtime.enable');
  await waitFor('!!document.querySelector(".login-form")');
  await evaluate(setInput('.login-form input[type=url]', base));
  await evaluate(setInput('.login-form input[autocomplete=username]', 'demo'));
  await evaluate(setInput('.login-form input[type=password]', 'demo1234'));
  await evaluate('document.querySelector(".login-form").requestSubmit()');
  await waitFor('!!document.querySelector(".pos")');
  await evaluate('document.querySelector(".topbar button:not(.quiet)")?.click()');
  await waitFor('document.querySelector(".connection-pill")?.textContent.includes("подключена")');
  const stockBefore = await get('/stores/demo-store/stock');
  const beforeQuantity = stockBefore.items.find(item => item.productId === 'demo-cream').quantity;
  await evaluate('document.querySelector(".shift form")?.requestSubmit()');
  await waitFor('document.querySelector(".shift")?.textContent.includes("Открыта")');
  await waitFor('document.querySelectorAll(".results button").length > 0');
  await evaluate('document.querySelector(".results button").click()');
  await waitFor('!!document.querySelector(".cart li")');
  await evaluate('document.querySelector(".fill-total").click()');
  await waitFor('!document.querySelector(".columns form .primary").disabled');
  await evaluate('document.querySelector(".columns form .primary").click()');
  await waitFor('document.querySelector(".receipt h2")?.textContent.includes("DEMO-0001")');
  const sold = (await get('/stores/demo-store/sales')).items[0];
  assert.equal((await get('/stores/demo-store/stock')).items.find(item => item.productId === 'demo-cream').quantity, beforeQuantity - 1);
  await waitFor('document.querySelector(".sales-history-list")?.textContent.includes("DEMO-0001")');
  await evaluate('document.querySelector(".sales-history-list button").click()');
  await waitFor('!!document.querySelector(".sales-return-form")');
  await evaluate(setInput('.sales-return-form input', 'Товар не подошёл'));
  await evaluate('document.querySelector(".sales-return-form").requestSubmit()');
  await waitFor('document.querySelector(".sales-return-status")?.textContent.includes("Возврат")');
  const returned = await get(`/stores/demo-store/sales/${sold.id}`);
  assert.equal(returned.returns[0].reason, 'Товар не подошёл');
  assert.equal((await get('/stores/demo-store/stock')).items.find(item => item.productId === 'demo-cream').quantity, beforeQuantity);
  const shifts = await get('/stores/demo-store/finance/cash-shifts');
  assert.equal(shifts.items[0].expectedCashMinor, '0');
  const today = new Date().toISOString().slice(0, 10);
  const summary = await get(`/finance/summary?from=${today}&to=${today}`);
  assert.equal(summary.revenueMinor, '0');
  const record = returned.returns[0];
  const replay = await fetch(`${base}/stores/demo-store/sales/${sold.id}/return`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId: record.operationId, deviceId: record.deviceId, cashShiftId: record.cashShiftId, reason: record.reason, items: record.items.map(item => ({ saleItemId: item.saleItemId, quantity: item.quantity })) }) });
  assert.equal(replay.status, 200);
  assert.equal((await get('/stores/demo-store/stock')).items.find(item => item.productId === 'demo-cream').quantity, beforeQuantity);
  await evaluate('document.querySelector(".sales-history").scrollIntoView({block:"start"})');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('D:/KoreaCRM/apps/pos/preview-return.png', Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ sale: sold.number, returned: true, stockRestored: true, cashRestored: true, revenueMinor: summary.revenueMinor, replayStatus: replay.status, screenshot: 'apps/pos/preview-return.png' }));
} finally { socket.close(); }
