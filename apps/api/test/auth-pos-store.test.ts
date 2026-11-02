import assert from 'node:assert/strict';
import test from 'node:test';
import { hash } from 'argon2';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { DatabaseService } from '../src/database.service';
import { AuthService } from '../src/auth/auth.service';
import { newPosCodes } from '../src/auth/pos-code';

async function fixture() {
  let assigned = true;
  let networkAccess = false;
  let device: { deviceId: string; storeId: string; status: string } | null = null;
  let issued = 0;
  let refreshRow: { userId: string; deviceId: string; tokenHash: string } | null = null;
  const claims: Array<Record<string, unknown>> = [];
  const store = { id: 'store-a', name: 'Store A', code: 'SHOP_A', status: 'ACTIVE', deletedAt: null };
  const user = { id: 'cashier-a', login: 'cashier', name: 'Cashier', active: true, passwordHash: await hash('valid-password'), role: { code: 'CASHIER', permissions: [{ permission: { code: 'sales.create' } }] } };
  const fullUser = () => ({ ...user, allStores: networkAccess, primaryStoreId: null, stores: assigned ? [{ storeId: store.id }] : [] });
  const posDevice = {
    findUnique: async () => device ? { ...device, store } : null,
    create: async ({ data }: { data: { deviceId: string; storeId: string } }) => { device = { ...data, status: 'ACTIVE' }; return device; },
  };
  const db = {
    user: { findUnique: async () => fullUser(), findFirst: async () => fullUser() },
    posDevice,
    store: { findFirst: async ({ where }: { where: { code?: string; id?: string } }) => where.code && where.code !== store.code || where.id && where.id !== store.id ? null : where.code ? { id: store.id, name: store.name, code: store.code } : store },
    auditLog: { create: async () => undefined },
    refreshToken: {
      create: async ({ data }: { data: { userId: string; deviceId: string; tokenHash: string } }) => { issued++; refreshRow = data; },
      findUnique: async () => refreshRow ? { ...refreshRow, id: 'refresh-a', revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user } : null,
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ posDevice, store: { findFirst: async () => store }, auditLog: { create: async () => undefined } }),
  } as unknown as DatabaseService;
  const auth = new AuthService(db, { signAsync: async (input: Record<string, unknown>) => { claims.push(input); return 'jwt'; } } as unknown as JwtService);
  return { auth, store, claims, deny: () => { assigned = false; }, allowNetwork: () => { networkAccess = true; }, bind: (storeId = store.id, status = 'ACTIVE') => { device = { deviceId: 'POS-device-a', storeId, status }; }, issued: () => issued, device: () => device };
}

test('point code resolves a public label without registering a device or issuing tokens', async () => {
  const f = await fixture();
  assert.deepEqual(await f.auth.posStore(' shop_a '), { id: 'store-a', name: 'Store A', code: 'SHOP_A' });
  assert.equal(f.device(), null);
  assert.equal(f.issued(), 0);
  await assert.rejects(f.auth.posStore('UNKNOWN'), BadRequestException);
});

test('new POS requires a point code and an assigned employee before creating a device', async () => {
  const f = await fixture();
  await assert.rejects(f.auth.login('cashier', 'valid-password', 'POS-device-a'), BadRequestException);
  f.deny();
  await assert.rejects(f.auth.login('cashier', 'valid-password', 'POS-device-a', 'SHOP_A'), ForbiddenException);
  assert.equal(f.device(), null);
  assert.equal(f.issued(), 0);
});

test('password login pins POS tokens and access context to the registered point', async () => {
  const f = await fixture();
  await f.auth.login('cashier', 'valid-password', 'POS-device-a', 'SHOP_A');
  assert.equal(f.device()?.storeId, 'store-a');
  assert.equal(f.claims[0]?.posDeviceId, 'POS-device-a');
  const scope = await f.auth.context('cashier-a', 'POS-device-a');
  assert.deepEqual(scope.storeIds, ['store-a']);
  assert.equal(scope.allStores, false);
  assert.equal(scope.primaryStoreId, 'store-a');
});

test('QR login uses the same store assignment check as password login', async () => {
  const f = await fixture();
  f.deny();
  await assert.rejects(f.auth.loginWithPosCode(newPosCodes().qrCode, 'POS-device-a', 'test-ip', 'SHOP_A'), ForbiddenException);
  assert.equal(f.issued(), 0);
});

test('a POS cannot move to another store by changing its saved setup code', async () => {
  const f = await fixture(); f.bind('store-b');
  await assert.rejects(f.auth.posStore('SHOP_A', 'POS-device-a'), ConflictException);
  await assert.rejects(f.auth.login('cashier', 'valid-password', 'POS-device-a', 'SHOP_A'), ConflictException);
  assert.equal(f.issued(), 0);
});

test('employee removal revokes scoped API access and refresh on the next request', async () => {
  const f = await fixture();
  const tokens = await f.auth.login('cashier', 'valid-password', 'POS-device-a', 'SHOP_A');
  f.deny();
  await assert.rejects(f.auth.context('cashier-a', 'POS-device-a'), ForbiddenException);
  await assert.rejects(f.auth.refresh(tokens.refreshToken, 'POS-device-a'), ForbiddenException);
  assert.equal(f.issued(), 1);
});

test('network-wide users still receive a point-scoped POS session', async () => {
  const f = await fixture(); f.deny(); f.allowNetwork();
  await f.auth.login('cashier', 'valid-password', 'POS-device-a', 'SHOP_A');
  assert.equal((await f.auth.context('cashier-a', 'POS-device-a')).allStores, false);
});

test('disabled POS cannot log in or use a previously issued scoped session', async () => {
  const f = await fixture(); f.bind('store-a', 'DISABLED');
  await assert.rejects(f.auth.login('cashier', 'valid-password', 'POS-device-a', 'SHOP_A'), ForbiddenException);
  await assert.rejects(f.auth.context('cashier-a', 'POS-device-a'), ForbiddenException);
});
