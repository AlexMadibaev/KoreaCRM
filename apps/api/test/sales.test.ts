import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DatabaseService } from '../src/database.service';
import type { FinanceService } from '../src/finance/finance.service';
import { SalesService } from '../src/sales/sales.service';
import { saleListSchema } from '../src/sales/sales.schemas';
import type { StockService } from '../src/stock/stock.service';
import type { NotificationsService } from '../src/notifications/notifications.service';
import { defaultLoyaltySettings } from '../src/loyalty/loyalty.rules';

const notifications = { recordLargeReturn: async () => undefined, recordLargeDiscount: async () => undefined } as unknown as NotificationsService;

const storeId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const paymentMethodId = '44444444-4444-4444-8444-444444444444';
const input = { operationId, deviceId: 'POS-1', items: [{ productId, quantity: 1, discountMinor: '0' }], payments: [{ paymentMethodId, amountMinor: '100' }] };

test('sale search filters receipt number and customer phone within the selected store', async () => {
  let where: unknown;
  const db = {
    store: { findFirst: async () => ({ id: storeId }) },
    sale: { findMany: async (options: { where: unknown }) => { where = options.where; return []; }, count: async () => 0 },
    $transaction: async (requests: Promise<unknown>[]) => Promise.all(requests),
  } as unknown as DatabaseService;
  const service = new SalesService(db, {} as StockService, {} as FinanceService, notifications);
  await service.list(storeId, saleListSchema.parse({ search: '  DEMO-0001  ' }));
  assert.deepEqual(where, { storeId, OR: [{ number: { contains: 'DEMO-0001', mode: 'insensitive' } }, { customer: { phone: { contains: 'DEMO-0001' } } }] });
});

test('return history searches receipts within the selected store and uses return date order', async () => {
  let options: { where: unknown; orderBy: unknown } | undefined;
  const db = {
    store: { findFirst: async () => ({ id: storeId }) },
    saleReturn: { findMany: async (query: { where: unknown; orderBy: unknown }) => { options = query; return []; }, count: async () => 0 },
    $transaction: async (requests: Promise<unknown>[]) => Promise.all(requests),
  } as unknown as DatabaseService;
  const service = new SalesService(db, {} as StockService, {} as FinanceService, notifications);
  await service.listReturns(storeId, saleListSchema.parse({ search: ' DEMO-0001 ' }));
  assert.deepEqual(options?.where, { storeId, sale: { OR: [{ number: { contains: 'DEMO-0001', mode: 'insensitive' } }, { customer: { phone: { contains: 'DEMO-0001' } } }] } });
  assert.deepEqual(options?.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
});

test('duplicate product lines are rejected before opening a transaction', async () => {
  let opened = false;
  const db = { $transaction: () => { opened = true; } } as unknown as DatabaseService;
  const service = new SalesService(db, {} as StockService, {} as FinanceService, notifications);
  await assert.rejects(service.create(storeId, { ...input, items: [...input.items, ...input.items] }, 'actor'), BadRequestException);
  assert.equal(opened, false);
});

test('reusing a sale operation ID for another payload is rejected before stock changes', async () => {
  let stockChanged = false;
  const tx = { sale: { findUnique: async () => ({ id: 'existing', operationId, storeId, requestHash: 'other-payload' }) } };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: () => { stockChanged = true; } } as unknown as StockService;
  const service = new SalesService(db, stock, {} as FinanceService, notifications);
  await assert.rejects(service.create(storeId, input, 'actor'), ConflictException);
  assert.equal(stockChanged, false);
});

