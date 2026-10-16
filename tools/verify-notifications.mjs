import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.KOREACRM_TEST_API_URL ?? 'http://127.0.0.1:3008';
const login = process.env.KOREACRM_TEST_LOGIN;
const password = process.env.KOREACRM_TEST_PASSWORD;
if (!login || !password) throw new Error('Set KOREACRM_TEST_LOGIN and KOREACRM_TEST_PASSWORD');

async function request(path, options = {}, token) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

const tokens = await request('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
const token = tokens.accessToken;
const stores = await request('/stores', {}, token);
assert.ok(stores[0]?.id, 'Test owner needs a store');
const storeId = stores[0].id;
const sku = `NOTICE-${randomUUID().slice(0, 8)}`;
const product = await request('/products', { method: 'POST', body: JSON.stringify({ name: 'Проверка уведомлений', sku }) }, token);
const list = () => request('/notifications?page=1&limit=100', {}, token);
const item = async () => (await list()).items.find(entry => entry.productId === product.id);
try {
  await request(`/stores/${storeId}/products/${product.id}/settings`, { method: 'PATCH', body: JSON.stringify({ minStock: 2 }) }, token);
  let notice = await item();
  assert.equal(notice?.type, 'OUT_OF_STOCK');
  assert.equal(notice.readAt, null);
  const firstId = notice.id;
  assert.equal((await item()).id, firstId, 'Repeated reading must not duplicate a notification');
  await request(`/notifications/${firstId}/read`, { method: 'PATCH' }, token);
  notice = await item();
  assert.ok(notice.readAt);
  await request(`/stores/${storeId}/stock/adjustments`, { method: 'POST', body: JSON.stringify({ productId: product.id, type: 'CORRECTION', delta: 1, comment: 'Проверка уведомлений: низкий остаток' }) }, token);
  notice = await item();
  assert.equal(notice?.type, 'LOW_STOCK');
  assert.equal(notice.id, firstId);
  assert.equal(notice.readAt, null, 'A more severe or changed alert must become unread');
  await request(`/notifications/${firstId}/read`, { method: 'PATCH' }, token);
  await request(`/stores/${storeId}/stock/adjustments`, { method: 'POST', body: JSON.stringify({ productId: product.id, type: 'CORRECTION', delta: 1, comment: 'Проверка уведомлений: частичное пополнение' }) }, token);
  assert.ok((await item()).readAt, 'Improving stock within the same alert level keeps read state');
  await request(`/stores/${storeId}/stock/adjustments`, { method: 'POST', body: JSON.stringify({ productId: product.id, type: 'CORRECTION', delta: -1, comment: 'Проверка уведомлений: снижение остатка' }) }, token);
  assert.equal((await item()).readAt, null, 'Worsening stock makes the alert unread again');
  await request(`/stores/${storeId}/stock/adjustments`, { method: 'POST', body: JSON.stringify({ productId: product.id, type: 'CORRECTION', delta: 2, comment: 'Проверка уведомлений: пополнение' }) }, token);
  assert.equal(await item(), undefined, 'Recovered stock must leave the active list');
  console.log(JSON.stringify({ result: 'ok', sku, noDuplicates: true, readState: true, worseningAlert: true, resolved: true }));
} finally {
  await request(`/products/${product.id}`, { method: 'DELETE' }, token);
}
