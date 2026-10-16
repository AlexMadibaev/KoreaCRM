import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:3005';
const token = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) }).then(response => response.json()).then(body => body.accessToken);
const target = (await fetch('http://127.0.0.1:9225/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression) { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 250)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-1400)')}`); }
const input = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const select = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); })()`;
try {
  await call('Page.enable'); await call('Runtime.enable');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(token)})`);
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/sales' });
  await waitFor('!!document.querySelector(".crm-sale-create .grid select")');
  await evaluate(input('#product-search', 'KR-001'));
  await waitFor('!!document.querySelector(".crm-sale-create ul li button")');
  await evaluate('document.querySelector(".crm-sale-create ul li button").click()');
  await waitFor('document.querySelectorAll(".crm-sale-create tbody tr").length === 1');
  await evaluate(select('.crm-sale-create .grid select', 'demo-customer-1'));
  await waitFor('document.querySelector(".crm-sale-create")?.textContent.includes("Доступно бонусов: 150,00")');
  await evaluate(input('.crm-sale-create form input[aria-label="Сумма оплаты 1"]', '1140'));
  await evaluate('[...document.querySelectorAll(".crm-sale-create form button")].find(button => button.textContent.includes("Добавить способ")).click()');
  await waitFor('document.querySelectorAll(".crm-sale-create form select").length === 2');
  await evaluate(select('.crm-sale-create form .flex:nth-of-type(2) select', 'demo-bonus'));
  await evaluate(input('.crm-sale-create form input[aria-label="Сумма оплаты 2"]', '150'));
  await waitFor('/Внесено:\\s*1\\s*290,00/u.test(document.querySelector(".crm-sale-create")?.textContent ?? "")');
  await evaluate('document.querySelector(".crm-sale-create").scrollIntoView({block:"start"})');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  let shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('D:/KoreaCRM/apps/web/preview-bonus-payment.png', Buffer.from(shot.data, 'base64'));
  await evaluate('[...document.querySelectorAll(".crm-sale-create form button")].find(button => button.textContent.includes("Завершить продажу")).click()');
  await waitFor('!![...document.querySelectorAll("section h2")].find(heading => heading.textContent.startsWith("Чек ")) || !!document.querySelector("[role=alert]")');
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  const number = (await evaluate('[...document.querySelectorAll("section h2")].find(heading => heading.textContent.startsWith("Чек "))?.textContent')).replace(/^Чек /, '');
  const savedPage = await fetch(`${base}/stores/demo-store/sales?search=${number}`, { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
  const sale = savedPage.items.find(item => item.number === number);
  assert.ok(sale);
  assert.equal(sale.totalMinor, '129000');
  assert.deepEqual(sale.payments.map(payment => [payment.paymentMethod.kind, payment.amountMinor]), [['CARD', '114000'], ['BONUS', '15000']]);
  const ledger = await fetch(`${base}/customers/demo-customer-1/bonuses`, { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
  assert.equal(ledger.balanceMinor, '0');
  assert.equal(ledger.items[0].type, 'SPEND');
  assert.equal(ledger.items[0].deltaMinor, '-15000');
  shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/web/preview-bonus-payment-receipt.png', Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ number, bonusSpentMinor: '15000', bonusBalanceMinor: '0', persisted: true }));
} finally { socket.close(); }
