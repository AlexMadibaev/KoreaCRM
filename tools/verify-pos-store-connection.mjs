// Writes fixtures only to a dedicated local test database. Never use on production.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
const apiUrl = new URL(process.env.POS_STORE_TEST_API ?? 'http://127.0.0.1:18111');
if (!['localhost', '127.0.0.1'].includes(databaseUrl.hostname) || !databaseUrl.pathname.includes('_pos_store_test')) throw new Error('Use a dedicated local *_pos_store_test database');
if (!['localhost', '127.0.0.1'].includes(apiUrl.hostname)) throw new Error('Test API must be local');
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { hash } = require('argon2');
const db = new PrismaClient();
let checks = 0;
async function request(path, { body, token, status = 200 } = {}) {
  const response = await fetch(new URL(path, apiUrl), { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  assert.equal(response.status, status, `${path}: ${JSON.stringify(result)}`); checks++;
  return result;
}

try {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const role = await db.role.findUniqueOrThrow({ where: { code: 'CASHIER' } });
  const storeA = await db.store.create({ data: { name: 'POS access test A', code: `TESTA_${suffix}`.toUpperCase() } });
  const storeB = await db.store.create({ data: { name: 'POS access test B', code: `TESTB_${suffix}`.toUpperCase() } });
  const password = randomBytes(20).toString('base64url');
  const scanCode = `KCRM1:${randomBytes(32).toString('base64url')}`;
  const user = await db.user.create({ data: { login: `pos-test-${suffix}`, name: 'POS store test employee', passwordHash: await hash(password), posQrHash: createHash('sha256').update(scanCode).digest('hex'), roleId: role.id, stores: { create: { storeId: storeA.id } } } });
  const deviceId = `POS-${randomUUID()}`;
  const login = { login: user.login, password, deviceId };
  const setup = await request('/auth/pos-store', { body: { storeCode: storeA.code.toLowerCase(), deviceId }, status: 201 });
  assert.deepEqual(Object.keys(setup).sort(), ['code', 'id', 'name']); checks++;
  await request('/auth/login', { body: login, status: 400 });
  await request('/auth/login', { body: { ...login, storeCode: storeB.code }, status: 403 });
  assert.equal(await db.posDevice.count({ where: { deviceId } }), 0); checks++;
  let session = await request('/auth/login', { body: { ...login, storeCode: storeA.code }, status: 201 });
  const me = await request('/auth/me', { token: session.accessToken });
  assert.deepEqual(me.storeIds, [storeA.id]); assert.equal(me.allStores, false); checks++;
  const stores = await request('/stores', { token: session.accessToken });
  assert.deepEqual(stores.map(store => store.id), [storeA.id]); checks++;
  session = await request('/auth/refresh', { body: { refreshToken: session.refreshToken, deviceId }, status: 201 });
  const refreshed = await request('/auth/me', { token: session.accessToken });
  assert.deepEqual(refreshed.storeIds, [storeA.id]); checks++;
  await request(`/stores/${storeB.id}/pos-products`, { token: session.accessToken, status: 403 });
  await request('/auth/pos-store', { body: { storeCode: storeB.code, deviceId }, status: 409 });
  const scanned = await request('/auth/pos-code', { body: { code: scanCode, deviceId, storeCode: storeA.code }, status: 201 });
  assert.equal(scanned.login, user.login); checks++;
  await db.userStore.delete({ where: { userId_storeId: { userId: user.id, storeId: storeA.id } } });
  await db.userStore.create({ data: { userId: user.id, storeId: storeB.id } });
  await request('/auth/me', { token: session.accessToken, status: 403 });
  await request('/auth/refresh', { body: { refreshToken: session.refreshToken, deviceId }, status: 403 });
  await request('/auth/login', { body: { ...login, storeCode: storeA.code }, status: 403 });
  await request('/auth/pos-code', { body: { code: scanCode, deviceId, storeCode: storeA.code }, status: 403 });
  await db.userStore.create({ data: { userId: user.id, storeId: storeA.id } });
  await request('/auth/login', { body: { ...login, storeCode: storeA.code }, status: 201 });
  await db.posDevice.update({ where: { deviceId }, data: { status: 'DISABLED' } });
  await request('/auth/me', { token: session.accessToken, status: 403 });
  await request('/auth/login', { body: { ...login, storeCode: storeA.code }, status: 403 });
  console.log(`PASS: ${checks} real HTTP/database checks for point setup, assignment, QR, scope, transfer, refresh and disabled POS`);
} finally { await db.$disconnect(); }
