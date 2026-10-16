import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { canAccessStore, type AccessContext } from '../auth/policy';
import { DatabaseService } from '../database.service';
import { StockService } from '../stock/stock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { createSchema, editSchema, listSchema, receiveSchema } from './transfers.schemas';

type Create = z.infer<typeof createSchema>;
type Edit = z.infer<typeof editSchema>;
type List = z.infer<typeof listSchema>;
type Receive = z.infer<typeof receiveSchema>;
const includeTransfer = { fromStore: { select: { id: true, name: true } }, toStore: { select: { id: true, name: true } }, items: { include: { product: { select: { id: true, name: true, sku: true } } } }, receipts: { include: { items: true }, orderBy: { createdAt: 'desc' as const } } };

function assertStore(access: AccessContext, storeId: string) {
  if (!canAccessStore(access, storeId)) throw new ForbiddenException('Store access denied');
}
function retryable(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code); }

@Injectable()
export class TransfersService {
  constructor(private readonly db: DatabaseService, private readonly stock: StockService, private readonly notifications: NotificationsService) {}

  async stores() { return this.db.store.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }); }
  private async requireStore(id: string) { if (!await this.db.store.findFirst({ where: { id, deletedAt: null, status: 'ACTIVE' }, select: { id: true } })) throw new NotFoundException('Store not found'); }
  private async validateItems(items: Create['items']) {
    const productIds = items.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) throw new BadRequestException('Duplicate product');
    if (await this.db.product.count({ where: { id: { in: productIds }, deletedAt: null, status: 'ACTIVE' } }) !== productIds.length) throw new BadRequestException('Unknown or inactive product');
  }
  async list(query: List, access: AccessContext) {
    if (query.storeId) assertStore(access, query.storeId);
    const where: Prisma.TransferWhereInput = query.storeId
      ? { OR: [{ fromStoreId: query.storeId }, { toStoreId: query.storeId }] }
      : access.allStores ? {} : { OR: [{ fromStoreId: { in: access.storeIds } }, { toStoreId: { in: access.storeIds } }] };
    const [items, total] = await this.db.$transaction([this.db.transfer.findMany({ where, include: { fromStore: { select: { id: true, name: true } }, toStore: { select: { id: true, name: true } }, _count: { select: { items: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }), this.db.transfer.count({ where })]);
    return { items, total, page: query.page, limit: query.limit };
  }
  async get(id: string, access: AccessContext) {
    const transfer = await this.db.transfer.findUnique({ where: { id }, include: includeTransfer });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (!canAccessStore(access, transfer.fromStoreId) && !canAccessStore(access, transfer.toStoreId)) throw new ForbiddenException('Store access denied');
    return transfer;
  }
  async create(input: Create, access: AccessContext) {
    assertStore(access, input.fromStoreId);
    if (input.fromStoreId === input.toStoreId) throw new BadRequestException('Source and destination must differ');
    await Promise.all([this.requireStore(input.fromStoreId), this.requireStore(input.toStoreId), this.validateItems(input.items)]);
    return this.db.$transaction(async (tx) => {
      const item = await tx.transfer.create({ data: { fromStoreId: input.fromStoreId, toStoreId: input.toStoreId, createdById: access.userId, items: { create: input.items } }, include: includeTransfer });
      await tx.auditLog.create({ data: { userId: access.userId, action: 'TRANSFER_CREATED', entityType: 'Transfer', entityId: item.id, newValue: { fromStoreId: input.fromStoreId, toStoreId: input.toStoreId, itemCount: input.items.length } } });
      return item;
    });
  }
  async edit(id: string, patch: Edit, access: AccessContext) {
    const current = await this.get(id, access);
    assertStore(access, current.fromStoreId);
    if (current.status !== 'DRAFT') throw new ConflictException('Only drafts can be edited');
    const toStoreId = patch.toStoreId ?? current.toStoreId;
    if (toStoreId === current.fromStoreId) throw new BadRequestException('Source and destination must differ');
    await this.requireStore(toStoreId);
    if (patch.items) await this.validateItems(patch.items);
    try {
      return await this.db.$transaction(async (tx) => {
        const guard = await tx.transfer.updateMany({ where: { id, status: 'DRAFT' }, data: { toStoreId } });
        if (!guard.count) throw new ConflictException('Transfer changed');
        if (patch.items) {
          await tx.transferItem.deleteMany({ where: { transferId: id } });
          await tx.transferItem.createMany({ data: patch.items.map((row) => ({ transferId: id, ...row })) });
        }
        await tx.auditLog.create({ data: { userId: access.userId, action: 'TRANSFER_UPDATED', entityType: 'Transfer', entityId: id } });
        return tx.transfer.findUniqueOrThrow({ where: { id }, include: includeTransfer });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) { if (retryable(error)) throw new ConflictException('Transfer changed'); throw error; }
  }
  async transition(id: string, next: 'REQUESTED' | 'APPROVED' | 'CANCELLED', access: AccessContext) {
    const current = await this.get(id, access);
    assertStore(access, current.fromStoreId);
    const allowed = next === 'REQUESTED' ? ['DRAFT'] : next === 'APPROVED' ? ['REQUESTED'] : ['DRAFT', 'REQUESTED', 'APPROVED'];
    if (!allowed.includes(current.status)) throw new ConflictException('Invalid transfer status');
    if (next === 'REQUESTED' && !current.items.length) throw new ConflictException('Transfer has no items');
    return this.db.$transaction(async (tx) => {
      const data: Prisma.TransferUpdateManyMutationInput = { status: next };
      if (next === 'APPROVED') Object.assign(data, { approvedById: access.userId, approvedAt: new Date() });
      if (next === 'CANCELLED') Object.assign(data, { cancelledAt: new Date() });
      const guard = await tx.transfer.updateMany({ where: { id, status: current.status }, data });
      if (!guard.count) throw new ConflictException('Transfer changed');
      await tx.auditLog.create({ data: { userId: access.userId, action: `TRANSFER_${next}`, entityType: 'Transfer', entityId: id } });
      const updated = await tx.transfer.findUniqueOrThrow({ where: { id }, include: includeTransfer });
      await this.notifications.recordTransfer(tx, updated, next);
      return updated;
    });
  }
  async send(id: string, access: AccessContext) {
    const current = await this.get(id, access);
    assertStore(access, current.fromStoreId);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(async (tx) => {
          const transfer = await tx.transfer.findUnique({ where: { id }, include: { items: true } });
          if (!transfer) throw new NotFoundException('Transfer not found');
          if (transfer.status !== 'APPROVED') throw new ConflictException('Transfer is not approved');
          if (!transfer.items.length) throw new ConflictException('Transfer has no items');
          for (const item of transfer.items) {
            const stock = await tx.stock.findUnique({ where: { storeId_productId: { storeId: transfer.fromStoreId, productId: item.productId } } });
            if (!stock || stock.quantity - stock.reservedQuantity < item.quantity) throw new ConflictException('Insufficient available stock');
            await this.stock.applyMovementInTransaction(tx, { storeId: transfer.fromStoreId, productId: item.productId, type: 'TRANSFER_OUT', delta: -item.quantity, sourceType: 'TRANSFER_ITEM', sourceId: item.id, actorId: access.userId });
          }
          await tx.transfer.update({ where: { id }, data: { status: 'IN_TRANSIT', sentById: access.userId, sentAt: new Date() } });
          await tx.auditLog.create({ data: { userId: access.userId, action: 'TRANSFER_SENT', entityType: 'Transfer', entityId: id } });
          const updated = await tx.transfer.findUniqueOrThrow({ where: { id }, include: includeTransfer });
          await this.notifications.recordTransfer(tx, updated, 'IN_TRANSIT');
          return updated;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) { if (retryable(error) && attempt < 2) continue; if (retryable(error)) throw new ConflictException('Transfer send conflicted'); throw error; }
    }
    throw new ConflictException('Transfer could not be sent');
  }
  async receive(id: string, input: Receive, access: AccessContext) {
    const normalized = [...input.items].sort((a, b) => a.transferItemId.localeCompare(b.transferItemId));
    const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(async (tx) => {
          const transfer = await tx.transfer.findUnique({ where: { id }, include: { items: true } });
          if (!transfer) throw new NotFoundException('Transfer not found');
          assertStore(access, transfer.toStoreId);
          const existing = await tx.transferReceipt.findUnique({ where: { transferId_operationId: { transferId: id, operationId: input.operationId } }, include: { items: true } });
          if (existing) { if (existing.requestHash !== requestHash) throw new ConflictException('Operation ID was used for different receipt'); return existing; }
          if (transfer.status !== 'IN_TRANSIT') throw new ConflictException('Transfer is not in transit');
          const byId = new Map(transfer.items.map((item) => [item.id, item]));
          const seen = new Set<string>();
          for (const row of input.items) {
            const item = byId.get(row.transferItemId);
            if (!item) throw new BadRequestException('Item does not belong to transfer');
            if (seen.has(row.transferItemId)) throw new BadRequestException('Duplicate transfer item');
            seen.add(row.transferItemId);
            if (item.receivedQuantity + row.quantity > item.quantity) throw new ConflictException('Received quantity exceeds sent quantity');
          }
          const receipt = await tx.transferReceipt.create({ data: { transferId: id, operationId: input.operationId, requestHash, receivedById: access.userId } });
          for (const row of input.items) {
            const item = byId.get(row.transferItemId)!;
            const receiptItem = await tx.transferReceiptItem.create({ data: { receiptId: receipt.id, transferItemId: item.id, quantity: row.quantity } });
            await this.stock.applyMovementInTransaction(tx, { storeId: transfer.toStoreId, productId: item.productId, type: 'TRANSFER_IN', delta: row.quantity, sourceType: 'TRANSFER_RECEIPT_ITEM', sourceId: receiptItem.id, actorId: access.userId });
            await tx.transferItem.update({ where: { id: item.id }, data: { receivedQuantity: { increment: row.quantity } } });
          }
          const complete = transfer.items.every((item) => item.receivedQuantity + (normalized.find((row) => row.transferItemId === item.id)?.quantity ?? 0) === item.quantity);
          if (complete) await tx.transfer.update({ where: { id }, data: { status: 'RECEIVED', receivedById: access.userId, receivedAt: new Date() } });
          await tx.auditLog.create({ data: { userId: access.userId, action: 'TRANSFER_RECEIVED', entityType: 'Transfer', entityId: id, newValue: { receiptId: receipt.id, complete } } });
          await this.notifications.recordTransfer(tx, transfer, complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED', receipt.id);
          return tx.transferReceipt.findUniqueOrThrow({ where: { id: receipt.id }, include: { items: true } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) { if (retryable(error) && attempt < 2) continue; if (retryable(error)) throw new ConflictException('Transfer receipt conflicted'); throw error; }
    }
    throw new ConflictException('Transfer could not be received');
  }
}
