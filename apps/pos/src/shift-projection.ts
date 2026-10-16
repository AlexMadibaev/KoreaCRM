type QueuedSale = { status: string; payloadJson: string };
type SalePayload = { cashShiftId?: string; payments?: { paymentMethodId: string; amountMinor: string }[] };

export function projectShiftCash(expectedCashMinor: string, shiftId: string, cashMethodIds: string[], queuedSales: QueuedSale[]) {
  const cashMethods = new Set(cashMethodIds);
  let queuedCashMinor = 0n;
  for (const entry of queuedSales) {
    if (entry.status === 'SYNCED') continue;
    let sale: SalePayload;
    try { sale = JSON.parse(entry.payloadJson) as SalePayload; } catch { continue; }
    if (sale.cashShiftId !== shiftId || !Array.isArray(sale.payments)) continue;
    for (const payment of sale.payments) {
      if (cashMethods.has(payment.paymentMethodId) && /^(0|[1-9]\d*)$/.test(payment.amountMinor)) queuedCashMinor += BigInt(payment.amountMinor);
    }
  }
  return { expectedCashMinor: BigInt(expectedCashMinor) + queuedCashMinor, queuedCashMinor };
}
