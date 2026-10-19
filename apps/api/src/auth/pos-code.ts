import { createHash, randomBytes, randomInt } from 'node:crypto';

export function hashPosCode(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function ean13CheckDigit(firstTwelve: string) {
  const sum = [...firstTwelve].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return String((10 - sum % 10) % 10);
}

export function validPosCode(value: string) {
  return /^KCRM1:[A-Za-z0-9_-]{43}$/.test(value) || /^\d{13}$/.test(value) && ean13CheckDigit(value.slice(0, 12)) === value[12];
}

export function newPosCodes() {
  const qrCode = `KCRM1:${randomBytes(32).toString('base64url')}`;
  const firstTwelve = `29${String(randomInt(0, 10_000_000_000)).padStart(10, '0')}`;
  return { qrCode, ean13: firstTwelve + ean13CheckDigit(firstTwelve) };
}
