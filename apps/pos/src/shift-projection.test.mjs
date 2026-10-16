import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectShiftCash } from './shift-projection.ts';

test('cash projection includes only unsent cash payments for the current shift', () => {
  const sale = (shiftId, status, cash, card) => ({ status, payloadJson: JSON.stringify({ cashShiftId: shiftId, payments: [{ paymentMethodId: 'cash', amountMinor: cash }, { paymentMethodId: 'card', amountMinor: card }] }) });
  const projected = projectShiftCash('50000', 'shift-a', ['cash'], [sale('shift-a', 'PENDING', '12000', '30000'), sale('shift-a', 'ERROR', '7000', '0'), sale('shift-a', 'SYNCED', '8000', '0'), sale('shift-b', 'PENDING', '9000', '0')]);
  assert.deepEqual(projected, { expectedCashMinor: 69000n, queuedCashMinor: 19000n });
});
