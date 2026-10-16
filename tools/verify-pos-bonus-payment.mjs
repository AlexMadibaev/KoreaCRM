import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const target = (await fetch('http://127.0.0.1:9226/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:5174/'));
assert.ok(target);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression) { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 250)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-1400)')}`); }
const input = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const inputAt = (selector, index, value) => `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const select = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); })()`;
const selectAt = (selector, index, value) => `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); })()`;
try {
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.navigate', { url: 'http://127.0.0.1:5174/' });
  await waitFor('!!document.querySelector(".login-form")');
  await evaluate(input('.login-form input[type=url]', 'http://127.0.0.1:3005'));
  await evaluate(input('.login-form input[autocomplete=username]', 'demo'));
  await evaluate(input('.login-form input[type=password]', 'demo1234'));
  await evaluate('document.querySelector(".login-form").requestSubmit()');
  await waitFor('!!document.querySelector(".pos")');
  await evaluate('document.querySelector(".topbar button:not(.quiet)")?.click()');
  await waitFor('document.querySelector(".connection-pill")?.textContent.includes("подключена")');
  await evaluate(input('.columns input[placeholder^="Сканируйте"]', 'KR-001'));
  await waitFor('!!document.querySelector(".results button")');
  await evaluate('document.querySelector(".results button").click()');
  await waitFor('!!document.querySelector(".cart li")');
  await evaluate(select('.columns form select', 'demo-customer-1'));
  await waitFor('document.body.innerText.includes("Доступно бонусов: 150,00")');
  await evaluate(selectAt('.payment select', 0, 'demo-card'));
  await evaluate(inputAt('.payment input[aria-label^="Сумма оплаты"]', 0, '1140'));
  await evaluate('[...document.querySelectorAll(".payments button")].find(button => button.textContent.includes("Добавить способ")).click()');
  await waitFor('document.querySelectorAll(".payment select").length === 2');
  await evaluate(selectAt('.payment select', 1, 'demo-bonus'));
  await evaluate(inputAt('.payment input[aria-label^="Сумма оплаты"]', 1, '150'));
  await waitFor('/Внесено:\\s*1\\s*290,00/u.test(document.querySelector(".payments")?.textContent ?? "")');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  let shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/pos/preview-bonus-payment.png', Buffer.from(shot.data, 'base64'));
  await evaluate('document.querySelector(".columns form .primary").click()');
  await waitFor('!!document.querySelector(".receipt") || !!document.querySelector("[role=alert]")');
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  assert.ok(await evaluate('document.querySelector(".receipt")?.textContent.includes("Бонусы")'));
  assert.ok(await evaluate('document.querySelector(".receipt")?.textContent.includes("Карта")'));
  const ledger = await fetch('http://127.0.0.1:3005/customers/demo-customer-1/bonuses', { headers: { Authorization: 'Bearer demo-local-token' } }).then(response => response.json());
  assert.equal(ledger.balanceMinor, '0');
  assert.equal(ledger.items[0].type, 'SPEND');
  shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/pos/preview-bonus-payment-receipt.png', Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ bonusSpentMinor: '15000', bonusBalanceMinor: '0', receipt: true }));
} finally { socket.close(); }
