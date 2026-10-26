import assert from 'node:assert/strict';
import { test } from 'node:test';
import { automaticPercent, defaultLoyaltySettings, loyaltySettingsSchema } from '../src/loyalty/loyalty.rules';

const productId = '11111111-1111-4111-8111-111111111111';
const brandId = '22222222-2222-4222-8222-222222222222';
const categoryId = '33333333-3333-4333-8333-333333333333';
const product = { productId, brandId, categoryId };

test('current receipt thresholds apply at 500 and 800 somoni only for a selected customer', () => {
  const rules = defaultLoyaltySettings;
  assert.equal(automaticPercent(rules, product, '0', 49999n), '0');
  assert.equal(automaticPercent(rules, product, '0', 50000n), '7');
  assert.equal(automaticPercent(rules, product, '0', 79999n), '7');
  assert.equal(automaticPercent(rules, product, '0', 80000n), '10');
  assert.equal(automaticPercent(rules, product, null, 80000n), '0');
  assert.equal(automaticPercent(rules, product, '12', 80000n), '12');
});

test('product, brand and category exclusions prevent automatic discounts', () => {
  for (const excluded of [{ excludedProductIds: [productId] }, { excludedBrandIds: [brandId] }, { excludedCategoryIds: [categoryId] }]) {
    const rules = { ...defaultLoyaltySettings, ...excluded };
    assert.equal(automaticPercent(rules, product, '15', 90000n), '0');
  }
});

test('promotion rules win over the tier and follow local Tajikistan date', () => {
  const rules = loyaltySettingsSchema.parse({ ...defaultLoyaltySettings, promotions: [
    { id: '44444444-4444-4444-8444-444444444444', targetType: 'BRAND', targetId: brandId, percent: '14', daysOfWeek: [1], startDate: '2026-10-26', endDate: '2026-10-26', active: true },
    { id: '55555555-5555-4555-8555-555555555555', targetType: 'CATEGORY', targetId: categoryId, percent: '20', daysOfWeek: [1], startDate: '2026-10-26', endDate: '2026-10-26', active: true },
  ] });
  assert.equal(automaticPercent(rules, product, null, 0n, new Date('2026-10-25T19:30:00Z')), '20');
  assert.equal(automaticPercent(rules, product, '0', 90000n, new Date('2026-10-26T19:30:00Z')), '10');
  assert.equal(automaticPercent({ ...rules, mode: 'BONUS' }, product, '15', 90000n), '0');
});

test('bonus mode requires an earn rate and thresholds must increase', () => {
  assert.equal(loyaltySettingsSchema.safeParse({ ...defaultLoyaltySettings, mode: 'BONUS' }).success, false);
  assert.equal(loyaltySettingsSchema.safeParse({ ...defaultLoyaltySettings, tiers: [{ minimumMinor: '80000', percent: '7' }, { minimumMinor: '50000', percent: '10' }] }).success, false);
});