test('queued sale can create negative stock and records an alert while normal sale is rejected', async () => {
  const alerts: string[] = [];
  let movements = 0;
  let recordedPrice = '';
  const quotedInput = { ...input, items: [{ ...input.items[0]!, priceMinor: '100' }] };
  const tx = {
    sale: { findUnique: async () => null, create: async () => ({ id: 'sale-1' }), findUniqueOrThrow: async () => ({ id: 'sale-1' }) },
    store: { findFirst: async () => ({ id: storeId }) },
    posDevice: { findUnique: async () => ({ storeId, status: 'ACTIVE' }), update: async () => ({}) },
    product: { findFirst: async () => ({ id: productId, sku: 'KR-1' }) },
    loyaltySettings: { findUnique: async () => null },
    storeProductSettings: { findUnique: async () => ({ active: true, priceMinor: 200 }) },
    stock: { findUnique: async () => ({ quantity: 0, reservedQuantity: 0 }) },
    productBatch: { findFirst: async () => ({ id: 'batch-1', purchasePriceMinor: new Prisma.Decimal(40) }) },
    salePaymentMethod: { findMany: async () => [{ id: paymentMethodId, kind: 'CARD', active: true }] },
    saleItem: { create: async ({ data }: { data: { priceMinor: Prisma.Decimal } }) => { recordedPrice = data.priceMinor.toString(); return { id: 'item-1' }; } },
    payment: { create: async () => ({ id: 'payment-1' }) },
    auditLog: { create: async ({ data }: { data: { action: string } }) => { alerts.push(data.action); } },
  };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: async () => { movements += 1; return { newQuantity: -1 }; } } as unknown as StockService;
  const service = new SalesService(db, stock, {} as FinanceService, notifications);
  await assert.rejects(service.create(storeId, quotedInput, 'actor'), ConflictException);
  assert.equal(movements, 0);
  await service.create(storeId, quotedInput, 'actor', true);
  assert.equal(movements, 1);
  assert.equal(recordedPrice, '100');
  assert.ok(alerts.includes('NEGATIVE_STOCK'));
  assert.ok(alerts.includes('OFFLINE_PRICE_DIFFERENCE'));
});

test('bonus payment debits the selected customer once and rejects an insufficient balance', async () => {
  const customerId = '55555555-5555-4555-8555-555555555555';
  const bonusMethodId = '66666666-6666-4666-8666-666666666666';
  let bonusBalance = new Prisma.Decimal(100);
  let savedSale: { id: string; number: string; requestHash: string; storeId: string } | null = null;
  let movements = 0;
  let discountChecks = 0;
  let loyaltyMode: 'DISCOUNT' | 'BONUS' = 'BONUS';
  const bonusEntries: { deltaMinor: Prisma.Decimal; balanceAfterMinor: Prisma.Decimal; operationId: string }[] = [];
  const tx = {
    sale: {
      findUnique: async () => savedSale,
      create: async ({ data }: { data: { requestHash: string; storeId: string; number: string } }) => { savedSale = { id: 'sale-bonus', number: data.number, requestHash: data.requestHash, storeId: data.storeId }; return savedSale; },
      findUniqueOrThrow: async () => savedSale,
    },
    store: { findFirst: async () => ({ id: storeId }) },
    posDevice: { findUnique: async () => ({ storeId, status: 'ACTIVE' }), update: async () => ({}) },
    customer: {
      findFirst: async () => ({ id: customerId, discountPercent: new Prisma.Decimal(0), bonusBalanceMinor: bonusBalance, totalSpentMinor: new Prisma.Decimal(0), debtBalanceMinor: new Prisma.Decimal(0), ordersCount: 0 }),
      findUniqueOrThrow: async () => ({ id: customerId, bonusBalanceMinor: bonusBalance }),
      update: async ({ data }: { data: { bonusBalanceMinor?: Prisma.Decimal } }) => { if (data.bonusBalanceMinor) bonusBalance = data.bonusBalanceMinor; },
    },
    product: { findFirst: async () => ({ id: productId, sku: 'KR-1' }) },
    loyaltySettings: { findUnique: async () => ({ rules: { ...defaultLoyaltySettings, mode: loyaltyMode, bonusEarnPercent: '10' } }) },
    storeProductSettings: { findUnique: async () => ({ active: true, priceMinor: 100 }) },
    stock: { findUnique: async () => ({ quantity: 5, reservedQuantity: 0 }) },
    productBatch: { findFirst: async () => ({ id: 'batch-1', purchasePriceMinor: new Prisma.Decimal(40) }) },
    salePaymentMethod: { findMany: async () => [{ id: bonusMethodId, kind: 'BONUS', active: true }, { id: paymentMethodId, kind: 'CARD', active: true }] },
    bonusTransaction: {
      findUnique: async () => null,
      create: async ({ data }: { data: { deltaMinor: Prisma.Decimal; balanceAfterMinor: Prisma.Decimal; operationId: string } }) => { bonusEntries.push(data); return { id: 'bonus-1' }; },
    },
    saleItem: { create: async () => ({ id: 'item-1' }) },
    payment: { create: async () => ({ id: 'payment-1' }) },
    auditLog: { create: async () => ({}) },
  };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: async () => { movements++; return { newQuantity: 4 }; } } as unknown as StockService;
  const service = new SalesService(db, stock, {} as FinanceService, {
    recordLargeDiscount: async () => { discountChecks++; },
  } as unknown as NotificationsService);
  const request = { ...input, customerId, payments: [{ paymentMethodId: bonusMethodId, amountMinor: '50' }, { paymentMethodId, amountMinor: '50' }] };
  await service.create(storeId, request, 'actor');
  await service.create(storeId, request, 'actor');
  assert.equal(bonusBalance.toString(), '55');
  assert.equal(movements, 1);
  assert.equal(discountChecks, 1);
  assert.equal(bonusEntries.length, 2);
  assert.equal(bonusEntries[0]!.deltaMinor.toString(), '-50');
  assert.equal(bonusEntries[0]!.balanceAfterMinor.toString(), '50');
  assert.equal(bonusEntries[1]!.deltaMinor.toString(), '5');
  assert.equal(bonusEntries[1]!.balanceAfterMinor.toString(), '55');
  savedSale = null;
  await assert.rejects(service.create(storeId, { ...request, operationId: '77777777-7777-4777-8777-777777777777', payments: [{ paymentMethodId: bonusMethodId, amountMinor: '56' }, { paymentMethodId, amountMinor: '44' }] }, 'actor'), ConflictException);
  loyaltyMode = 'DISCOUNT';
  await assert.rejects(service.create(storeId, { ...request, operationId: '88888888-8888-4888-8888-888888888888' }, 'actor'), BadRequestException);
  assert.equal(movements, 1);
});

