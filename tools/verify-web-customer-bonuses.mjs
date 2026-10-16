import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:3005';
async function login(login, password) { const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) }); assert.equal(response.status, 200); return (await response.json()).accessToken; }
const accessToken = await login('demo', 'demo1234');
const target = (await fetch('http://127.0.0.1:9225/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target, 'Web preview tab is open');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-1200)')}`); }
try {
  await call('Page.enable'); await call('Runtime.enable');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(accessToken)})`);
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/customers' });
  await waitFor('document.body.innerText.includes("Анна Иванова")');
  await evaluate('Array.from(document.querySelectorAll("li button")).find(button => button.parentElement?.textContent.includes("Анна Иванова"))?.click()');
  await waitFor('document.body.innerText.includes("История клиента")');
  await evaluate('Array.from(document.querySelectorAll("[role=tab]")).find(button => button.textContent === "Бонусы")?.click()');
  await waitFor('document.body.innerText.includes("Начальный бонусный баланс для демо")');
  assert.ok(await evaluate('document.body.innerText.includes("150,00 сум")'));
  await evaluate(`(() => { const form = [...document.querySelectorAll('form')].find(item => item.textContent.includes('Ручная корректировка')); const input = form.querySelector('input[inputmode=decimal]'); const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; inputSetter.call(input, '50'); input.dispatchEvent(new Event('input', { bubbles: true })); const reason = form.querySelector('textarea'); const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; textareaSetter.call(reason, 'Корректировка после сверки'); reason.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await evaluate('Array.from(document.querySelectorAll("form")).find(item => item.textContent.includes("Ручная корректировка"))?.requestSubmit()');
  await waitFor('document.body.innerText.includes("Корректировка после сверки") && document.body.innerText.includes("200,00 сум")');
  const page = await fetch(`${base}/customers/demo-customer-1/bonuses`, { headers: { Authorization: `Bearer ${accessToken}` } }).then(response => response.json());
  assert.equal(page.balanceMinor, '20000');
  assert.equal(page.total, 2);
  assert.equal(page.items[0].actor.name, 'Демо администратор');
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/web/preview-customer-bonuses.png', Buffer.from(screenshot.data, 'base64'));
  const managerToken = await login('manager', 'manager1234');
  const forbidden = await fetch(`${base}/customers/demo-customer-1/bonuses/corrections`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` }, body: JSON.stringify({ operationId: crypto.randomUUID(), deltaMinor: '100', reason: 'Проверка доступа' }) });
  assert.equal(forbidden.status, 403);
  console.log(JSON.stringify({ balanceMinor: page.balanceMinor, operations: page.total, managerForbidden: true, screenshot: 'apps/web/preview-customer-bonuses.png' }));
} finally { socket.close(); }
