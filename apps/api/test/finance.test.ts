import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinanceService } from '../src/finance/finance.service';
import type { DatabaseService } from '../src/database.service';

const storeId = '11111111-1111-4111-8111-111111111111';
const shiftId = '22222222-2222-4222-8222-222222222222';
const categoryId = '33333333-3333-4333-8333-333333333333';
const purchaseId = '44444444-4444-4444-8444-444444444444';
const operationId = '55555555-5555-4555-8555-555555555555';

test('cash expense posts a negative cash operation in the same transaction', async () => {
  let operationAmount = '';
  let expectedCash = '';
  const tx = {
    expenseCategory: { findFirst: async () => ({ id: categoryId }) },
    expense: { findUnique: async () => null, create: async () => ({ id: 'expense-1' }) },
    cashOperation: { findUnique: async () => null, create: async ({ data }: { data: { amountMinor: Prisma.Decimal } }) => { operationAmount = data.amountMinor.toString(); return { id: 'cash-operation-1' }; } },
    cashShift: { findFirst: async () => ({ id: shiftId, status: 'OPEN', expectedCashMinor: new Prisma.Decimal(1000) }), update: async ({ data }: { data: { expectedCashMinor: Prisma.Decimal } }) => { expectedCash = data.expectedCashMinor.toString(); } },
    auditLog: { create: async () => ({}) },
  };
  const db = { store: { findFirst: async () => ({ id: storeId }) }, $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  await new FinanceService(db).createExpense(storeId, { operationId, categoryId, amountMinor: '200', paymentMethod: 'CASH', cashShiftId: shiftId, date: '2026-10-10' }, 'user-1');
  assert.equal(operationAmount, '-200');
  assert.equal(expectedCash, '800');
});

test('repeated expense operation does not create another cash withdrawal', async () => {
  let writes = 0;
  const existing = { id: 'expense-1', operationId, storeId, categoryId, amountMinor: new Prisma.Decimal(200), paymentMethod: 'CASH', date: new Date('2026-10-10T00:00:00.000Z'), description: null, attachmentKey: null };
  const tx = {
    expense: { findUnique: async () => existing, create: async () => { writes++; } },
    cashOperation: { findUnique: async () => ({ cashShiftId: shiftId }), create: async () => { writes++; } },
  };
  const db = { store: { findFirst: async () => ({ id: storeId }) }, $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const result = await new FinanceService(db).createExpense(storeId, { operationId, categoryId, amountMinor: '200', paymentMethod: 'CASH', cashShiftId: shiftId, date: '2026-10-10' }, 'user-1');
  assert.equal(result.id, existing.id);
  assert.equal(writes, 0);
});

test('supplier payment cannot exceed the purchase debt', async () => {
  let writes = 0;
  const tx = {
    supplierPayment: { findUnique: async () => null, create: async () => { writes++; } },
    purchase: { findFirst: async () => ({ id: purchaseId, supplierId: 'supplier-1', debtMinor: new Prisma.Decimal(100) }) },
  };
  const db = { store: { findFirst: async () => ({ id: storeId }) }, $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  await assert.rejects(new FinanceService(db).paySupplier(storeId, { operationId, purchaseId, amountMinor: '101', paymentMethod: 'CARD' }, 'user-1'), ConflictException);
  assert.equal(writes, 0);
});

test('repeated supplier payment returns its prior record without paying twice', async () => {
  let writes = 0;
  const existing = { id: 'payment-1', operationId, purchaseId, storeId, amountMinor: new Prisma.Decimal(75), paymentMethod: 'BANK_TRANSFER', cashShiftId: null };
  const tx = { supplierPayment: { findUnique: async () => existing }, purchase: { update: async () => { writes++; } }, supplier: { update: async () => { writes++; } } };
  const db = { store: { findFirst: async () => ({ id: storeId }) }, $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const result = await new FinanceService(db).paySupplier(storeId, { operationId, purchaseId, amountMinor: '75', paymentMethod: 'BANK_TRANSFER' }, 'user-1');
  assert.equal(result.id, existing.id);
  assert.equal(writes, 0);
});

test('cash operation replay does not change balance after a shift closes', async () => {
  let shiftReads = 0;
  const existing = { id: 'operation-1', cashShiftId: shiftId, storeId, type: 'DEPOSIT', amountMinor: new Prisma.Decimal(50) };
  const tx = { cashOperation: { findUnique: async () => existing }, cashShift: { findFirst: async () => { shiftReads++; return { status: 'CLOSED' }; } } };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const result = await new FinanceService(db).createCashOperation(storeId, shiftId, { operationId, type: 'DEPOSIT', amountMinor: '50', comment: 'Test' }, 'user-1');
  assert.equal(result.id, existing.id);
  assert.equal(shiftReads, 0);
});

test('cash withdrawal refuses a refund larger than the drawer balance', async () => {
  let writes = 0;
  const tx = {
    cashOperation: { findUnique: async () => null, create: async () => { writes++; } },
    cashShift: { findFirst: async () => ({ id: shiftId, status: 'OPEN', expectedCashMinor: new Prisma.Decimal(99) }), update: async () => { writes++; } },
  };
  const service = new FinanceService({} as DatabaseService);
  await assert.rejects(service.postCashInTransaction(tx as never, { storeId, shiftId, actorId: 'user-1', type: 'WITHDRAWAL', amount: new Prisma.Decimal(-100), sourceType: 'SALE_RETURN', sourceId: 'return-1' }), ConflictException);
  assert.equal(writes, 0);
});

test('summary combines completed sales and expenses', async () => {
  const aggregate = (field: string, value: string) => ({ _sum: { [field]: new Prisma.Decimal(value) } });
  const db = {
    store: { findMany: async () => [{ id: storeId }] },
    expense: { aggregate: () => Promise.resolve(aggregate('amountMinor', '50')) },
    cashOperation: { aggregate: () => Promise.resolve(aggregate('amountMinor', '-50')) },
    purchase: { aggregate: () => Promise.resolve(aggregate('debtMinor', '100')) },
    supplierPayment: { aggregate: () => Promise.resolve(aggregate('amountMinor', '25')) },
    cashShift: { aggregate: () => Promise.resolve(aggregate('expectedCashMinor', '200')) },
    sale: { aggregate: () => Promise.resolve({ _count: { id: 2 }, _sum: { totalMinor: new Prisma.Decimal(500), costMinor: new Prisma.Decimal(300), profitMinor: new Prisma.Decimal(200), discountMinor: new Prisma.Decimal(50) } }) },
    saleReturn: { aggregate: () => Promise.resolve({ _count: { id: 1 }, _sum: { amountMinor: new Prisma.Decimal(100), costMinor: new Prisma.Decimal(60), profitMinor: new Prisma.Decimal(40) } }) },
    customer: { aggregate: () => Promise.resolve(aggregate('debtBalanceMinor', '75')) },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as DatabaseService;
  const report = await new FinanceService(db).summary({ from: '2026-10-01', to: '2026-10-10' }, { userId: 'user-1', permissions: ['finance.view'], allStores: true, storeIds: [] });
  assert.equal(report.expensesMinor, '50');
  assert.equal(report.cashDrawerFlowMinor, '-50');
  assert.equal(report.supplierDebtMinor, '100');
  assert.equal(report.revenueMinor, '400');
  assert.equal(report.cogsMinor, '240');
  assert.equal(report.grossProfitMinor, '160');
  assert.equal(report.operationalResultMinor, '110');
  assert.equal(report.customerDebtMinor, '75');
  assert.equal(report.cashFlowMinor, null);
  assert.equal(report.checksCount, 2);
  assert.equal(report.averageCheckMinor, '250');
  assert.equal(report.discountsMinor, '50');
  assert.equal(report.returnsCount, 1);
  assert.equal(report.returnsMinor, '100');
});

test('finance report defaults to active stores and can include archived history explicitly', async () => {
  const filters: unknown[] = [];
  const db = { store: { findMany: async (query: { where: unknown }) => { filters.push(query.where); return [{ id: storeId }]; } } } as unknown as DatabaseService;
  const service = new FinanceService(db);
  const access = { userId: 'user-1', permissions: ['finance.view'], allStores: true, storeIds: [] };
  await service.stores(access);
  await service.stores(access, 'all');
  assert.deepEqual(filters, [
    { deletedAt: null, status: 'ACTIVE', id: undefined },
    { deletedAt: undefined, status: undefined, id: undefined },
  ]);
});

test('sales trend fills days without transactions and calculates negative net revenue', async () => {
  const db = { $queryRaw: async () => [
    { day: '2026-10-01', salesMinor: new Prisma.Decimal(500), returnsMinor: new Prisma.Decimal(100), checksCount: new Prisma.Decimal(2) },
    { day: '2026-10-03', salesMinor: new Prisma.Decimal(0), returnsMinor: new Prisma.Decimal(200), checksCount: new Prisma.Decimal(0) },
  ] } as unknown as DatabaseService;
  const result = await new FinanceService(db).salesTrend({ from: '2026-10-01', to: '2026-10-03', storeId }, { userId: 'user-1', permissions: ['finance.view'], allStores: false, storeIds: [storeId] });
  assert.deepEqual(result.days, [
    { date: '2026-10-01', salesMinor: '500', returnsMinor: '100', netMinor: '400', checksCount: 2 },
    { date: '2026-10-02', salesMinor: '0', returnsMinor: '0', netMinor: '0', checksCount: 0 },
    { date: '2026-10-03', salesMinor: '0', returnsMinor: '200', netMinor: '-200', checksCount: 0 },
  ]);
});

test('sales trend refuses a store outside the employee scope', async () => {
  const db = { $queryRaw: async () => { throw Error('Query must not run'); } } as unknown as DatabaseService;
  await assert.rejects(new FinanceService(db).salesTrend({ from: '2026-10-01', to: '2026-10-03', storeId }, { userId: 'user-1', permissions: ['finance.view'], allStores: false, storeIds: [] }), ForbiddenException);
});

test('top products returns net sold quantity and revenue in ranking order', async () => {
  const db = { $queryRaw: async () => [
    { productId: 'product-1', name: 'First', sku: 'SKU-1', netQuantity: new Prisma.Decimal(4), netRevenueMinor: new Prisma.Decimal(600) },
    { productId: 'product-2', name: 'Second', sku: 'SKU-2', netQuantity: new Prisma.Decimal(2), netRevenueMinor: new Prisma.Decimal(100) },
  ] } as unknown as DatabaseService;
  const result = await new FinanceService(db).topProducts({ from: '2026-10-01', to: '2026-10-03', storeId }, { userId: 'user-1', permissions: ['finance.view'], allStores: false, storeIds: [storeId] });
  assert.deepEqual(result.items, [
    { productId: 'product-1', name: 'First', sku: 'SKU-1', quantity: 4, revenueMinor: '600' },
    { productId: 'product-2', name: 'Second', sku: 'SKU-2', quantity: 2, revenueMinor: '100' },
  ]);
});

test('top products does not query data outside the employee scope', async () => {
  let queried = false;
  const db = { $queryRaw: async () => { queried = true; return []; } } as unknown as DatabaseService;
  const service = new FinanceService(db);
  const access = { userId: 'user-1', permissions: ['finance.view'], allStores: false, storeIds: [] };
  const empty = await service.topProducts({ from: '2026-10-01', to: '2026-10-03' }, access);
  assert.deepEqual(empty.items, []);
  assert.equal(queried, false);
  await assert.rejects(service.topProducts({ from: '2026-10-01', to: '2026-10-03', storeId }, access), ForbiddenException);
});
