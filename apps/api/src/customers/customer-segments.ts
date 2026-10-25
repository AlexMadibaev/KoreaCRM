import { z } from 'zod';

export const segmentCodes = ['NEW', 'REGULAR', 'VIP', 'DORMANT', 'HIGH_CHECK', 'FREQUENT'] as const;
export type SegmentCode = typeof segmentCodes[number];
const count = z.number().int().min(0).max(1000000);
const positiveCount = z.number().int().min(1).max(1000000);
const days = z.number().int().min(1).max(3650);
const minor = z.string().regex(/^(0|[1-9]\d{0,17})$/);

export const segmentSettingsSchema = z.object({
  NEW: z.object({ enabled: z.boolean(), maxOrders: count }),
  REGULAR: z.object({ enabled: z.boolean(), minOrders: positiveCount }),
  VIP: z.object({ enabled: z.boolean(), minOrders: positiveCount, minSpentMinor: minor }),
  DORMANT: z.object({ enabled: z.boolean(), days }),
  HIGH_CHECK: z.object({ enabled: z.boolean(), minAverageMinor: minor }),
  FREQUENT: z.object({ enabled: z.boolean(), minOrders: positiveCount, days }),
});
export type SegmentSettings = z.infer<typeof segmentSettingsSchema>;

export const defaultSegmentSettings: SegmentSettings = {
  NEW: { enabled: true, maxOrders: 1 },
  REGULAR: { enabled: true, minOrders: 3 },
  VIP: { enabled: true, minOrders: 5, minSpentMinor: '500000000' },
  DORMANT: { enabled: true, days: 90 },
  HIGH_CHECK: { enabled: true, minAverageMinor: '50000000' },
  FREQUENT: { enabled: true, minOrders: 3, days: 30 },
};

export const segmentLabels: Record<SegmentCode, string> = {
  NEW: 'Новый', REGULAR: 'Постоянный', VIP: 'VIP', DORMANT: 'Давно не покупал', HIGH_CHECK: 'Высокий средний чек', FREQUENT: 'Частые покупки',
};
const somoni = (minorValue: string) => {
  const value = BigInt(minorValue);
  return `${new Intl.NumberFormat('ru-RU').format(value / 100n)},${String(value % 100n).padStart(2, '0')} сомони`;
};

export function segmentDescription(code: SegmentCode, settings: SegmentSettings) {
  switch (code) {
    case 'NEW': return `Не более ${settings.NEW.maxOrders} действующих покупок`;
    case 'REGULAR': return `Не менее ${settings.REGULAR.minOrders} действующих покупок`;
    case 'VIP': return `Не менее ${settings.VIP.minOrders} покупок и ${somoni(settings.VIP.minSpentMinor)} потрачено`;
    case 'DORMANT': return `Последняя покупка более ${settings.DORMANT.days} дней назад`;
    case 'HIGH_CHECK': return `Средний чек не ниже ${somoni(settings.HIGH_CHECK.minAverageMinor)}`;
    case 'FREQUENT': return `Не менее ${settings.FREQUENT.minOrders} покупок за ${settings.FREQUENT.days} дней`;
  }
}

export function segmentCutoffs(now: Date, settings: SegmentSettings = defaultSegmentSettings) {
  return { dormant: new Date(now.getTime() - settings.DORMANT.days * 86400000), frequent: new Date(now.getTime() - settings.FREQUENT.days * 86400000) };
}

export function deriveCustomerSegments(customer: { ordersCount: number; totalSpentMinor: { toString(): string }; averageCheckMinor: { toString(): string } }, lastPurchaseAt: Date | null, recentSales: number, now: Date = new Date(), settings: SegmentSettings = defaultSegmentSettings) {
  const { dormant } = segmentCutoffs(now, settings);
  const codes: SegmentCode[] = [];
  if (settings.NEW.enabled && customer.ordersCount <= settings.NEW.maxOrders) codes.push('NEW');
  if (settings.REGULAR.enabled && customer.ordersCount >= settings.REGULAR.minOrders) codes.push('REGULAR');
  if (settings.VIP.enabled && customer.ordersCount >= settings.VIP.minOrders && BigInt(customer.totalSpentMinor.toString()) >= BigInt(settings.VIP.minSpentMinor)) codes.push('VIP');
  if (settings.DORMANT.enabled && lastPurchaseAt && lastPurchaseAt < dormant) codes.push('DORMANT');
  if (settings.HIGH_CHECK.enabled && customer.ordersCount > 0 && BigInt(customer.averageCheckMinor.toString()) >= BigInt(settings.HIGH_CHECK.minAverageMinor)) codes.push('HIGH_CHECK');
  if (settings.FREQUENT.enabled && customer.ordersCount >= settings.FREQUENT.minOrders && recentSales >= settings.FREQUENT.minOrders) codes.push('FREQUENT');
  return codes.map(code => ({ code, label: segmentLabels[code], description: segmentDescription(code, settings) }));
}
