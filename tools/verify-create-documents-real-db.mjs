// Integration check for multi-line write-off and receive documents and their place in the journals. SEPARATE test PostgreSQL only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (process.env.KOREACRM_ISOLATED_TEST_DB !== '1') throw new Error('Set KOREACRM_ISOLATED_TEST_DB=1: this script writes test data');
const baseUrl = process.env.KOREACRM_TEST_API_URL ?? 'http://127.0.0.1:3006';
async function call(token, method, path, body, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}
const owner = (await call(null, 'POST', '/auth/login', { login: process.env.KOREACRM_TEST_LOGIN, password: process.env.KOREACRM_TEST_PASSWORD }, 201)).accessToken;
const request = (method, path, body, expected) => call(owner, method, path, body, expected);
const s = randomUUID().slice(0, 6).toUpperCase();
const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const store = await request('POST', '/store-management', { name: `Формы ${s}`, code: `FM${s}` }, 201);
const a = await request('POST', '/products', { name: `Тушь ${s}`, sku: `FA-${s}`, barcodes: [] }, 201);
const b = await request('POST', '/products', { name: `Помада ${s}`, sku: `FB-${s}`, barcodes: [] }, 201);
const stockOf = async product => (await request('GET', `/stores/${store.id}/stock?search=${product.sku}`)).items[0]?.quantity ?? 0;
const checks = [];

const receiveId = randomUUID();
const receive = { operationId: receiveId, comment: 'Излишки при приёмке', items: [{ productId: a.id, quantity: 5 }, { productId: b.id, quantity: 3 }] };
assert.equal((await request('POST', `/stores/${store.id}/stock/receive-documents`, receive, 201)).length, 2);
assert.equal((await request('POST', `/stores/${store.id}/stock/receive-documents`, receive, 201)).length, 2, 'replay returns the same document');
assert.deepEqual([await stockOf(a), await stockOf(b)], [5, 3], 'a replay does not add stock twice');
checks.push('receive document: two lines, replay safe');

const writeOffId = randomUUID();
const writeOff = { operationId: writeOffId, comment: 'Истёк срок годности', items: [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 1 }, { productId: a.id, quantity: 1 }] };
await request('POST', `/stores/${store.id}/stock/write-off-documents`, writeOff, 201);
await request('POST', `/stores/${store.id}/stock/write-off-documents`, writeOff, 201);
assert.deepEqual([await stockOf(a), await stockOf(b)], [2, 2], 'duplicate lines are merged and a replay is ignored');
await request('POST', `/stores/${store.id}/stock/write-off-documents`, { ...writeOff, comment: 'Другая причина' }, 409);
await request('POST', `/stores/${store.id}/stock/write-off-documents`, { operationId: randomUUID(), comment: 'Слишком много', items: [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 50 }] }, 409);
assert.deepEqual([await stockOf(a), await stockOf(b)], [2, 2], 'a failed line rolls back the whole document');
checks.push('write-off document: merged lines, replay safe, conflict and all-or-nothing');

const journal = await request('GET', `/documents?from=${today}&to=${today}&storeId=${store.id}`);
const kinds = journal.items.map(item => `${item.kind}:${item.positions}`).sort();
assert.deepEqual(kinds, ['RECEIVE_IN:2', 'WRITE_OFF:2']);
const card = await request('GET', `/documents/WRITE_OFF/${writeOffId}`);
assert.deepEqual(card.lines.map(line => line.quantity).sort((x, y) => x - y), [-3, -1]);
assert.equal((await request('GET', `/documents/RECEIVE_IN/${receiveId}`)).fields.find(([label]) => label === 'Комментарий')[1], 'Излишки при приёмке');
checks.push('journal shows each as one document with its lines');

const deviceId = `form-${s}`;
await request('POST', `/stores/${store.id}/pos-devices`, { deviceId, appVersion: 'form-test' }, 201);
const shift = await request('POST', `/stores/${store.id}/finance/cash-shifts`, { deviceId, openingCashMinor: '0' }, 201);
await request('POST', `/stores/${store.id}/finance/cash-shifts/${shift.id}/operations`, { operationId: randomUUID(), type: 'DEPOSIT', amountMinor: '2500', comment: 'Размен: от управляющего' }, 201);
const money = await request('GET', `/money?from=${today}&to=${today}&storeId=${store.id}`);
assert.ok(money.items.some(item => item.direction === 'IN' && item.amountMinor === '2500' && item.comment === 'Размен: от управляющего'));
checks.push('cash receipt appears in the money journal');
console.log(JSON.stringify({ result: 'ok', checks }, null, 1));
