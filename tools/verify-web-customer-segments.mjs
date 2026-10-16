import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const login = await fetch('http://127.0.0.1:3005/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) });
assert.equal(login.status, 200);
const { accessToken } = await login.json();
const target = (await fetch('http://127.0.0.1:9225/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target, 'Web preview tab is open');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-1200)')}`); }
async function selectSegment(code) { await evaluate(`(() => { const select = document.querySelector('select[aria-label="Сегмент клиентов"]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, ${JSON.stringify(code)}); select.dispatchEvent(new Event('change', { bubbles: true })); })()`); }
try {
  await call('Page.enable'); await call('Runtime.enable');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(accessToken)})`);
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/customers' });
  await waitFor('document.body.innerText.includes("Елена Пак")');
  await selectSegment('REGULAR');
  await waitFor('document.body.innerText.includes("Елена Пак") && !document.body.innerText.includes("Анна Иванова")');
  assert.ok(await evaluate('!document.body.innerText.includes("Мария Ким")'));
  await evaluate('Array.from(document.querySelectorAll("li button")).find(button => button.parentElement?.textContent.includes("Елена Пак"))?.click()');
  await waitFor('document.body.innerText.includes("Частые покупки")');
  assert.ok(await evaluate('document.body.innerText.includes("Постоянный")'));
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/web/preview-customer-segments.png', Buffer.from(screenshot.data, 'base64'));
  await selectSegment('NEW');
  await waitFor('document.body.innerText.includes("Анна Иванова") && document.body.innerText.includes("Мария Ким")');
  assert.ok(await evaluate('!Array.from(document.querySelectorAll("li")).some(item => item.textContent?.includes("Елена Пак"))'));
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  console.log(JSON.stringify({ regular: true, frequent: true, newFilter: true, screenshot: 'apps/web/preview-customer-segments.png' }));
} finally { socket.close(); }
