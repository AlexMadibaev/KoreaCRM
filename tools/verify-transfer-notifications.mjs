import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client/default.js';

const apiUrl = process.env.KOREACRM_TEST_API_URL ?? 'http://127.0.0.1:3008';
const login = process.env.KOREACRM_TEST_LOGIN;
const password = process.env.KOREACRM_TEST_PASSWORD;
if (!login || !password || !process.env.DATABASE_URL) throw new Error('Set test login, password and DATABASE_URL');
const prisma = new PrismaClient();

async function request(path, token, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function verifyBrowser(token, transferId) {
  const target = (await fetch('http://127.0.0.1:9226/json').then(response => response.json())).find(item => item.type === 'page');
  assert.ok(target?.webSocketDebuggerUrl);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  const tasks = new Map(); let nextId = 0;
  socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
  function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
  async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
  async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression).catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}`); }
  try {
    await call('Page.enable'); await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
    await call('Page.navigate', { url: 'http://127.0.0.1:3007/login' });
    await waitFor('!!document.querySelector("input[autocomplete=username]")');
    await evaluate(`sessionStorage.clear(); localStorage.clear(); sessionStorage.setItem('accessToken', ${JSON.stringify(token)})`);
    await call('Page.navigate', { url: 'http://127.0.0.1:3007/notifications' });
    await waitFor(`!![...document.querySelectorAll('.crm-notification-card')].find(card => card.innerText.includes('Запрошено перемещение'))`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.ok(await evaluate(`!![...document.querySelectorAll('.crm-notification-card')].find(card => card.innerText.includes('Запрошено перемещение'))?.querySelector('a[href="/transfers?id=${transferId}"]')`));
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile('tools/pg-test-data/transfer-notifications-mobile.png', Buffer.from(screenshot.data, 'base64'));
    await evaluate(`[...document.querySelectorAll('.crm-notification-card')].find(card => card.innerText.includes('Запрошено перемещение')).querySelector('a').click()`);
    await waitFor(`location.pathname === '/transfers' && location.search.includes('id=${transferId}') && !!document.querySelector('#transfer-detail')`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const detailScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile('tools/pg-test-data/transfer-detail-mobile.png', Buffer.from(detailScreenshot.data, 'base64'));
    await evaluate(`document.querySelector('#transfer-detail button').click()`);
    await waitFor(`!document.querySelector('#transfer-detail') && !location.search.includes('id=')`);
  } finally { await call('Emulation.clearDeviceMetricsOverride').catch(() => undefined); socket.close(); }
}

const { accessToken } = await request('/auth/login', null, { method: 'POST', body: JSON.stringify({ login, password }) });
const stores = await request('/stores', accessToken);
const fromStoreId = stores[0]?.id;
assert.ok(fromStoreId);
const suffix = randomUUID().slice(0, 8);
let product; let destination; let transfer;
try {
  destination = await prisma.store.create({ data: { code: `NOTICE-${suffix}`, name: 'Тестовый магазин уведомлений' } });
  product = await request('/products', accessToken, { method: 'POST', body: JSON.stringify({ sku: `TRANSFER-NOTICE-${suffix}`, name: 'Тест уведомлений перемещения' }) });
  await request(`/stores/${fromStoreId}/stock/adjustments`, accessToken, { method: 'POST', body: JSON.stringify({ productId: product.id, type: 'CORRECTION', delta: 1, comment: 'Тест уведомлений: запас для отправки' }) });
  transfer = await request('/transfers', accessToken, { method: 'POST', body: JSON.stringify({ fromStoreId, toStoreId: destination.id, items: [{ productId: product.id, quantity: 1 }] }) });
  const events = async () => (await request('/notifications?page=1&limit=100', accessToken)).items.filter(item => item.sourceKey.startsWith(`transfer:${transfer.id}:`));
  await request(`/transfers/${transfer.id}/request`, accessToken, { method: 'POST' });
  assert.equal((await events()).filter(item => item.sourceKey.endsWith(':REQUESTED')).length, 1);
  if (process.env.KOREACRM_TEST_BROWSER === '1') await verifyBrowser(accessToken, transfer.id);
  await request(`/transfers/${transfer.id}/approve`, accessToken, { method: 'POST' });
  assert.equal((await events()).filter(item => item.sourceKey.endsWith(':APPROVED')).length, 1);
  await request(`/transfers/${transfer.id}/send`, accessToken, { method: 'POST' });
  assert.equal((await events()).filter(item => item.sourceKey.endsWith(':IN_TRANSIT')).length, 1);
  const operationId = randomUUID();
  const receiptBody = { operationId, items: [{ transferItemId: transfer.items[0].id, quantity: 1 }] };
  const receipt = await request(`/transfers/${transfer.id}/receive`, accessToken, { method: 'POST', body: JSON.stringify(receiptBody) });
  assert.ok((await events()).some(item => item.sourceKey === `transfer:${transfer.id}:receipt:${receipt.id}` && item.title === 'Перемещение завершено'));
  await request(`/transfers/${transfer.id}/receive`, accessToken, { method: 'POST', body: JSON.stringify(receiptBody) });
  assert.equal((await events()).length, 4, 'Replay must not create a duplicate notification');
  console.log(JSON.stringify({ result: 'ok', transferId: transfer.id, events: 4, replayDuplicates: false }));
} finally {
  try {
    if (transfer || product) await prisma.notification.updateMany({
      where: { OR: [
        ...(transfer ? [{ sourceKey: { startsWith: `transfer:${transfer.id}:` } }] : []),
        ...(product ? [{ productId: product.id }] : []),
      ] },
      data: { resolvedAt: new Date(), readAt: new Date() },
    });
    if (product) await request(`/products/${product.id}`, accessToken, { method: 'DELETE' });
    if (destination) await prisma.store.update({ where: { id: destination.id }, data: { deletedAt: new Date() } });
  } finally { await prisma.$disconnect(); }
}
