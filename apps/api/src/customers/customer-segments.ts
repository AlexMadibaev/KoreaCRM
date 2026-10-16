export const segmentCodes = ['NEW', 'REGULAR', 'VIP', 'DORMANT', 'HIGH_CHECK', 'FREQUENT'] as const;
export type SegmentCode = typeof segmentCodes[number];

export const segmentDefinitions: Record<SegmentCode, { label: string; description: string }> = {
  NEW: { label: 'Новый', description: 'Не более одной действующей покупки' },
  REGULAR: { label: 'Постоянный', description: 'Не менее трёх действующих покупок' },
  VIP: { label: 'VIP', description: 'Не менее пяти действующих покупок и 5 000 000 сум потрачено' },
  DORMANT: { label: 'Давно не покупал', description: 'Последняя покупка была более 90 дней назад' },
  HIGH_CHECK: { label: 'Высокий средний чек', description: 'Средний чек не ниже 500 000 сум' },
  FREQUENT: { label: 'Частые покупки', description: 'Не менее трёх покупок за последние 30 дней' },
};

export function segmentCutoffs(now: Date) {
  return { dormant: new Date(now.getTime() - 90 * 86400000), frequent: new Date(now.getTime() - 30 * 86400000) };
}

export function deriveCustomerSegments(customer: { ordersCount: number; totalSpentMinor: { toString(): string }; averageCheckMinor: { toString(): string } }, lastPurchaseAt: Date | null, recentSales: number, now: Date = new Date()) {
  const { dormant } = segmentCutoffs(now);
  const codes: SegmentCode[] = [];
  if (customer.ordersCount <= 1) codes.push('NEW');
  if (customer.ordersCount >= 3) codes.push('REGULAR');
  if (customer.ordersCount >= 5 && BigInt(customer.totalSpentMinor.toString()) >= 500000000n) codes.push('VIP');
  if (lastPurchaseAt && lastPurchaseAt < dormant) codes.push('DORMANT');
  if (customer.ordersCount > 0 && BigInt(customer.averageCheckMinor.toString()) >= 50000000n) codes.push('HIGH_CHECK');
  if (customer.ordersCount >= 3 && recentSales >= 3) codes.push('FREQUENT');
  return codes.map(code => ({ code, ...segmentDefinitions[code] }));
}
