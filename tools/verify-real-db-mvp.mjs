import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.KOREACRM_TEST_API_URL ?? 'http://127.0.0.1:3006';
const login = process.env.KOREACRM_TEST_LOGIN;
const password = process.env.KOREACRM_TEST_PASSWORD;
if (!login || !password) throw new Error('Set KOREACRM_TEST_LOGIN and KOREACRM_TEST_PASSWORD');

let token;
async function request(method, path, body, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}

const auth = await request('POST', '/auth/login', { login, password }, 201);
assert.ok(auth.accessToken);
token = auth.accessToken;
const me = await request('GET', '/auth/me');
assert.equal(me.login, login);
const stores = await request('GET', '/stores');
assert.ok(stores.length > 0);
const storeId = stores[0].id;
const methods = await request('GET', '/sale-payment-methods');
const cardId = methods.find((method) => method.code === 'CARD')?.id;
assert.ok(cardId);

const suffix = randomUUID().slice(0, 8);
const product = await request('POST', '/products', { name: `DB test ${suffix}`, sku: `DB-${suffix}`, barcodes: [] }, 201);
assert.ok(product.id);
await request('PATCH', `/stores/${storeId}/products/${product.id}/settings`, { priceMinor: 150000, minStock: 1, active: true });
const supplier = await request('POST', '/suppliers', { name: `DB test supplier ${suffix}` }, 201);
const purchase = await request('POST', `/stores/${storeId}/purchases`, {
  supplierId: supplier.id, number: `DB-${suffix}`, items: [{ productId: product.id, quantityOrdered: 3, purchasePriceMinor: '90000', salePriceMinor: '150000' }],
}, 201);
assert.equal(purchase.items.length, 1);
await request('POST', `/stores/${storeId}/purchases/${purchase.id}/submit`, undefined, 201);
const receivingOperationId = randomUUID();
const receivingBody = { operationId: receivingOperationId, items: [{ purchaseItemId: purchase.items[0].id, quantity: 3, batchNumber: `B-${suffix}` }] };
const receiving = await request('POST', `/stores/${storeId}/purchases/${purchase.id}/receivings`, receivingBody, 201);
const repeatedReceiving = await request('POST', `/stores/${storeId}/purchases/${purchase.id}/receivings`, receivingBody, 201);
assert.equal(repeatedReceiving.id, receiving.id);

async function stockQuantity() {
  const result = await request('GET', `/stores/${storeId}/stock?search=${product.sku}`);
  assert.equal(result.items.length, 1);
  return result.items[0].quantity;
}
assert.equal(await stockQuantity(), 3);

const deviceId = `db-test-${suffix}`;
await request('POST', `/stores/${storeId}/pos-devices`, { deviceId, appVersion: 'db-test' }, 201);
const saleBody = { operationId: randomUUID(), deviceId, items: [{ productId: product.id, quantity: 2, discountMinor: '0' }], payments: [{ paymentMethodId: cardId, amountMinor: '300000' }] };
await request('POST', `/stores/${storeId}/sales`, { ...saleBody, items: [{ ...saleBody.items[0], quantity: 4 }], payments: [{ paymentMethodId: cardId, amountMinor: '600000' }] }, 409);
assert.equal(await stockQuantity(), 3);
const sale = await request('POST', `/stores/${storeId}/sales`, saleBody, 201);
const repeatedSale = await request('POST', `/stores/${storeId}/sales`, saleBody, 201);
assert.equal(repeatedSale.id, sale.id);
assert.equal(await stockQuantity(), 1);

const writeOffBody = { operationId: randomUUID(), productId: product.id, quantity: 2, comment: 'Real database integration test' };
await request('POST', `/stores/${storeId}/stock/write-offs`, writeOffBody, 409);
const writeOff = await request('POST', `/stores/${storeId}/stock/write-offs`, { ...writeOffBody, quantity: 1 }, 201);
const repeatedWriteOff = await request('POST', `/stores/${storeId}/stock/write-offs`, { ...writeOffBody, quantity: 1 }, 201);
assert.equal(repeatedWriteOff.id, writeOff.id);
assert.equal(await stockQuantity(), 0);

console.log(JSON.stringify({ result: 'ok', checks: ['login', 'purchase', 'receipt idempotency', 'stock', 'oversell rejection', 'sale idempotency', 'write-off limit and idempotency'], storeId, productId: product.id, saleId: sale.id }));
