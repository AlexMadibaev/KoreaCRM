import { randomInt } from 'node:crypto';
import { z } from 'zod';

// No 0/O or 1/I: cashiers sometimes type the code from a worn card.
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const block = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');

/** The QR code on the card encodes exactly this string, e.g. GC-7KQ2-M9XA-P4TD. */
export function newGiftCardCode() {
  return `GC-${block()}-${block()}-${block()}`;
}

/** Scanners and people add spaces, lower case or drop dashes; all of them mean the same card. */
export function normalizeGiftCardCode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = compact.startsWith('GC') ? compact.slice(2) : compact;
  return body.length === 12 ? `GC-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}` : value.trim().toUpperCase();
}

const minor = z.string().regex(/^[1-9]\d{0,13}$/);
export const giftCardCreateSchema = z.object({
  amountMinor: minor,
  expiresAt: z.iso.date().nullable().optional(),
  comment: z.string().trim().max(500).optional(),
});
export const giftCardPatchSchema = z.object({ status: z.enum(['ACTIVE', 'BLOCKED']) });
export const giftCardListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});

export type GiftCardState = { status: 'ACTIVE' | 'BLOCKED'; expiresAt: Date | null; balanceMinor: { toString(): string } };

/** Why a card cannot pay right now, in words a cashier can read to the customer; null when it can. */
export function giftCardProblem(card: GiftCardState | null, now = new Date()) {
  if (!card) return 'Гифт-карта не найдена';
  if (card.status === 'BLOCKED') return 'Гифт-карта заблокирована';
  if (card.expiresAt && card.expiresAt.getTime() < now.getTime()) return 'Срок действия гифт-карты истёк';
  if (BigInt(card.balanceMinor.toString()) <= 0n) return 'На гифт-карте не осталось денег';
  return null;
}

/** A card is valid through the whole of its last day in Dushanbe (UTC+5). */
export function giftCardExpiry(date: string) {
  return new Date(`${date}T23:59:59.999+05:00`);
}
