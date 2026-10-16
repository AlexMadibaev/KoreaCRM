import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queuedSaleDetails } from './queued-sale-details.ts';

test('queued sale details show mixed payment amount and line quantities', () => {
  const details = queuedSaleDetails(JSON.stringify({ cashShiftId: 'shift-1', items: [{ quantity: 2 }, { quantity: 1 }], payments: [{ paymentMethodId: 'cash', amountMinor: '12000' }, { paymentMethodId: 'card', amountMinor: '30000' }] }));
  assert.deepEqual(details, { positions: 2, quantity: 3, totalMinor: 42000n, payments: [{ paymentMethodId: 'cash', amountMinor: '12000' }, { paymentMethodId: 'card', amountMinor: '30000' }], hasCashShift: true });
  assert.equal(queuedSaleDetails('{broken'), null);
});
