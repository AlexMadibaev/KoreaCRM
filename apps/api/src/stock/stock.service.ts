import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import type { AccessContext } from '../auth/policy';
import { adjustmentSchema, movementListSchema, stockListSchema, writeOffSchema } from './stock.schemas';

type StockList = z.infer<typeof stockListSchema>;
type MovementList = z.infer<typeof movementListSchema>;
type Adjustment = z.infer<typeof adjustmentSchema>;
type WriteOff = z.infer<typeof writeOffSchema>;

const inbound = new Set<StockMovementType>(['PURCHASE', 'RETURN', 'TRANSFER_IN']);
const outbound = new Set<StockMovementType>(['SALE', 'TRANSFER_OUT', 'WRITE_OFF', 'SUPPLIER_RETURN']);

export function nextQuantity(previous: number, delta: number, type: StockMovementType): number {
  if (!Number.isInteger(previous) || !Number.isInteger(delta) || delta === 0) throw new BadRequestException('Invalid quantity change');
  if (inbound.has(type) && delta < 0 || outbound.has(type) && delta > 0) throw new BadRequestException('Movement direction does not match type');
  const next = previous + delta;
  if (next < -2_147_483_648 || next > 2_147_483_647) throw new BadRequestException('Stock quantity exceeds database range');
  return next;
}

export interface MovementInput {
  storeId: string;
  productId: string;
  type: StockMovementType;
  delta: number;
  sourceType: string;
  sourceId: string;
  actorId?: string;
  comment?: string;
}

interface StockRow {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  reservedQuantity: number;
  minStock: number;
  negative: boolean;
  low: boolean;
}

@Injectable()
export class StockService {
  constructor(private readonly db: DatabaseService) {}

  async stores(access: AccessContext) {
    return this.db.store.findMany({
      where: { deletedAt: null, status: 'ACTIVE', id: access.allStores ? undefined : { in: access.storeIds } },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }

  private async requireStore(storeId: string) {
    const store = await this.db.store.findFirst({ where: { id: storeId, deletedAt: null } });
    if (!store) throw new NotFoundException('Store not found');
  }

  async list(storeId: string, query: StockList) {
    await this.requireStore(storeId);
    const conditions: Prisma.Sql[] = [Prisma.sql`p."deletedAt" IS NULL`];
    if (query.brandId) conditions.push(Prisma.sql`p."brandId" = ${query.brandId}::uuid`);
    if (query.categoryId) conditions.push(Prisma.sql`p."categoryId" = ${query.categoryId}::uuid`);
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(Prisma.sql`(p."name" ILIKE ${pattern} OR p."sku" ILIKE ${pattern} OR EXISTS (SELECT 1 FROM "ProductBarcode" b WHERE b."productId" = p.id AND b."value" ILIKE ${pattern}))`);
    }
    if (query.filter === 'negative') conditions.push(Prisma.sql`COALESCE(s.quantity, 0) < 0`);
    if (query.filter === 'zero') conditions.push(Prisma.sql`COALESCE(s.quantity, 0) = 0`);
    if (query.filter === 'low') conditions.push(Prisma.sql`COALESCE(s.quantity, 0) <= COALESCE(ps."minStock", 0)`);
    const from = Prisma.sql`FROM "Product" p LEFT JOIN "Stock" s ON s."productId" = p.id AND s."storeId" = ${storeId}::uuid LEFT JOIN "StoreProductSettings" ps ON ps."productId" = p.id AND ps."storeId" = ${storeId}::uuid`;
    const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const [items, counts] = await this.db.$transaction([
      this.db.$queryRaw<StockRow[]>`SELECT p.id AS "productId", p.name, p.sku, COALESCE(s.quantity, 0) AS quantity, COALESCE(s."reservedQuantity", 0) AS "reservedQuantity", COALESCE(ps."minStock", 0) AS "minStock", COALESCE(s.quantity, 0) < 0 AS negative, COALESCE(s.quantity, 0) <= COALESCE(ps."minStock", 0) AS low ${from} ${where} ORDER BY p.name, p.id LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      this.db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count ${from} ${where}`,
    ]);
    return { items, total: Number(counts[0]?.count ?? 0), page: query.page, limit: query.limit };
  }

  async movements(storeId: string, query: MovementList) {
    await this.requireStore(storeId);
    const where: Prisma.StockMovementWhereInput = { storeId, productId: query.productId, type: query.type };
    const [items, total] = await this.db.$transaction([
      this.db.stockMovement.findMany({ where, include: { product: { select: { name: true, sku: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.db.stockMovement.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async adjust(storeId: string, input: Adjustment, actorId: string) {
    return this.applyMovement({ storeId, productId: input.productId, type: input.type, delta: input.delta, sourceType: 'MANUAL_ADJUSTMENT', sourceId: randomUUID(), actorId, comment: input.comment });
  }

  async writeOff(storeId: string, input: WriteOff, actorId: string) {
    return this.applyMovement({ storeId, productId: input.productId, type: 'WRITE_OFF', delta: -input.quantity, sourceType: 'MANUAL_WRITE_OFF', sourceId: input.operationId, actorId, comment: input.comment });
  }

  async applyMovement(input: MovementInput) {
    if (!input.sourceType || !input.sourceId) throw new BadRequestException('Movement source is required');
    nextQuantity(0, input.delta, input.type);
    await this.requireStore(input.storeId);
    const product = await this.db.product.findFirst({ where: { id: input.productId, deletedAt: null } });
    if (!product) throw new NotFoundException('Product not found');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction((tx) => this.applyMovementInTransaction(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002') && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('Could not update stock');
  }

  async applyMovementInTransaction(tx: Prisma.TransactionClient, input: MovementInput) {
    if (!input.sourceType || !input.sourceId) throw new BadRequestException('Movement source is required');
    const source = { storeId: input.storeId, productId: input.productId, type: input.type, sourceType: input.sourceType, sourceId: input.sourceId };
    const manualWriteOff = input.type === 'WRITE_OFF' && input.sourceType === 'MANUAL_WRITE_OFF';
    const existing = await tx.stockMovement.findFirst({ where: manualWriteOff ? { sourceType: input.sourceType, sourceId: input.sourceId } : source });
    if (existing) {
      if (existing.quantity !== input.delta || manualWriteOff && (existing.storeId !== input.storeId || existing.productId !== input.productId || existing.comment !== input.comment)) throw new ConflictException('Movement source already used with different details');
      return existing;
    }
    let stock = await tx.stock.findUnique({ where: { storeId_productId: { storeId: input.storeId, productId: input.productId } } });
    if (!stock) stock = await tx.stock.create({ data: { storeId: input.storeId, productId: input.productId } });
    if (input.type === 'WRITE_OFF' && -input.delta > stock.quantity - stock.reservedQuantity) throw new ConflictException('Insufficient available stock for write-off');
    const quantity = nextQuantity(stock.quantity, input.delta, input.type);
    await tx.stock.update({ where: { storeId_productId: { storeId: input.storeId, productId: input.productId } }, data: { quantity } });
    const movement = await tx.stockMovement.create({ data: { ...source, quantity: input.delta, previousQuantity: stock.quantity, newQuantity: quantity, employeeId: input.actorId, comment: input.comment } });
    await tx.auditLog.create({ data: { userId: input.actorId, action: 'STOCK_CHANGED', entityType: 'Stock', entityId: `${input.storeId}:${input.productId}`, oldValue: { quantity: stock.quantity }, newValue: { quantity, movementId: movement.id, sourceType: input.sourceType, sourceId: input.sourceId } } });
    return movement;
  }
}
