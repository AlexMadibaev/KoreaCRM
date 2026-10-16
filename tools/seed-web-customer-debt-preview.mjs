import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = 'http://127.0.0.1:3005';
async function request(path, method, body, token) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw Error(`${path}: ${JSON.stringify(value)}`);
  return value;
}
const { accessToken } = await request('/auth/login', 'POST', { login: 'demo', password: 'demo1234' });
const deviceId = 'WEB-CUSTOMER-DEBT-PREVIEW';
await request('/stores/demo-store/pos-devices', 'POST', { deviceId, appVersion: 'preview' }, accessToken);
const sale = await request('/stores/demo-store/sales', 'POST', { operationId: randomUUID(), deviceId, customerId: 'demo-customer-2', items: [{ productId: 'demo-cleanser', quantity: 2, discountMinor: '0' }], payments: [{ paymentMethodId: 'demo-debt', amountMinor: '190000' }] }, accessToken);
await request('/stores/demo-store/customers/demo-customer-2/payments', 'POST', { operationId: randomUUID(), paymentMethodId: 'demo-card', amountMinor: '50000' }, accessToken);
const history = await request('/customers/demo-customer-2/history?kind=debts', 'GET', null, accessToken);
const customer = await request('/customers/demo-customer-2', 'GET', null, accessToken);
assert.equal(history.total, 2);
assert.equal(customer.debtBalanceMinor, '140000');
await request('/customers/demo-customer-2', 'PATCH', { discountPercent: '10' }, accessToken);
console.log(JSON.stringify({ sale: sale.number, debtEntries: history.total, balanceMinor: customer.debtBalanceMinor }));
