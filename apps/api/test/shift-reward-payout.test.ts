import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinanceService } from '../src/finance/finance.service';
import type { DatabaseService } from '../src/database.service';

const d = (value: number | string) => new Prisma.Decimal(value);

function fixture() {
  const balances: Record<string, Prisma.Decimal> = { first: d(30), second: d(60), closer: d(999) };
  let earned = d(30);
  let shift = { id: 'shift-a', storeId: 'store', deviceId: 'pos', openedById: 'first', status: 'OPEN', expectedCashMinor: d(1000), actualCashMinor: null as Prisma.Decimal | null, closingCashMinor: null as Prisma.Decimal | null, closedById: null as string | null, closingComment: null as string | null };
  const operations: Prisma.CashOperationUncheckedCreateInput[] = [];
  const payouts = new Map<string, Prisma.EmployeeRewardPayoutUncheckedCreateInput>();
  const tx = {
    cashShift: {
      findFirst: async ({ where }: { where: { status?: string } }) => where.status && where.status !== shift.status ? null : { ...shift },
      update: async ({ data }: { data: Partial<typeof shift> }) => { Object.assign(shift, data); return { ...shift }; },
      create: async ({ data }: { data: { openedById: string; openingCashMinor: Prisma.Decimal; expectedCashMinor: Prisma.Decimal } }) => { shift = { ...shift, ...data, id: 'shift-b', status: 'OPEN', closedById: null, closingCashMinor: null, actualCashMinor: null }; earned = d(60); return { ...shift }; },
    },
    user: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id, rewardBalanceMinor: balances[where.id] }),
      update: async ({ where, data }: { where: { id: string }; data: { rewardBalanceMinor: Prisma.Decimal } }) => { balances[where.id] = data.rewardBalanceMinor; },
    },
    sale: { findMany: async ({ where }: { where: { employeeId: string; cashShiftId: string } }) => { assert.equal(where.employeeId, shift.openedById); assert.equal(where.cashShiftId, shift.id); return [{ id: 'receipt' }]; } },
    employeeRewardTransaction: { aggregate: async () => ({ _sum: { deltaMinor: earned } }) },
    employeeRewardPayout: {
      findUnique: async ({ where }: { where: { cashShiftId: string } }) => payouts.get(where.cashShiftId) ?? null,
      create: async ({ data }: { data: Prisma.EmployeeRewardPayoutUncheckedCreateInput }) => { assert.equal(payouts.has(data.cashShiftId), false); payouts.set(data.cashShiftId, data); return data; },
    },
    cashOperation: {
      findUnique: async () => null,
      create: async ({ data }: { data: Prisma.CashOperationUncheckedCreateInput }) => { operations.push(data); return { id: 'operation', ...data }; },
    },
    auditLog: { create: async () => ({}) },
  };
  const db = { store: { findFirst: async () => ({ id: 'store' }) }, $transaction: async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DatabaseService;
  return { service: new FinanceService(db), balances, operations, payouts, shift: () => shift, setBalance: (value: number) => { balances.first = d(value); } };
}

test('two successive shifts pay their opener once and carry cash after payout to the next cashier', async () => {
  const f = fixture();
  const close = { actualCashMinor: '1000', rewardPayoutMinor: '30' };
  await f.service.closeShift('store', 'shift-a', close, 'closer');
  await f.service.closeShift('store', 'shift-a', close, 'closer');
  assert.equal(f.shift().actualCashMinor?.toString(), '1000');
  assert.equal(f.shift().closingCashMinor?.toString(), '970');
  assert.equal(f.shift().expectedCashMinor.toString(), '970');
  assert.equal(f.balances.first.toString(), '0');
  assert.equal(f.balances.closer.toString(), '999');
  assert.equal(f.payouts.get('shift-a')?.employeeId, 'first');
  assert.equal(f.operations.length, 1);
  assert.equal(String(f.operations[0].amountMinor), '-30');
  await f.service.openShift('store', { deviceId: 'pos', openingCashMinor: '970' }, 'second');
  await f.service.closeShift('store', 'shift-b', { actualCashMinor: '970', rewardPayoutMinor: '60' }, 'second');
  assert.equal(f.shift().closingCashMinor?.toString(), '910');
  assert.equal(f.payouts.get('shift-b')?.employeeId, 'second');
  assert.equal(f.balances.second.toString(), '0');
});

test('unconfirmed/stale payout and insufficient cash fail before writes', async () => {
  const f = fixture();
  await assert.rejects(f.service.closeShift('store', 'shift-a', { actualCashMinor: '1000' }, 'first'), ConflictException);
  await assert.rejects(f.service.closeShift('store', 'shift-a', { actualCashMinor: '1000', rewardPayoutMinor: '29' }, 'first'), ConflictException);
  await assert.rejects(f.service.closeShift('store', 'shift-a', { actualCashMinor: '20', rewardPayoutMinor: '30' }, 'first'), ConflictException);
  assert.equal(f.operations.length, 0);
  assert.equal(f.payouts.size, 0);
});

test('reversal of a previously paid sale reduces the next available payout', async () => {
  const f = fixture();
  f.setBalance(10);
  await f.service.closeShift('store', 'shift-a', { actualCashMinor: '1000', rewardPayoutMinor: '10' }, 'first');
  assert.equal(String(f.payouts.get('shift-a')?.amountMinor), '10');
  assert.equal(f.balances.first.toString(), '0');
});
