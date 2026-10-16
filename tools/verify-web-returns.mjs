import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const token = await fetch('http://127.0.0.1:3005/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) }).then(response => response.json()).then(value => value.accessToken);
const targets = await fetch('http://127.0.0.1:9225/json').then(response => response.json());
const target = targets.find(item => item.url.startsWith('http://127.0.0.1:3004/'));
if (!target) throw Error('Web preview tab not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0; const tasks = new Map();
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression, timeout = 30000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 250)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-1800)')}`); }
function setInput(selector, value) { return `(() => { const element=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('input',{bubbles:true})); })()`; }
try {
  await call('Page.enable');
  await call('Runtime.enable');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(token)})`);
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/sales' });
  await waitFor('!!document.querySelector("section[aria-label]")');
  await waitFor('document.querySelector("section[aria-label]")?.textContent.includes("DEMO-0001")');
  await evaluate('document.querySelectorAll("section[aria-label] button[aria-pressed]")[1].click()');
  await waitFor('document.querySelector("section[aria-label]")?.textContent.includes("Найдено: 2")');
  await evaluate('document.querySelector("section[aria-label] button[aria-expanded]")?.click()');
  await waitFor('document.querySelector("section[aria-label]")?.textContent.includes("Сыворотка")');
  const panel = await evaluate('document.querySelector("section[aria-label]")?.textContent');
  assert.match(panel, /Возврат сыворотки/);
  await evaluate(setInput('section[aria-label="История продаж и возвратов"] input', '+998901234567'));
  await waitFor('document.querySelector("section[aria-label]")?.textContent.includes("Найдено: 0")');
  await evaluate(setInput('section[aria-label="История продаж и возвратов"] input', 'DEMO-0001'));
  await waitFor('document.querySelector("section[aria-label]")?.textContent.includes("Найдено: 2")');
  await evaluate('document.querySelector("section[aria-label] button[aria-expanded]")?.click()');
  await evaluate('document.querySelector("section[aria-label]").scrollIntoView({block:"start"})');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('D:/KoreaCRM/apps/web/preview-returns.png', Buffer.from(shot.data, 'base64'));
  await evaluate('Array.from(document.querySelectorAll("section[aria-label] button")).find(button => button.textContent.includes("Открыть исходный чек"))?.click()');
  await waitFor('document.querySelector("section[aria-label]")?.textContent.includes("Частичный возврат")');
  await evaluate('document.querySelector("section[aria-label] button[aria-expanded]")?.click()');
  await waitFor('document.querySelector("section[aria-label]")?.textContent.includes("После возвратов")');
  const saleShot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('D:/KoreaCRM/apps/web/preview-sales-with-returns.png', Buffer.from(saleShot.data, 'base64'));
  console.log(JSON.stringify({ returns: 2, search: true, detail: true, saleNet: true, screenshots: ['apps/web/preview-returns.png', 'apps/web/preview-sales-with-returns.png'] }));
} finally { socket.close(); }
