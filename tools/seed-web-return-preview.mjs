import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = 'http://127.0.0.1:3005';
const send = async (path, body, token) => {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw Error(`${path}: ${JSON.stringify(value)}`);
  return value;
};
const login = await send('/auth/login', { login: 'demo', password: 'demo1234' });
const token = login.accessToken;
const deviceId = 'WEB-RETURN-PREVIEW';
await send('/stores/demo-store/pos-devices', { deviceId, appVersion: 'preview' }, token);
const shift = await send('/stores/demo-store/finance/cash-shifts', { deviceId, openingCashMinor: '0' }, token);
const sale = await send('/stores/demo-store/sales', { operationId: randomUUID(), deviceId, cashShiftId: shift.id, customerId: 'demo-customer-1', items: [{ productId: 'demo-cream', quantity: 3, discountMinor: '0' }, { productId: 'demo-serum', quantity: 1, discountMinor: '0' }], payments: [{ paymentMethodId: 'demo-cash', amountMinor: '576000' }] }, token);
const first = await send(`/stores/demo-store/sales/${sale.id}/return`, { operationId: randomUUID(), deviceId, cashShiftId: shift.id, reason: 'Покупателю не подошёл крем', items: [{ saleItemId: sale.items[0].id, quantity: 1 }] }, token);
const second = await send(`/stores/demo-store/sales/${sale.id}/return`, { operationId: randomUUID(), deviceId, cashShiftId: shift.id, reason: 'Возврат сыворотки', items: [{ saleItemId: sale.items[1].id, quantity: 1 }] }, token);
const history = await fetch(base + `/stores/demo-store/sales/returns?limit=20&search=${encodeURIComponent(sale.number)}`, { headers: { Authorization: `Bearer ${token}` } }).then(response => response.json());
assert.equal(history.total, 2);
assert.equal(second.returns.length, 2);
assert.equal(first.returns[0].amountMinor, '129000');
console.log(JSON.stringify({ sale: sale.number, returns: history.total, amounts: history.items.map(item => item.amountMinor) }));
