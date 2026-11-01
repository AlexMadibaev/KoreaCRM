import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { CatalogService } from '../src/catalog/catalog.service';
import { productUpdateSchema } from '../src/catalog/catalog.schemas';
import type { DatabaseService } from '../src/database.service';

test('POS catalog revision changes with store stock and scopes store data', async () => {
  const storeId = 'store-a';
  let stockVersion = new Date('2026-01-01T00:00:00Z');
  const staticVersion = { _count: 1, _max: { updatedAt: new Date('2026-01-01T00:00:00Z') } };
  const db = {
    store: { findFirst: async () => ({ id: storeId }) },
    product: { aggregate: async () => staticVersion },
    storeProductSettings: { aggregate: async ({ where }: { where: { storeId: string } }) => { assert.equal(where.storeId, storeId); return staticVersion; } },
    stock: { aggregate: async ({ where }: { where: { storeId: string } }) => { assert.equal(where.storeId, storeId); return { _count: 1, _max: { updatedAt: stockVersion } }; } },
    customer: { aggregate: async () => staticVersion },
    category: { aggregate: async () => staticVersion },
  } as unknown as DatabaseService;
  const service = new CatalogService(db);
  const before = await service.posCatalogRevision(storeId);
  assert.match(before.revision, /^categories-v3\|/);
  stockVersion = new Date('2026-01-02T00:00:00Z');
  const after = await service.posCatalogRevision(storeId);
  assert.notEqual(before.revision, after.revision);
});

test('a partial product update preserves omitted photos, barcodes, status and unit', () => {
  assert.deepEqual(productUpdateSchema.parse({ name: 'New name' }), { name: 'New name' });
  assert.deepEqual(productUpdateSchema.parse({ imageKeys: [], barcodes: [] }), { imageKeys: [], barcodes: [] });
});

test('product create writes barcodes and audit in one transaction', async () => {
  const calls: string[] = [];
  const db = {
    brand: { findFirst: async () => ({ id: 'brand-1' }) },
    category: { findFirst: async () => ({ id: 'category-1' }) },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      product: { create: async ({ data }: { data: { barcodes: { create: { value: string }[] } } }) => {
        calls.push('product');
        assert.equal(data.barcodes.create[0]?.value, '12345');
        return { id: 'product-1', name: 'Cream', sku: 'SKU-1' };
      } },
      auditLog: { create: async ({ data }: { data: { entityId: string } }) => {
        calls.push('audit'); assert.equal(data.entityId, 'product-1');
      } },
    }),
  } as unknown as DatabaseService;
  const service = new CatalogService(db);
  await service.createProduct({ name: 'Cream', sku: 'SKU-1', brandId: 'brand-1', categoryId: 'category-1', unit: 'pcs', status: 'ACTIVE', barcodes: ['12345'], imageKeys: [] }, 'user-1');
  assert.deepEqual(calls, ['product', 'audit']);
});

test('duplicate barcodes are rejected before writing', async () => {
  const service = new CatalogService({} as DatabaseService);
  await assert.rejects(service.createProduct({ name: 'Cream', sku: 'SKU-1', unit: 'pcs', status: 'ACTIVE', barcodes: ['12345', '12345'], imageKeys: [] }, 'user-1'), BadRequestException);
});

test('product update removes old barcodes before inserting replacements', async () => {
  const calls: string[] = [];
  const db = {
    product: { findFirst: async () => ({ id: 'product-1', name: 'Old', sku: 'SKU-1' }) },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      productBarcode: {
        deleteMany: async () => { calls.push('delete'); },
        createMany: async () => { calls.push('create'); },
      },
      product: { update: async () => { calls.push('update'); return { id: 'product-1', name: 'New', sku: 'SKU-1' }; } },
      auditLog: { create: async () => { calls.push('audit'); } },
    }),
  } as unknown as DatabaseService;
  await new CatalogService(db).updateProduct('product-1', { name: 'New', barcodes: ['12345'] }, 'user-1');
  assert.deepEqual(calls, ['delete', 'create', 'update', 'audit']);
});

test('category cannot become its own ancestor', async () => {
  const db = {
    category: { findFirst: async ({ where }: { where: { id: string } }) => where.id === 'parent' ? { id: 'parent', name: 'Parent', parentId: 'child' } : { id: 'child', name: 'Child', parentId: 'parent' } },
  } as unknown as DatabaseService;
  const service = new CatalogService(db);
  await assert.rejects(service.updateCategory('child', { name: 'Child', parentId: 'parent' }, 'user-1'), BadRequestException);
});

test('product list keeps deleted items out and applies exact barcode lookup', async () => {
  let where: unknown;
  const db = {
    product: {
      findMany: (input: { where: unknown }) => { where = input.where; return Promise.resolve([]); },
      count: async () => 0,
    },
    $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
  } as unknown as DatabaseService;
  const service = new CatalogService(db);
  await service.products({ page: 1, limit: 20, barcode: '12345' });
  assert.deepEqual(where, { deletedAt: null, status: undefined, brandId: undefined, categoryId: undefined, sku: undefined, barcodes: { some: { value: '12345' } }, OR: undefined });
});

test('POS catalog returns image, store price and available stock together', async () => {
  let settingsStore = '';
  let stockStore = '';
  const db = {
    store: { findFirst: async () => ({ id: 'store-1' }) },
    product: {
      findMany: async (input: { select: { storeSettings: { where: { storeId: string } }; stocks: { where: { storeId: string } } } }) => {
        settingsStore = input.select.storeSettings.where.storeId;
        stockStore = input.select.stocks.where.storeId;
        return [{ id: 'product-1', name: 'Cream', sku: 'SKU-1', brandId: null, categoryId: null, status: 'ACTIVE', barcodes: [], images: [{ storageKey: 'photo.png' }], storeSettings: [{ priceMinor: 129000, active: true }], stocks: [{ quantity: 5, reservedQuantity: 2 }] }];
      },
      count: async () => 1,
    },
    $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
  } as unknown as DatabaseService;
  const result = await new CatalogService(db).posProducts('store-1', { page: 1, limit: 20 });
  assert.equal(settingsStore, 'store-1');
  assert.equal(stockStore, 'store-1');
  assert.deepEqual(result.items[0], { id: 'product-1', name: 'Cream', sku: 'SKU-1', brandId: null, categoryId: null, status: 'ACTIVE', barcodes: [], images: [{ storageKey: 'photo.png' }], priceMinor: 129000, availableQuantity: 3, active: true });
});

test('POS catalog applies category selection including uncategorized items', async () => {
  const where: Array<{ categoryId?: string | null }> = [];
  const db = {
    store: { findFirst: async () => ({ id: 'store-1' }) },
    product: {
      findMany: async ({ where: filter }: { where: { categoryId?: string | null } }) => { where.push(filter); return []; },
      count: async ({ where: filter }: { where: { categoryId?: string | null } }) => { where.push(filter); return 0; },
    },
    $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
  } as unknown as DatabaseService;
  const service = new CatalogService(db);
  await service.posProducts('store-1', { page: 1, limit: 20, categoryId: 'category-1' });
  await service.posProducts('store-1', { page: 1, limit: 20, uncategorized: 'true' });
  assert.deepEqual(where.map(filter => filter.categoryId), ['category-1', 'category-1', null, null]);
});
