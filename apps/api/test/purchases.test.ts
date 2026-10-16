import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchasesService } from '../src/purchases/purchases.service';
import type { DatabaseService } from '../src/database.service';
import type { StockService } from '../src/stock/stock.service';

const itemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const purchaseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const storeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const operationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const purchase = { id: purchaseId, storeId, supplierId: 'supplier-1', status: 'ORDERED', receivedMinor: new Prisma.Decimal(0), items: [{ id: itemId, productId: 'product-1', quantityOrdered: 4, quantityReceived: 1, purchasePriceMinor: new Prisma.Decimal(125) }] };

test('receiving rejects excess quantity before creating records', async () => {
  let writes = 0;
  const tx = {
    receiving: { findUnique: async () => null, create: async () => { writes++; } },
    purchase: { findFirst: async () => purchase },
  };
  const db = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: async () => { writes++; } } as unknown as StockService;
  const service = new PurchasesService(db, stock);
  await assert.rejects(service.receive(storeId, purchaseId, { operationId, items: [{ purchaseItemId: itemId, quantity: 4, batchNumber: 'B1' }] }, 'user-1'), ConflictException);
  assert.equal(writes, 0);
});

test('receiving rejects duplicate batches before creating records', async () => {
  let writes = 0;
  const tx = {
    receiving: { findUnique: async () => null, create: async () => { writes++; } },
    purchase: { findFirst: async () => purchase },
  };
  const db = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const service = new PurchasesService(db, {} as StockService);
  await assert.rejects(service.receive(storeId, purchaseId, { operationId, items: [{ purchaseItemId: itemId, quantity: 1, batchNumber: 'B1' }, { purchaseItemId: itemId, quantity: 1, batchNumber: 'B1' }] }, 'user-1'), BadRequestException);
  assert.equal(writes, 0);
});

test('receiving replays the same operation without changing stock', async () => {
  const existing = { id: 'receipt-1', requestHash: 'ignored', items: [] };
  let writes = 0;
  const tx = { purchase: { findFirst: async () => purchase }, receiving: { findUnique: async () => ({ ...existing, requestHash: expectedHash }) } };
  const db = { $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const service = new PurchasesService(db, { applyMovementInTransaction: async () => { writes++; } } as unknown as StockService);
  const input = { operationId, items: [{ purchaseItemId: itemId, quantity: 1, batchNumber: 'B1' }] };
  const { createHash } = await import('node:crypto');
  const expectedHash = createHash('sha256').update(JSON.stringify([{ ...input.items[0], manufacturedAt: null, expiresAt: null }])).digest('hex');
  assert.equal((await service.receive(storeId, purchaseId, input, 'user-1')).id, existing.id);
  assert.equal(writes, 0);
});
