import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:3003';
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
async function waitFor(expression, timeout = 30000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 250)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(0,1600)')}`); }
function setInput(selector, value) { return `(() => { const element=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('input',{bubbles:true})); })()`; }
try {
  await call('Runtime.enable');
  let before;
  let sold;
  if (await evaluate('!!document.querySelector(".login-form")')) {
  await evaluate(setInput('.login-form input[type=url]', base));
  await evaluate(setInput('.login-form input[autocomplete=username]', 'demo'));
  await evaluate(setInput('.login-form input[type=password]', 'demo1234'));
  await evaluate('document.querySelector(".login-form").requestSubmit()');
  await waitFor('!!document.querySelector(".pos")');
  await evaluate('document.querySelector(".topbar button:not(.quiet)")?.click()');
  await waitFor('document.querySelector(".connection-pill")?.textContent.includes("подключена")');
  before = (await get('/stores/demo-store/stock')).items.find(item => item.productId === 'demo-cream').quantity;
  await evaluate('document.querySelector(".shift form")?.requestSubmit()');
  await waitFor('document.querySelector(".shift")?.textContent.includes("Открыта")');
  await waitFor('document.querySelectorAll(".results button").length > 0');
  await evaluate('document.querySelector(".results button").click()');
  await waitFor('!!document.querySelector(".cart li")');
  await evaluate(setInput('.cart input[type=number]', '3'));
  await waitFor('document.querySelector(".cart input[type=number]")?.value === "3"');
  await evaluate('document.querySelector(".fill-total").click()');
  await waitFor('!document.querySelector(".columns form .primary").disabled');
  await evaluate('document.querySelector(".columns form .primary").click()');
  await waitFor('document.querySelector(".receipt h2")?.textContent.includes("DEMO-0001")');
  sold = (await get('/stores/demo-store/sales')).items[0];
  assert.equal((await get('/stores/demo-store/stock')).items.find(item => item.productId === 'demo-cream').quantity, before - 3);
  } else {
    sold = (await get('/stores/demo-store/sales')).items[0];
    before = (await get('/stores/demo-store/stock')).items.find(item => item.productId === 'demo-cream').quantity + 3;
  }
  await waitFor('document.querySelector(".sales-history-list")?.textContent.includes("DEMO-0001")');
  await evaluate('document.querySelector(".sales-history-list button").click()');
  await waitFor('!!document.querySelector(".sales-return-form")');
  await evaluate(setInput('.sales-return-form input[type=number]', '1'));
  await waitFor('document.querySelector(".sales-return-form .sales-history-total")?.textContent.includes("290,00")');
  await evaluate(setInput('.sales-return-form input:not([type=number])', 'Товар не подошёл'));
  await evaluate('document.querySelector(".sales-return-form").requestSubmit()');
  await waitFor('document.querySelector(".sales-return-status")?.textContent.includes("Возврат")');
  const partial = await get(`/stores/demo-store/sales/${sold.id}`);
  assert.equal(partial.returns.length, 1);
  assert.equal(partial.returns[0].items[0].quantity, 1);
  assert.equal(partial.returns[0].amountMinor, '129000');
  assert.equal((await get('/stores/demo-store/stock')).items.find(item => item.productId === 'demo-cream').quantity, before - 2);
  await evaluate('document.querySelector(".sales-history").scrollIntoView({block:"start"})');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('D:/KoreaCRM/apps/pos/preview-partial-return.png', Buffer.from(shot.data, 'base64'));
  await waitFor('document.querySelector(".sales-return-form input[type=number]")?.value === "2"');
  await evaluate(setInput('.sales-return-form input:not([type=number])', 'Остальные тоже не подошли'));
  await evaluate('document.querySelector(".sales-return-form").requestSubmit()');
  await waitFor('document.querySelectorAll(".sales-return-status").length === 2');
  const full = await get(`/stores/demo-store/sales/${sold.id}`);
  assert.equal(full.returns[1].items[0].quantity, 2);
  assert.equal(full.returns.reduce((total, item) => total + BigInt(item.amountMinor), 0n), 387000n);
  assert.equal((await get('/stores/demo-store/stock')).items.find(item => item.productId === 'demo-cream').quantity, before);
  const shift = (await get('/stores/demo-store/finance/cash-shifts')).items[0];
  assert.equal(shift.expectedCashMinor, '0');
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await get(`/finance/summary?from=${today}&to=${today}`)).revenueMinor, '0');
  console.log(JSON.stringify({ sale: sold.number, firstReturn: '129000', secondReturn: '258000', stockRestored: true, cashRestored: true, screenshot: 'apps/pos/preview-partial-return.png' }));
} finally { socket.close(); }
