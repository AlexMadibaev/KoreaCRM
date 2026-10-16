import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSaleTotals } from '../lib/sale-calculations.ts';

test('web sale combines customer and fixed receipt discounts with exact line allocation', () => {
  const lines = [
    { productId: 'cream', quantity: 1, available: 4, priceMinor: 129000, discountMinor: '0' },
    { productId: 'serum', quantity: 1, available: 2, priceMinor: 189000, discountMinor: '0' },
  ];
  const result = calculateSaleTotals(lines, '10', { kind: 'FIXED', value: '10000' });
  assert.equal(result.total, 276200n);
  assert.equal(result.discount, 41800n);
  assert.deepEqual(result.lines.map(line => line.totalMinor), [112043n, 164157n]);
  assert.equal(result.lines.reduce((sum, line) => sum + line.discountMinor, 0n), result.discount);
  assert.throws(() => calculateSaleTotals(lines, '10', { kind: 'FIXED', value: '286201' }));
});

test('web sale accepts comma percentages and rejects quantities above stock', () => {
  const lines = [{ productId: 'cream', quantity: 1, available: 1, priceMinor: 10000, discountMinor: '0' }];
  assert.equal(calculateSaleTotals(lines, '10', { kind: 'PERCENT', value: '12,5' }).total, 7875n);
  assert.throws(() => calculateSaleTotals([{ ...lines[0], quantity: 2 }], '0', { kind: 'FIXED', value: '0' }));
});
