import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { allocateRefund, type RefundPayment } from '../src/sales/return-refunds';

const d = (value: number) => new Prisma.Decimal(value);
const payment = (id: string, kind: RefundPayment['paymentMethod']['kind'], amount: number): RefundPayment => ({ id, paymentMethodId: `${id}-method`, amountMinor: d(amount), paymentMethod: { kind } });
const plain = (parts: ReturnType<typeof allocateRefund>) => parts.map(part => [part.paymentId, part.kind, part.amount.toString()]);

test('refund writes off debt, then card, and pays cash last', () => {
  const payments = [payment('cash', 'CASH', 50), payment('card', 'CARD', 30), payment('debt', 'DEBT', 20)];
  assert.deepEqual(plain(allocateRefund(payments, [], d(70), d(20))), [['debt', 'DEBT', '20'], ['card', 'CARD', '30'], ['cash', 'CASH', '20']]);
});

test('debt already repaid by the customer is refunded in cash', () => {
  const payments = [payment('debt', 'DEBT', 100)];
  assert.deepEqual(plain(allocateRefund(payments, [], d(100), d(30))), [['debt', 'DEBT', '30'], [null, 'CASH', '70']]);
});

test('later returns skip amounts already refunded on each payment', () => {
  const payments = [payment('cash', 'CASH', 60), payment('card', 'CARD', 40)];
  const previous = [{ amountMinor: d(40), payments: [{ paymentId: 'card', amountMinor: d(40) }] }];
  assert.deepEqual(plain(allocateRefund(payments, previous, d(60), d(0))), [['cash', 'CASH', '60']]);
});

test('returns recorded before itemized refunds count against cash', () => {
  const payments = [payment('cash', 'CASH', 100)];
  assert.deepEqual(plain(allocateRefund(payments, [{ amountMinor: d(70) }], d(30), d(0))), [['cash', 'CASH', '30']]);
});
