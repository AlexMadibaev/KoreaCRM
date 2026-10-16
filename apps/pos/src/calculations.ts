export type CartLine = { productId: string; quantity: number; available: number; priceMinor: number; discountMinor: string };
export type PaymentPart = { methodId: string; amountMinor: string; kind: string };
const amount = /^(0|[1-9]\d{0,17})$/;
const maximum = 999999999999999999n;

export function discountBasisPoints(percent: string): bigint {
  const normalized = percent.replace(',', '.');
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) > 100) throw new Error('Invalid discount percent');
  const [whole = '0', fraction = ''] = normalized.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
}

export function lineDiscountMinor(line: CartLine, customerDiscountPercent = '0') {
  const gross = BigInt(line.priceMinor) * BigInt(line.quantity);
  const manual = BigInt(line.discountMinor);
  if (manual > gross) throw new Error('Discount exceeds line price');
  const personal = (gross - manual) * discountBasisPoints(customerDiscountPercent) / 10000n;
  return { manual, personal, total: manual + personal };
}

export function calculateCart(lines: CartLine[], customerDiscountPercent = '0') {
  if (!lines.length || new Set(lines.map(line => line.productId)).size !== lines.length) throw new Error('Invalid cart');
  let subtotal = 0n;
  let discount = 0n;
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > line.available || !Number.isInteger(line.priceMinor) || line.priceMinor < 0 || !amount.test(line.discountMinor)) throw new Error('Invalid cart line');
    const gross = BigInt(line.priceMinor) * BigInt(line.quantity);
    const lineDiscount = lineDiscountMinor(line, customerDiscountPercent).total;
    subtotal += gross;
    discount += lineDiscount;
  }
  if (subtotal > maximum) throw new Error('Cart total exceeds allowed range');
  return { subtotal, discount, total: subtotal - discount };
}

export type CartDiscount = { kind: 'FIXED' | 'PERCENT'; value: string };

export function calculateCartWithDiscount(lines: CartLine[], customerDiscountPercent = '0', cartDiscount: CartDiscount = { kind: 'FIXED', value: '0' }) {
  const base = calculateCart(lines, customerDiscountPercent);
  const desired = cartDiscount.kind === 'FIXED' ? amount.test(cartDiscount.value) ? BigInt(cartDiscount.value) : -1n : base.total * discountBasisPoints(cartDiscount.value) / 10000n;
  if (desired < 0n || desired > base.total) throw new Error('Cart discount exceeds remaining total');
  const portions = lines.map((line, index) => {
    const gross = BigInt(line.priceMinor) * BigInt(line.quantity);
    const previousDiscount = lineDiscountMinor(line, customerDiscountPercent).total;
    const remaining = gross - previousDiscount;
    const scaled = desired * remaining;
    return { index, productId: line.productId, gross, previousDiscount, remaining, allocated: base.total > 0n ? scaled / base.total : 0n, remainder: base.total > 0n ? scaled % base.total : 0n };
  });
  let undistributed = desired - portions.reduce((sum, portion) => sum + portion.allocated, 0n);
  for (const portion of [...portions].sort((left, right) => left.remainder === right.remainder ? left.index - right.index : left.remainder > right.remainder ? -1 : 1)) {
    if (undistributed === 0n) break;
    portion.allocated += 1n;
    undistributed -= 1n;
  }
  return { subtotal: base.subtotal, discount: base.discount + desired, total: base.total - desired, cartDiscountMinor: desired, lines: portions.map(portion => ({ productId: portion.productId, discountMinor: portion.previousDiscount + portion.allocated, cartDiscountMinor: portion.allocated, totalMinor: portion.remaining - portion.allocated })) };
}

export function validatePayments(parts: PaymentPart[], total: bigint, customerId: string | null, shiftId: string | null, bonusBalanceMinor = '0') {
  if (!parts.length || total <= 0n || parts.some(part => !part.methodId || !amount.test(part.amountMinor) || BigInt(part.amountMinor) <= 0n)) throw new Error('Invalid payment');
  if (parts.reduce((sum, part) => sum + BigInt(part.amountMinor), 0n) !== total) throw new Error('Payment total does not match cart total');
  if (parts.some(part => part.kind === 'DEBT') && !customerId) throw new Error('Customer is required for a debt sale');
  const bonus = parts.filter(part => part.kind === 'BONUS').reduce((sum, part) => sum + BigInt(part.amountMinor), 0n);
  if (bonus > 0n && (!customerId || !amount.test(bonusBalanceMinor) || bonus > BigInt(bonusBalanceMinor))) throw new Error('Customer bonus balance is insufficient');
  if (parts.some(part => part.kind === 'CASH') !== Boolean(shiftId)) throw new Error('Cash shift is required only for cash payment');
}

export function formatMinor(value: string | number | bigint) {
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${new Intl.NumberFormat('ru-RU').format(absolute / 100n)},${String(absolute % 100n).padStart(2, '0')}`;
}
