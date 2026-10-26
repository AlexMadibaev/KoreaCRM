import { z } from 'zod';

const percent = z.string().regex(/^\d{1,3}(?:\.\d{1,2})?$/).refine(value => Number(value) <= 100);
const minor = z.string().regex(/^(0|[1-9]\d{0,15})$/);
const uuid = z.string().uuid();

export const loyaltySettingsSchema = z.object({
  mode: z.enum(['DISCOUNT', 'BONUS']),
  tiers: z.array(z.object({ minimumMinor: minor, percent })).max(20),
  bonusEarnPercent: percent,
  consultantEarnPercent: percent,
  excludedProductIds: z.array(uuid).max(500),
  excludedBrandIds: z.array(uuid).max(200),
  excludedCategoryIds: z.array(uuid).max(200),
  promotions: z.array(z.object({ id: uuid, targetType: z.enum(['PRODUCT', 'BRAND', 'CATEGORY']), targetId: uuid, percent, daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7), startDate: z.iso.date().nullable(), endDate: z.iso.date().nullable(), active: z.boolean() })).max(200),
}).superRefine((value, context) => {
  const minimums = value.tiers.map(tier => BigInt(tier.minimumMinor));
  if (minimums.some((minimum, index) => index > 0 && minimum <= minimums[index - 1]!)) context.addIssue({ code: 'custom', message: 'Thresholds must increase', path: ['tiers'] });
  if (value.mode === 'BONUS' && Number(value.bonusEarnPercent) <= 0) context.addIssue({ code: 'custom', message: 'Set a bonus earn percentage before activating bonuses', path: ['bonusEarnPercent'] });
  for (const [index, promotion] of value.promotions.entries()) if (promotion.startDate && promotion.endDate && promotion.startDate > promotion.endDate) context.addIssue({ code: 'custom', message: 'End date must follow start date', path: ['promotions', index] });
});

export type LoyaltySettings = z.infer<typeof loyaltySettingsSchema>;
export const defaultLoyaltySettings: LoyaltySettings = { mode: 'DISCOUNT', tiers: [{ minimumMinor: '50000', percent: '7' }, { minimumMinor: '80000', percent: '10' }], bonusEarnPercent: '0', consultantEarnPercent: '0', excludedProductIds: [], excludedBrandIds: [], excludedCategoryIds: [], promotions: [] };

export function percentBasisPoints(value: string) {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
}

export function automaticPercent(settings: LoyaltySettings, line: { productId: string; brandId: string | null; categoryId: string | null }, customerPercent: string | null, grossSubtotalMinor: bigint, at = new Date()) {
  if (settings.mode !== 'DISCOUNT') return '0';
  if (settings.excludedProductIds.includes(line.productId) || (line.brandId && settings.excludedBrandIds.includes(line.brandId)) || (line.categoryId && settings.excludedCategoryIds.includes(line.categoryId))) return '0';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dushanbe', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`, day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const promotion = settings.promotions.filter(rule => rule.active && (!rule.startDate || date >= rule.startDate) && (!rule.endDate || date <= rule.endDate) && (!rule.daysOfWeek.length || rule.daysOfWeek.includes(day)) && (rule.targetType === 'PRODUCT' && rule.targetId === line.productId || rule.targetType === 'BRAND' && rule.targetId === line.brandId || rule.targetType === 'CATEGORY' && rule.targetId === line.categoryId)).sort((a, b) => Number(b.percent) - Number(a.percent))[0];
  if (promotion) return promotion.percent;
  if (customerPercent === null) return '0';
  if (Number(customerPercent) > 0) return customerPercent;
  return settings.tiers.filter(tier => grossSubtotalMinor >= BigInt(tier.minimumMinor)).at(-1)?.percent ?? '0';
}
