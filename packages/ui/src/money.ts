const maximumMinor = 999999999999999999n;

export function parseMoneyInput(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, '');
  if (!/^\d{1,16}(?:[.,]\d{0,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.replace(',', '.').split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return minor <= maximumMinor ? minor.toString() : null;
}

export function formatMoneyInput(minor: string): string {
  if (!/^(0|[1-9]\d{0,17})$/.test(minor)) return '';
  const amount = BigInt(minor);
  return `${amount / 100n},${String(amount % 100n).padStart(2, '0')}`;
}

export function parseSignedMoneyInput(raw: string): string | null {
  const value = raw.trim();
  const negative = value.startsWith('-');
  const parsed = parseMoneyInput(negative ? value.slice(1) : value);
  if (parsed === null || (negative && parsed === '0')) return null;
  return negative ? `-${parsed}` : parsed;
}

export function formatSignedMoneyInput(minor: string): string {
  return minor.startsWith('-') ? `-${formatMoneyInput(minor.slice(1))}` : formatMoneyInput(minor);
}

export function formatCurrencyMinor(minor: string | null | undefined): string {
  if (minor == null) return '—';
  const amount = BigInt(minor);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '−' : ''}${new Intl.NumberFormat('ru-RU').format(absolute / 100n)},${String(absolute % 100n).padStart(2, '0')} сум`;
}
