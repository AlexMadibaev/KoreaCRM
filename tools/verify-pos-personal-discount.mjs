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
async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-1200)')}`); }
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
  await evaluate(input('.columns input[placeholder^="Сканируйте"]', 'крем'));
  await waitFor('!!document.querySelector(".results button")');
  await evaluate('document.querySelector(".results button").click()');
  await waitFor('!!document.querySelector(".cart li")');
  await evaluate(select('.columns form select', 'demo-customer-2'));
  await waitFor('document.body.innerText.includes("Персональная скидка клиента: 10%")');
  assert.ok(await evaluate('/1\\s*161,00/u.test(document.querySelector(".cart li")?.textContent ?? "")'));
  await evaluate(select('.payment select', 'demo-card'));
  await evaluate('document.querySelector(".fill-total").click()');
  await waitFor('!document.querySelector(".columns form .primary").disabled');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  let screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/pos/preview-personal-discount-cart.png', Buffer.from(screenshot.data, 'base64'));
  await evaluate('document.querySelector(".columns form .primary").click()');
  await waitFor('!!document.querySelector(".receipt") || !!document.querySelector("[role=alert]")');
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  assert.ok(await evaluate('/1\\s*161,00/u.test(document.querySelector(".receipt")?.textContent ?? "")'));
  assert.ok(await evaluate('document.querySelector(".receipt")?.textContent.includes("129,00")'));
  screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/pos/preview-personal-discount-receipt.png', Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ customerDiscountPercent: 10, totalMinor: '116100', receipt: true }));
} finally { socket.close(); }
