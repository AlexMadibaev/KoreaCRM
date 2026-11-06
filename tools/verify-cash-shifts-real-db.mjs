// Integration check for the CloudShop-style shift journal (GET /cash-shifts) and shift card (…/activity).
// Uses a real API and a SEPARATE test PostgreSQL database; never run it against production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (process.env.KOREACRM_ISOLATED_TEST_DB !== '1') throw new Error('Set KOREACRM_ISOLATED_TEST_DB=1: this script writes test data');
const baseUrl = process.env.KOREACRM_TEST_API_URL ?? 'http://127.0.0.1:3006';
const login = process.env.KOREACRM_TEST_LOGIN, password = process.env.KOREACRM_TEST_PASSWORD;
if (!login || !password) throw new Error('Set KOREACRM_TEST_LOGIN and KOREACRM_TEST_PASSWORD');

async function call(token, method, path, body, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}
const signIn = async (user, secret) => (await call(null, 'POST', '/auth/login', { login: user, password: secret }, 201)).accessToken;
const owner = await signIn(login, password);
const request = (method, path, body, expected) => call(owner, method, path, body, expected);
const s = randomUUID().slice(0, 6).toUpperCase();
const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);

const store = await request('POST', '/store-management', { name: `Смены ${s}`, code: `SH${s}` }, 201);
const methods = await request('GET', '/sale-payment-methods');
const cash = methods.find(method => method.code === 'CASH').id, card = methods.find(method => method.code === 'CARD').id;
const product = await request('POST', '/products', { name: `Товар смены ${s}`, sku: `SH-${s}`, barcodes: [] }, 201);
await request('PATCH', `/stores/${store.id}/products/${product.id}/settings`, { priceMinor: 10000, minStock: 0, active: true });
const supplier = await request('POST', '/suppliers', { name: `Поставщик смен ${s}` }, 201);
const purchase = await request('POST', `/stores/${store.id}/purchases`, { supplierId: supplier.id, number: `P-SH${s}`, items: [{ productId: product.id, quantityOrdered: 10, purchasePriceMinor: '6000' }] }, 201);
await request('POST', `/stores/${store.id}/purchases/${purchase.id}/submit`, undefined, 201);
await request('POST', `/stores/${store.id}/purchases/${purchase.id}/receivings`, { operationId: randomUUID(), items: [{ purchaseItemId: purchase.items[0].id, quantity: 10, batchNumber: `B-${s}` }] }, 201);
const deviceId = `shift-${s}`;
await request('POST', `/stores/${store.id}/pos-devices`, { deviceId, appVersion: 'shift-test' }, 201);
const shift = await request('POST', `/stores/${store.id}/finance/cash-shifts`, { deviceId, openingCashMinor: '5000' }, 201);
const sell = (items, payments) => request('POST', `/stores/${store.id}/sales`, { operationId: randomUUID(), deviceId, cashShiftId: shift.id, items, payments }, 201);
const sale1 = await sell([{ productId: product.id, quantity: 2 }], [{ paymentMethodId: cash, amountMinor: '20000' }]);
await sell([{ productId: product.id, quantity: 1 }], [{ paymentMethodId: cash, amountMinor: '4000' }, { paymentMethodId: card, amountMinor: '6000' }]);
await request('POST', `/stores/${store.id}/sales/${sale1.id}/return`, { operationId: randomUUID(), deviceId, cashShiftId: shift.id, reason: 'Брак упаковки', items: [{ saleItemId: sale1.items[0].id, quantity: 1 }] }, 201);
await request('POST', `/stores/${store.id}/finance/cash-shifts/${shift.id}/operations`, { operationId: randomUUID(), type: 'DEPOSIT', amountMinor: '3000', comment: 'Размен' }, 201);

