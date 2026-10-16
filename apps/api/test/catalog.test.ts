import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { CatalogService } from '../src/catalog/catalog.service';
import type { DatabaseService } from '../src/database.service';

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
