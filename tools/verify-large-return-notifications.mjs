import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client/default.js';

const apiUrl = process.env.KOREACRM_TEST_API_URL ?? 'http://127.0.0.1:3008';
const login = process.env.KOREACRM_TEST_LOGIN;
const password = process.env.KOREACRM_TEST_PASSWORD;
if (!login || !password || !process.env.DATABASE_URL) throw new Error('Set test login, password and DATABASE_URL');
const prisma = new PrismaClient();
let token;
async function request(path, body, method = 'GET') {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function verifyBrowser(sale, storeId) {
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
    await waitFor(`!![...document.querySelectorAll('.crm-notification-card')].find(card => card.innerText.includes('Крупный возврат'))`);
    const href = `/sales?storeId=${storeId}&saleId=${sale.id}`;
    assert.ok(await evaluate(`!![...document.querySelectorAll('.crm-notification-card')].find(card => card.innerText.includes('Крупный возврат'))?.querySelector('a[href="${href}"]')`));
    await evaluate(`[...document.querySelectorAll('.crm-notification-card')].find(card => card.innerText.includes('Крупный возврат')).querySelector('a').click()`);
    await waitFor(`location.pathname === '/sales' && !!document.querySelector('#sale-receipt')?.innerText.includes(${JSON.stringify(sale.number)})`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile('tools/pg-test-data/large-return-mobile.png', Buffer.from(screenshot.data, 'base64'));
  } finally { await call('Emulation.clearDeviceMetricsOverride').catch(() => undefined); socket.close(); }
}

let store; let product; let supplier; let shift; let sale; let returnRecord;
try {
  token = (await request('/auth/login', { login, password }, 'POST')).accessToken;
  const suffix = randomUUID().slice(0, 8);
  store = await prisma.store.create({ data: { code: `RET-${suffix}`, name: 'Тестовый магазин возврата' } });
  product = await request('/products', { name: 'Тест крупного возврата', sku: `RETURN-NOTICE-${suffix}` }, 'POST');
  supplier = await request('/suppliers', { name: `Тестовый поставщик ${suffix}` }, 'POST');
  await request(`/stores/${store.id}/products/${product.id}/settings`, { priceMinor: 100000000, active: true }, 'PATCH');
  const purchase = await request(`/stores/${store.id}/purchases`, { supplierId: supplier.id, number: `RET-${suffix}`, items: [{ productId: product.id, quantityOrdered: 1, purchasePriceMinor: '1000000' }] }, 'POST');
  await request(`/stores/${store.id}/purchases/${purchase.id}/submit`, undefined, 'POST');
  await request(`/stores/${store.id}/purchases/${purchase.id}/receivings`, { operationId: randomUUID(), items: [{ purchaseItemId: purchase.items[0].id, quantity: 1, batchNumber: 'TEST' }] }, 'POST');
  const deviceId = `RETURN-NOTICE-${suffix}`;
  await request(`/stores/${store.id}/pos-devices`, { deviceId, appVersion: 'notification-test' }, 'POST');
  shift = await request(`/stores/${store.id}/finance/cash-shifts`, { deviceId, openingCashMinor: '0' }, 'POST');
  const cash = (await request('/sale-payment-methods')).find(method => method.kind === 'CASH');
  assert.ok(cash);
  sale = await request(`/stores/${store.id}/sales`, { operationId: randomUUID(), deviceId, cashShiftId: shift.id, items: [{ productId: product.id, quantity: 1, discountMinor: '0' }], payments: [{ paymentMethodId: cash.id, amountMinor: '100000000' }] }, 'POST');
  const body = { operationId: randomUUID(), deviceId, cashShiftId: shift.id, reason: 'Проверка уведомления о крупном возврате' };
  const returned = await request(`/stores/${store.id}/sales/${sale.id}/return`, body, 'POST');
  returnRecord = returned.returns[0];
  assert.ok(returnRecord);
  const events = async () => (await request('/notifications?limit=100')).items.filter(item => item.sourceKey === `return:${returnRecord.id}:sale:${sale.id}`);
  assert.equal((await events()).length, 1);
  await request(`/stores/${store.id}/sales/${sale.id}/return`, body, 'POST');
  assert.equal((await events()).length, 1, 'Replay must not duplicate notification');
  if (process.env.KOREACRM_TEST_BROWSER === '1') await verifyBrowser(sale, store.id);
  console.log(JSON.stringify({ result: 'ok', saleId: sale.id, returnId: returnRecord.id, notifications: 1, replayDuplicates: false }));
} finally {
  try {
    if (shift) {
      const current = await prisma.cashShift.findUnique({ where: { id: shift.id } });
      if (current?.status === 'OPEN') await request(`/stores/${store.id}/finance/cash-shifts/${shift.id}/close`, { actualCashMinor: current.expectedCashMinor.toString() }, 'POST');
    }
    if (returnRecord) await prisma.notification.updateMany({ where: { sourceKey: `return:${returnRecord.id}:sale:${sale.id}` }, data: { resolvedAt: new Date(), readAt: new Date() } });
    if (product) await request(`/products/${product.id}`, undefined, 'DELETE');
    if (supplier) await prisma.supplier.update({ where: { id: supplier.id }, data: { deletedAt: new Date(), status: 'INACTIVE' } });
    if (store) await prisma.store.update({ where: { id: store.id }, data: { deletedAt: new Date() } });
  } finally { await prisma.$disconnect(); }
}
