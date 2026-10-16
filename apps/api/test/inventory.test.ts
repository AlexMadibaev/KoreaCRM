import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { InventoryService } from '../src/inventory/inventory.service';
import type { DatabaseService } from '../src/database.service';
import type { StockService } from '../src/stock/stock.service';

const item = { id: 'item-1', productId: 'product-1', expectedQuantity: 5, actualQuantity: 3 };
const inventory = { id: 'inventory-1', status: 'IN_PROGRESS', items: [item] };

test('completion rejects a stock change since the snapshot without moving stock', async () => {
  let movements = 0;
  const tx = { inventory: { findFirst: async () => inventory }, stock: { findMany: async () => [{ productId: 'product-1', quantity: 6 }] } };
  const db = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: async () => { movements++; } } as unknown as StockService;
  await assert.rejects(new InventoryService(db, stock).complete('store-1', 'inventory-1', 'user-1'), ConflictException);
  assert.equal(movements, 0);
});

test('completion records the exact difference and closes the inventory', async () => {
  const movements: Array<{ delta: number; sourceId: string }> = [];
  let status = 'IN_PROGRESS';
  const tx = {
    inventory: { findFirst: async () => inventory, update: async ({ data }: { data: { status: string } }) => { status = data.status; }, findUniqueOrThrow: async () => ({ ...inventory, status }) },
    stock: { findMany: async () => [{ productId: 'product-1', quantity: 5 }] },
    inventoryItem: { update: async () => ({}) }, auditLog: { create: async () => ({}) },
  };
  const db = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: async (_tx: unknown, input: { delta: number; sourceId: string }) => { movements.push(input); } } as unknown as StockService;
  const result = await new InventoryService(db, stock).complete('store-1', 'inventory-1', 'user-1');
  assert.equal(movements.length, 1);
  assert.equal(movements[0]?.delta, -2);
  assert.equal(movements[0]?.sourceId, 'item-1');
  assert.equal(result.status, 'COMPLETED');
});
