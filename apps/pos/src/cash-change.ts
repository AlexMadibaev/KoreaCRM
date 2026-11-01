// Suggested banknote amounts for a cash payment, in minor units (1 сомони = 100).
export function quickCashAmounts(totalMinor: bigint, limit = 3): bigint[] {
  if (totalMinor <= 0n) return [];
  const steps = [1000n, 5000n, 10000n, 20000n, 50000n, 100000n];
  const amounts = new Set<bigint>();
  for (const step of steps) {
    const rounded = (totalMinor + step - 1n) / step * step;
    if (rounded > totalMinor) amounts.add(rounded);
    if (amounts.size >= limit) break;
  }
  return [...amounts].sort((a, b) => (a < b ? -1 : 1)).slice(0, limit);
}

export function changeDue(receivedMinor: string, totalMinor: bigint): bigint | null {
  if (!/^\d+$/.test(receivedMinor)) return null;
  const received = BigInt(receivedMinor);
  return received >= totalMinor ? received - totalMinor : null;
}
