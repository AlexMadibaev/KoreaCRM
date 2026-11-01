import { Prisma } from '@prisma/client';

type Kind = 'CASH' | 'CARD' | 'QR' | 'TRANSFER' | 'BONUS' | 'DEBT' | 'CUSTOM';
export type RefundPayment = { id: string; paymentMethodId: string; amountMinor: Prisma.Decimal; paymentMethod: { kind: Kind } };
export type PriorReturn = { amountMinor: Prisma.Decimal; payments?: { paymentId: string | null; amountMinor: Prisma.Decimal }[] };
export type RefundPart = { paymentId: string | null; paymentMethodId: string | null; kind: Kind; amount: Prisma.Decimal };

// Debt is written off first, then bonuses, then card-like payments; cash pays out last.
const order: Kind[] = ['DEBT', 'BONUS', 'CARD', 'QR', 'TRANSFER', 'CUSTOM', 'CASH'];

/**
 * Splits a return amount across the sale's original payments. A debt part larger than the
 * customer's current debt (already repaid) is paid out in cash instead, with paymentMethodId null.
 */
export function allocateRefund(payments: RefundPayment[], previous: PriorReturn[], amount: Prisma.Decimal, debtBalance: Prisma.Decimal): RefundPart[] {
  const zero = new Prisma.Decimal(0);
  const refunded = new Map<string, Prisma.Decimal>();
  let legacyCash = zero;
  for (const record of previous) {
    // Returns recorded before itemized refunds were cash-only.
    if (!record.payments?.length) { legacyCash = legacyCash.plus(record.amountMinor); continue; }
    for (const part of record.payments) if (part.paymentId) refunded.set(part.paymentId, (refunded.get(part.paymentId) ?? zero).plus(part.amountMinor));
  }
  const parts: RefundPart[] = [];
  let left = amount;
  let debtRoom = debtBalance.lt(0) ? zero : debtBalance;
  let overflow = zero;
  const sorted = [...payments].sort((a, b) => order.indexOf(a.paymentMethod.kind) - order.indexOf(b.paymentMethod.kind));
  for (const payment of sorted) {
    if (left.lte(0)) break;
    let remaining = payment.amountMinor.minus(refunded.get(payment.id) ?? zero);
    if (payment.paymentMethod.kind === 'CASH' && legacyCash.gt(0)) { const used = Prisma.Decimal.min(legacyCash, remaining); remaining = remaining.minus(used); legacyCash = legacyCash.minus(used); }
    if (remaining.lte(0)) continue;
    let take = Prisma.Decimal.min(remaining, left);
    left = left.minus(take);
    if (payment.paymentMethod.kind === 'DEBT') {
      const written = Prisma.Decimal.min(take, debtRoom);
      debtRoom = debtRoom.minus(written);
      overflow = overflow.plus(take.minus(written));
      take = written;
    }
    if (take.gt(0)) parts.push({ paymentId: payment.id, paymentMethodId: payment.paymentMethodId, kind: payment.paymentMethod.kind, amount: take });
  }
  overflow = overflow.plus(left.gt(0) ? left : zero);
  if (overflow.gt(0)) {
    const cash = parts.find(part => part.kind === 'CASH' && part.paymentId === null);
    if (cash) cash.amount = cash.amount.plus(overflow);
    else parts.push({ paymentId: null, paymentMethodId: null, kind: 'CASH', amount: overflow });
  }
  return parts;
}
