import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { sealPosCodes, openPosCodes } from '../src/auth/pos-code-vault';
import { newPosCodes, hashPosCode } from '../src/auth/pos-code';
import { EmployeesService } from '../src/employees/employees.service';
import type { DatabaseService } from '../src/database.service';
import type { AccessContext } from '../src/auth/policy';

process.env.JWT_SECRET = 'isolated-pos-code-vault-test-secret-20261109';
test('POS codes are encrypted, authenticated and bound to their employee', () => {
  const codes = newPosCodes(), encrypted = sealPosCodes('alice', codes);
  assert.ok(!encrypted.includes(codes.qrCode) && !encrypted.includes(codes.ean13));
  assert.deepEqual(openPosCodes('alice', encrypted), codes);
  assert.equal(openPosCodes('bob', encrypted), null);
  const parts = encrypted.split('.'); parts[3] = 'A' + parts[3]!.slice(1);
  if (parts.join('.') === encrypted) parts[3] = 'B' + parts[3]!.slice(1);
  assert.equal(openPosCodes('alice', parts.join('.')), null);
});
const actor: AccessContext = { userId: 'alice', permissions: ['sales.create'], allStores: false, storeIds: ['shop-a'] };
const employee = { id: 'alice', name: 'Alice', active: true, deletedAt: null, allStores: false, stores: [{ storeId: 'shop-a' }], role: { permissions: [{ permission: { code: 'sales.create' } }] } };
test('reading a saved code preserves it and refuses stale or legacy secrets', async () => {
  const codes = newPosCodes();
  const stored = { posQrHash: hashPosCode(codes.qrCode), posEanHash: hashPosCode(codes.ean13), posCodesEncrypted: sealPosCodes('alice', codes) as string | null };
  const db = { user: { findUnique: async () => employee, findUniqueOrThrow: async () => stored } } as unknown as DatabaseService;
  const service = new EmployeesService(db);
  assert.deepEqual(await service.getPosCodes('alice', actor), { available: true, employeeName: 'Alice', ...codes });
  assert.deepEqual(await service.getPosCodes('alice', actor), { available: true, employeeName: 'Alice', ...codes });
  stored.posCodesEncrypted = null;
  assert.deepEqual(await service.getPosCodes('alice', actor), { available: false, hasCodes: true });
  stored.posCodesEncrypted = sealPosCodes('alice', codes); stored.posQrHash = hashPosCode('revoked');
  assert.deepEqual(await service.getPosCodes('alice', actor), { available: false, hasCodes: true });
});
test('reading codes cannot bypass store scope or permissions of the target account', async () => {
  const db = { user: { findUnique: async () => ({ ...employee, stores: [{ storeId: 'shop-b' }] }) } } as unknown as DatabaseService;
  await assert.rejects(new EmployeesService(db).getPosCodes('alice', actor), ForbiddenException);
  const wider = { user: { findUnique: async () => ({ ...employee, role: { permissions: [{ permission: { code: 'settings.edit' } }] } }) } } as unknown as DatabaseService;
  await assert.rejects(new EmployeesService(wider).getPosCodes('alice', actor), ForbiddenException);
});
