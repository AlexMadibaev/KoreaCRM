import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const target = (await fetch('http://127.0.0.1:9226/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:5174/'));
assert.ok(target, 'POS browser preview is running');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => {
  const reply = JSON.parse(event.data);
  const task = tasks.get(reply.id);
  if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); }
});
function call(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => tasks.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const reply = await call('Runtime.evaluate', { expression, returnByValue: true });
  if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text);
  return reply.result.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-1200)')}`);
}
const input = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const select = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); })()`;
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
  for (const sku of ['KR-001', 'KR-002']) {
    await evaluate(input('.columns input[placeholder^="Сканируйте"]', sku));
    await waitFor(`!![...document.querySelectorAll('.results li')].find(item => item.textContent.includes(${JSON.stringify(sku)}))`);
    await evaluate(`([...document.querySelectorAll('.results li')].find(item => item.textContent.includes(${JSON.stringify(sku)}))).querySelector('button').click()`);
    await waitFor(`document.querySelectorAll('.cart li').length === ${sku === 'KR-001' ? 1 : 2}`);
  }
  await evaluate(select('.columns form select', 'demo-customer-2'));
  await waitFor('document.body.innerText.includes("Персональная скидка клиента: 10%")');
  await evaluate(select('.cart-discount select', 'PERCENT'));
  await evaluate(input('.cart-discount input', '5,5'));
  await waitFor('document.querySelector(".cart-discount input")?.value === "5,5"');
  assert.equal(await evaluate('!!document.querySelector(".cart-discount-error")'), false, 'comma percentage is accepted');
  assert.ok(await evaluate('document.querySelector(".cart-discount")?.parentElement?.innerText.includes("157,41")'), '5.5% of 2 862,00');
  await evaluate(select('.cart-discount select', 'FIXED'));
  await evaluate(input('.cart-discount input', '10,50'));
  await waitFor('/2\\s*851,50/u.test(document.querySelector(".cart-discount")?.parentElement?.innerText ?? "")');
  await evaluate(input('.cart-discount input', '10,999'));
  await waitFor('document.querySelector(".cart-discount input")?.getAttribute("aria-invalid") === "true"');
  await evaluate(input('.cart-discount input', '100'));
  await waitFor('document.querySelector(".cart-discount input")?.value === "100"');
  await evaluate('(() => { const el = document.querySelector(".cart-discount input"); el.focus(); el.blur(); })()');
  await waitFor('document.querySelector(".cart-discount input")?.value === "100,00"');
  assert.ok(await evaluate('/2\\s*762,00/u.test(document.querySelector(".cart-discount")?.parentElement?.innerText ?? "")'));
  await evaluate(select('.payment select', 'demo-card'));
  await evaluate('document.querySelector(".fill-total").click()');
  await waitFor('!document.querySelector(".columns form .primary").disabled');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  let screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/pos/preview-cart-discount-cart.png', Buffer.from(screenshot.data, 'base64'));
  await evaluate('document.querySelector(".columns form .primary").click()');
  await waitFor('!!document.querySelector(".receipt") || !!document.querySelector("[role=alert]")');
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  const receiptText = await evaluate('document.querySelector(".receipt")?.innerText ?? ""');
  assert.match(receiptText, /2\s*762,00/u);
  assert.match(receiptText, /418,00/u);
  assert.equal(await evaluate('document.querySelectorAll(".receipt li").length'), 2);
  const receiptNumber = await evaluate('document.querySelector(".receipt h2")?.textContent.match(/DEMO-\\d+/)?.[0]');
  const saleList = await fetch(`http://127.0.0.1:3005/stores/demo-store/sales?search=${receiptNumber}`, { headers: { authorization: 'Bearer demo-local-token' } }).then(response => response.json());
  const savedSale = saleList.items?.find(sale => sale.number === receiptNumber);
  assert.ok(savedSale, 'sale is saved on server');
  assert.equal(savedSale.totalMinor, '276200');
  assert.equal(savedSale.discountMinor, '41800');
  assert.equal(savedSale.items.reduce((sum, item) => sum + BigInt(item.totalMinor), 0n), 276200n);
  assert.equal(savedSale.items.reduce((sum, item) => sum + BigInt(item.discountMinor), 0n), 41800n);
  screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/pos/preview-cart-discount-receipt.png', Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ totalMinor: '276200', discountMinor: '41800', items: 2, receipt: true, persisted: true }));
} finally { socket.close(); }
