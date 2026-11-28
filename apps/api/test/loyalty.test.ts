import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automaticPercent, defaultLoyaltySettings, earnedDiscountPercent, loyaltySettingsSchema } from '../src/loyalty/loyalty.rules';

const productId = '11111111-1111-4111-8111-111111111111';
const brandId = '22222222-2222-4222-8222-222222222222';
const categoryId = '33333333-3333-4333-8333-333333333333';
const product = { productId, brandId, categoryId };

test('one completed receipt earns a permanent discount for subsequent purchases', () => {
  const rules = defaultLoyaltySettings;
  assert.equal(earnedDiscountPercent(rules, '0', 49999n), '0');
  assert.equal(earnedDiscountPercent(rules, '0', 50000n), '7');
  assert.equal(earnedDiscountPercent(rules, '0', 79999n), '7');
  assert.equal(earnedDiscountPercent(rules, '0', 80000n), '10');
  assert.equal(earnedDiscountPercent(rules, '7', 80000n), '10');
  assert.equal(earnedDiscountPercent(rules, '10', 10000n), '10');
  assert.equal(earnedDiscountPercent(rules, '12', 80000n), '12');
  assert.equal(earnedDiscountPercent({ ...rules, mode: 'BONUS' }, '0', 80000n), '0');
  assert.equal(automaticPercent(rules, product, null), '0');
  assert.equal(automaticPercent(rules, product, '0'), '0');
  assert.equal(automaticPercent(rules, product, '7'), '7');
  assert.equal(automaticPercent(rules, product, '10'), '10');
});

test('product, brand and category exclusions prevent automatic discounts', () => {
  for (const excluded of [{ excludedProductIds: [productId] }, { excludedBrandIds: [brandId] }, { excludedCategoryIds: [categoryId] }]) {
    const rules = { ...defaultLoyaltySettings, ...excluded };
    assert.equal(automaticPercent(rules, product, '15'), '0');
  }
});

test('promotion rules win over the tier and follow local Tajikistan date', () => {
  const rules = loyaltySettingsSchema.parse({ ...defaultLoyaltySettings, promotions: [
    { id: '44444444-4444-4444-8444-444444444444', targetType: 'BRAND', targetId: brandId, percent: '14', daysOfWeek: [1], startDate: '2026-10-26', endDate: '2026-10-26', active: true },
    { id: '55555555-5555-4555-8555-555555555555', targetType: 'CATEGORY', targetId: categoryId, percent: '20', daysOfWeek: [1], startDate: '2026-10-26', endDate: '2026-10-26', active: true },
  ] });
  assert.equal(automaticPercent(rules, product, null, new Date('2026-10-25T19:30:00Z')), '20');
  assert.equal(automaticPercent(rules, product, '0', new Date('2026-10-26T19:30:00Z')), '0');
  assert.equal(automaticPercent({ ...rules, mode: 'BONUS' }, product, '15'), '0');
});

test('a promotion and the customer discount never add up: the larger one applies', () => {
  const friday = loyaltySettingsSchema.parse({ ...defaultLoyaltySettings, promotions: [
    { id: '66666666-6666-4666-8666-666666666666', targetType: 'ALL', targetId: '00000000-0000-4000-8000-000000000000', percent: '8', daysOfWeek: [5], startDate: null, endDate: null, active: true },
  ] });
  const fridayNoon = new Date('2026-11-27T07:00:00Z');
  assert.equal(automaticPercent(friday, product, '10', fridayNoon), '10');
  assert.equal(automaticPercent(friday, product, '7', fridayNoon), '8');
  assert.equal(automaticPercent(friday, product, null, fridayNoon), '8');
  assert.equal(automaticPercent(friday, product, '7', new Date('2026-11-28T07:00:00Z')), '7');
});

test('bonus mode requires an earn rate and thresholds must increase', () => {
  assert.equal(loyaltySettingsSchema.safeParse({ ...defaultLoyaltySettings, mode: 'BONUS' }).success, false);
  assert.equal(loyaltySettingsSchema.safeParse({ ...defaultLoyaltySettings, tiers: [{ minimumMinor: '80000', percent: '7' }, { minimumMinor: '50000', percent: '10' }] }).success, false);
});
