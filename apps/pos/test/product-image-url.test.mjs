import assert from 'node:assert/strict';
import test from 'node:test';
import { productImageUrls } from '../src/product-image-url.ts';

test('POS image URL follows the same /api proxy route as the cabinet', () => {
  const [primary, fallback] = productImageUrls('https://crm.example/api/', 'photo 1.webp');
  assert.equal(primary, 'https://crm.example/api/product-images/photo%201.webp');
  assert.equal(fallback, 'https://crm.example/product-images/photo%201.webp');
});
