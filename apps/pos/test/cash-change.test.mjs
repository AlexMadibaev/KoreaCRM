import assert from 'node:assert/strict';
import test from 'node:test';
import { changeDue, quickCashAmounts } from '../src/cash-change.ts';

test('quick cash amounts round the total up to common banknotes', () => {
  assert.deepEqual(quickCashAmounts(434000n), [435000n, 440000n, 450000n]);
  assert.deepEqual(quickCashAmounts(100000n), []);
  assert.deepEqual(quickCashAmounts(12345n), [13000n, 15000n, 20000n]);
  assert.deepEqual(quickCashAmounts(0n), []);
});

test('change is shown only when the customer gave enough cash', () => {
  assert.equal(changeDue('500000', 434000n), 66000n);
  assert.equal(changeDue('434000', 434000n), 0n);
  assert.equal(changeDue('400000', 434000n), null);
  assert.equal(changeDue('', 434000n), null);
});
