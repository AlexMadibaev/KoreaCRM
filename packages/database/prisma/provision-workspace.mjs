import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const normalize = (text) => text.normalize('NFKC').trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
const aliases = (name) => name.split('/').map(normalize);
export function validateWorkspace(value) {
  assert.ok(value && value.version === 1, 'Workspace version must be 1');
  assert.ok(Object.keys(value).every((key) => ['version', 'stores', 'roles', 'users', 'suppliers', 'paymentMethods'].includes(key)), 'Unknown workspace field; products and transactions are not accepted');
  for (const key of ['stores', 'roles', 'users', 'suppliers', 'paymentMethods']) assert.ok(Array.isArray(value[key]) && value[key].length <= 300, `Invalid ${key}`);
  const unique = (rows, key) => { const values = rows.map((row) => normalize(row[key])); assert.equal(new Set(values).size, values.length, `Duplicate ${key}`); };
  const text = (value, max = 255) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  const mappedIds = value.stores.filter((store) => store.existingId).map((store) => store.existingId.toLowerCase());
  assert.equal(new Set(mappedIds).size, mappedIds.length, 'Two configured stores cannot use the same existing ID');
  for (const store of value.stores) {
    assert.ok(!store.existingId || /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(store.existingId), 'Invalid existing store ID');
    assert.ok(!(store.existingId && store.create), 'Choose an existing ID or explicit creation');
    assert.ok(store.create === undefined || typeof store.create === 'boolean', 'Invalid create flag');
  }
  unique(value.stores, 'code'); unique(value.roles, 'code'); unique(value.users, 'login'); unique(value.suppliers, 'name'); unique(value.paymentMethods, 'code');
  const stores = new Set(value.stores.map((s) => s.code)), roles = new Set(value.roles.map((r) => r.code));
  for (const store of value.stores) assert.ok(/^[A-Z][A-Z0-9_-]{1,39}$/.test(store.code) && text(store.name, 120) && (!store.address || text(store.address, 500)), 'Invalid store');
  for (const role of value.roles) assert.ok(/^[A-Z][A-Z0-9_]{2,39}$/.test(role.code) && text(role.name, 100) && Array.isArray(role.permissions) && role.permissions.every((p) => text(p, 100)) && new Set(role.permissions).size === role.permissions.length, 'Invalid role');
  for (const user of value.users) {
    assert.ok(/^[a-zA-Z0-9._-]{3,60}$/.test(user.login) && text(user.name, 150) && typeof user.active === 'boolean' && roles.has(user.roleCode), 'Invalid user');
    assert.ok(Array.isArray(user.storeCodes) && user.storeCodes.every((code) => stores.has(code)) && new Set(user.storeCodes).size === user.storeCodes.length, 'Invalid user stores');
    assert.ok(!user.primaryStoreCode || user.storeCodes.includes(user.primaryStoreCode), 'Primary store must be assigned');
    assert.ok(!Object.hasOwn(user, 'password') && !Object.hasOwn(user, 'passwordHash') && !Object.hasOwn(user, 'allStores'), 'Credentials and network-wide access are generated or assigned separately');
  }
  for (const supplier of value.suppliers) assert.ok(text(supplier.name, 255), 'Invalid supplier');
  for (const method of value.paymentMethods) assert.ok(/^[A-Z][A-Z0-9_]{1,31}$/.test(method.code) && text(method.name, 100) && ['CASH', 'CARD', 'QR', 'TRANSFER', 'CUSTOM'].includes(method.kind) && Array.isArray(method.storeCodes) && method.storeCodes.length > 0 && method.storeCodes.every((code) => stores.has(code)), 'Invalid payment method');
  return value;
}
export async function provisionWorkspace(db, config, { apply = false, actorLogin, credentialsFile } = {}) {
  validateWorkspace(config);
  const actor = await db.user.findUnique({ where: { login: actorLogin } });
  assert.ok(actor && actor.active && !actor.deletedAt, 'A current bootstrap owner is required');
  const permissionCodes = new Set((await db.permission.findMany()).map((p) => p.code));
  for (const role of config.roles) for (const permission of role.permissions) assert.ok(permissionCodes.has(permission), `Unknown permission: ${permission}`);
  const allStores = await db.store.findMany({ include: { _count: { select: { stocks: true, purchases: true, sales: true } } } });
  const mappings = config.stores.map((input) => {
    const existing = input.existingId ? allStores.find((store) => store.id === input.existingId.toLowerCase()) : input.create ? allStores.find((store) => store.code === input.code && normalize(store.name) === normalize(input.name)) : undefined;
    if (input.existingId) assert.ok(existing && !existing.deletedAt && existing.status === 'ACTIVE', `Existing store is missing or unavailable: ${input.code}`);
    if (existing) return { code: input.code, action: 'reuse', id: existing.id, actualCode: existing.code, name: existing.name };
    if (input.create) {
      const normalized = (text) => normalize(text).replace(/[^\p{L}\p{N}]/gu, '');
      assert.ok(!allStores.some((store) => store.code === input.code || normalized(store.name) === normalized(input.name)), `Store already exists; supply its existingId: ${input.code}`);
      return { code: input.code, action: 'create' };
    }
    return { code: input.code, action: 'mapping_required' };
  });
  if (!apply) return { dryRun: true, stores: mappings, existingStores: allStores.map((store) => ({ id: store.id, code: store.code, name: store.name, deletedAt: store.deletedAt, counts: store._count })), users: config.users.map((u) => ({ login: u.login, active: u.active })), suppliers: config.suppliers.length, paymentMethods: config.paymentMethods.map((m) => ({ code: m.code, stores: m.storeCodes })), products: 0 };
  assert.ok(mappings.every((store) => store.action !== 'mapping_required'), 'Map every store with existingId before applying; for a new shop explicitly set create=true');
  assert.ok(credentialsFile && path.isAbsolute(credentialsFile), 'Provide an absolute credentials export path');
  fs.mkdirSync(path.dirname(credentialsFile), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(credentialsFile, 'wx', 0o600);
  const credentials = [], created = { stores: 0, roles: 0, users: 0, suppliers: 0, paymentMethods: 0 };
  const { hash } = await import('argon2');
  try {
    await db.$transaction(async (tx) => {
      const storeIds = new Map(), roleIds = new Map();
      for (const input of config.stores) {
        const mapping = mappings.find((store) => store.code === input.code);
        if (mapping.action === 'reuse') {
          const existing = await tx.store.findUnique({ where: { id: mapping.id } });
          assert.ok(existing && !existing.deletedAt && existing.status === 'ACTIVE', `Store changed during setup: ${input.code}`);
          storeIds.set(input.code, existing.id);
        } else {
          const item = await tx.store.create({ data: { code: input.code, name: input.name, address: input.address ?? null } });
          storeIds.set(input.code, item.id); created.stores++;
        }
      }
      for (const input of config.roles) {
        const existing = await tx.role.findUnique({ where: { code: input.code }, include: { permissions: { include: { permission: true } } } });
        if (existing) {
          assert.ok(!existing.deletedAt, `Role archived: ${input.code}`);
          assert.deepEqual(existing.permissions.map((p) => p.permission.code).sort(), [...input.permissions].sort(), `Existing role differs: ${input.code}`); roleIds.set(input.code, existing.id);
        } else {
          const role = await tx.role.create({ data: { code: input.code, name: input.name, system: false, permissionsCustomizedAt: new Date(), permissions: { create: input.permissions.map((code) => ({ permission: { connect: { code } } })) } } });
          roleIds.set(input.code, role.id); created.roles++;
        }
      }
      for (const input of config.users) {
        const existing = await tx.user.findUnique({ where: { login: input.login }, include: { stores: true } });
        const storeList = input.storeCodes.map((code) => storeIds.get(code)).sort();
        if (existing) {
          assert.equal(existing.name, input.name, `Login belongs to another employee: ${input.login}`);
          assert.ok(!existing.deletedAt && existing.active === input.active && !existing.allStores && existing.roleId === roleIds.get(input.roleCode), `Existing account differs; no permissions changed: ${input.login}`);
          assert.deepEqual(existing.stores.map((s) => s.storeId).sort(), storeList, `Existing scope differs: ${input.login}`);
          assert.equal(existing.primaryStoreId, input.primaryStoreCode ? storeIds.get(input.primaryStoreCode) : null, `Existing primary store differs: ${input.login}`);
          continue;
        }
        assert.equal(await tx.user.count({ where: { name: { equals: input.name, mode: 'insensitive' }, deletedAt: null } }), 0, `Employee name exists with another login: ${input.name}`);
        const password = randomBytes(24).toString('base64url');
        await tx.user.create({ data: { login: input.login, name: input.name, passwordHash: await hash(password), roleId: roleIds.get(input.roleCode), active: input.active, allStores: false, primaryStoreId: input.primaryStoreCode ? storeIds.get(input.primaryStoreCode) : null, stores: { create: storeList.map((storeId) => ({ storeId })) } } });
        credentials.push({ login: input.login, name: input.name, active: input.active, password }); created.users++;
      }
      const suppliers = await tx.supplier.findMany();
      for (const input of config.suppliers) {
        const matches = suppliers.filter((s) => aliases(s.name).some((name) => aliases(input.name).includes(name)));
        assert.ok(matches.length <= 1, `Ambiguous supplier: ${input.name}`);
        if (matches.length) { assert.ok(!matches[0].deletedAt && matches[0].status === 'ACTIVE', `Supplier archived: ${input.name}`); continue; }
        const item = await tx.supplier.create({ data: { name: input.name, status: 'ACTIVE' } }); suppliers.push(item); created.suppliers++;
      }
      for (const input of config.paymentMethods) {
        const storeList = input.storeCodes.map((code) => storeIds.get(code)).sort();
        const existing = await tx.salePaymentMethod.findUnique({ where: { code: input.code }, include: { storeBindings: true } });
        if (existing) {
          assert.ok(existing.name === input.name && existing.kind === input.kind && existing.active && existing.restrictedToStores, `Existing payment method differs: ${input.code}`);
          assert.deepEqual(existing.storeBindings.map((s) => s.storeId).sort(), storeList, `Existing bank scope differs: ${input.code}`); continue;
        }
        await tx.salePaymentMethod.create({ data: { code: input.code, name: input.name, kind: input.kind, restrictedToStores: true, sortOrder: input.sortOrder ?? 100, storeBindings: { create: storeList.map((storeId) => ({ storeId })) } } }); created.paymentMethods++;
      }
      fs.writeFileSync(descriptor, JSON.stringify({ createdAt: new Date().toISOString(), users: credentials }, null, 2)); fs.fsyncSync(descriptor);
      await tx.auditLog.create({ data: { userId: actor.id, action: 'WORKSPACE_INITIALIZED', entityType: 'Workspace', entityId: createHash('sha256').update(JSON.stringify(config)).digest('hex'), newValue: created } });
    }, { timeout: 120000 });
  } catch (error) { fs.closeSync(descriptor); fs.unlinkSync(credentialsFile); throw error; }
  fs.closeSync(descriptor);
  return { dryRun: false, stores: mappings, created, credentialUsers: credentials.length, credentialsFile, products: 0 };
}
async function main() {
  const file = process.env.KOREACRM_WORKSPACE_FILE;
  assert.ok(file, 'Set KOREACRM_WORKSPACE_FILE to a private JSON manifest');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must come from the target server');
  const config = validateWorkspace(JSON.parse(fs.readFileSync(file, 'utf8')));
  const { PrismaClient } = await import('@prisma/client'); const db = new PrismaClient();
  try { console.log(JSON.stringify(await provisionWorkspace(db, config, { apply: process.argv.includes('--apply'), actorLogin: process.env.SEED_OWNER_LOGIN ?? 'owner', credentialsFile: process.env.KOREACRM_CREDENTIALS_FILE }), null, 2)); }
  finally { await db.$disconnect(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });