// Integration check for the document journal (GET /documents) and document card (GET /documents/:kind/:id).
// Uses a real API and a SEPARATE test PostgreSQL database; never run it against production.
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

const store = await request('POST', '/store-management', { name: `Документы ${s}`, code: `DC${s}` }, 201);
const cash = (await request('GET', '/sale-payment-methods')).find(method => method.code === 'CASH').id;
const product = await request('POST', '/products', { name: `Товар документов ${s}`, sku: `DC-${s}`, barcodes: [`200${Date.now()}`.slice(0, 13)] }, 201);
await request('PATCH', `/stores/${store.id}/products/${product.id}/settings`, { priceMinor: 5000, minStock: 0, active: true });
const supplier = await request('POST', '/suppliers', { name: `Поставщик документов ${s}` }, 201);
const purchase = await request('POST', `/stores/${store.id}/purchases`, { supplierId: supplier.id, number: `PD-${s}`, items: [{ productId: product.id, quantityOrdered: 8, purchasePriceMinor: '3000' }] }, 201);
await request('POST', `/stores/${store.id}/purchases/${purchase.id}/submit`, undefined, 201);
await request('POST', `/stores/${store.id}/purchases/${purchase.id}/receivings`, { operationId: randomUUID(), items: [{ purchaseItemId: purchase.items[0].id, quantity: 8, batchNumber: `B-${s}` }] }, 201);
const deviceId = `doc-${s}`;
await request('POST', `/stores/${store.id}/pos-devices`, { deviceId, appVersion: 'doc-test' }, 201);
const shift = await request('POST', `/stores/${store.id}/finance/cash-shifts`, { deviceId, openingCashMinor: '0' }, 201);
const sale = await request('POST', `/stores/${store.id}/sales`, { operationId: randomUUID(), deviceId, cashShiftId: shift.id, items: [{ productId: product.id, quantity: 2, discountMinor: '500' }], payments: [{ paymentMethodId: cash, amountMinor: '9500' }] }, 201);
await request('POST', `/stores/${store.id}/sales/${sale.id}/return`, { operationId: randomUUID(), deviceId, cashShiftId: shift.id, reason: 'Не подошёл оттенок', items: [{ saleItemId: sale.items[0].id, quantity: 1 }] }, 201);
const writeOffId = randomUUID();
await request('POST', `/stores/${store.id}/stock/write-offs`, { operationId: writeOffId, productId: product.id, quantity: 1, comment: 'Повреждён при выкладке' }, 201);
await request('POST', `/stores/${store.id}/stock/adjustments`, { productId: product.id, type: 'CORRECTION', delta: 2, comment: 'Найдено на складе' }, 201);

const checks = [];
const journal = await request('GET', `/documents?from=${today}&to=${today}&storeId=${store.id}`);
const kinds = journal.items.map(item => item.kind).sort();
assert.deepEqual(kinds, ['ADJUSTMENT', 'PURCHASE', 'SALE', 'SALE_RETURN', 'WRITE_OFF']);
const saleRow = journal.items.find(item => item.kind === 'SALE');
assert.deepEqual([saleRow.positions, saleRow.amountMinor, saleRow.paidMinor, saleRow.sender, saleRow.receiver], [1, '9500', '9500', `Магазин ${store.name}`, 'Клиент Розничный покупатель']);
const purchaseRow = journal.items.find(item => item.kind === 'PURCHASE');
assert.deepEqual([purchaseRow.amountMinor, purchaseRow.paidMinor, purchaseRow.sender], ['24000', '0', `Поставщик ${supplier.name}`]);
const ret = journal.items.find(item => item.kind === 'SALE_RETURN');
checks.push('journal lists every document kind with sums and parties');

assert.deepEqual((await request('GET', `/documents?from=${today}&to=${today}&storeId=${store.id}&kind=PURCHASE`)).items.map(item => item.kind), ['PURCHASE']);
assert.deepEqual((await request('GET', `/documents?from=${today}&to=${today}&storeId=${store.id}&paid=UNPAID`)).items.map(item => item.kind), ['PURCHASE']);
assert.equal((await request('GET', `/documents?from=${today}&to=${today}&storeId=${store.id}&q=PD-${s}`)).total, 1);
checks.push('type, payment and search filters');

const saleCard = await request('GET', `/documents/SALE/${sale.id}`);
assert.equal(saleCard.payments.length, 1);
assert.deepEqual([saleCard.lines[0].quantity, saleCard.lines[0].priceMinor, saleCard.lines[0].discountMinor, saleCard.lines[0].totalMinor], [2, '5000', '500', '9500']);
assert.ok(saleCard.lines[0].barcode);
assert.equal(saleCard.related[0].id, ret.id);
assert.equal((await request('GET', `/documents/SALE_RETURN/${ret.id}`)).lines[0].quantity, 1);
assert.equal((await request('GET', `/documents/PURCHASE/${purchase.id}`)).lines[0].received, 8);
const writeOff = await request('GET', `/documents/WRITE_OFF/${writeOffId}`);
assert.deepEqual([writeOff.lines[0].quantity, writeOff.lines[0].after], [-1, 6]);
checks.push('document cards: sale, return, purchase, write-off');

const roles = await request('GET', '/roles');
const login = `doc_cash_${s.toLowerCase()}`;
const other = await request('POST', '/store-management', { name: `Другой ${s}`, code: `DO${s}` }, 201);
await request('POST', '/employees', { name: 'Кассир документов', login, password: 'doc-test-password', roleId: roles.find(role => role.code === 'CASHIER').id, storeIds: [other.id], primaryStoreId: other.id }, 201);
const cashier = (await call(null, 'POST', '/auth/login', { login, password: 'doc-test-password' }, 201)).accessToken;
await call(cashier, 'GET', `/documents?from=${today}&to=${today}&storeId=${store.id}`, undefined, 403);
await call(cashier, 'GET', `/documents/SALE/${sale.id}`, undefined, 404);
const own = await call(cashier, 'GET', `/documents?from=${today}&to=${today}`);
assert.ok(!own.kinds.includes('PURCHASE') || own.items.every(item => item.kind !== 'PURCHASE' || item.receiver.includes(other.name)));
assert.ok(own.items.every(item => !String(item.sender).includes(store.name) && !String(item.receiver).includes(store.name)));
checks.push('store isolation and permissions');
await request('GET', `/documents/NOPE/${sale.id}`, undefined, 404);
checks.push('validation');
console.log(JSON.stringify({ result: 'ok', checks }, null, 1));