const checks = [];
let journal = await request('GET', `/cash-shifts?storeId=${store.id}&from=${today}&to=${today}`);
assert.equal(journal.total, 1);
let row = journal.items[0];
assert.equal(row.number, 1);
assert.equal(row.status, 'OPEN');
assert.deepEqual([row.salesCount, row.salesMinor, row.cashMinor, row.noncashMinor, row.returnsCount, row.returnsMinor, row.revenueMinor], [2, '30000', '24000', '6000', 1, '10000', '20000']);
// Drawer: 50.00 opening + 240.00 cash sales + 30.00 deposit − 100.00 cash refund = 220.00.
assert.deepEqual([row.openingCashMinor, row.depositsMinor, row.outflowsMinor, row.expectedCashMinor, row.closingCashMinor], ['5000', '27000', '10000', '22000', null]);
assert.ok(journal.filters.devices.some(device => device.deviceId === deviceId));
checks.push('journal row of an open shift');

const report = await request('GET', `/stores/${store.id}/finance/cash-shifts/${shift.id}/report`);
await request('POST', `/stores/${store.id}/finance/cash-shifts/${shift.id}/close`, { actualCashMinor: '22000', rewardPayoutMinor: report.reward.payableMinor }, 201);
journal = await request('GET', `/cash-shifts?storeId=${store.id}&status=CLOSED`);
row = journal.items[0];
assert.equal(row.status, 'CLOSED');
assert.equal(row.closingCashMinor, String(22000 - Number(report.reward.payableMinor)));
assert.equal((await request('GET', `/cash-shifts?storeId=${store.id}&status=OPEN`)).total, 0);
assert.equal((await request('GET', `/cash-shifts?storeId=${store.id}&deviceId=nope`)).total, 0);
checks.push('closing and status/device filters');

const activity = await request('GET', `/stores/${store.id}/finance/cash-shifts/${shift.id}/activity`);
assert.equal(activity.number, 1);
assert.deepEqual(activity.documents.map(document => document.kind).sort(), ['RETURN', 'SALE', 'SALE']);
const cashIn = activity.money.filter(entry => entry.direction === 'IN' && entry.accountKind === 'CASH').reduce((sum, entry) => sum + Number(entry.amountMinor), 0);
assert.equal(cashIn, 24000 + 3000, 'cash sales and the deposit are in the money tab');
assert.ok(activity.money.some(entry => entry.direction === 'IN' && entry.accountKind === 'CARD' && entry.amountMinor === '6000'));
assert.ok(activity.money.some(entry => entry.direction === 'OUT' && entry.category === 'Возврат денежных средств клиенту' && entry.amountMinor === '10000'));
assert.equal(Number(activity.products.sold[0].quantity), 3);
assert.equal(activity.products.sold[0].profitMinor, '12000');
assert.equal(Number(activity.products.returned[0].quantity), 1);
checks.push('shift card tabs: documents, money, products');

const roles = await request('GET', '/roles');
const cashierLogin = `shift_cash_${s.toLowerCase()}`;
await request('POST', '/employees', { name: 'Кассир смен', login: cashierLogin, password: 'shift-test-password', roleId: roles.find(role => role.code === 'CASHIER').id, storeIds: [store.id], primaryStoreId: store.id }, 201);
const cashier = await signIn(cashierLogin, 'shift-test-password');
const other = await request('POST', '/store-management', { name: `Чужой ${s}`, code: `SX${s}` }, 201);
const cashierJournal = await call(cashier, 'GET', '/cash-shifts', undefined, (await call(cashier, 'GET', '/auth/me')).permissions.includes('finance.cash_view') ? 200 : 403);
if (cashierJournal) {
  assert.ok(cashierJournal.items.every(item => item.storeId === store.id), 'cashier sees only own store');
  await call(cashier, 'GET', `/cash-shifts?storeId=${other.id}`, undefined, 403);
  await call(cashier, 'GET', `/stores/${other.id}/finance/cash-shifts/${shift.id}/activity`, undefined, 403);
}
checks.push('store isolation');
await request('GET', '/cash-shifts?from=2026-02-30&to=2026-03-01', undefined, 400);
checks.push('validation');
console.log(JSON.stringify({ result: 'ok', checks }, null, 1));
