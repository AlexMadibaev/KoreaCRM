import assert from 'node:assert/strict';
import { test } from 'node:test';
import { giftCardExpiry, giftCardProblem, newGiftCardCode, normalizeGiftCardCode } from '../src/gift-cards/gift-cards.rules';

test('gift card codes are readable and survive how scanners and people type them', () => {
  const code = newGiftCardCode();
  assert.match(code, /^GC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(normalizeGiftCardCode(code.toLowerCase()), code);
  assert.equal(normalizeGiftCardCode(` ${code.replace(/-/g, '')} `), code);
  assert.equal(normalizeGiftCardCode(code.slice(3).replace(/-/g, ' ')), code);
});

test('a gift card pays only while active, unexpired and not empty', () => {
  const now = new Date('2026-12-01T10:00:00Z');
  const card = { status: 'ACTIVE' as const, expiresAt: null, balanceMinor: '500' };
  assert.equal(giftCardProblem(card, now), null);
  assert.equal(giftCardProblem(null, now), 'Гифт-карта не найдена');
  assert.equal(giftCardProblem({ ...card, status: 'BLOCKED' }, now), 'Гифт-карта заблокирована');
  assert.equal(giftCardProblem({ ...card, balanceMinor: '0' }, now), 'На гифт-карте не осталось денег');
  assert.equal(giftCardProblem({ ...card, expiresAt: giftCardExpiry('2026-12-01') }, now), null);
  assert.equal(giftCardProblem({ ...card, expiresAt: giftCardExpiry('2026-11-30') }, now), 'Срок действия гифт-карты истёк');
});
