// Integration check for the wide product list (GET /products-overview). SEPARATE test PostgreSQL only.
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
const store = await request('POST', '/store-management', { name: `Каталог ${s}`, code: `CT${s}` }, 201);
const barcode = `46${Date.now()}`.slice(0, 13);
const product = await request('POST', '/products', { name: `Сыворотка ${s}`, sku: `CT-${s}`, barcodes: [barcode] }, 201);
await request('PATCH', `/stores/${store.id}/products/${product.id}/settings`, { priceMinor: 5000, minStock: 2, active: true });
const supplier = await request('POST', '/suppliers', { name: `Каталожный ${s}` }, 201);
const purchase = await request('POST', `/stores/${store.id}/purchases`, { supplierId: supplier.id, number: `PC-${s}`, items: [{ productId: product.id, quantityOrdered: 4, purchasePriceMinor: '3000' }] }, 201);
await request('POST', `/stores/${store.id}/purchases/${purchase.id}/submit`, undefined, 201);
await request('POST', `/stores/${store.id}/purchases/${purchase.id}/receivings`, { operationId: randomUUID(), items: [{ purchaseItemId: purchase.items[0].id, quantity: 4, batchNumber: `B-${s}` }] }, 201);

const checks = [];
const list = await request('GET', `/products-overview?search=${barcode}&storeId=${store.id}`);
assert.equal(list.total, 1);
const row = list.items[0];
assert.deepEqual([row.barcode, row.priceMinor, row.purchasePriceMinor, row.costMinor, row.marginPercent, row.markupPercent, row.minStock, row.supplier], [barcode, '5000', '3000', '3000', '40.00', '66.67', 2, supplier.name]);
assert.equal(row.stock[store.id], 4);
assert.ok(list.stores.some(item => item.id === store.id));
checks.push('price, purchase price, cost, margin, markup, supplier and stock per store');
assert.equal((await request('GET', `/products-overview?search=CT-${s}&status=INACTIVE`)).total, 0);
checks.push('status filter');
const roles = await request('GET', '/roles');
const login = `cat_cash_${s.toLowerCase()}`;
await request('POST', '/employees', { name: 'Кассир каталога', login, password: 'catalog-test-password', roleId: roles.find(role => role.code === 'CASHIER').id, storeIds: [store.id], primaryStoreId: store.id }, 201);
const cashier = (await call(null, 'POST', '/auth/login', { login, password: 'catalog-test-password' }, 201)).accessToken;
const me = await call(cashier, 'GET', '/auth/me');
const cashierList = await call(cashier, 'GET', `/products-overview?search=CT-${s}`, undefined, me.permissions.includes('products.view') ? 200 : 403);
if (cashierList && !me.permissions.includes('finance.view') && !me.permissions.includes('purchases.view')) assert.equal(cashierList.items[0].costMinor, null, 'cost is hidden without finance or purchase rights');
const other = await request('POST', '/store-management', { name: `Чужой каталог ${s}`, code: `CX${s}` }, 201);
await call(cashier, 'GET', `/products-overview?storeId=${other.id}`, undefined, me.permissions.includes('products.view') ? 403 : 403);
checks.push('cost visibility and store isolation');
console.log(JSON.stringify({ result: 'ok', checks }, null, 1));
