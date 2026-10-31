import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseService } from '../src/database.service';
import type { FinanceService } from '../src/finance/finance.service';
import { normalizeCustomerName } from '../src/customers/customer-name';
import { CustomersService } from '../src/customers/customers.service';

test('formats Cyrillic, Tajik and Latin customer names consistently', () => {
  const cases = [
    ['  аЛЕКСАНДР   мАДИБАЕВ  ', 'Александр Мадибаев'],
    ['ҶӮРАБЕК-ЁЛКА', 'Ҷӯрабек-Ёлка'],
    ["o'CONNOR", "O'Connor"],
    ['ANNA-MARIA', 'Anna-Maria'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeCustomerName(input), expected);
    assert.equal(normalizeCustomerName(expected), expected);
  }
});

test('customer creation saves normalized names for every client', async () => {
  const db = {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      customer: { create: async ({ data }: { data: { firstName: string; lastName: string | null; phone: string } }) => {
        assert.equal(data.firstName, 'Александр');
        assert.equal(data.lastName, 'Мадибаев');
        return { id: 'customer-1', phone: data.phone, discountPercent: { gt: () => false } };
      } },
      auditLog: { create: async () => undefined },
    }),
  } as unknown as DatabaseService;
  await new CustomersService(db, {} as FinanceService).create({ firstName: 'аЛЕКСАНДР', lastName: 'мАДИБАЕВ', phone: '+992900000000' }, 'user-1');
});

test('customer edit normalizes only submitted names', async () => {
  const db = {
    customer: { findFirst: async () => ({ id: 'customer-1' }) },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      customer: { update: async ({ data }: { data: { lastName?: string | null; firstName?: string; phone?: string } }) => {
        assert.deepEqual(data, { lastName: 'Анна-Мария' });
        return { id: 'customer-1', lastName: data.lastName };
      } },
      auditLog: { create: async () => undefined },
    }),
  } as unknown as DatabaseService;
  await new CustomersService(db, {} as FinanceService).edit('customer-1', { lastName: 'АННА-МАРИЯ' }, 'user-1');
});
