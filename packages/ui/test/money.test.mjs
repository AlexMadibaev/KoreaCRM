import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCurrencyMinor, formatMoneyInput, formatSignedMoneyInput, parseMoneyInput, parseSignedMoneyInput } from '../src/money.ts';

test('money input converts user amounts to exact minor units', () => {
  assert.equal(parseMoneyInput('150'), '15000');
  assert.equal(parseMoneyInput('150,5'), '15050');
  assert.equal(parseMoneyInput('1 234,56'), '123456');
  assert.equal(parseMoneyInput('0.01'), '1');
  assert.equal(formatMoneyInput('15050'), '150,50');
});

test('signed cash adjustments keep their sign and fractional amount', () => {
  assert.equal(parseSignedMoneyInput('-12,50'), '-1250');
  assert.equal(formatSignedMoneyInput('-1250'), '-12,50');
  assert.equal(parseSignedMoneyInput('-0'), null);
  assert.equal(parseSignedMoneyInput('-1,234'), null);
});

test('currency labels preserve cents and show unavailable data honestly', () => {
  assert.equal(formatCurrencyMinor('1250'), '12,50 сум');
  assert.equal(formatCurrencyMinor('-225'), '−2,25 сум');
  assert.equal(formatCurrencyMinor(null), '—');
});

test('money input rejects fractions beyond two digits and amounts above the database range', () => {
  assert.equal(parseMoneyInput('1,234'), null);
  assert.equal(parseMoneyInput('-1'), null);
  assert.equal(parseMoneyInput('10000000000000000'), null);
  assert.equal(parseMoneyInput(''), null);
});
