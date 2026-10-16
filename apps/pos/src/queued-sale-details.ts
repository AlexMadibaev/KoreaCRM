type SalePayload = { items?: { quantity: number }[]; payments?: { paymentMethodId: string; amountMinor: string }[]; cashShiftId?: string };

export function queuedSaleDetails(payloadJson: string) {
  let sale: SalePayload;
  try { sale = JSON.parse(payloadJson) as SalePayload; } catch { return null; }
  if (!Array.isArray(sale.items) || !Array.isArray(sale.payments)) return null;
  const payments = sale.payments.filter(payment => typeof payment.paymentMethodId === 'string' && /^(0|[1-9]\d*)$/.test(payment.amountMinor));
  const quantity = sale.items.reduce((sum, item) => sum + (Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0), 0);
  return { positions: sale.items.length, quantity, totalMinor: payments.reduce((sum, payment) => sum + BigInt(payment.amountMinor), 0n), payments, hasCashShift: Boolean(sale.cashShiftId) };
}
