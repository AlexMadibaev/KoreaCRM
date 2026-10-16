import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const apiUrl = process.env.KOREACRM_TEST_API_URL ?? 'http://127.0.0.1:3008';
const webUrl = process.env.KOREACRM_TEST_WEB_URL ?? 'http://127.0.0.1:3007';
const login = process.env.KOREACRM_TEST_LOGIN;
const password = process.env.KOREACRM_TEST_PASSWORD;
if (!login || !password) throw new Error('Set KOREACRM_TEST_LOGIN and KOREACRM_TEST_PASSWORD');

async function api(path, token, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}
const auth = await fetch(`${apiUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
assert.equal(auth.status, 201);
const { accessToken } = await auth.json();
const stores = await api('/stores', accessToken);
const sku = `WEB-NOTICE-${randomUUID().slice(0, 8)}`;
const product = await api('/products', accessToken, { method: 'POST', body: JSON.stringify({ name: 'Тест центра уведомлений', sku }) });
const target = (await fetch('http://127.0.0.1:9226/json').then(response => response.json())).find(item => item.type === 'page');
assert.ok(target?.webSocketDebuggerUrl);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression).catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-500)')}`); }

try {
  await api(`/stores/${stores[0].id}/products/${product.id}/settings`, accessToken, { method: 'PATCH', body: JSON.stringify({ minStock: 1 }) });
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `${webUrl}/login` });
  await waitFor('!!document.querySelector("input[autocomplete=username]")');
  await evaluate(`sessionStorage.clear(); localStorage.clear(); sessionStorage.setItem('accessToken', ${JSON.stringify(accessToken)})`);
  await call('Page.navigate', { url: `${webUrl}/notifications` });
  await waitFor(`!![...document.querySelectorAll('.crm-notification-card')].find(card => card.innerText.includes(${JSON.stringify(sku)}))`);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.ok(await evaluate('!!document.querySelector(".crm-notification-link span")'));
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('tools/pg-test-data/notifications-mobile.png', Buffer.from(screenshot.data, 'base64'));
  await evaluate(`[...document.querySelectorAll('.crm-notification-card')].find(card => card.innerText.includes(${JSON.stringify(sku)})).querySelector('button').click()`);
  await waitFor(`!![...document.querySelectorAll('.crm-notification-card')].find(card => card.innerText.includes(${JSON.stringify(sku)}) && !card.classList.contains('unread'))`);
  await evaluate('[...document.querySelectorAll(".crm-notification-tabs button")][1].click()');
  await waitFor(`![...document.querySelectorAll('.crm-notification-card')].some(card => card.innerText.includes(${JSON.stringify(sku)}))`);
  console.log(JSON.stringify({ result: 'ok', sku, mobileWidth: 360, badge: true, markRead: true, unreadFilter: true }));
} finally {
  await call('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
  socket.close();
  await api(`/products/${product.id}`, accessToken, { method: 'DELETE' });
}
