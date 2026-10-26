import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalServerUrl, normalizeServerUrl } from '../src/server-url.ts';

test('POS accepts a cabinet login link and uses its API', () => {
  assert.equal(normalizeServerUrl('https://shop.example/login'), 'https://shop.example/api');
  assert.equal(normalizeServerUrl(' https://shop.example/login/?next=%2Fsales '), 'https://shop.example/api');
});

test('POS keeps explicit and direct API addresses', () => {
  assert.equal(normalizeServerUrl('https://shop.example/api/'), 'https://shop.example/api');
  assert.equal(normalizeServerUrl('http://127.0.0.1:3011'), 'http://127.0.0.1:3011');
  assert.throws(() => normalizeServerUrl('shop.example/login'), /Укажите адрес магазина/);
});

test('local API stays usable when the internet connection is down', () => {
  assert.equal(isLocalServerUrl('http://127.0.0.1:3011'), true);
  assert.equal(isLocalServerUrl('http://10.0.0.100:3011'), true);
  assert.equal(isLocalServerUrl('http://192.168.1.20:3011'), true);
  assert.equal(isLocalServerUrl('https://shop.example/api'), false);
});
