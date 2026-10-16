import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCart, calculateCartWithDiscount, lineDiscountMinor, validatePayments } from '../src/calculations.ts';

test('cart calculations preserve integer minor units across quantity and discount', () => {
  const result = calculateCart([{ productId: 'a', quantity: 3, available: 5, priceMinor: 1999, discountMinor: '502' }, { productId: 'b', quantity: 1, available: 1, priceMinor: 101, discountMinor: '0' }]);
  assert.deepEqual(result, { subtotal: 6098n, discount: 502n, total: 5596n });
});
test('personal discount applies after manual discount and rounds down per line', () => {
  const lines = [{ productId: 'a', quantity: 2, available: 3, priceMinor: 1005, discountMinor: '10' }, { productId: 'b', quantity: 1, available: 2, priceMinor: 101, discountMinor: '0' }];
  assert.deepEqual(lineDiscountMinor(lines[0], '12.50'), { manual: 10n, personal: 250n, total: 260n });
  assert.deepEqual(calculateCart(lines, '12.50'), { subtotal: 2111n, discount: 272n, total: 1839n });
});
test('cart rejects unavailable quantity and excessive discount', () => {
  assert.throws(() => calculateCart([{ productId: 'a', quantity: 2, available: 1, priceMinor: 100, discountMinor: '0' }]));
  assert.throws(() => calculateCart([{ productId: 'a', quantity: 1, available: 1, priceMinor: 100, discountMinor: '101' }]));
});
test('fixed cart discount is distributed exactly after manual and customer discounts', () => {
  const lines = [{ productId: 'a', quantity: 1, available: 1, priceMinor: 100, discountMinor: '0' }, { productId: 'b', quantity: 1, available: 1, priceMinor: 200, discountMinor: '0' }];
  const result = calculateCartWithDiscount(lines, '10', { kind: 'FIXED', value: '101' });
  assert.equal(result.total, 169n);
  assert.equal(result.cartDiscountMinor, 101n);
  assert.deepEqual(result.lines.map(line => line.discountMinor), [44n, 87n]);
  assert.equal(result.lines.reduce((sum, line) => sum + line.totalMinor, 0n), result.total);
  assert.throws(() => calculateCartWithDiscount(lines, '10', { kind: 'FIXED', value: '271' }));
});
test('percentage cart discount rounds once and distributes its minor units', () => {
  const lines = [{ productId: 'a', quantity: 1, available: 1, priceMinor: 100, discountMinor: '0' }, { productId: 'b', quantity: 1, available: 1, priceMinor: 200, discountMinor: '0' }];
  const result = calculateCartWithDiscount(lines, '10', { kind: 'PERCENT', value: '12.50' });
  assert.equal(result.cartDiscountMinor, 33n);
  assert.deepEqual(result.lines.map(line => line.cartDiscountMinor), [11n, 22n]);
  assert.equal(result.total, 237n);
  assert.equal(calculateCartWithDiscount(lines, '10', { kind: 'PERCENT', value: '12,50' }).total, 237n);
  assert.throws(() => calculateCartWithDiscount(lines, '0', { kind: 'PERCENT', value: '101' }));
});
test('mixed payments must equal the sale total and debt requires a customer', () => {
  const parts = [{ methodId: 'card', kind: 'CARD', amountMinor: '200' }, { methodId: 'debt', kind: 'DEBT', amountMinor: '50' }];
  assert.doesNotThrow(() => validatePayments(parts, 250n, 'customer', null));
  assert.throws(() => validatePayments(parts, 251n, 'customer', null));
  assert.throws(() => validatePayments(parts, 250n, null, null));
});

test('bonus payment requires a customer with enough available balance', () => {
  const parts = [{ methodId: 'bonus', kind: 'BONUS', amountMinor: '50' }, { methodId: 'card', kind: 'CARD', amountMinor: '150' }];
  assert.doesNotThrow(() => validatePayments(parts, 200n, 'customer', null, '50'));
  assert.throws(() => validatePayments(parts, 200n, null, null, '50'));
  assert.throws(() => validatePayments(parts, 200n, 'customer', null, '49'));
});
