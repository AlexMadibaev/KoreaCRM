import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { DatabaseService } from '../src/database.service';
import { PosDevicesController } from '../src/pos-devices/pos-devices.controller';
import { PosDevicesService } from '../src/pos-devices/pos-devices.service';

test('registered POS device cannot move to another store', async () => {
  let wrote = false;
  const tx = {
    store: { findFirst: async () => ({ id: 'store-2' }) },
    posDevice: { findUnique: async () => ({ deviceId: 'POS-1', storeId: 'store-1', status: 'ACTIVE' }), update: async () => { wrote = true; } },
  };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  await assert.rejects(new PosDevicesService(db).register('store-2', { deviceId: 'POS-1', appVersion: '0.1.0' }, 'actor'), ConflictException);
  assert.equal(wrote, false);
});

test('employee allowed to return sales can register a device without sale creation rights', () => {
  let registrations = 0;
  const service = { register: () => { registrations++; return { deviceId: 'WEB-1' }; } } as unknown as PosDevicesService;
  const controller = new PosDevicesController(service);
  const input = { deviceId: 'WEB-1', appVersion: 'web-1' };
  const request = (permissions: string[]) => ({ access: { userId: 'actor', permissions, allStores: false, storeIds: ['store-1'] } });
  assert.deepEqual(controller.register('store-1', input, request(['sales.return']) as never), { deviceId: 'WEB-1' });
  assert.throws(() => controller.register('store-1', input, request(['sales.view']) as never), ForbiddenException);
  assert.equal(registrations, 1);
});
