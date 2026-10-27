import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { DatabaseService } from '../src/database.service';
import type { AccessContext } from '../src/auth/policy';
import { StoresService } from '../src/stores/stores.service';
import { AuditController } from '../src/audit/audit.controller';
import { AuditService } from '../src/audit/audit.service';

const manager: AccessContext = { userId: 'manager', role: 'MANAGER', permissions: ['stores.view', 'stores.edit'], allStores: false, storeIds: ['store-a'] };

test('a manager cannot create stores outside their scope', async () => {
  const service = new StoresService({} as DatabaseService);
  await assert.rejects(service.create({ name: 'New store', code: 'NEW' }, manager), ForbiddenException);
  await assert.rejects(service.detail('store-b', manager), ForbiddenException);
});

test('closing an active store refuses an open cash shift', async () => {
  const db = { store: { findFirst: async () => ({ id: 'store-a', status: 'ACTIVE' }) }, cashShift: { count: async () => 1 } } as unknown as DatabaseService;
  await assert.rejects(new StoresService(db).update('store-a', { status: 'PAUSED' }, manager), ConflictException);
});

test('only the superuser role can read the audit log', async () => {
  const controller = new AuditController({ list: async () => ({ items: [], total: 0, page: 1, limit: 30 }) } as AuditService);
  assert.throws(() => controller.list({}, { access: { ...manager, permissions: [...manager.permissions, 'settings.edit'] } } as never), ForbiddenException);
  const result = await controller.list({}, { access: { ...manager, role: 'SUPERUSER' } } as never);
  assert.equal(result.total, 0);
});
