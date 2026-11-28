import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import { giftCardCreateSchema, giftCardExpiry, giftCardListSchema, giftCardProblem, newGiftCardCode, normalizeGiftCardCode } from './gift-cards.rules';

type Tx = Prisma.TransactionClient;

@Injectable()
export class GiftCardsService {
  constructor(private readonly db: DatabaseService) {}

  async list(query: z.infer<typeof giftCardListSchema>) {
    const search = query.search ? normalizeGiftCardCode(query.search) : undefined;
    const where: Prisma.GiftCardWhereInput = search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { comment: { contains: query.search, mode: 'insensitive' } }] } : {};
    const [items, total] = await this.db.$transaction([
      this.db.giftCard.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.db.giftCard.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string) {
    const card = await this.db.giftCard.findUnique({ where: { id }, include: { transactions: { orderBy: { createdAt: 'desc' }, take: 100 } } });
    if (!card) throw new NotFoundException('Гифт-карта не найдена');
    return card;
  }

  async create(input: z.infer<typeof giftCardCreateSchema>, actorId: string) {
    const expiresAt = input.expiresAt ? giftCardExpiry(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() < Date.now()) throw new BadRequestException('Срок действия уже прошёл');
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.db.$transaction(async tx => {
          const card = await tx.giftCard.create({ data: { code: newGiftCardCode(), initialMinor: input.amountMinor, balanceMinor: input.amountMinor, expiresAt, comment: input.comment || null, createdById: actorId } });
          await tx.giftCardTransaction.create({ data: { giftCardId: card.id, type: 'ISSUE', amountMinor: input.amountMinor, balanceAfterMinor: input.amountMinor, actorId } });
          await tx.auditLog.create({ data: { userId: actorId, action: 'GIFT_CARD_ISSUED', entityType: 'GiftCard', entityId: card.id, newValue: { code: card.code, amountMinor: input.amountMinor, expiresAt: expiresAt?.toISOString() ?? null } } });
          return card;
        });
      } catch (error) {
        // Twelve random characters practically never repeat, but a repeat must not fail the issue.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && attempt < 4) continue;
        throw error;
      }
    }
    throw new ConflictException('Не удалось выпустить гифт-карту');
  }

  async setStatus(id: string, status: 'ACTIVE' | 'BLOCKED', actorId: string) {
    const card = await this.get(id);
    if (card.status === status) return card;
    return this.db.$transaction(async tx => {
      const updated = await tx.giftCard.update({ where: { id }, data: { status } });
      await tx.auditLog.create({ data: { userId: actorId, action: status === 'BLOCKED' ? 'GIFT_CARD_BLOCKED' : 'GIFT_CARD_UNBLOCKED', entityType: 'GiftCard', entityId: id, oldValue: { status: card.status }, newValue: { status } } });
      return updated;
    });
  }

  /** What the till shows after a scan: the balance and, when the card cannot pay, why. */
  async lookup(rawCode: string) {
    const code = normalizeGiftCardCode(rawCode);
    const card = await this.db.giftCard.findUnique({ where: { code } });
    const problem = giftCardProblem(card);
    if (!card) throw new NotFoundException(problem);
    return { code: card.code, balanceMinor: card.balanceMinor.toString(), status: card.status, expiresAt: card.expiresAt, usable: problem === null, problem };
  }
}

/** Spends a card inside the sale's transaction; a concurrent spend of the same balance fails the sale instead of overdrawing. */
export async function redeemGiftCard(tx: Tx, input: { code: string | undefined; amount: Prisma.Decimal; saleId: string; paymentId: string; actorId: string }) {
  if (!input.code) throw new BadRequestException('Отсканируйте QR-код гифт-карты');
  const card = await tx.giftCard.findUnique({ where: { code: normalizeGiftCardCode(input.code) } });
  const problem = giftCardProblem(card);
  if (problem || !card) throw new ConflictException(problem);
  const spent = await tx.giftCard.updateMany({ where: { id: card.id, status: 'ACTIVE', balanceMinor: { gte: input.amount } }, data: { balanceMinor: { decrement: input.amount } } });
  if (spent.count !== 1) throw new ConflictException('На гифт-карте недостаточно денег');
  const after = await tx.giftCard.findUniqueOrThrow({ where: { id: card.id } });
  await tx.giftCardTransaction.create({ data: { giftCardId: card.id, type: 'REDEEM', amountMinor: input.amount.neg(), balanceAfterMinor: after.balanceMinor, saleId: input.saleId, paymentId: input.paymentId, actorId: input.actorId } });
}

/** Puts a returned part of a gift-card payment back on the same card, whatever its status. */
export async function refundGiftCard(tx: Tx, input: { paymentId: string; amount: Prisma.Decimal; saleId: string; saleReturnId: string; actorId: string }) {
  const redeemed = await tx.giftCardTransaction.findFirst({ where: { paymentId: input.paymentId, type: 'REDEEM' } });
  if (!redeemed) throw new ConflictException('Не найдена гифт-карта, которой оплатили чек');
  const card = await tx.giftCard.update({ where: { id: redeemed.giftCardId }, data: { balanceMinor: { increment: input.amount } } });
  await tx.giftCardTransaction.create({ data: { giftCardId: card.id, type: 'REFUND', amountMinor: input.amount, balanceAfterMinor: card.balanceMinor, saleId: input.saleId, paymentId: input.paymentId, saleReturnId: input.saleReturnId, actorId: input.actorId } });
}
