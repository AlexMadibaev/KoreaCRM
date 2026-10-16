import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { TransfersService } from '../src/transfers/transfers.service';
import type { DatabaseService } from '../src/database.service';
import type { StockService } from '../src/stock/stock.service';
import type { NotificationsService } from '../src/notifications/notifications.service';

const access = { userId: 'user-1', permissions: ['transfers.send', 'transfers.receive'], allStores: false, storeIds: ['source-1'] };
const transfer = { id: 'transfer-1', fromStoreId: 'source-1', toStoreId: 'destination-1', status: 'APPROVED', items: [{ id: 'item-1', productId: 'product-1', quantity: 4, receivedQuantity: 0 }] };
const notifications = { recordTransfer: async () => {} } as unknown as NotificationsService;

test('sending refuses insufficient available stock before writing movements', async () => {
  let movements = 0;
  const tx = { transfer: { findUnique: async () => transfer }, stock: { findUnique: async () => ({ quantity: 4, reservedQuantity: 1 }) } };
  const db = { transfer: { findUnique: async () => transfer }, $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: async () => { movements++; } } as unknown as StockService;
  await assert.rejects(new TransfersService(db, stock, notifications).send(transfer.id, access), ConflictException);
  assert.equal(movements, 0);
});

test('sending records one source movement and marks transfer in transit', async () => {
  const movements: Array<{ storeId: string; delta: number; sourceId: string }> = [];
  let status = 'APPROVED';
  const tx = {
    transfer: { findUnique: async () => transfer, update: async ({ data }: { data: { status: string } }) => { status = data.status; }, findUniqueOrThrow: async () => ({ ...transfer, status }) },
    stock: { findUnique: async () => ({ quantity: 5, reservedQuantity: 1 }) }, auditLog: { create: async () => ({}) },
  };
  const db = { transfer: { findUnique: async () => transfer }, $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: async (_tx: unknown, movement: { storeId: string; delta: number; sourceId: string }) => { movements.push(movement); } } as unknown as StockService;
  const result = await new TransfersService(db, stock, notifications).send(transfer.id, access);
  assert.equal(result.status, 'IN_TRANSIT');
  assert.equal(movements.length, 1);
  assert.equal(movements[0]?.storeId, 'source-1');
  assert.equal(movements[0]?.delta, -4);
  assert.equal(movements[0]?.sourceId, 'item-1');
});

test('only destination store can receive a transfer', async () => {
  const db = { $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({ transfer: { findUnique: async () => ({ ...transfer, status: 'IN_TRANSIT' }) } }) } as unknown as DatabaseService;
  const service = new TransfersService(db, {} as StockService, notifications);
  await assert.rejects(service.receive(transfer.id, { operationId: 'operation-1', items: [{ transferItemId: 'item-1', quantity: 1 }] }, access), ForbiddenException);
});

test('partial receipt updates destination stock once and leaves transfer in transit', async () => {
  let receivedQuantity = 0;
  let movements = 0;
  const inTransit = { ...transfer, status: 'IN_TRANSIT' };
  const tx = {
    transfer: { findUnique: async () => inTransit, update: async () => { throw new Error('Partial receipt must not close transfer'); } },
    transferReceipt: { findUnique: async () => null, create: async () => ({ id: 'receipt-1' }), findUniqueOrThrow: async () => ({ id: 'receipt-1' }) },
    transferReceiptItem: { create: async () => ({ id: 'receipt-item-1' }) },
    transferItem: { update: async ({ data }: { data: { receivedQuantity: { increment: number } } }) => { receivedQuantity += data.receivedQuantity.increment; } },
    auditLog: { create: async () => ({}) },
  };
  const db = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: async (_tx: unknown, movement: { storeId: string; delta: number }) => { assert.equal(movement.storeId, 'destination-1'); assert.equal(movement.delta, 2); movements++; } } as unknown as StockService;
  const recipient = { ...access, storeIds: ['destination-1'] };
  const result = await new TransfersService(db, stock, notifications).receive(transfer.id, { operationId: 'operation-1', items: [{ transferItemId: 'item-1', quantity: 2 }] }, recipient);
  assert.equal(result.id, 'receipt-1');
  assert.equal(receivedQuantity, 2);
  assert.equal(movements, 1);
});

test('repeated receipt operation returns the prior result without another movement', async () => {
  const items = [{ transferItemId: 'item-1', quantity: 2 }];
  const requestHash = createHash('sha256').update(JSON.stringify(items)).digest('hex');
  let movements = 0;
  const tx = { transfer: { findUnique: async () => ({ ...transfer, status: 'RECEIVED' }) }, transferReceipt: { findUnique: async () => ({ id: 'receipt-1', requestHash, items }) } };
  const db = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: async () => { movements++; } } as unknown as StockService;
  const recipient = { ...access, storeIds: ['destination-1'] };
  const result = await new TransfersService(db, stock, notifications).receive(transfer.id, { operationId: 'operation-1', items }, recipient);
  assert.equal(result.id, 'receipt-1');
  assert.equal(movements, 0);
});
