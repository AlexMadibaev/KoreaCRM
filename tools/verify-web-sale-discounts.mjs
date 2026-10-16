import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:3005';
const loginResponse = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) });
assert.equal(loginResponse.status, 200);
const token = (await loginResponse.json()).accessToken;
const target = (await fetch('http://127.0.0.1:9225/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target, 'Web preview tab is open');
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
  await waitFor('!!document.querySelector(".crm-sale-create") && !!document.querySelector(".crm-sale-create form select")');
  for (const sku of ['KR-001', 'KR-002']) {
    await evaluate(input('#product-search', sku));
    await waitFor(`!![...document.querySelectorAll('.crm-sale-create ul li')].find(item => item.textContent.includes(${JSON.stringify(sku)}))`);
    await evaluate(`([...document.querySelectorAll('.crm-sale-create ul li')].find(item => item.textContent.includes(${JSON.stringify(sku)}))).querySelector('button').click()`);
    await waitFor(`document.querySelectorAll('.crm-sale-create tbody tr').length === ${sku === 'KR-001' ? 1 : 2}`);
  }
  await evaluate(input('.crm-sale-create tbody tr:first-child input[type=number]', '999'));
  await waitFor('document.querySelector(".crm-sale-create [role=status]")?.textContent.includes("автоматически")');
  const available = await evaluate('Number(document.querySelector(".crm-sale-create tbody tr:first-child input[type=number]")?.max)');
  assert.equal(await evaluate('Number(document.querySelector(".crm-sale-create tbody tr:first-child input[type=number]")?.value)'), available);
  await evaluate(input('.crm-sale-create tbody tr:first-child input[type=number]', '1'));
  await evaluate(select('.crm-sale-create .grid select', 'demo-customer-2'));
  await waitFor('document.querySelector(".crm-sale-create")?.textContent.includes("Персональная скидка клиента: 10%")');
  await evaluate(select('.crm-sale-create select[aria-label="Вид скидки на чек"]', 'PERCENT'));
  await evaluate(input('.crm-sale-create input[aria-label="Размер скидки на чек"]', '5,5'));
  await waitFor('document.querySelector(".crm-sale-create")?.textContent.includes("157,41")');
  assert.equal(await evaluate('!!document.querySelector(".crm-sale-create [role=alert]")'), false);
  await evaluate(select('.crm-sale-create select[aria-label="Вид скидки на чек"]', 'FIXED'));
  await evaluate(input('.crm-sale-create input[aria-label="Размер скидки на чек"]', '10,50'));
  await waitFor('/2\\s*851,50/u.test(document.querySelector(".crm-sale-create")?.textContent ?? "")');
  await evaluate(input('.crm-sale-create input[aria-label="Размер скидки на чек"]', '10,999'));
  await waitFor('document.querySelector(".crm-sale-create input[aria-label=\\"Размер скидки на чек\\"]")?.getAttribute("aria-invalid") === "true"');
  await evaluate(input('.crm-sale-create input[aria-label="Размер скидки на чек"]', '100'));
  await waitFor('/2\\s*762,00/u.test(document.querySelector(".crm-sale-create")?.textContent ?? "")');
  await evaluate(input('.crm-sale-create form input[aria-label="Сумма оплаты 1"]', '2762'));
  await evaluate('(() => { const el = document.querySelector(".crm-sale-create form input[aria-label=\\"Сумма оплаты 1\\"]"); el.focus(); el.blur(); })()');
  await waitFor('document.querySelector(".crm-sale-create form input[aria-label=\\"Сумма оплаты 1\\"]")?.value === "2762,00"');
  await waitFor('![...document.querySelectorAll(".crm-sale-create form button")].find(button => button.textContent.includes("Завершить продажу"))?.disabled');
  await evaluate('document.querySelector(".crm-sale-create").scrollIntoView({block:"start"})');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  let shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('D:/KoreaCRM/apps/web/preview-sale-discounts.png', Buffer.from(shot.data, 'base64'));
  await evaluate('[...document.querySelectorAll(".crm-sale-create form button")].find(button => button.textContent.includes("Завершить продажу")).click()');
  await waitFor('!![...document.querySelectorAll("section h2")].find(heading => heading.textContent.startsWith("Чек ")) || !!document.querySelector("[role=alert]")');
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  const receiptHeading = await evaluate('[...document.querySelectorAll("section h2")].find(heading => heading.textContent.startsWith("Чек "))?.textContent');
  const receiptNumber = receiptHeading.replace(/^Чек /, '');
  const savedPage = await fetch(`${base}/stores/demo-store/sales?search=${encodeURIComponent(receiptNumber)}`, { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
  const saved = savedPage.items.find(item => item.number === receiptNumber);
  assert.ok(saved);
  assert.equal(saved.totalMinor, '276200');
  assert.equal(saved.discountMinor, '41800');
  assert.equal(saved.items.reduce((sum, item) => sum + BigInt(item.totalMinor), 0n), 276200n);
  shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/web/preview-sale-discounts-receipt.png', Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ receiptNumber, totalMinor: saved.totalMinor, discountMinor: saved.discountMinor, stockClamped: true, persisted: true }));
} finally { socket.close(); }
