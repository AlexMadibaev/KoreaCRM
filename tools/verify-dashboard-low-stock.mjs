import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = 'http://127.0.0.1:3005';
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) }).then(response => response.json());
const target = (await fetch('http://127.0.0.1:9225/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target, 'Web preview tab is open');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-900)')}`); }
try {
  await call('Page.enable'); await call('Runtime.enable');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(login.accessToken)})`);
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/dashboard' });
  await waitFor('document.querySelector(".crm-stock-attention-list a")?.textContent.includes("Крем для лица Centella")');
  assert.ok(await evaluate('[...document.querySelectorAll(".crm-metric")].find(card => card.textContent.includes("Выручка"))?.textContent.includes("1 900,00 сомони") || [...document.querySelectorAll(".crm-metric")].find(card => card.textContent.includes("Выручка"))?.textContent.includes("1\u00a0900,00 сомони")'));
  assert.equal(await evaluate('[...document.querySelectorAll(".crm-metric")].find(card => card.textContent.includes("Валовая прибыль"))?.querySelector("strong")?.textContent'), '—');
  assert.ok(await evaluate('document.querySelector(".crm-stock-attention")?.textContent.includes("Требуют внимания: 1")'));
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/web/preview-dashboard-low-stock.png', Buffer.from(screenshot.data, 'base64'));
  await evaluate('document.querySelector(".crm-stock-attention-list a").click()');
  await waitFor('location.pathname === "/stock" && document.querySelector("select")?.value === "demo-store"');
  assert.equal(await evaluate('new URLSearchParams(location.search).get("filter")'), 'low');
  assert.equal(await evaluate('document.querySelectorAll("select")[1]?.value'), 'low');
  await waitFor('document.body.innerText.includes("Крем для лица Centella")');
  console.log(JSON.stringify({ revenueMajor: '1900,00', unavailableProfit: true, lowStockCount: 1, stockLink: true }));
} finally { socket.close(); }
