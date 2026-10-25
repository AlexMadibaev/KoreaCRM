import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createApiClient, getHealth } from '../src/index.ts';

test('POS login keeps the /api prefix of a public server address', async () => {
  const requests = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ accessToken: 'test', refreshToken: 'test' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  try {
    const client = createApiClient('https://shop.example/api/', 'test-device');
    await client.login('cashier', 'test-password');
    assert.deepEqual(requests, ['https://shop.example/api/auth/login']);
  } finally {
    fetchMock.mock.restore();
  }
});

test('health request keeps the /api prefix', async () => {
  const requests = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ status: 'ok', service: 'api' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  try {
    await getHealth('https://shop.example/api');
    assert.deepEqual(requests, ['https://shop.example/api/health']);
  } finally {
    fetchMock.mock.restore();
  }
});
