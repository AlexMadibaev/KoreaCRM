import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseStatus } from '@prisma/client';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import { StockService } from '../stock/stock.service';
import { listSchema, purchasePatchSchema, purchaseSchema, receivingSchema, supplierPatchSchema, supplierSchema } from './purchases.schemas';

type List = z.infer<typeof listSchema>;
type SupplierInput = z.infer<typeof supplierSchema>;
type PurchaseInput = z.infer<typeof purchaseSchema>;
type ReceivingInput = z.infer<typeof receivingSchema>;
const includePurchase = { supplier: { select: { id: true, name: true } }, items: { include: { product: { select: { id: true, name: true, sku: true } }, batches: true } }, receivings: { include: { items: true }, orderBy: { createdAt: 'desc' as const } } };
const decimal = (value: string) => new Prisma.Decimal(value);

function total(items: PurchaseInput['items']) {
  const value = items.reduce((sum, item) => sum.plus(decimal(item.purchasePriceMinor).mul(item.quantityOrdered)), new Prisma.Decimal(0));
  if (value.gt('999999999999999999')) throw new BadRequestException('Purchase total exceeds database range');
  return value;
}
function retryable(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code); }

@Injectable()
export class PurchasesService {
  constructor(private readonly db: DatabaseService, private readonly stock: StockService) {}

