import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && /^\/koreacrm_deploy_check_/.test(url.pathname), 'An isolated local deploy-check database is required');
const suffix = randomBytes(5).toString('hex');
const password = randomBytes(24).toString('base64url');
const hiddenLogin = `directory-hidden-${suffix}`;
process.env.SEED_OWNER_LOGIN = hiddenLogin;
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { hash } = require('argon2');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module.js');
const db = new PrismaClient();
let app;
let hidden, visible, store;
try {
  const role = await db.role.findUniqueOrThrow({ where: { code: 'SUPERUSER' } });
  store = await db.store.create({ data: { name: 'Directory visibility check', code: `DIRECTORY_${suffix.toUpperCase()}` } });
  const passwordHash = await hash(password);
  hidden = await db.user.create({ data: { login: hiddenLogin, name: 'Hidden bootstrap', passwordHash, roleId: role.id, allStores: true, primaryStoreId: store.id, stores: { create: { storeId: store.id } } } });
  visible = await db.user.create({ data: { login: `directory-visible-${suffix}`, name: 'Visible superuser', passwordHash, roleId: role.id, allStores: true } });
  await db.store.update({ where: { id: store.id }, data: { managerId: hidden.id } });
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  async function call(path, token, method = 'GET', body, status = 200) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, status, `${method} ${path}`);
    return response.json();
  }
  const login = async user => (await call('/auth/login', null, 'POST', { login: user.login, password }, 201)).accessToken;
  const ownerToken = await login(hidden), staffToken = await login(visible);
  assert.equal((await call('/auth/me', ownerToken)).userId, hidden.id);
  for (const token of [ownerToken, staffToken]) {
    const list = await call('/employees?limit=100', token);
    assert.ok(!list.items.some(user => user.id === hidden.id));
    assert.ok(list.items.some(user => user.id === visible.id));
    assert.equal(list.total, await db.user.count({ where: { deletedAt: null, NOT: { login: { equals: hiddenLogin, mode: 'insensitive' } } } }));
    const search = await call(`/employees?search=${hiddenLogin.toUpperCase()}`, token);
    assert.equal(search.total, 0);
    assert.deepEqual(search.items, []);
  }
  for (const endpoint of ['rewards', 'activity', 'pos-codes']) await call(`/employees/${hidden.id}/${endpoint}`, staffToken, 'GET', undefined, 404);
  await call(`/employees/${hidden.id}/pos-codes`, staffToken, 'POST', {}, 404);
  await call(`/employees/${hidden.id}`, staffToken, 'PATCH', { name: 'Changed' }, 404);
  await call(`/employees/${hidden.id}`, staffToken, 'DELETE', undefined, 404);
  const stores = await call('/store-management', staffToken);
  const listed = stores.find(item => item.id === store.id);
  assert.equal(listed.manager, null);
  assert.equal(listed.managerId, null);
  assert.equal(listed._count.users, 0);
  const detail = await call(`/store-management/${store.id}`, staffToken);
  assert.ok(!detail.employees.some(user => user.id === hidden.id));
  assert.ok(detail.employees.some(user => user.id === visible.id));
  const codes = await call('/employees/me/pos-codes', ownerToken, 'POST', {}, 201);
  const saved = await call('/employees/me/pos-codes', ownerToken);
  assert.equal(saved.available, true);
  assert.equal(saved.qrCode, codes.qrCode);
  const actual = await db.user.findUniqueOrThrow({ where: { id: hidden.id } });
  assert.equal(actual.active, true);
  assert.equal(actual.login, hiddenLogin);
  assert.equal(actual.passwordHash, passwordHash);
  assert.equal(actual.roleId, role.id);
  assert.equal((await db.store.findUniqueOrThrow({ where: { id: store.id } })).managerId, hidden.id);
  console.log('DIRECTORY_VISIBILITY_HTTP_PASS: directory, counts, search, selectors, direct access, login and self-service');
} finally {
  await app?.close();
  const ids = [hidden?.id, visible?.id].filter(Boolean);
  if (store) await db.store.update({ where: { id: store.id }, data: { managerId: null } });
  await db.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { entityId: { in: ids } }] } });
  await db.userStore.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  if (store) await db.store.delete({ where: { id: store.id } });
  await db.$disconnect();
}
