// Integration check for /reports against a real API and a SEPARATE test PostgreSQL database.
// It creates two stores, purchases, cash/card/mixed sales, a discount, a customer sale, a partial return and an expense,
// then compares every report with values calculated by hand. Never run it against the production database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (process.env.KOREACRM_ISOLATED_TEST_DB !== '1') throw new Error('Set KOREACRM_ISOLATED_TEST_DB=1: this script writes test data');
const baseUrl = process.env.KOREACRM_TEST_API_URL ?? 'http://127.0.0.1:3006';
const login = process.env.KOREACRM_TEST_LOGIN;
const password = process.env.KOREACRM_TEST_PASSWORD;
if (!login || !password) throw new Error('Set KOREACRM_TEST_LOGIN and KOREACRM_TEST_PASSWORD');

async function call(token, method, path, body, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert.equal(response.status, expected, `${method} ${path}: ${text}`);
  return data;
}
const signIn = async (user, secret) => (await call(null, 'POST', '/auth/login', { login: user, password: secret }, 201)).accessToken;
const owner = await signIn(login, password);
const request = (method, path, body, expected) => call(owner, method, path, body, expected);

const s = randomUUID().slice(0, 6).toUpperCase();
const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10); // Asia/Dushanbe calendar day
const storeA = await request('POST', '/store-management', { name: `Отчёты A ${s}`, code: `RA${s}` }, 201);
const storeB = await request('POST', '/store-management', { name: `Отчёты B ${s}`, code: `RB${s}` }, 201);
const methods = await request('GET', '/sale-payment-methods');
const cash = methods.find(method => method.code === 'CASH').id;
const card = methods.find(method => method.code === 'CARD').id;

const parent = await request('POST', '/categories', { name: `Уход ${s}` }, 201);
const child = await request('POST', '/categories', { name: `Кремы ${s}`, parentId: parent.id }, 201);
const productA = await request('POST', '/products', { name: `Крем ${s}`, sku: `RA-${s}`, categoryId: child.id, barcodes: [] }, 201);
const productB = await request('POST', '/products', { name: `Тоник ${s}`, sku: `RB-${s}`, categoryId: parent.id, barcodes: [] }, 201);
const productC = await request('POST', '/products', { name: `Набор ${s}`, sku: `RC-${s}`, barcodes: [] }, 201);
const price = async (store, product, priceMinor) => request('PATCH', `/stores/${store.id}/products/${product.id}/settings`, { priceMinor, minStock: 5, active: true });
await price(storeA, productA, 12000); await price(storeA, productB, 4550); await price(storeA, productC, 30000);
await price(storeB, productA, 13000); // individual price in the second store

const supplier = await request('POST', '/suppliers', { name: `Поставщик ${s}`, phone: '+992900000000' }, 201);
async function receive(store, lines) {
  const purchase = await request('POST', `/stores/${store.id}/purchases`, { supplierId: supplier.id, number: `P-${store.code}`, items: lines.map(([product, quantityOrdered, purchasePriceMinor]) => ({ productId: product.id, quantityOrdered, purchasePriceMinor: String(purchasePriceMinor) })) }, 201);
  await request('POST', `/stores/${store.id}/purchases/${purchase.id}/submit`, undefined, 201);
  await request('POST', `/stores/${store.id}/purchases/${purchase.id}/receivings`, { operationId: randomUUID(), items: purchase.items.map((item, index) => ({ purchaseItemId: item.id, quantity: lines[index][1], batchNumber: `B${index}-${s}` })) }, 201);
}
await receive(storeA, [[productA, 10, 7000], [productB, 20, 2000], [productC, 5, 18000]]);
await receive(storeB, [[productA, 5, 7000]]);

async function till(store) {
  const deviceId = `rep-${store.code}`;
  await request('POST', `/stores/${store.id}/pos-devices`, { deviceId, appVersion: 'reports-test' }, 201);
  const shift = await request('POST', `/stores/${store.id}/finance/cash-shifts`, { deviceId, openingCashMinor: '0' }, 201);
  return { deviceId, shiftId: shift.id };
}
const tillA = await till(storeA);
const tillB = await till(storeB);
const customer = await request('POST', '/customers', { firstName: 'Отчёт', lastName: s, phone: `+99290${String(Date.now()).slice(-7)}` }, 201);
const sell = (store, register, items, payments, extra = {}) => request('POST', `/stores/${store.id}/sales`, { operationId: randomUUID(), deviceId: register.deviceId, cashShiftId: register.shiftId, items, payments, ...extra }, 201);

