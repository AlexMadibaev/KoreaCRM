import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const login = await fetch('http://127.0.0.1:3005/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) });
assert.equal(login.status, 200);
const { accessToken } = await login.json();
const target = (await fetch('http://127.0.0.1:9225/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target);
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
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/employees' });
  await waitFor('document.body.innerText.includes("Демо администратор")');
  await evaluate('Array.from(document.querySelectorAll("article")).find(article => article.textContent.includes("@demo"))?.querySelector("button")?.click()');
  const panel = JSON.stringify('[aria-label^="История действий"]');
  await waitFor(`document.querySelector(${panel})?.textContent.includes("Продажа оформлена")`);
  const ownerHistory = await evaluate(`document.querySelector(${panel})?.textContent`);
  assert.ok(ownerHistory.includes('Возврат оформлен'));
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('D:/KoreaCRM/apps/web/preview-employee-activity.png', Buffer.from(screenshot.data, 'base64'));
  await evaluate(`document.querySelector(${JSON.stringify('[aria-label="Закрыть историю"]')})?.click()`);
  await evaluate('Array.from(document.querySelectorAll("article")).find(article => article.textContent.includes("@preview.manager"))?.querySelector("button")?.click()');
  await waitFor(`document.querySelector(${panel})?.textContent.includes("Учётная запись создана")`);
  const createdHistory = await evaluate(`document.querySelector(${panel})?.textContent`);
  assert.ok(createdHistory.includes('Изменил: Демо администратор'));
  console.log(JSON.stringify({ saleActions: true, accountChanges: true, screenshot: 'apps/web/preview-employee-activity.png' }));
} finally { socket.close(); }
