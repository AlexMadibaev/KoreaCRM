import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const login = await fetch('http://127.0.0.1:3005/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'manager', password: 'manager1234' }) });
assert.equal(login.status, 200);
const target = (await fetch('http://127.0.0.1:9225/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
try {
  await call('Page.enable'); await call('Runtime.enable');
  await evaluate('sessionStorage.removeItem("accessToken")');
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/login' });
  for (let i = 0; i < 80 && !await evaluate('!!document.querySelector("input[autocomplete=username]")'); i++) await new Promise(resolve => setTimeout(resolve, 200));
  const setInput = (selector, value) => `(() => { const element=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('input',{bubbles:true})); })()`;
  await evaluate(setInput('input[autocomplete=username]', 'manager'));
  await evaluate(setInput('input[autocomplete=current-password]', 'manager1234'));
  await evaluate('document.querySelector("button[type=submit]")?.click()');
  for (let i = 0; i < 80 && !await evaluate('location.pathname === "/sales"'); i++) await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await evaluate('location.pathname'), '/sales');
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/employees' });
  for (let i = 0; i < 80 && !await evaluate('document.body.innerText.includes("Менеджер магазина")'); i++) await new Promise(resolve => setTimeout(resolve, 200));
  const body = await evaluate('document.body.innerText');
  assert.ok(body.includes('Менеджер магазина'));
  assert.equal(body.includes('Добавить сотрудника'), false);
  assert.equal(body.includes('Создать роль'), false);
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('D:/KoreaCRM/apps/web/preview-manager-access.png', Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ managerLogin: true, employeeView: true, createHidden: true, screenshot: 'apps/web/preview-manager-access.png' }));
} finally { socket.close(); }
