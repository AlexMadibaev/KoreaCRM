import assert from 'node:assert/strict';

const token = await fetch('http://127.0.0.1:3005/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) }).then(response => response.json()).then(value => value.accessToken);
const target = (await fetch('http://127.0.0.1:9225/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}`); }
function setInput(selector, value) { return `(() => { const element=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('input',{bubbles:true})); })()`; }
try {
  await call('Page.enable'); await call('Runtime.enable');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(token)})`);
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/employees' });
  await waitFor('document.body.innerText.includes("@preview.manager")');
  await evaluate('Array.from(document.querySelectorAll("article")).find(article => article.textContent.includes("@preview.manager"))?.querySelector("button")?.click()');
  await waitFor(`!!document.querySelector(${JSON.stringify('[aria-label="Редактор сотрудника"]')})`);
  await evaluate(setInput('[aria-label="Редактор сотрудника"] input[minlength="2"]', 'Тестовый менеджер CRM'));
  await evaluate(setInput('[aria-label="Редактор сотрудника"] input[type=password]', 'changed-manager-123'));
  await evaluate(`document.querySelector(${JSON.stringify('[aria-label="Редактор сотрудника"] button[type=submit]')})?.click()`);
  await waitFor('document.body.innerText.includes("Данные сотрудника сохранены")');
  await waitFor('document.body.innerText.includes("Тестовый менеджер CRM")');
  const changedLogin = await fetch('http://127.0.0.1:3005/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'preview.manager', password: 'changed-manager-123' }) });
  assert.equal(changedLogin.status, 200);
  console.log(JSON.stringify({ employeeEdited: true, newPasswordWorks: true }));
} finally { socket.close(); }
