export type LoyaltySettings = {
  mode: 'DISCOUNT' | 'BONUS';
  tiers: { minimumMinor: string; percent: string }[];
  bonusEarnPercent: string;
  consultantEarnPercent: string;
  excludedProductIds: string[];
  excludedBrandIds: string[];
  excludedCategoryIds: string[];
  promotions: { id: string; targetType: 'PRODUCT' | 'BRAND' | 'CATEGORY'; targetId: string; percent: string; daysOfWeek: number[]; startDate: string | null; endDate: string | null; active: boolean }[];
};

export const defaultLoyaltySettings: LoyaltySettings = { mode: 'DISCOUNT', tiers: [{ minimumMinor: '50000', percent: '7' }, { minimumMinor: '80000', percent: '10' }], bonusEarnPercent: '0', consultantEarnPercent: '0', excludedProductIds: [], excludedBrandIds: [], excludedCategoryIds: [], promotions: [] };

export function loyaltyPercent(settings: LoyaltySettings, line: { productId: string; brandId?: string | null; categoryId?: string | null }, personalPercent: string | null, subtotal: bigint, now = new Date()): string {
  if (settings.mode !== 'DISCOUNT') return '0';
  if (settings.excludedProductIds.includes(line.productId) || (line.brandId && settings.excludedBrandIds.includes(line.brandId)) || (line.categoryId && settings.excludedCategoryIds.includes(line.categoryId))) return '0';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dushanbe', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`, day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const promotion = settings.promotions.filter(rule => rule.active && (!rule.startDate || date >= rule.startDate) && (!rule.endDate || date <= rule.endDate) && (!rule.daysOfWeek.length || rule.daysOfWeek.includes(day)) && (rule.targetType === 'PRODUCT' && rule.targetId === line.productId || rule.targetType === 'BRAND' && rule.targetId === line.brandId || rule.targetType === 'CATEGORY' && rule.targetId === line.categoryId)).sort((a, b) => Number(b.percent) - Number(a.percent))[0];
  if (promotion) return promotion.percent;
  if (personalPercent === null) return '0';
  if (Number(personalPercent) > 0) return personalPercent;
  return settings.tiers.filter(tier => subtotal >= BigInt(tier.minimumMinor)).at(-1)?.percent ?? '0';
}

export function percentBasisPoints(value: string): bigint {
  const [whole = '0', fraction = ''] = value.replace(',', '.').split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
}

export function autoDiscountMinor(settings: LoyaltySettings, line: { productId: string; brandId?: string | null; categoryId?: string | null; priceMinor: number; quantity: number; discountMinor: string }, personalPercent: string | null, subtotal: bigint): bigint {
  const gross = BigInt(line.priceMinor) * BigInt(line.quantity), manual = BigInt(line.discountMinor);
  if (manual > gross) throw new Error('Discount exceeds line price');
  const percent = loyaltyPercent(settings, line, personalPercent, subtotal);
  return (gross - manual) * percentBasisPoints(percent) / 10000n;
}
