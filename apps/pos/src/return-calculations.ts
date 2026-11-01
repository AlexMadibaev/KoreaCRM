import type { PosSale } from '@koreacrm/types';

export function returnedQuantity(sale: PosSale, saleItemId: string) {
  return (sale.returns ?? []).reduce((total, record) => total + record.items.filter(item => item.saleItemId === saleItemId).reduce((sum, item) => sum + item.quantity, 0), 0);
}

export function returnAmount(sale: PosSale, quantities: Record<string, number>) {
  return sale.items.reduce((total, item) => {
    const already = returnedQuantity(sale, item.id);
    const quantity = quantities[item.id] ?? 0;
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > item.quantity - already) throw new Error('Количество возврата превышает доступное');
    const price = BigInt(item.totalMinor);
    const count = BigInt(item.quantity);
    return total + price * BigInt(already + quantity) / count - price * BigInt(already) / count;
  }, 0n);
}

export function fullyReturned(sale: PosSale) {
  return sale.items.every(item => returnedQuantity(sale, item.id) >= item.quantity);
}

type RefundKind = PosSale['payments'][number]['paymentMethod']['kind'];
export type RefundPreview = { methodId: string; name: string; kind: RefundKind; amountMinor: bigint };
// Same order as the server: debt is written off first, cash pays out last.
const refundOrder: RefundKind[] = ['DEBT', 'BONUS', 'CARD', 'QR', 'TRANSFER', 'CUSTOM', 'CASH'];

/** Preview of how the server splits a refund across the sale's payments (debt cap not known here). */
export function refundPreview(sale: PosSale, amount: bigint): RefundPreview[] {
  const refunded = new Map<string, bigint>();
  let legacyCash = 0n;
  for (const record of sale.returns ?? []) {
    if (!record.payments?.length) { legacyCash += BigInt(record.amountMinor); continue; }
    for (const part of record.payments) if (part.paymentId) refunded.set(part.paymentId, (refunded.get(part.paymentId) ?? 0n) + BigInt(part.amountMinor));
  }
  const result: RefundPreview[] = [];
  let left = amount;
  for (const payment of [...sale.payments].sort((a, b) => refundOrder.indexOf(a.paymentMethod.kind) - refundOrder.indexOf(b.paymentMethod.kind))) {
    if (left <= 0n) break;
    let remaining = BigInt(payment.amountMinor) - (refunded.get(payment.id) ?? 0n);
    if (payment.paymentMethod.kind === 'CASH' && legacyCash > 0n) { const used = legacyCash < remaining ? legacyCash : remaining; remaining -= used; legacyCash -= used; }
    if (remaining <= 0n) continue;
    const take = remaining < left ? remaining : left;
    left -= take;
    const existing = result.find(part => part.methodId === payment.paymentMethod.id);
    if (existing) existing.amountMinor += take;
    else result.push({ methodId: payment.paymentMethod.id, name: payment.paymentMethod.name, kind: payment.paymentMethod.kind, amountMinor: take });
  }
  return result;
}

export function refundInstruction(kind: RefundKind): string {
  if (kind === 'CASH') return 'выдайте наличными';
  if (kind === 'DEBT') return 'спишется с долга клиента';
  if (kind === 'BONUS') return 'вернётся на бонусный счёт';
  if (kind === 'CARD') return 'верните на карту через терминал';
  if (kind === 'QR') return 'верните через QR-сервис';
  return 'верните тем же способом';
}
