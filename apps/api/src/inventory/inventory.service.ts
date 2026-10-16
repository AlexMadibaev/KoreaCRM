import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import { StockService } from '../stock/stock.service';
import { countSchema, listSchema, scanSchema } from './inventory.schemas';

type List = z.infer<typeof listSchema>;
type Count = z.infer<typeof countSchema>;
type Scan = z.infer<typeof scanSchema>;
const includeItems = { items: { include: { product: { select: { id: true, name: true, sku: true, barcodes: { select: { value: true } } } } }, orderBy: { product: { name: 'asc' as const } } } };
function checkedDifference(actual: number, expected: number) {
  const difference = actual - expected;
  if (difference < -2_147_483_648 || difference > 2_147_483_647) throw new BadRequestException('Difference exceeds database range');
  return difference;
}

@Injectable()
export class InventoryService {
  constructor(private readonly db: DatabaseService, private readonly stock: StockService) {}

  private async requireStore(storeId: string) {
    if (!await this.db.store.findFirst({ where: { id: storeId, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Store not found');
  }
  async list(storeId: string, query: List) {
    await this.requireStore(storeId);
    const where = { storeId };
    const [items, total] = await this.db.$transaction([this.db.inventory.findMany({ where, include: { _count: { select: { items: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }), this.db.inventory.count({ where })]);
    return { items, total, page: query.page, limit: query.limit };
  }
  async get(storeId: string, id: string) {
    const item = await this.db.inventory.findFirst({ where: { id, storeId }, include: includeItems });
    if (!item) throw new NotFoundException('Inventory not found');
    return item;
  }
  async create(storeId: string, actorId: string) {
    await this.requireStore(storeId);
    try {
      return await this.db.$transaction(async (tx) => {
        if (await tx.inventory.findFirst({ where: { storeId, status: { in: ['DRAFT', 'IN_PROGRESS'] } }, select: { id: true } })) throw new ConflictException('Store already has an open inventory');
        const inventory = await tx.inventory.create({ data: { storeId, createdById: actorId } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'INVENTORY_CREATED', entityType: 'Inventory', entityId: inventory.id, newValue: { storeId } } });
        return inventory;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new ConflictException('Store already has an open inventory'); throw error; }
  }
  async start(storeId: string, id: string, actorId: string) {
    try {
      return await this.db.$transaction(async (tx) => {
        const inventory = await tx.inventory.findFirst({ where: { id, storeId, status: 'DRAFT' }, select: { id: true } });
        if (!inventory) throw new ConflictException('Inventory is not a draft');
        const products = await tx.product.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, select: { id: true } });
        const stocks = await tx.stock.findMany({ where: { storeId }, select: { productId: true, quantity: true } });
        const byProduct = new Map(stocks.map((row) => [row.productId, row.quantity]));
        if (products.length) await tx.inventoryItem.createMany({ data: products.map((product) => ({ inventoryId: inventory.id, productId: product.id, expectedQuantity: byProduct.get(product.id) ?? 0 })) });
        await tx.inventory.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'INVENTORY_STARTED', entityType: 'Inventory', entityId: inventory.id, newValue: { storeId, productCount: products.length } } });
        return tx.inventory.findUniqueOrThrow({ where: { id: inventory.id }, include: includeItems });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new ConflictException('Inventory changed while starting'); throw error; }
  }
  async count(storeId: string, id: string, input: Count, actorId: string) {
    return this.retryCount(async (tx) => {
      const inventory = await tx.inventory.findFirst({ where: { id, storeId }, select: { id: true, status: true } });
      if (!inventory) throw new NotFoundException('Inventory not found');
      if (inventory.status !== 'IN_PROGRESS') throw new ConflictException('Inventory is closed');
      const item = await tx.inventoryItem.findUnique({ where: { inventoryId_productId: { inventoryId: id, productId: input.productId } } });
      if (!item) throw new BadRequestException('Product is not part of inventory');
      const updated = await tx.inventoryItem.update({ where: { id: item.id }, data: { actualQuantity: input.actualQuantity, difference: checkedDifference(input.actualQuantity, item.expectedQuantity) } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'INVENTORY_COUNTED', entityType: 'InventoryItem', entityId: item.id, oldValue: { actualQuantity: item.actualQuantity }, newValue: { actualQuantity: input.actualQuantity } } });
      return updated;
    });
  }
  async scan(storeId: string, id: string, input: Scan, actorId: string) {
    const product = await this.db.productBarcode.findUnique({ where: { value: input.barcode }, select: { productId: true } });
    if (!product) throw new NotFoundException('Barcode not found');
    return this.retryCount(async (tx) => {
      const inventory = await tx.inventory.findFirst({ where: { id, storeId }, select: { status: true } });
      if (!inventory) throw new NotFoundException('Inventory not found');
      if (inventory.status !== 'IN_PROGRESS') throw new ConflictException('Inventory is closed');
      const item = await tx.inventoryItem.findUnique({ where: { inventoryId_productId: { inventoryId: id, productId: product.productId } } });
      if (!item) throw new BadRequestException('Product is not part of inventory');
      const actual = (item.actualQuantity ?? 0) + 1;
      if (actual > 2_147_483_647) throw new BadRequestException('Quantity exceeds database range');
      const updated = await tx.inventoryItem.update({ where: { id: item.id }, data: { actualQuantity: actual, difference: checkedDifference(actual, item.expectedQuantity) } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'INVENTORY_SCANNED', entityType: 'InventoryItem', entityId: item.id, newValue: { barcode: input.barcode, actualQuantity: actual } } });
      return updated;
    });
  }
  private async retryCount<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.db.$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue; throw error; }
    }
    throw new ConflictException('Concurrent inventory count');
  }
  async complete(storeId: string, id: string, actorId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(async (tx) => {
          const inventory = await tx.inventory.findFirst({ where: { id, storeId }, include: { items: true } });
          if (!inventory) throw new NotFoundException('Inventory not found');
          if (inventory.status !== 'IN_PROGRESS') throw new ConflictException('Inventory is closed');
          const stock = await tx.stock.findMany({ where: { storeId }, select: { productId: true, quantity: true } });
          const byProduct = new Map(stock.map((row) => [row.productId, row.quantity]));
          for (const item of inventory.items) if ((byProduct.get(item.productId) ?? 0) !== item.expectedQuantity) throw new ConflictException('Stock changed since inventory started; restart the count');
          for (const item of inventory.items) {
            const actual = item.actualQuantity ?? 0;
            const difference = checkedDifference(actual, item.expectedQuantity);
            if (difference !== 0) await this.stock.applyMovementInTransaction(tx, { storeId, productId: item.productId, type: 'INVENTORY', delta: difference, sourceType: 'INVENTORY_ITEM', sourceId: item.id, actorId });
            await tx.inventoryItem.update({ where: { id: item.id }, data: { actualQuantity: actual, difference } });
          }
          await tx.inventory.update({ where: { id }, data: { status: 'COMPLETED', completedById: actorId, completedAt: new Date() } });
          await tx.auditLog.create({ data: { userId: actorId, action: 'INVENTORY_COMPLETED', entityType: 'Inventory', entityId: id, newValue: { itemCount: inventory.items.length } } });
          return tx.inventory.findUniqueOrThrow({ where: { id }, include: includeItems });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('Inventory could not be completed');
  }
  async cancel(storeId: string, id: string, actorId: string) {
    return this.db.$transaction(async (tx) => {
      const result = await tx.inventory.updateMany({ where: { id, storeId, status: { in: ['DRAFT', 'IN_PROGRESS'] } }, data: { status: 'CANCELLED' } });
      if (!result.count) throw new ConflictException('Inventory is not open');
      await tx.auditLog.create({ data: { userId: actorId, action: 'INVENTORY_CANCELLED', entityType: 'Inventory', entityId: id } });
      return tx.inventory.findUniqueOrThrow({ where: { id }, include: includeItems });
    });
  }
}
