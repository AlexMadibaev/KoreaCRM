import assert from 'node:assert/strict';
import test from 'node:test';
import { refundPreview } from '../src/return-calculations.ts';

const method = (id, kind) => ({ id, code: id, name: id, kind, active: true });
const sale = (payments, returns = []) => ({ payments: payments.map(([id, kind, amount]) => ({ id, amountMinor: String(amount), paymentMethod: method(`${id}-m`, kind) })), returns });

test('refund preview writes off debt first and pays cash last', () => {
  const preview = refundPreview(sale([['cash', 'CASH', 50], ['card', 'CARD', 30], ['debt', 'DEBT', 20]]), 70n);
  assert.deepEqual(preview.map(part => [part.kind, part.amountMinor]), [['DEBT', 20n], ['CARD', 30n], ['CASH', 20n]]);
});

test('refund preview skips amounts already refunded', () => {
  const previous = [{ amountMinor: '30', payments: [{ paymentId: 'card', amountMinor: '30' }] }, { amountMinor: '10' }];
  const preview = refundPreview(sale([['cash', 'CASH', 50], ['card', 'CARD', 30]], previous), 40n);
  assert.deepEqual(preview.map(part => [part.kind, part.amountMinor]), [['CASH', 40n]]);
});
