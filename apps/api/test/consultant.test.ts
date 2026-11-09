import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { consultantPeriods } from '../src/employees/consultant-periods';
import {
  ConsultantService,
  consultantSalesWhere,
} from '../src/employees/consultant.service';
import type { AccessContext } from '../src/auth/policy';
import type { DatabaseService } from '../src/database.service';
const actor = {
  userId: 'consultant',
  allStores: false,
  storeIds: ['store-1'],
  permissions: ['sales.create'],
  role: 'CASHIER',
} as AccessContext;

test('consultant periods cross local midnight, quarter and year boundaries in Dushanbe', () => {
  const periods = consultantPeriods(new Date('2026-12-31T20:00:00Z'));
  assert.equal(periods.day.from.toISOString(), '2026-12-31T19:00:00.000Z');
  assert.equal(periods.month.from.toISOString(), '2026-12-31T19:00:00.000Z');
  assert.equal(periods.quarter.to.toISOString(), '2027-03-31T19:00:00.000Z');
  assert.equal(
    consultantPeriods(new Date('2026-11-08T18:59:59Z')).day.from.toISOString(),
    '2026-11-07T19:00:00.000Z',
  );
});

test('consultant attribution scopes stores and uses seller before the legacy cashier fallback', () => {
  assert.deepEqual(consultantSalesWhere(actor), {
    storeId: { in: ['store-1'] },
    status: 'COMPLETED',
    OR: [
      { sellerId: 'consultant' },
      { sellerId: null, employeeId: 'consultant' },
    ],
  });
});

test('consultant metrics deduct returns, compute average check and never select costs', async () => {
  const calls: unknown[] = [];
  const tx = {
    sale: {
      aggregate: async (query: unknown) => {
        calls.push(query);
        return {
          _count: { id: 2 },
          _sum: { totalMinor: new Prisma.Decimal(10001) },
        };
      },
    },
    saleReturn: {
      aggregate: async (query: unknown) => {
        calls.push(query);
        return { _sum: { amountMinor: new Prisma.Decimal(3000) } };
      },
    },
    cashShift: { count: async () => 1 },
  };
  const db = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as unknown as DatabaseService;
  const result = await new ConsultantService(db).performance(actor);
  assert.equal(result.month.netMinor, '7001');
  assert.equal(result.month.averageCheckMinor, '5001');
  assert.equal(result.month.closedShiftCount, 1);
  for (const query of calls)
    assert.equal(JSON.stringify(query).includes('costMinor'), false);
});
