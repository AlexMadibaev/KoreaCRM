import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { NotificationsService, stockAlertType } from '../src/notifications/notifications.service';
import type { DatabaseService } from '../src/database.service';

test('stock alert severity follows the current quantity', () => {
  assert.equal(stockAlertType(-1, 3), NotificationType.NEGATIVE_STOCK);
  assert.equal(stockAlertType(0, 3), NotificationType.OUT_OF_STOCK);
  assert.equal(stockAlertType(2, 3), NotificationType.LOW_STOCK);
  assert.equal(stockAlertType(3, 3), NotificationType.LOW_STOCK);
  assert.equal(stockAlertType(4, 3), null);
  assert.equal(stockAlertType(2, 0), null);
});

test('marking a notification read enforces employee and store scope', async () => {
  let where: unknown;
  const db = { notification: { updateMany: async (input: { where: unknown }) => { where = input.where; return { count: 0 }; } } } as unknown as DatabaseService;
  const service = new NotificationsService(db);
  await assert.rejects(service.markRead({ userId: 'employee-1', allStores: false, storeIds: ['store-1'], permissions: ['inventory.view'] }, 'notice-1'), NotFoundException);
  assert.deepEqual(where, { userId: 'employee-1', storeId: { in: ['store-1'] }, id: 'notice-1', resolvedAt: null });
});

test('sales-only notification viewer does not query stock alerts', async () => {
  const db = { $queryRaw: async () => { throw new Error('stock query must not run'); } } as unknown as DatabaseService;
  await new NotificationsService(db).syncStock({ userId: 'cashier-1', permissions: ['sales.view'], allStores: false, storeIds: ['store-1'] });
});

test('transfer event targets only users with relevant store access and uses a stable key', async () => {
  let recipientFilter: unknown;
  let created: { data: Array<{ userId: string; storeId: string; sourceKey: string; type: NotificationType }>; skipDuplicates: boolean } | undefined;
  const tx = {
    store: { findMany: async () => [{ id: 'source-1', name: 'Отправитель' }, { id: 'destination-1', name: 'Получатель' }] },
    user: { findMany: async (query: { where: unknown }) => {
      recipientFilter = query.where;
      return [
        { id: 'source-user', allStores: false, stores: [{ storeId: 'source-1' }] },
        { id: 'destination-user', allStores: false, stores: [{ storeId: 'destination-1' }] },
      ];
    } },
    notification: { createMany: async (input: typeof created) => { created = input; } },
  } as unknown as Prisma.TransactionClient;
  await new NotificationsService({} as DatabaseService).recordTransfer(tx, { id: 'transfer-1', fromStoreId: 'source-1', toStoreId: 'destination-1' }, 'REQUESTED');
  assert.deepEqual(created?.data.map(item => [item.userId, item.storeId, item.sourceKey, item.type]), [
    ['source-user', 'source-1', 'transfer:transfer-1:REQUESTED', NotificationType.TRANSFER],
    ['destination-user', 'destination-1', 'transfer:transfer-1:REQUESTED', NotificationType.TRANSFER],
  ]);
  assert.equal(created?.skipDuplicates, true);
  assert.match(JSON.stringify(recipientFilter), /transfers.view/);
  assert.match(JSON.stringify(recipientFilter), /inventory.view/);
});

test('large return targets sales viewers once and skips amounts below the configured threshold', async () => {
  let recipientFilter: unknown;
  let created: { data: Array<{ sourceKey: string; storeId: string; type: NotificationType; message: string }>; skipDuplicates: boolean } | undefined;
  const tx = {
    user: { findMany: async (query: { where: unknown }) => { recipientFilter = query.where; return [{ id: 'manager-1' }]; } },
    notification: { createMany: async (input: typeof created) => { created = input; } },
  } as unknown as Prisma.TransactionClient;
  const service = new NotificationsService({} as DatabaseService);
  const record = { id: 'return-1', saleId: 'sale-1', storeId: 'store-1' };
  await service.recordLargeReturn(tx, record, 'SALE-1', new Prisma.Decimal('99999999'));
  assert.equal(created, undefined);
  await service.recordLargeReturn(tx, record, 'SALE-1', new Prisma.Decimal('100000000'));
  assert.deepEqual(created?.data.map(item => [item.sourceKey, item.storeId, item.type]), [
    ['return:return-1:sale:sale-1', 'store-1', NotificationType.LARGE_RETURN],
  ]);
  assert.match(created!.data[0]!.message, /SALE-1/);
  assert.equal(created?.skipDuplicates, true);
  assert.match(JSON.stringify(recipientFilter), /sales.view/);
});

test('large discount requires both amount and percentage thresholds', async () => {
  let recipientFilter: unknown;
  let created: { data: Array<{ sourceKey: string; storeId: string; type: NotificationType; message: string }>; skipDuplicates: boolean } | undefined;
  const tx = {
    user: { findMany: async (query: { where: unknown }) => { recipientFilter = query.where; return [{ id: 'manager-1' }]; } },
    notification: { createMany: async (input: typeof created) => { created = input; } },
  } as unknown as Prisma.TransactionClient;
  const service = new NotificationsService({} as DatabaseService);
  const sale = { id: 'sale-1', storeId: 'store-1', number: 'SALE-1' };
  await service.recordLargeDiscount(tx, sale, new Prisma.Decimal('100000000'), new Prisma.Decimal('9999999'));
  assert.equal(created, undefined);
  await service.recordLargeDiscount(tx, sale, new Prisma.Decimal('100000000'), new Prisma.Decimal('15000000'));
  assert.equal(created, undefined);
  await service.recordLargeDiscount(tx, sale, new Prisma.Decimal('100000000'), new Prisma.Decimal('20000000'));
  assert.deepEqual(created?.data.map(item => [item.sourceKey, item.storeId, item.type]), [
    ['sale:sale-1:large-discount', 'store-1', NotificationType.LARGE_DISCOUNT],
  ]);
  assert.match(created!.data[0]!.message, /20%/);
  assert.equal(created?.skipDuplicates, true);
  assert.match(JSON.stringify(recipientFilter), /sales.view/);
});