test('return refuses a card sale before changing stock or cash', async () => {
  let writes = 0;
  const sale = { id: 'sale-1', status: 'COMPLETED', returnRecord: null, cashShiftId: null, debtMinor: new Prisma.Decimal(0), payments: [{ paymentMethod: { kind: 'CARD' } }] };
  const tx = { saleReturn: { findUnique: async () => null, create: async () => { writes++; } }, sale: { findFirst: async () => sale } };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const service = new SalesService(db, { applyMovementInTransaction: async () => { writes++; } } as unknown as StockService, { postCashInTransaction: async () => { writes++; } } as unknown as FinanceService, notifications);
  await assert.rejects(service.returnSale(storeId, 'sale-1', { operationId, deviceId: 'POS-1', cashShiftId: operationId, reason: 'Не подошёл' }, 'actor'), ConflictException);
  assert.equal(writes, 0);
});

test('cash return restores stock and withdraws cash once; replay is read only', async () => {
  let record: { id: string; operationId: string; saleId: string; storeId: string; deviceId: string; cashShiftId: string; reason: string; items: { saleItemId: string; quantity: number }[] } | null = null;
  let stockDelta = 0;
  let cashAmount = '';
  let audit = '';
  let notices = 0;
  const sale = { id: 'sale-1', status: 'COMPLETED', returns: [] as { items: { saleItemId: string; quantity: number }[] }[], cashShiftId: 'original-shift', debtMinor: new Prisma.Decimal(0), totalMinor: new Prisma.Decimal(200), costMinor: new Prisma.Decimal(100), profitMinor: new Prisma.Decimal(100), customerId: null, items: [{ id: 'item-1', productId, quantity: 2, totalMinor: new Prisma.Decimal(200), purchasePriceMinor: new Prisma.Decimal(50) }], payments: [{ paymentMethod: { kind: 'CASH' } }] };
  const tx = {
    saleReturn: { findUnique: async () => record, create: async ({ data }: { data: Omit<NonNullable<typeof record>, 'id' | 'items'> }) => { record = { ...data, id: 'return-1', items: [] }; sale.returns.push(record); return record; } },
    saleReturnItem: { create: async ({ data }: { data: { saleItemId: string; quantity: number } }) => { record!.items.push(data); return { id: 'return-item-1' }; } },
    sale: { findFirst: async () => sale, findUniqueOrThrow: async () => sale },
    employeeRewardTransaction: { findUnique: async () => null },
    posDevice: { findUnique: async () => ({ storeId, status: 'ACTIVE' }), update: async () => ({}) },
    cashShift: { findFirst: async () => ({ status: 'OPEN' }) },
    auditLog: { create: async ({ data }: { data: { action: string } }) => { audit = data.action; } },
  };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: async (_tx: unknown, movement: { delta: number }) => { stockDelta += movement.delta; } } as unknown as StockService;
  const finance = { postCashInTransaction: async (_tx: unknown, cash: { amount: Prisma.Decimal }) => { cashAmount = cash.amount.toString(); } } as unknown as FinanceService;
  const service = new SalesService(db, stock, finance, { recordLargeReturn: async () => { notices++; } } as unknown as NotificationsService);
  const request = { operationId, deviceId: 'POS-1', cashShiftId: operationId, reason: 'Не подошёл' };
  await service.returnSale(storeId, sale.id, request, 'actor');
  await service.returnSale(storeId, sale.id, request, 'actor');
  assert.equal(stockDelta, 2);
  assert.equal(cashAmount, '-200');
  assert.equal(audit, 'SALE_RETURNED');
  assert.equal(notices, 1);
});

