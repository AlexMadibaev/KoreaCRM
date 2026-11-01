import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchProductImage, productImageUrls } from '../src/product-image-url.ts';

test('POS image URL follows the same /api proxy route as the cabinet', () => {
  const [primary, fallback] = productImageUrls('https://crm.example/api/', 'photo 1.webp');
  assert.equal(primary, 'https://crm.example/api/product-images/photo%201.webp');
  assert.equal(fallback, 'https://crm.example/product-images/photo%201.webp');
});

test('POS fetches the image through the API route used by its CORS requests', async () => {
  const urls = [];
  const blob = new Blob(['image'], { type: 'image/webp' });
  const result = await fetchProductImage('https://crm.example/api', 'photo.webp', async (url, options) => {
    urls.push([url, options.mode]);
    return urls.length === 1 ? new Response('missing', { status: 404 }) : new Response(blob, { headers: { 'content-type': 'image/webp' } });
  });
  assert.equal(result.size, blob.size);
  assert.deepEqual(urls, [
    ['https://crm.example/api/product-images/photo.webp', 'cors'],
    ['https://crm.example/product-images/photo.webp', 'cors'],
  ]);
});
