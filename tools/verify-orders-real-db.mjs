// Writes only to an explicitly selected, isolated test API/database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (process.env.KOREACRM_ISOLATED_TEST_DB !== '1')
  throw new Error(
    'Set KOREACRM_ISOLATED_TEST_DB=1. This test creates orders and money movements.',
  );
const base = process.env.KOREACRM_TEST_API_URL;
const login = process.env.KOREACRM_TEST_LOGIN;
const password = process.env.KOREACRM_TEST_PASSWORD;
if (!base || !login || !password)
  throw new Error(
    'Set KOREACRM_TEST_API_URL, KOREACRM_TEST_LOGIN, KOREACRM_TEST_PASSWORD',
  );

async function call(token, method, path, body, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${JSON.stringify(result)}`,
  );
  return result;
}
const signIn = async (login, password) =>
  (await call(null, 'POST', '/auth/login', { login, password }, 201))
    .accessToken;
const owner = await signIn(login, password);
const request = (method, path, body, expected) =>
  call(owner, method, path, body, expected);
const suffix = randomUUID().slice(0, 8);
const store = await request(
  'POST',
  '/store-management',
  { name: `Orders ${suffix}`, code: `O${suffix}` },
  201,
);
const otherStore = await request(
  'POST',
  '/store-management',
  { name: `Other ${suffix}`, code: `X${suffix}` },
  201,
);
const roles = await request('GET', '/roles');
const employeePassword = `Orders-test-${suffix}-password`;
const employee = await request(
  'POST',
  '/employees',
  {
    name: 'Orders cashier',
    login: `order-${suffix}`,
    password: employeePassword,
    roleId: roles.find((role) => role.code === 'MANAGER').id,
    allStores: false,
    storeIds: [store.id],
  },
  201,
);
const cashier = await signIn(employee.login, employeePassword);
const cashRequest = (method, path, body, expected) =>
  call(cashier, method, path, body, expected);
const prefix = `/stores/${store.id}/orders`;
await cashRequest('GET', `/stores/${otherStore.id}/orders`, undefined, 403);
const methods = await request('GET', '/sale-payment-methods');
const cash = methods.find((method) => method.code === 'CASH').id;
const card = methods.find((method) => method.code === 'CARD').id;
const bonus = methods.find((method) => method.code === 'BONUS').id;
const product = await request(
  'POST',
  '/products',
  { name: `Order cream ${suffix}`, sku: `ORDER-${suffix}`, barcodes: [] },
  201,
);
await request('PATCH', `/stores/${store.id}/products/${product.id}/settings`, {
  priceMinor: 10000,
  costBasisMinor: 4000,
  active: true,
});
await request(
  'POST',
  `/stores/${store.id}/stock/adjustments`,
  {
    productId: product.id,
    type: 'INVENTORY',
    delta: 5,
    comment: 'Isolated order test',
  },
  201,
);
const deviceId = `order-device-${suffix}`;
await cashRequest(
  'POST',
  `/stores/${store.id}/pos-devices`,
  { deviceId, appVersion: 'orders-test' },
  201,
);
const shift = await cashRequest(
  'POST',
  `/stores/${store.id}/finance/cash-shifts`,
  { deviceId, openingCashMinor: '100000' },
  201,
);
const stock = async () =>
  (await request('GET', `/stores/${store.id}/stock?search=${product.sku}`))
    .items[0];
const report = () =>
  cashRequest(
    'GET',
    `/stores/${store.id}/finance/cash-shifts/${shift.id}/report`,
  );
const draft = {
  deliveryMethod: 'PICKUP',
  items: [{ productId: product.id, quantity: 2 }],
};
const createBody = { operationId: randomUUID(), draft };
let order = await cashRequest('POST', prefix, createBody, 201);
assert.equal((await cashRequest('POST', prefix, createBody, 201)).id, order.id);
await cashRequest(
  'POST',
  prefix,
  { ...createBody, draft: { ...draft, comment: 'different' } },
  409,
);
assert.equal((await stock()).reservedQuantity, 0);
const edit = {
  version: order.version,
  draft: {
    ...draft,
    deliveryMethod: 'DELIVERY',
    deliveryAddress: 'Test street',
    contactPhone: '+992900000001',
  },
};
order = await cashRequest('PATCH', `${prefix}/${order.id}`, edit);
await cashRequest('PATCH', `${prefix}/${order.id}`, edit, 409);
const version = order.version;
order = await cashRequest(
  'POST',
  `${prefix}/${order.id}/confirm`,
  { version },
  201,
);
await cashRequest('POST', `${prefix}/${order.id}/confirm`, { version }, 201);
assert.equal((await stock()).reservedQuantity, 2);
await cashRequest(
  'PATCH',
  `${prefix}/${order.id}`,
  { ...edit, version: order.version },
  409,
);

// Two orders compete for the remaining three units. Only one two-unit reservation can succeed.
const contenders = await Promise.all(
  [1, 2].map(() =>
    cashRequest('POST', prefix, { operationId: randomUUID(), draft }, 201),
  ),
);
const confirmations = await Promise.all(
  contenders.map(async (contender) => {
    const response = await fetch(`${base}${prefix}/${contender.id}/confirm`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cashier}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ version: contender.version }),
    });
    return { contender, status: response.status };
  }),
);
assert.deepEqual(
  confirmations.map((result) => result.status).sort(),
  [201, 409],
);
assert.equal((await stock()).reservedQuantity, 4);
for (const contender of contenders)
  await cashRequest(
    'POST',
    `${prefix}/${contender.id}/cancel`,
    { operationId: randomUUID(), reason: 'No longer needed' },
    201,
  );
assert.equal((await stock()).reservedQuantity, 2);

const partialPayment = {
  operationId: randomUUID(),
  paymentMethodId: card,
  amountMinor: '8000',
};
order = await cashRequest(
  'POST',
  `${prefix}/${order.id}/payments`,
  partialPayment,
  201,
);
assert.equal(order.paymentStatus, 'PARTIALLY_PAID');
assert.equal(
  (
    await cashRequest(
      'POST',
      `${prefix}/${order.id}/payments`,
      partialPayment,
      201,
    )
  ).paidMinor,
  '8000',
);
await cashRequest(
  'POST',
  `${prefix}/${order.id}/payments`,
  { ...partialPayment, operationId: randomUUID(), amountMinor: '13000' },
  400,
);
await cashRequest(
  'POST',
  `${prefix}/${order.id}/payments`,
  { operationId: randomUUID(), paymentMethodId: bonus, amountMinor: '1000' },
  400,
);
await cashRequest(
  'POST',
  `${prefix}/${order.id}/complete`,
  { operationId: randomUUID(), cashShiftId: shift.id },
  409,
);
order = await cashRequest(
  'POST',
  `${prefix}/${order.id}/payments`,
  {
    operationId: randomUUID(),
    paymentMethodId: cash,
    cashShiftId: shift.id,
    amountMinor: '12000',
  },
  201,
);
assert.equal(order.paymentStatus, 'PAID');
const cashBefore = (await report()).cash.expectedMinor;
assert.equal(cashBefore, '112000');
await request('PATCH', `/stores/${store.id}/products/${product.id}/settings`, {
  priceMinor: 11000,
});
order = await cashRequest('POST', `${prefix}/${order.id}/ready`, {}, 201);
const completion = { operationId: randomUUID(), cashShiftId: shift.id };
order = await cashRequest(
  'POST',
  `${prefix}/${order.id}/complete`,
  completion,
  201,
);
assert.equal(order.status, 'COMPLETED');
assert.equal(
  (await cashRequest('POST', `${prefix}/${order.id}/complete`, completion, 201))
    .sale.id,
  order.sale.id,
);
assert.equal((await report()).cash.expectedMinor, cashBefore);
assert.equal((await stock()).quantity, 3);
assert.equal((await stock()).reservedQuantity, 0);
const reward = await cashRequest('GET', '/employees/me/rewards');
assert.equal(reward.balanceMinor, '600');
const sale = await cashRequest(
  'GET',
  `/stores/${store.id}/sales/${order.sale.id}`,
);
assert.equal(sale.totalMinor, '20000'); // Frozen order price survives a catalog price change.
await cashRequest(
  'POST',
  `/stores/${store.id}/sales/${sale.id}/return`,
  {
    operationId: randomUUID(),
    deviceId,
    cashShiftId: shift.id,
    reason: 'Order return test',
    items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
  },
  201,
);
assert.equal(
  (await cashRequest('GET', `${prefix}/${order.id}`)).sale.returns.length,
  1,
);
assert.equal(
  (await cashRequest('GET', '/employees/me/rewards')).balanceMinor,
  '300',
);

// Cancelling a prepaid order refunds cash once and releases its reservation.
let cancelled = await cashRequest(
  'POST',
  prefix,
  {
    operationId: randomUUID(),
    draft: { items: [{ productId: product.id, quantity: 1 }] },
  },
  201,
);
cancelled = await cashRequest(
  'POST',
  `${prefix}/${cancelled.id}/confirm`,
  { version: cancelled.version },
  201,
);
cancelled = await cashRequest(
  'POST',
  `${prefix}/${cancelled.id}/payments`,
  {
    operationId: randomUUID(),
    paymentMethodId: cash,
    amountMinor: '4000',
    cashShiftId: shift.id,
  },
  201,
);
const beforeCancel = (await report()).cash.expectedMinor;
const emptyDevice = `empty-${suffix}`;
await cashRequest('POST', `/stores/${store.id}/pos-devices`, { deviceId: emptyDevice, appVersion: 'orders-test' }, 201);
const emptyShift = await cashRequest('POST', `/stores/${store.id}/finance/cash-shifts`, { deviceId: emptyDevice, openingCashMinor: '0' }, 201);
await cashRequest('POST', `${prefix}/${cancelled.id}/cancel`, { operationId: randomUUID(), cashShiftId: emptyShift.id, reason: 'Insufficient refund cash' }, 409);
assert.equal((await cashRequest('GET', `${prefix}/${cancelled.id}`)).status, 'CONFIRMED');
assert.equal((await cashRequest('GET', `${prefix}/${cancelled.id}`)).paidMinor, '4000');
assert.equal((await stock()).reservedQuantity, 1);
const cancellation = {
  operationId: randomUUID(),
  cashShiftId: shift.id,
  reason: 'Customer changed mind',
};
cancelled = await cashRequest(
  'POST',
  `${prefix}/${cancelled.id}/cancel`,
  cancellation,
  201,
);
await cashRequest(
  'POST',
  `${prefix}/${cancelled.id}/cancel`,
  cancellation,
  201,
);
assert.equal(cancelled.status, 'CANCELLED');
assert.equal(
  (await report()).cash.expectedMinor,
  String(BigInt(beforeCancel) - 4000n),
);
assert.equal((await stock()).reservedQuantity, 0);
assert.equal(
  cancelled.payments.reduce(
    (total, payment) => total + BigInt(payment.amountMinor),
    0n,
  ),
  0n,
);
await cashRequest(
  'POST',
  `${prefix}/${cancelled.id}/cancel`,
  { ...cancellation, reason: 'different reason' },
  409,
);
const day = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
const finance = await cashRequest(
  'GET',
  `/reports/finance-operations?from=${day}&to=${day}&storeId=${store.id}`,
);
assert.equal(finance.totals.incomeMinor, '24000');
assert.equal(finance.totals.outcomeMinor, '14000');
const viewerRole = await request('POST', '/roles', { code: `ORDER_VIEW_${suffix.toUpperCase()}`, name: 'Order viewer', permissions: ['orders.view', 'stores.view'] }, 201);
const viewer = await request('POST', '/employees', { name: 'Order viewer', login: `viewer-${suffix}`, password: employeePassword, roleId: viewerRole.id, allStores: false, storeIds: [store.id] }, 201);
const viewerToken = await signIn(viewer.login, employeePassword);
await call(viewerToken, 'GET', prefix);
await call(viewerToken, 'POST', prefix, { operationId: randomUUID(), draft }, 403);
await call(viewerToken, 'POST', `${prefix}/${order.id}/payments`, { operationId: randomUUID(), paymentMethodId: card, amountMinor: '1' }, 403);
console.log(
  JSON.stringify({
    result: 'ok',
    checks: [
      'draft replay and editing',
      'version conflict',
      'delivery fields',
      'concurrent reservations',
      'partial payments and replay',
      'overpayment rejection',
      'frozen price',
      'completion without duplicate cash',
      'sale and employee reward',
      'receipt return',
      'cancellation refund and replay',
      'store scope',
      'finance journal without double counting',
    ],
    storeId: store.id,
  }),
);
