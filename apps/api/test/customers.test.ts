import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import type { DatabaseService } from '../src/database.service';
import type { FinanceService } from '../src/finance/finance.service';
import { CustomersService } from '../src/customers/customers.service';
import { bonusCorrectionSchema, commentSchema } from '../src/customers/customers.schemas';
import { defaultSegmentSettings, deriveCustomerSegments } from '../src/customers/customer-segments';

test('customer text search does not include an empty match-all branch', async () => {
  let where: Prisma.CustomerWhereInput | undefined;
  const db = {
    customerSegmentSettings: { findUnique: async () => null },
    customer: {
      findMany: ({ where: filter }: { where: Prisma.CustomerWhereInput }) => { where = filter; return Promise.resolve([]); },
      count: async () => 0,
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as DatabaseService;
  await new CustomersService(db, {} as FinanceService).list({ search: 'Анна', page: 1, limit: 20 });
  assert.equal(where?.OR?.length, 3);
  assert.ok(where?.OR?.every(condition => Object.values(condition).every(value => value !== undefined)));
});

test('customer segments use purchase count, spend and recency thresholds', () => {
  const now = new Date('2026-10-13T12:00:00.000Z');
  const vip = deriveCustomerSegments({ ordersCount: 5, totalSpentMinor: '500000000', averageCheckMinor: '100000000' }, new Date('2026-10-12T12:00:00.000Z'), 3, now);
  assert.deepEqual(vip.map(item => item.code), ['REGULAR', 'VIP', 'HIGH_CHECK', 'FREQUENT']);
  const dormant = deriveCustomerSegments({ ordersCount: 1, totalSpentMinor: '10000', averageCheckMinor: '10000' }, new Date('2026-01-01T00:00:00.000Z'), 0, now);
  assert.deepEqual(dormant.map(item => item.code), ['NEW', 'DORMANT']);
});

test('changed segment rules apply immediately and disabled rules disappear', () => {
  const settings = { ...defaultSegmentSettings, NEW: { enabled: false, maxOrders: 2 }, REGULAR: { enabled: true, minOrders: 2 }, VIP: { enabled: true, minOrders: 2, minSpentMinor: '10000' } };
  const segments = deriveCustomerSegments({ ordersCount: 2, totalSpentMinor: '12000', averageCheckMinor: '6000' }, null, 0, new Date('2026-10-13T12:00:00.000Z'), settings);
  assert.deepEqual(segments.map(item => item.code), ['REGULAR', 'VIP']);
});

test('frequent segment filters the customer list before pagination', async () => {
  let where: Prisma.CustomerWhereInput | undefined;
  const db = {
    customerSegmentSettings: { findUnique: async () => null },
    sale: { groupBy: async () => [{ customerId: 'customer-1', _count: { _all: 3 } }, { customerId: 'customer-2', _count: { _all: 2 } }] },
    customer: { findMany: ({ where: filter }: { where: Prisma.CustomerWhereInput }) => { where = filter; return Promise.resolve([]); }, count: async () => 0 },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as DatabaseService;
  await new CustomersService(db, {} as FinanceService).list({ segment: 'FREQUENT', page: 1, limit: 20 });
  assert.deepEqual(where?.AND, [{ id: { in: ['customer-1'] }, ordersCount: { gte: 3 } }]);
});

test('customer history restricts purchases, returns and debt entries to assigned stores', async () => {
  const filters: unknown[] = [];
  const db = {
    customer: { findFirst: async () => ({ id: 'customer-1' }) },
    sale: { findMany: ({ where }: { where: unknown }) => { filters.push(where); return Promise.resolve([]); }, count: async () => 0 },
    saleReturn: { findMany: ({ where }: { where: unknown }) => { filters.push(where); return Promise.resolve([]); }, count: async () => 0 },
    customerDebtEntry: { findMany: ({ where }: { where: unknown }) => { filters.push(where); return Promise.resolve([]); }, count: async () => 0 },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as DatabaseService;
  const service = new CustomersService(db, {} as FinanceService);
  const actor = { userId: 'employee-1', permissions: ['customers.view'], allStores: false, storeIds: ['store-a'] };
  await service.history('customer-1', { kind: 'sales', page: 1, limit: 10 }, actor);
  await service.history('customer-1', { kind: 'returns', page: 1, limit: 10 }, actor);
  await service.history('customer-1', { kind: 'debts', page: 1, limit: 10 }, actor);
  assert.deepEqual(filters, [
    { customerId: 'customer-1', storeId: { in: ['store-a'] } },
    { sale: { customerId: 'customer-1' }, storeId: { in: ['store-a'] } },
    { customerId: 'customer-1', OR: [{ sale: { storeId: { in: ['store-a'] } } }, { customerPayment: { storeId: { in: ['store-a'] } } }] },
  ]);
});

test('customer comments use the signed-in author and audit the event without copying the text', async () => {
  let saved: { customerId: string; authorId: string; text: string } | undefined;
  let audited: { userId: string; action: string; newValue: unknown } | undefined;
  const tx = {
    customer: { findFirst: async () => ({ id: 'customer-1' }) },
    customerComment: { create: async ({ data }: { data: typeof saved }) => { saved = data; return { id: 'comment-1', text: data?.text }; } },
    auditLog: { create: async ({ data }: { data: typeof audited }) => { audited = data; } },
  };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const result = await new CustomersService(db, {} as FinanceService).addComment('customer-1', commentSchema.parse({ text: '  Просит написать о поступлении крема  ' }), 'employee-1');
  assert.deepEqual(saved, { customerId: 'customer-1', authorId: 'employee-1', text: 'Просит написать о поступлении крема' });
  assert.deepEqual(audited?.newValue, { customerId: 'customer-1' });
  assert.equal(audited?.action, 'CUSTOMER_COMMENT_CREATED');
  assert.equal(result.id, 'comment-1');
  assert.equal(commentSchema.safeParse({ text: '   ' }).success, false);
});

test('bonus correction is audited, idempotent, and cannot make the balance negative', async () => {
  let balance = new Prisma.Decimal(10000);
  const records = new Map<string, { customerId: string; type: 'CORRECTION'; deltaMinor: Prisma.Decimal; reason: string; operationId: string }>();
  const audits: unknown[] = [];
  const tx = {
    customer: { findFirst: async () => ({ id: 'customer-1', bonusBalanceMinor: balance }), update: async ({ data }: { data: { bonusBalanceMinor: Prisma.Decimal } }) => { balance = data.bonusBalanceMinor; } },
    bonusTransaction: {
      findUnique: async ({ where }: { where: { operationId: string } }) => records.get(where.operationId) ?? null,
      create: async ({ data }: { data: { operationId: string; customerId: string; type: 'CORRECTION'; deltaMinor: Prisma.Decimal; reason: string } }) => { const record = { ...data, id: 'bonus-1' }; records.set(data.operationId, record); return record; },
    },
    auditLog: { create: async ({ data }: { data: unknown }) => { audits.push(data); } },
  };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  const service = new CustomersService(db, {} as FinanceService);
  const input = bonusCorrectionSchema.parse({ operationId: '11111111-1111-4111-8111-111111111111', deltaMinor: '-2500', reason: 'Исправление ошибочного начисления' });
  await service.correctBonus('customer-1', input, 'owner-1');
  await service.correctBonus('customer-1', input, 'owner-1');
  assert.equal(balance.toString(), '7500');
  assert.equal(records.size, 1);
  assert.equal(audits.length, 1);
  await assert.rejects(service.correctBonus('customer-1', { ...input, operationId: '22222222-2222-4222-8222-222222222222', deltaMinor: '-8000' }, 'owner-1'), /Bonus balance cannot be negative/);
  assert.equal(balance.toString(), '7500');
});

test('customer activity merges sale, bonus and profile events while restricting store transactions', async () => {
  const filters: unknown[] = [];
  const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`);
  const db = {
    customer: { findFirst: async () => ({ id: 'customer-1' }) },
    sale: { findMany: async ({ where }: { where: unknown }) => { filters.push(where); return [{ id: 'sale-1', number: '01', totalMinor: { toString: () => '10000' }, createdAt: at(12), store: { name: 'Магазин' }, employee: { name: 'Кассир' } }]; }, count: async () => 1 },
    saleReturn: { findMany: async ({ where }: { where: unknown }) => { filters.push(where); return [{ id: 'return-1', amountMinor: { toString: () => '3000' }, createdAt: at(11), sale: { number: '01' } }]; }, count: async () => 1 },
    customerPayment: { findMany: async ({ where }: { where: unknown }) => { filters.push(where); return [{ id: 'payment-1', amountMinor: { toString: () => '2000' }, createdAt: at(10), paymentMethod: { name: 'Карта' }, employee: { name: 'Менеджер' } }]; }, count: async () => 1 },
    customerComment: { findMany: async () => [{ id: 'comment-1', text: 'Запрос', createdAt: at(9), author: { name: 'Менеджер' } }], count: async () => 1 },
    bonusTransaction: { findMany: async () => [{ id: 'bonus-1', type: 'CORRECTION', deltaMinor: { toString: () => '500' }, reason: 'Исправление', createdAt: at(7), actor: { name: 'Менеджер' } }], count: async () => 1 },
    auditLog: { findMany: async () => [{ id: 'audit-1', action: 'CUSTOMER_CREATED', createdAt: at(8), user: { name: 'Менеджер' } }], count: async () => 1 },
  } as unknown as DatabaseService;
  const service = new CustomersService(db, {} as FinanceService);
  const result = await service.activity('customer-1', { page: 2, limit: 2 }, { userId: 'employee-1', permissions: ['customers.view'], allStores: false, storeIds: ['store-a'] });
  assert.equal(result.total, 6);
  assert.deepEqual(result.items.map(item => item.kind), ['PAYMENT', 'COMMENT']);
  const later = await service.activity('customer-1', { page: 3, limit: 2 }, { userId: 'employee-1', permissions: ['customers.view'], allStores: false, storeIds: ['store-a'] });
  assert.deepEqual(later.items.map(item => item.kind), ['PROFILE', 'BONUS']);
  assert.deepEqual(filters.slice(0, 3), [
    { customerId: 'customer-1', storeId: { in: ['store-a'] } },
    { sale: { customerId: 'customer-1' }, storeId: { in: ['store-a'] } },
    { customerId: 'customer-1', storeId: { in: ['store-a'] } },
  ]);
});
