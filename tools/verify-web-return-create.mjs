import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const token = await fetch('http://127.0.0.1:3005/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) }).then(response => response.json()).then(value => value.accessToken);
const reason = `Проверка возврата ${Date.now()}`;
const targets = await fetch('http://127.0.0.1:9225/json').then(response => response.json());
const target = targets.find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target, 'Web preview tab not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression, timeout = 20000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-1600)')}`); }
function input(selector, value) { return `(() => { const element=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(${selector.includes('textarea') ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype,'value').set; setter.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('input',{bubbles:true})); })()`; }
try {
  await call('Page.enable'); await call('Runtime.enable');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(token)})`);
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/sales' });
  await waitFor('!!document.querySelector("section[aria-label] article button[aria-expanded]")');
  await evaluate('document.querySelector("section[aria-label] button[aria-expanded]")?.click()');
  await waitFor('!!document.querySelector(\'[aria-label^="Возврат по чеку"]\')');
  const form = '[aria-label^="Возврат по чеку"]';
  const shiftButton = await evaluate(`!!document.querySelector('${form} form button')?.textContent.includes('Открыть смену')`);
  if (shiftButton) {
    await evaluate(input(`${form} input[pattern="[0-9]+"]`, '500000'));
    await evaluate(`document.querySelector('${form} form button').click()`);
    await waitFor(`!document.querySelector('${form}')?.textContent.includes('Для возврата откройте кассовую смену')`);
  }
  await evaluate(input(`${form} input[type="number"]`, '1'));
  await evaluate(input(`${form} textarea`, reason));
  await waitFor(`document.querySelector('${form}')?.textContent.includes('К выдаче: 1 290,00') || document.querySelector('${form}')?.textContent.includes('К выдаче: 1 290,00')`);
  await evaluate(`Array.from(document.querySelectorAll('${form} button')).find(button => button.textContent.includes('Оформить возврат'))?.click()`);
  await waitFor(`document.querySelector('[role=status]')?.textContent.includes('Возврат по чеку')`);
  await waitFor(`document.querySelector('section[aria-label]')?.textContent.includes(${JSON.stringify(reason)})`);
  const body = await evaluate('document.querySelector("section[aria-label]")?.textContent');
  assert.ok(body.includes(reason));
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate('document.querySelector("section[aria-label]").scrollIntoView({block:"start"})');
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('D:/KoreaCRM/apps/web/preview-return-create.png', Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ shift: true, partialReturn: true, historyUpdated: true, screenshot: 'apps/web/preview-return-create.png' }));
} finally { socket.close(); }