test('partial cash returns allocate discounted amount exactly and reject excess quantity', async () => {
  let nextRecord = 0;
  const records: { id: string; operationId: string; saleId: string; storeId: string; deviceId: string; cashShiftId: string; reason: string; items: { saleItemId: string; quantity: number }[] }[] = [];
  const cash: string[] = [];
  const sale = { id: 'sale-1', status: 'COMPLETED', returns: records, cashShiftId: 'shift-old', debtMinor: new Prisma.Decimal(0), totalMinor: new Prisma.Decimal(100), customerId: null, items: [{ id: 'item-1', productId, quantity: 3, totalMinor: new Prisma.Decimal(100), purchasePriceMinor: new Prisma.Decimal(20) }], payments: [{ paymentMethod: { kind: 'CASH' } }] };
  const tx = {
    saleReturn: { findUnique: async ({ where }: { where: { operationId: string } }) => records.find(record => record.operationId === where.operationId) ?? null, create: async ({ data }: { data: Omit<(typeof records)[number], 'id' | 'items'> }) => { const record = { ...data, id: `return-${++nextRecord}`, items: [] }; records.push(record); return record; } },
    saleReturnItem: { create: async ({ data }: { data: { saleReturnId: string; saleItemId: string; quantity: number } }) => { records.find(record => record.id === data.saleReturnId)!.items.push(data); return { id: `return-item-${nextRecord}` }; } },
    sale: { findFirst: async () => sale, findUniqueOrThrow: async () => sale },
    employeeRewardTransaction: { findUnique: async () => null },
    posDevice: { findUnique: async () => ({ storeId, status: 'ACTIVE' }), update: async () => ({}) },
    cashShift: { findFirst: async () => ({ status: 'OPEN' }) },
    auditLog: { create: async () => ({}) },
  };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const stock = { applyMovementInTransaction: async () => ({}) } as unknown as StockService;
  const finance = { postCashInTransaction: async (_tx: unknown, input: { amount: Prisma.Decimal }) => { cash.push(input.amount.toString()); } } as unknown as FinanceService;
  const service = new SalesService(db, stock, finance, notifications);
  const request = (id: string, quantity: number) => ({ operationId: id, deviceId: 'POS-1', cashShiftId: operationId, reason: 'Не подошёл', items: [{ saleItemId: 'item-1', quantity }] });
  await service.returnSale(storeId, sale.id, request('return-op-1', 1), 'actor');
  await assert.rejects(service.returnSale(storeId, sale.id, request('return-op-1', 2), 'actor'), ConflictException);
  await assert.rejects(service.returnSale(storeId, sale.id, request('return-op-excess', 3), 'actor'), ConflictException);
  await service.returnSale(storeId, sale.id, request('return-op-2', 1), 'actor');
  await service.returnSale(storeId, sale.id, request('return-op-3', 1), 'actor');
  assert.deepEqual(cash, ['-33', '-33', '-34']);
  assert.equal(records.length, 3);
});
