import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLoyaltySettings, loyaltyPercent } from '../src/loyalty.ts';
import { refundInstruction } from '../src/return-calculations.ts';

const product = { productId: 'p1', brandId: null, categoryId: null };
const friday = { ...defaultLoyaltySettings, promotions: [{ id: 'fri', targetType: 'PRODUCT', targetId: 'p1', percent: '8', daysOfWeek: [5], startDate: null, endDate: null, active: true }] };

test('the till applies the larger of the customer discount and a promotion, never both', () => {
  const fridayNoon = new Date('2026-11-27T07:00:00Z');
  assert.equal(loyaltyPercent(friday, product, '10', fridayNoon), '10');
  assert.equal(loyaltyPercent(friday, product, '7', fridayNoon), '8');
  assert.equal(loyaltyPercent(friday, product, null, fridayNoon), '8');
  assert.equal(loyaltyPercent(friday, product, '7', new Date('2026-11-28T07:00:00Z')), '7');
});

test('a gift card refund goes back to the card', () => {
  assert.equal(refundInstruction('GIFT_CARD'), 'вернётся на гифт-карту');
});
