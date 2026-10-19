import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { ProductImagesService, imageFormat } from '../src/catalog/product-images';
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
