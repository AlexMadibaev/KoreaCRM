import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeServerUrl } from '../src/server-url.ts';

test('POS accepts a cabinet login link and uses its API', () => {
  assert.equal(normalizeServerUrl('https://shop.example/login'), 'https://shop.example/api');
  assert.equal(normalizeServerUrl(' https://shop.example/login/?next=%2Fsales '), 'https://shop.example/api');
});

test('POS keeps explicit and direct API addresses', () => {
  assert.equal(normalizeServerUrl('https://shop.example/api/'), 'https://shop.example/api');
  assert.equal(normalizeServerUrl('http://127.0.0.1:3011'), 'http://127.0.0.1:3011');
  assert.throws(() => normalizeServerUrl('shop.example/login'), /Укажите адрес магазина/);
});
