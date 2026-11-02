import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createApiClient, getHealth } from '../src/index.ts';

test('point setup and both cashier login modes send the selected store code', async () => {
  const requests = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: 'store-a', name: 'Store A', code: 'SHOP_A', accessToken: 'test', refreshToken: 'test', login: 'cashier' }), { headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const client = createApiClient('https://shop.example/api', 'POS-device-a');
    await client.resolvePosStore('SHOP_A');
    await client.login('cashier', 'password', 'SHOP_A');
    await client.loginWithPosCode('cashier-code', 'SHOP_A');
    assert.deepEqual(requests.map(request => request.path), ['/api/auth/pos-store', '/api/auth/login', '/api/auth/pos-code']);
    assert.ok(requests.every(request => request.body.storeCode === 'SHOP_A' && request.body.deviceId === 'POS-device-a'));
  } finally { fetchMock.mock.restore(); }
});

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

test('POS retries at the same origin when a proxy leaves /api in the upstream route', async () => {
  const requests = [];
  const fetchMock = mock.method(globalThis, 'fetch', async url => {
    requests.push(String(url));
    if (String(url).includes('/api/')) return new Response(JSON.stringify({ message: 'Cannot POST /api/auth/login' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ accessToken: 'test', refreshToken: 'test' }), { headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const client = createApiClient('https://shop.example/api', 'test-device');
    await client.login('cashier', 'test-password');
    assert.equal(client.baseUrl(), 'https://shop.example');
    assert.deepEqual(requests, ['https://shop.example/api/auth/login', 'https://shop.example/auth/login']);
  } finally { fetchMock.mock.restore(); }
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

test('POS request stops waiting for an unreachable server', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  let watchdog;
  try {
    const client = createApiClient('https://shop.example/api', 'test-device', 10);
    const request = client.login('cashier', 'test-password');
    const deadline = new Promise((_resolve, reject) => {
      watchdog = setTimeout(() => reject(new Error('POS request timeout did not fire')), 1_000);
    });
    await assert.rejects(Promise.race([request, deadline]), error => error?.name === 'TimeoutError');
  } finally {
    clearTimeout(watchdog);
    fetchMock.mock.restore();
  }
});
