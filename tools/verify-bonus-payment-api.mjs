import assert from 'node:assert/strict';

const base = process.env.KOREACRM_DEMO_URL ?? 'http://127.0.0.1:3007';
const token = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) }).then(response => response.json()).then(body => body.accessToken);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function post(path, body) { const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }
const deviceId = `BONUS-TEST-${crypto.randomUUID()}`;
assert.equal((await post('/stores/demo-store/pos-devices', { deviceId, appVersion: 'test' })).status, 200);
const request = {
  operationId: crypto.randomUUID(), deviceId, customerId: 'demo-customer-1',
  items: [{ productId: 'demo-cream', quantity: 1, discountMinor: '0' }],
  payments: [{ paymentMethodId: 'demo-bonus', amountMinor: '10000' }, { paymentMethodId: 'demo-card', amountMinor: '119000' }],
};
const first = await post('/stores/demo-store/sales', request);
assert.equal(first.status, 201);
assert.equal(first.body.totalMinor, '129000');
const replay = await post('/stores/demo-store/sales', request);
assert.equal(replay.status, 200);
assert.equal(replay.body.id, first.body.id);
const ledger = await fetch(`${base}/customers/demo-customer-1/bonuses`, { headers }).then(response => response.json());
assert.equal(ledger.balanceMinor, '5000');
assert.equal(ledger.items.filter(item => item.type === 'SPEND').length, 1);
assert.equal(ledger.items.find(item => item.type === 'SPEND').deltaMinor, '-10000');
const insufficient = await post('/stores/demo-store/sales', { ...request, operationId: crypto.randomUUID(), payments: [{ paymentMethodId: 'demo-bonus', amountMinor: '6000' }, { paymentMethodId: 'demo-card', amountMinor: '123000' }] });
assert.equal(insufficient.status, 409);
const offline = await post('/stores/demo-store/sales/sync', { ...request, operationId: crypto.randomUUID(), payments: [{ paymentMethodId: 'demo-bonus', amountMinor: '1000' }, { paymentMethodId: 'demo-card', amountMinor: '128000' }] });
assert.equal(offline.status, 400);
console.log(JSON.stringify({ saleId: first.body.id, bonusBalanceMinor: ledger.balanceMinor, replaySafe: true, insufficientRejected: true, offlineRejected: true }));
