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
const phone = '+998901112233';
const existing = await request(`/customers?search=${encodeURIComponent(phone)}`, 'GET', null, accessToken);
const customer = existing.items.find(item => item.phone === phone) ?? await request('/customers', 'POST', { firstName: 'Елена', lastName: 'Пак', phone }, accessToken);
const deviceId = 'WEB-SEGMENT-PREVIEW';
await request('/stores/demo-store/pos-devices', 'POST', { deviceId, appVersion: 'preview' }, accessToken);
const prior = await request(`/customers/${customer.id}/history?kind=sales`, 'GET', null, accessToken);
for (let index = prior.total; index < 3; index++) {
  await request('/stores/demo-store/sales', 'POST', { operationId: randomUUID(), deviceId, customerId: customer.id, items: [{ productId: 'demo-cream', quantity: 1, discountMinor: '0' }], payments: [{ paymentMethodId: 'demo-card', amountMinor: '129000' }] }, accessToken);
}
const segments = await request(`/customers/${customer.id}/segments`, 'GET', null, accessToken);
assert.deepEqual(segments.items.map(item => item.code), ['REGULAR', 'FREQUENT']);
console.log(JSON.stringify({ customerId: customer.id, segments: segments.items.map(item => item.code) }));
