import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const token = await fetch('http://127.0.0.1:3005/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) }).then(response => response.json()).then(value => value.accessToken);
const targets = await fetch('http://127.0.0.1:9225/json').then(response => response.json());
const target = targets.find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target, 'Web preview tab not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-1800)')}`); }
function setValue(selector, value, kind = 'input') { return `(() => { const element=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(${kind === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set; setter.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('${kind === 'select' ? 'change' : 'input'}',{bubbles:true})); })()`; }
async function screenshot(path) { await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path, Buffer.from(result.data, 'base64')); }
try {
  await call('Page.enable'); await call('Runtime.enable');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(token)})`);
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/employees' });
  await waitFor('document.body.innerText.includes("Менеджер магазина")');
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify('a[href="/employees"]')})`), true);
  await screenshot('D:/KoreaCRM/apps/web/preview-employees.png');
  await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Роли и права")?.click()');
  await waitFor('document.body.innerText.includes("Доступные роли")');
  await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Создать роль"))?.click()');
  await waitFor(`!!document.querySelector(${JSON.stringify('[aria-label="Редактор роли"]')})`);
  await evaluate(setValue('[aria-label="Редактор роли"] input:first-of-type', 'Промо менеджер'));
  await evaluate(setValue('[aria-label="Редактор роли"] input[pattern]', 'PROMO_MANAGER'));
  await evaluate(`document.querySelector(${JSON.stringify('[aria-label="Редактор роли"] input[type=checkbox]')})?.click()`);
  await evaluate(`document.querySelector(${JSON.stringify('[aria-label="Редактор роли"] form button[type=submit]')})?.click()`);
  await waitFor('document.body.innerText.includes("Роль создана")');
  await screenshot('D:/KoreaCRM/apps/web/preview-roles.png');
  await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Сотрудники")?.click()');
  await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Добавить сотрудника"))?.click()');
  await waitFor(`!!document.querySelector(${JSON.stringify('[aria-label="Редактор сотрудника"]')})`);
  await evaluate(setValue('[aria-label="Редактор сотрудника"] input[minlength="2"]', 'Тестовый менеджер'));
  await evaluate(setValue('[aria-label="Редактор сотрудника"] input[pattern="[a-zA-Z0-9._-]+"]', 'preview.manager'));
  await evaluate(setValue('[aria-label="Редактор сотрудника"] input[type=password]', 'preview-manager-123'));
  const managerRoleId = await evaluate(`Array.from(document.querySelector(${JSON.stringify('[aria-label="Редактор сотрудника"] select')}).options).find(option => option.textContent === "Менеджер")?.value`);
  assert.ok(managerRoleId);
  await evaluate(setValue('[aria-label="Редактор сотрудника"] select', managerRoleId, 'select'));
  await evaluate(`document.querySelector(${JSON.stringify('[aria-label="Редактор сотрудника"] button[type=submit]')})?.click()`);
  await waitFor('document.body.innerText.includes("Сотрудник создан")');
  await waitFor('document.body.innerText.includes("Тестовый менеджер")');
  await screenshot('D:/KoreaCRM/apps/web/preview-employee-created.png');
  console.log(JSON.stringify({ employeesVisible: true, customRoleCreated: true, managerCreated: true, screenshots: ['apps/web/preview-employees.png', 'apps/web/preview-roles.png', 'apps/web/preview-employee-created.png'] }));
} finally { socket.close(); }
