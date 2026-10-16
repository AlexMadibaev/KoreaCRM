import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { verify } from 'argon2';
import type { DatabaseService } from '../src/database.service';
import type { AccessContext } from '../src/auth/policy';
import { EmployeesService } from '../src/employees/employees.service';

const actor: AccessContext = { userId: 'admin', permissions: ['employees.create', 'employees.edit', 'sales.view'], allStores: false, storeIds: ['store-a'] };
const input = { name: 'Тестовый менеджер', login: 'test.manager', password: 'long-password-123', roleId: 'role-a', allStores: false, storeIds: ['store-a'] };

test('employee creator cannot assign a role with permissions they do not have', async () => {
  const db = { role: { findUnique: async () => ({ id: 'role-a', permissions: [{ permission: { code: 'settings.edit' } }] }) } } as unknown as DatabaseService;
  await assert.rejects(new EmployeesService(db).create(input, actor), ForbiddenException);
});

test('employee creator cannot assign another store', async () => {
  const db = { role: { findUnique: async () => ({ id: 'role-a', permissions: [{ permission: { code: 'sales.view' } }] }) } } as unknown as DatabaseService;
  await assert.rejects(new EmployeesService(db).create({ ...input, storeIds: ['store-b'] }, actor), ForbiddenException);
});

test('employee creation hashes the password and assigns stores in one transaction', async () => {
  let created: { passwordHash: string } | undefined;
  let assigned: { userId: string; storeId: string }[] = [];
  let audited = false;
  const tx = {
    user: { create: async ({ data }: { data: { passwordHash: string } }) => { created = data; return { id: 'employee-1' }; } },
    userStore: { createMany: async ({ data }: { data: typeof assigned }) => { assigned = data; } },
    auditLog: { create: async () => { audited = true; } },
  };
  const db = {
    role: { findUnique: async () => ({ id: 'role-a', permissions: [{ permission: { code: 'sales.view' } }] }) },
    store: { count: async () => 1 },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    user: { findUniqueOrThrow: async () => ({ id: 'employee-1', name: input.name, login: input.login }) },
  } as unknown as DatabaseService;
  const result = await new EmployeesService(db).create(input, actor);
  assert.equal(result.id, 'employee-1');
  assert.ok(created);
  assert.notEqual(created.passwordHash, input.password);
  assert.equal(await verify(created.passwordHash, input.password), true);
  assert.deepEqual(assigned, [{ userId: 'employee-1', storeId: 'store-a' }]);
  assert.equal(audited, true);
});

test('employee editor cannot disable their own account', async () => {
  const service = new EmployeesService({} as DatabaseService);
  await assert.rejects(service.update(actor.userId, { active: false }, actor), ConflictException);
});

test('custom role cannot grant a permission absent from the creator', async () => {
  const service = new EmployeesService({} as DatabaseService);
  await assert.rejects(service.createRole({ code: 'TEST_ROLE', name: 'Test role', permissions: ['settings.edit'] }, actor), ForbiddenException);
});

test('employee history does not expose actions across inaccessible stores', async () => {
  const db = { user: { findUnique: async () => ({ id: 'employee-1', allStores: false, stores: [{ storeId: 'store-a' }, { storeId: 'store-b' }] }) } } as unknown as DatabaseService;
  await assert.rejects(new EmployeesService(db).activity('employee-1', actor, { page: 1, limit: 20 }), ForbiddenException);
});

test('employee history includes actions by the employee and changes to their account', async () => {
  let queried: unknown;
  const db = {
    user: { findUnique: async () => ({ id: 'employee-1', allStores: false, stores: [{ storeId: 'store-a' }] }) },
    auditLog: { findMany: async (options: unknown) => { queried = options; return [{ id: 'log-1', action: 'LOGIN' }]; }, count: async () => 1 },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as DatabaseService;
  const result = await new EmployeesService(db).activity('employee-1', actor, { page: 2, limit: 10 });
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.action, 'LOGIN');
  assert.deepEqual((queried as { where: unknown }).where, { OR: [{ userId: 'employee-1' }, { entityType: 'User', entityId: 'employee-1' }] });
  assert.equal((queried as { skip: number }).skip, 10);
});