const sale1 = await sell(storeA, tillA, [{ productId: productA.id, quantity: 2 }], [{ paymentMethodId: cash, amountMinor: '24000' }]);
await sell(storeA, tillA, [{ productId: productB.id, quantity: 3, discountMinor: '650' }], [{ paymentMethodId: card, amountMinor: '13000' }]);
await sell(storeA, tillA, [{ productId: productC.id, quantity: 1 }], [{ paymentMethodId: cash, amountMinor: '10000' }, { paymentMethodId: card, amountMinor: '20000' }]);
await sell(storeA, tillA, [{ productId: productA.id, quantity: 1 }], [{ paymentMethodId: cash, amountMinor: '12000' }], { customerId: customer.id });
await sell(storeB, tillB, [{ productId: productA.id, quantity: 1 }], [{ paymentMethodId: card, amountMinor: '13000' }]);
await request('POST', `/stores/${storeA.id}/sales/${sale1.id}/return`, { operationId: randomUUID(), deviceId: tillA.deviceId, cashShiftId: tillA.shiftId, reason: 'Покупатель передумал', items: [{ saleItemId: sale1.items[0].id, quantity: 1 }] }, 201);
const expenseCategory = await request('POST', '/expense-categories', { name: `Аренда ${s}` }, 201);
await request('POST', `/stores/${storeA.id}/finance/expenses`, { operationId: randomUUID(), categoryId: expenseCategory.id, amountMinor: '5000', paymentMethod: 'CASH', cashShiftId: tillA.shiftId, date: today, description: 'Тест отчётов' }, 201);

const report = (key, params = {}, token = owner, expected = 200) => call(token, 'GET', `/reports/${key}?${new URLSearchParams({ from: today, to: today, ...params })}`, undefined, expected);
const onlyA = { storeId: storeA.id };
const row = (data, key, value) => { const found = data.rows.find(item => item[key] === value); assert.ok(found, `${data.key}: no row ${key}=${value} in ${JSON.stringify(data.rows)}`); return found; };
const checks = [];

const catalog = await call(owner, 'GET', '/reports');
assert.equal(catalog.length, 14);
assert.ok(catalog.every(item => item.available));
checks.push('catalog: 14 reports');

let data = await report('sales-by-day', onlyA);
assert.equal(data.rows.length, 1);
assert.deepEqual({ ...data.rows[0] }, { day: today, checks: 4, salesMinor: '79000', discountsMinor: '650', returnsMinor: '12000', netMinor: '67000', profitMinor: '29000', averageCheckMinor: '19750' });
assert.equal(data.totals.netMinor, '67000');
checks.push('sales by day');

data = await report('sales-by-product', onlyA);
assert.deepEqual([row(data, 'sku', `RA-${s}`)].map(r => [r.soldQuantity, r.returnedQuantity, r.netQuantity, r.revenueMinor, r.costMinor, r.profitMinor, r.marginPercent])[0], [3, 1, 2, '24000', '14000', '10000', '41.67']);
assert.equal(row(data, 'sku', `RB-${s}`).revenueMinor, '13000');
assert.equal(row(data, 'sku', `RC-${s}`).category, 'Без категории');
assert.equal(data.rows[0].sku, `RC-${s}`, 'default sort is revenue desc');
assert.equal(data.totals.revenueMinor, '67000');
const searched = await report('sales-by-product', { ...onlyA, q: `RB-${s}` });
assert.equal(searched.total, 1);
checks.push('sales by product, search, sort');

data = await report('sales-by-category', { ...onlyA, categoryId: parent.id });
assert.equal(data.rows.length, 2, 'parent category filter includes subcategory');
assert.equal(row(data, 'category', `Кремы ${s}`).revenueMinor, '24000');
assert.equal(row(data, 'category', `Уход ${s}`).sharePercent, '35.14');
checks.push('sales by category with subcategories');

data = await report('sales-by-store', { scope: 'all' });
assert.equal(row(data, 'store', storeA.name).netMinor, '67000');
assert.equal(row(data, 'store', storeB.name).netMinor, '13000');
assert.equal(row(data, 'store', storeB.name).profitMinor, '6000');
checks.push('sales by store (two stores, individual price)');

data = await report('sales-by-employee', onlyA);
assert.equal(data.rows.length, 1);
assert.equal(data.rows[0].netMinor, '67000');
checks.push('sales by employee');

data = await report('gross-profit', onlyA);
assert.deepEqual({ ...data.rows[0] }, { day: today, netMinor: '67000', costMinor: '38000', profitMinor: '29000', marginPercent: '43.28', expensesMinor: '5000', resultMinor: '24000' });
checks.push('gross profit and operating result');

data = await report('cost', onlyA);
assert.equal(row(data, 'sku', `RA-${s}`).unitCostMinor, '7000');
assert.equal(data.totals.costMinor, '38000');
checks.push('cost of goods sold');

data = await report('stock', onlyA);
assert.deepEqual([row(data, 'sku', `RA-${s}`)].map(r => [r.quantity, r.available, r.costValueMinor, r.retailValueMinor, r.status])[0], [8, 8, '56000', '96000', 'В наличии']);
assert.equal(row(data, 'sku', `RC-${s}`).status, 'Мало');
const low = await report('stock', { ...onlyA, lowOnly: '1' });
assert.deepEqual(low.rows.map(r => r.sku), [`RC-${s}`]);
checks.push('stock valuation and low stock filter');

data = await report('stock-movements', onlyA);
assert.deepEqual([row(data, 'sku', `RA-${s}`)].map(r => [r.opening, r.purchases, r.sales, r.returns, r.closing])[0], [0, 10, -3, 1, 8]);
checks.push('stock movements opening/closing');

data = await report('finance-operations', onlyA);
const cashIn = data.rows.filter(r => r.kind === 'Выручка' && r.method === 'Наличные').reduce((sum, r) => sum + Number(r.incomeMinor), 0);
assert.equal(cashIn, 46000);
assert.equal(data.totals.incomeMinor, '79000');
assert.equal(data.totals.outcomeMinor, '17000');
checks.push('finance journal');

data = await report('returns', onlyA);
assert.equal(data.total, 1);
assert.equal(data.rows[0].amountMinor, '12000');
assert.match(data.rows[0].details, /× 1/);
checks.push('returns');

data = await report('debts', { storeId: storeA.id, q: `Поставщик ${s}` });
assert.equal(row(data, 'kind', 'Поставщик').debtMinor, '200000');
checks.push('supplier debts');

data = await report('discounts', onlyA);
assert.deepEqual([data.rows[0]].map(r => [r.checks, r.discountedChecks, r.discountsMinor, r.grossMinor, r.averageDiscountedCheckMinor])[0], [4, 1, '650', '79650', '13000']);
checks.push('discount effectiveness');

data = await report('customer-activity', onlyA);
assert.equal(row(data, 'phone', customer.phone).netMinor, '12000');
checks.push('customer activity');

const exported = await report('sales-by-product', { ...onlyA, export: '1', limit: '1' });
assert.equal(exported.rows.length, 3, 'export ignores page size');
const paged = await report('sales-by-product', { ...onlyA, limit: '1', page: '2' });
assert.equal(paged.rows.length, 1); assert.equal(paged.total, 3);
checks.push('pagination and export');

// RBAC is enforced by the API, not only by the menu.
const roles = await request('GET', '/roles');
const roleId = code => roles.find(role => role.code === code).id;
const cashierLogin = `rep_cash_${s.toLowerCase()}`; const adminLogin = `rep_admin_${s.toLowerCase()}`; const secret = 'reports-test-password';
await request('POST', '/employees', { name: 'Кассир отчётов', login: cashierLogin, password: secret, roleId: roleId('CASHIER'), storeIds: [storeA.id], primaryStoreId: storeA.id }, 201);
await request('POST', '/employees', { name: 'Администратор отчётов', login: adminLogin, password: secret, roleId: roleId('ADMIN'), storeIds: [storeB.id], primaryStoreId: storeB.id }, 201);
const cashier = await signIn(cashierLogin, secret);
const admin = await signIn(adminLogin, secret);
await call(cashier, 'GET', '/reports', undefined, 403);
await report('sales-by-day', onlyA, cashier, 403);
const adminProducts = await report('sales-by-product', { storeId: storeB.id }, admin);
assert.ok(!adminProducts.columns.some(column => column.key === 'profitMinor'), 'profit hidden without finance.view');
assert.ok(!('profitMinor' in adminProducts.rows[0]));
await report('gross-profit', { storeId: storeB.id }, admin, 403);
await report('sales-by-day', onlyA, admin, 403); // store outside the employee scope
const adminStores = await report('sales-by-store', {}, admin);
assert.deepEqual(adminStores.rows.map(r => r.store), [storeB.name]);
checks.push('RBAC: no reports for cashier, hidden profit, store isolation');

await report('sales-by-day', { storeId: storeA.id, from: today, to: '2000-01-01' }, owner, 400);
await call(owner, 'GET', '/reports/unknown', undefined, 404);
checks.push('validation');

console.log(JSON.stringify({ result: 'ok', checks }, null, 1));
