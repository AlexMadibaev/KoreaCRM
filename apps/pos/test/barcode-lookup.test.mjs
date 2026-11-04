import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupBarcode } from '../src/barcode-lookup.ts';

test('barcode lookup unwraps the API page before requesting product settings', async () => {
  const product = { id: '74850289-e085-4f97-81ee-d8338f2ce109', sku: 'CREAM', name: 'Cream' };
  const client = { async get(path) {
    assert.equal(path, '/products/lookup/barcode/123%2F456');
    return { items: [product], total: 1, page: 1, limit: 1 };
  } };
  assert.equal(await lookupBarcode(client, '123/456'), product);
});

test('unknown barcode returns no product instead of a page with an undefined ID', async () => {
  const client = { async get() { return { items: [], total: 0, page: 1, limit: 1 }; } };
  assert.equal(await lookupBarcode(client, 'missing'), undefined);
});

test('barcode lookup preserves network errors for offline fallback', async () => {
  const error = new TypeError('Failed to fetch');
  const client = { async get() { throw error; } };
  await assert.rejects(lookupBarcode(client, '123'), caught => caught === error);
});
