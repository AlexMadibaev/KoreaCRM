import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { ProductImagesService, imageFormat, normalizeProductImage } from '../src/catalog/product-images';
import type { DatabaseService } from '../src/database.service';

test('image upload accepts supported signatures and rejects a disguised SVG', async () => {
  assert.equal(imageFormat(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))?.mime, 'image/png');
  assert.equal(imageFormat(Buffer.from([255, 216, 255, 0]))?.mime, 'image/jpeg');
  assert.equal(imageFormat(Buffer.from('RIFF0000WEBP'))?.mime, 'image/webp');
  assert.equal(imageFormat(Buffer.from('<svg onload="alert(1)"></svg>')), null);
  const service = new ProductImagesService({} as DatabaseService);
  await assert.rejects(service.add('product-id', { buffer: Buffer.from('<svg></svg>'), size: 11 }, 'user-id'), BadRequestException);
});

test('image upload rejects files over 5 MB before touching the database', async () => {
  const service = new ProductImagesService({} as DatabaseService);
  const png = Buffer.alloc(5_000_001);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  await assert.rejects(service.add('product-id', { buffer: png, size: png.length }, 'user-id'), BadRequestException);
});

test('normalizes a landscape product photo to a compact 360px square WebP', async () => {
  const original = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#d28a91' } }).png().toBuffer();
  const result = await normalizeProductImage(original);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 360);
  assert.equal(metadata.height, 360);
  assert.ok(result.length < original.length);
});

test('rejects a corrupt file with a valid image signature', async () => {
  await assert.rejects(normalizeProductImage(Buffer.from([255, 216, 255, 0, 0, 0])), BadRequestException);
});

test('removing a photo advances the product revision used by POS', async () => {
  let touched = false;
  const db = {
    productImage: { findFirst: async () => ({ storageKey: '00000000-0000-0000-0000-000000000000.webp' }) },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      productImage: { delete: async () => undefined },
      product: { update: async ({ data }: { data: { updatedAt: Date } }) => { touched = data.updatedAt instanceof Date; } },
      auditLog: { create: async () => undefined },
    }),
  } as unknown as DatabaseService;
  await new ProductImagesService(db).remove('product-id', 'image-id', 'user-id');
  assert.equal(touched, true);
});
