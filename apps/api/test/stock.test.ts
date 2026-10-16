import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { nextQuantity, StockService } from '../src/stock/stock.service';
import type { DatabaseService } from '../src/database.service';

test('movement direction is enforced and negative stock is detectable', () => {
  assert.equal(nextQuantity(0, -3, StockMovementType.CORRECTION), -3);
  assert.equal(nextQuantity(5, -2, StockMovementType.SALE), 3);
  assert.throws(() => nextQuantity(5, 2, StockMovementType.SALE), BadRequestException);
  assert.throws(() => nextQuantity(5, -2, StockMovementType.PURCHASE), BadRequestException);
  assert.throws(() => nextQuantity(5, 0, StockMovementType.CORRECTION), BadRequestException);
});

test('a repeated movement source changes stock only once', async () => {
  let quantity = 0;
  let movement: { id: string; quantity: number; previousQuantity: number; newQuantity: number } | null = null;
  let audits = 0;
  const db = {
    store: { findFirst: async () => ({ id: 'store-1' }) },
    product: { findFirst: async () => ({ id: 'product-1' }) },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      stockMovement: {
        findFirst: async () => movement,
        create: async ({ data }: { data: { quantity: number; previousQuantity: number; newQuantity: number } }) => {
          movement = { id: 'movement-1', ...data };
          return movement;
        },
      },
      stock: {
        findUnique: async () => ({ quantity }),
        update: async ({ data }: { data: { quantity: number } }) => { quantity = data.quantity; },
      },
      auditLog: { create: async () => { audits++; } },
    }),
  } as unknown as DatabaseService;
  const service = new StockService(db);
  const input = { storeId: 'store-1', productId: 'product-1', type: StockMovementType.CORRECTION, delta: 5, sourceType: 'MANUAL_ADJUSTMENT', sourceId: 'source-1', actorId: 'user-1' };
  const first = await service.applyMovement(input);
  const second = await service.applyMovement(input);
  assert.deepEqual(second, first);
  assert.equal(quantity, 5);
  assert.equal(audits, 1);
  assert.equal(first.previousQuantity, 0);
  assert.equal(first.newQuantity, 5);
  await assert.rejects(service.applyMovement({ ...input, delta: 6 }), ConflictException);
});

test('write-off cannot consume reserved stock and replay does not subtract twice', async () => {
  let quantity = 5;
  let movement: { id: string; storeId: string; productId: string; quantity: number; previousQuantity: number; newQuantity: number; comment: string } | null = null;
  let audits = 0;
  const db = {
    store: { findFirst: async () => ({ id: 'store-1' }) },
    product: { findFirst: async () => ({ id: 'product-1' }) },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      stockMovement: {
        findFirst: async () => movement,
        create: async ({ data }: { data: { storeId: string; productId: string; quantity: number; previousQuantity: number; newQuantity: number; comment: string } }) => { movement = { id: 'write-off-1', ...data }; return movement; },
      },
      stock: {
        findUnique: async () => ({ quantity, reservedQuantity: 1 }),
        update: async ({ data }: { data: { quantity: number } }) => { quantity = data.quantity; },
      },
      auditLog: { create: async () => { audits++; } },
    }),
  } as unknown as DatabaseService;
  const service = new StockService(db);
  const input = { operationId: 'operation-1', productId: 'product-1', quantity: 4, comment: 'Повреждена упаковка' };
  await assert.rejects(service.writeOff('store-1', { ...input, quantity: 5 }, 'user-1'), ConflictException);
  const first = await service.writeOff('store-1', input, 'user-1');
  const replay = await service.writeOff('store-1', input, 'user-1');
  assert.deepEqual(replay, first);
  assert.equal(quantity, 1);
  assert.equal(audits, 1);
  await assert.rejects(service.writeOff('store-1', { ...input, quantity: 3 }, 'user-1'), ConflictException);
  await assert.rejects(service.writeOff('store-2', input, 'user-1'), ConflictException);
  await assert.rejects(service.writeOff('store-1', { ...input, productId: 'product-2' }, 'user-1'), ConflictException);
});

test('assigned store list does not expose other stores', async () => {
  let where: unknown;
  const db = { store: { findMany: async (query: { where: unknown }) => { where = query.where; return []; } } } as unknown as DatabaseService;
  await new StockService(db).stores({ userId: 'user-1', permissions: ['inventory.view'], allStores: false, storeIds: ['store-1'] });
  assert.deepEqual(where, { deletedAt: null, id: { in: ['store-1'] } });
});
