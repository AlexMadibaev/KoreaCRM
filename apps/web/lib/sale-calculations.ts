export type SaleLine = { productId: string; quantity: number; available: number; priceMinor: number; discountMinor: string };
export type ReceiptDiscount = { kind: 'FIXED' | 'PERCENT'; value: string };

const money = /^(0|[1-9]\d{0,17})$/;

function percentBasisPoints(value: string) {
  const normalized = value.replace(',', '.');
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) > 100) throw new Error('Invalid discount percent');
  const [whole = '0', fraction = ''] = normalized.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
}

export function calculateSaleTotals(lines: SaleLine[], customerPercent: string, receiptDiscount: ReceiptDiscount) {
  if (!lines.length || new Set(lines.map(line => line.productId)).size !== lines.length) throw new Error('Invalid sale lines');
  const customerBasisPoints = percentBasisPoints(customerPercent);
  const portions = lines.map((line, index) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > line.available || !Number.isInteger(line.priceMinor) || line.priceMinor < 0 || !money.test(line.discountMinor)) throw new Error('Invalid sale line');
    const gross = BigInt(line.priceMinor) * BigInt(line.quantity);
    const manual = BigInt(line.discountMinor);
    if (manual > gross) throw new Error('Line discount exceeds price');
    const personal = (gross - manual) * customerBasisPoints / 10000n;
    const previousDiscount = manual + personal;
    return { index, productId: line.productId, gross, previousDiscount, remaining: gross - previousDiscount, allocated: 0n, remainder: 0n };
  });
  const subtotal = portions.reduce((sum, portion) => sum + portion.gross, 0n);
  const baseTotal = portions.reduce((sum, portion) => sum + portion.remaining, 0n);
  const desired = receiptDiscount.kind === 'FIXED' ? money.test(receiptDiscount.value) ? BigInt(receiptDiscount.value) : -1n : baseTotal * percentBasisPoints(receiptDiscount.value) / 10000n;
  if (desired < 0n || desired > baseTotal) throw new Error('Receipt discount exceeds remaining total');
  for (const portion of portions) {
    const scaled = desired * portion.remaining;
    portion.allocated = baseTotal ? scaled / baseTotal : 0n;
    portion.remainder = baseTotal ? scaled % baseTotal : 0n;
  }
  let undistributed = desired - portions.reduce((sum, portion) => sum + portion.allocated, 0n);
  for (const portion of [...portions].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (!undistributed) break;
    portion.allocated += 1n;
    undistributed -= 1n;
  }
  return {
    subtotal,
    discount: subtotal - baseTotal + desired,
    total: baseTotal - desired,
    receiptDiscountMinor: desired,
    lines: portions.map(portion => ({ productId: portion.productId, discountMinor: portion.previousDiscount + portion.allocated, totalMinor: portion.remaining - portion.allocated })),
  };
}