  async suppliers(query: List) {
    const where: Prisma.SupplierWhereInput = { deletedAt: null, name: query.search ? { contains: query.search, mode: 'insensitive' } : undefined };
    const [items, count] = await this.db.$transaction([this.db.supplier.findMany({ where, orderBy: { name: 'asc' }, skip: (query.page - 1) * query.limit, take: query.limit }), this.db.supplier.count({ where })]);
    return { items, total: count, page: query.page, limit: query.limit };
  }
  async supplier(id: string) {
    const item = await this.db.supplier.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Supplier not found');
    return item;
  }
  async createSupplier(input: SupplierInput, actorId: string) {
    return this.db.$transaction(async (tx) => {
      const item = await tx.supplier.create({ data: input });
      await tx.auditLog.create({ data: { userId: actorId, action: 'SUPPLIER_CREATED', entityType: 'Supplier', entityId: item.id, newValue: { name: item.name } } });
      return item;
    });
  }
  async updateSupplier(id: string, input: z.infer<typeof supplierPatchSchema>, actorId: string) {
    await this.supplier(id);
    return this.db.$transaction(async (tx) => {
      const item = await tx.supplier.update({ where: { id }, data: input });
      await tx.auditLog.create({ data: { userId: actorId, action: 'SUPPLIER_UPDATED', entityType: 'Supplier', entityId: id, newValue: { name: item.name, status: item.status } } });
      return item;
    });
  }
  async deleteSupplier(id: string, actorId: string) {
    await this.supplier(id);
    const active = await this.db.purchase.count({ where: { supplierId: id, status: { in: ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED'] } } });
    if (active) throw new ConflictException('Supplier has open purchases');
    return this.db.$transaction(async (tx) => {
      const item = await tx.supplier.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE' } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'SUPPLIER_DELETED', entityType: 'Supplier', entityId: id } });
      return item;
    });
  }
  private async requireStore(storeId: string) {
    if (!await this.db.store.findFirst({ where: { id: storeId, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Store not found');
  }
  async purchases(storeId: string, query: List) {
    await this.requireStore(storeId);
    const where: Prisma.PurchaseWhereInput = { storeId, OR: query.search ? [{ number: { contains: query.search, mode: 'insensitive' } }, { supplier: { name: { contains: query.search, mode: 'insensitive' } } }] : undefined };
    const [items, count] = await this.db.$transaction([this.db.purchase.findMany({ where, include: { supplier: { select: { id: true, name: true } }, _count: { select: { items: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }), this.db.purchase.count({ where })]);
    return { items, total: count, page: query.page, limit: query.limit };
  }
  async purchase(storeId: string, id: string) {
    const item = await this.db.purchase.findFirst({ where: { id, storeId }, include: includePurchase });
    if (!item) throw new NotFoundException('Purchase not found');
    return item;
  }
  private async validateItems(input: PurchaseInput) {
    const productIds = input.items.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) throw new BadRequestException('Duplicate product');
    const count = await this.db.product.count({ where: { id: { in: productIds }, deletedAt: null } });
    if (count !== productIds.length) throw new BadRequestException('Unknown product');
    const supplier = await this.supplier(input.supplierId);
    if (supplier.status !== 'ACTIVE') throw new BadRequestException('Supplier is inactive');
  }
  async createPurchase(storeId: string, input: PurchaseInput, actorId: string) {
    await this.requireStore(storeId);
    await this.validateItems(input);
    try {
      return await this.db.$transaction(async (tx) => {
        const item = await tx.purchase.create({ data: { storeId, supplierId: input.supplierId, number: input.number, createdById: actorId, totalMinor: total(input.items), items: { create: input.items.map((row) => ({ productId: row.productId, quantityOrdered: row.quantityOrdered, purchasePriceMinor: decimal(row.purchasePriceMinor), salePriceMinor: row.salePriceMinor == null ? null : decimal(row.salePriceMinor) })) } }, include: includePurchase });
        await tx.auditLog.create({ data: { userId: actorId, action: 'PURCHASE_CREATED', entityType: 'Purchase', entityId: item.id, newValue: { number: item.number, totalMinor: item.totalMinor.toString() } } });
        return item;
      });
    } catch (error) { if (retryable(error)) throw new ConflictException('Purchase number already exists'); throw error; }
  }
  async updatePurchase(storeId: string, id: string, patch: z.infer<typeof purchasePatchSchema>, actorId: string) {
    const current = await this.purchase(storeId, id);
    if (current.status !== 'DRAFT') throw new ConflictException('Only draft purchases can be edited');
    const input: PurchaseInput = { supplierId: patch.supplierId ?? current.supplierId, number: patch.number ?? current.number, items: patch.items ?? current.items.map((row) => ({ productId: row.productId, quantityOrdered: row.quantityOrdered, purchasePriceMinor: row.purchasePriceMinor.toString(), salePriceMinor: row.salePriceMinor?.toString() ?? null })) };
    await this.validateItems(input);
    try {
      return await this.db.$transaction(async (tx) => {
        const guard = await tx.purchase.updateMany({ where: { id, storeId, status: 'DRAFT' }, data: { supplierId: input.supplierId, number: input.number, totalMinor: total(input.items) } });
        if (!guard.count) throw new ConflictException('Purchase changed');
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
        await tx.purchaseItem.createMany({ data: input.items.map((row) => ({ purchaseId: id, productId: row.productId, quantityOrdered: row.quantityOrdered, purchasePriceMinor: decimal(row.purchasePriceMinor), salePriceMinor: row.salePriceMinor == null ? null : decimal(row.salePriceMinor) })) });
        await tx.auditLog.create({ data: { userId: actorId, action: 'PURCHASE_UPDATED', entityType: 'Purchase', entityId: id } });
        return tx.purchase.findUniqueOrThrow({ where: { id }, include: includePurchase });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { if (retryable(error)) throw new ConflictException('Purchase changed or number exists'); throw error; }
  }
  async transition(storeId: string, id: string, status: 'ORDERED' | 'CANCELLED', actorId: string) {
    const item = await this.purchase(storeId, id);
    if (status === 'ORDERED' && item.status !== 'DRAFT' || status === 'CANCELLED' && !['DRAFT', 'ORDERED'].includes(item.status)) throw new ConflictException('Invalid purchase status');
    if (status === 'CANCELLED' && item.receivings.length) throw new ConflictException('Received purchase cannot be cancelled');
    return this.db.$transaction(async (tx) => {
      const updated = await tx.purchase.updateMany({ where: { id, storeId, status: item.status }, data: { status } });
      if (!updated.count) throw new ConflictException('Purchase changed');
      await tx.auditLog.create({ data: { userId: actorId, action: `PURCHASE_${status}`, entityType: 'Purchase', entityId: id } });
      return tx.purchase.findUniqueOrThrow({ where: { id }, include: includePurchase });
    });
  }
  async receive(storeId: string, id: string, input: ReceivingInput, actorId: string) {
    const normalized = input.items.map((row) => ({ ...row, manufacturedAt: row.manufacturedAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null })).sort((a, b) => `${a.purchaseItemId}:${a.batchNumber}`.localeCompare(`${b.purchaseItemId}:${b.batchNumber}`));
    const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(async (tx) => {
          const purchase = await tx.purchase.findFirst({ where: { id, storeId }, include: { items: true } });
          if (!purchase) throw new NotFoundException('Purchase not found');
          const existing = await tx.receiving.findUnique({ where: { purchaseId_operationId: { purchaseId: id, operationId: input.operationId } }, include: { items: true } });
          if (existing) { if (existing.requestHash !== requestHash) throw new ConflictException('Operation ID was used for different receipt'); return existing; }
          if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(purchase.status)) throw new ConflictException('Purchase is not open for receiving');
          const ordered = new Map(purchase.items.map((row) => [row.id, row]));
          const quantities = new Map<string, number>();
          const batchKeys = new Set<string>();
          for (const row of input.items) {
            if (!ordered.has(row.purchaseItemId)) throw new BadRequestException('Item does not belong to purchase');
            const batchKey = `${row.purchaseItemId}:${row.batchNumber}`;
            if (batchKeys.has(batchKey)) throw new BadRequestException('Duplicate batch in receipt');
            batchKeys.add(batchKey);
            if (row.expiresAt && row.manufacturedAt && row.expiresAt <= row.manufacturedAt) throw new BadRequestException('Expiry must follow manufacture');
            quantities.set(row.purchaseItemId, (quantities.get(row.purchaseItemId) ?? 0) + row.quantity);
          }
          for (const [itemId, quantity] of quantities) {
            const item = ordered.get(itemId)!;
            if (item.quantityReceived + quantity > item.quantityOrdered) throw new ConflictException('Received quantity exceeds ordered quantity');
          }
          const pendingCost = input.items.reduce((sum, row) => sum.plus(ordered.get(row.purchaseItemId)!.purchasePriceMinor.mul(row.quantity)), new Prisma.Decimal(0));
          if (purchase.receivedMinor.plus(pendingCost).gt('999999999999999999')) throw new BadRequestException('Received total exceeds database range');
          const receiving = await tx.receiving.create({ data: { purchaseId: id, operationId: input.operationId, requestHash, createdById: actorId } });
          let receivedCost = new Prisma.Decimal(0);
          for (const row of input.items) {
            const item = ordered.get(row.purchaseItemId)!;
            const oldBatch = await tx.productBatch.findUnique({ where: { purchaseItemId_batchNumber: { purchaseItemId: item.id, batchNumber: row.batchNumber } } });
            if (oldBatch && (oldBatch.manufacturedAt?.getTime() ?? null) !== (row.manufacturedAt?.getTime() ?? null) || oldBatch && (oldBatch.expiresAt?.getTime() ?? null) !== (row.expiresAt?.getTime() ?? null)) throw new ConflictException('Batch dates differ from existing batch');
            const batch = await tx.productBatch.upsert({ where: { purchaseItemId_batchNumber: { purchaseItemId: item.id, batchNumber: row.batchNumber } }, create: { purchaseItemId: item.id, productId: item.productId, supplierId: purchase.supplierId, storeId, batchNumber: row.batchNumber, purchasePriceMinor: item.purchasePriceMinor, quantity: row.quantity, manufacturedAt: row.manufacturedAt, expiresAt: row.expiresAt }, update: { quantity: { increment: row.quantity } } });
            const receiptItem = await tx.receivingItem.create({ data: { receivingId: receiving.id, purchaseItemId: item.id, batchId: batch.id, quantity: row.quantity, purchasePriceMinor: item.purchasePriceMinor } });
            await this.stock.applyMovementInTransaction(tx, { storeId, productId: item.productId, type: 'PURCHASE', delta: row.quantity, sourceType: 'RECEIVING_ITEM', sourceId: receiptItem.id, actorId });
            receivedCost = receivedCost.plus(item.purchasePriceMinor.mul(row.quantity));
          }
          for (const [itemId, quantity] of quantities) await tx.purchaseItem.update({ where: { id: itemId }, data: { quantityReceived: { increment: quantity } } });
          const complete = purchase.items.every((item) => item.quantityReceived + (quantities.get(item.id) ?? 0) === item.quantityOrdered);
          const status: PurchaseStatus = complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
          await tx.purchase.update({ where: { id }, data: { status, receivedMinor: { increment: receivedCost }, debtMinor: { increment: receivedCost } } });
          await tx.supplier.update({ where: { id: purchase.supplierId }, data: { balanceMinor: { increment: receivedCost } } });
          await tx.auditLog.create({ data: { userId: actorId, action: 'PURCHASE_RECEIVED', entityType: 'Purchase', entityId: id, newValue: { receivingId: receiving.id, costMinor: receivedCost.toString(), status } } });
          return tx.receiving.findUniqueOrThrow({ where: { id: receiving.id }, include: { items: true } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (retryable(error) && attempt < 2) continue;
        if (retryable(error)) throw new ConflictException('Receiving conflicted with another operation');
        throw error;
      }
    }
    throw new ConflictException('Receiving could not be completed');
  }
}
