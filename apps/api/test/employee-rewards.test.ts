import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { SalesService } from '../src/sales/sales.service';
import type { DatabaseService } from '../src/database.service';
import type { StockService } from '../src/stock/stock.service';
import type { FinanceService } from '../src/finance/finance.service';
import type { NotificationsService } from '../src/notifications/notifications.service';
import { rewardPercentSchema } from '../src/employees/employees.schemas';

const decimal = (value: string | number) => new Prisma.Decimal(value);

function fixture(rate = '3') {
  let created = false;
  let balance = decimal(0);
  let percent = decimal(rate);
  const ledger: Prisma.EmployeeRewardTransactionUncheckedCreateInput[] = [];
  type Returned = { id: string; operationId: string; saleId: string; amountMinor: Prisma.Decimal; items: { saleItemId: string; quantity: number }[]; payments: { paymentId: string; amountMinor: Prisma.Decimal }[] };
  let pending: Returned | undefined;
  const sale = {
    id: 'sale', number: '1', storeId: 'store', status: 'COMPLETED', operationId: 'original', requestHash: '', customerId: null,
    totalMinor: decimal(1001), items: [{ id: 'item', productId: 'product', quantity: 3, totalMinor: decimal(1001), purchasePriceMinor: decimal(0) }],
    payments: [{ id: 'payment', paymentMethodId: 'card', amountMinor: decimal(1001), paymentMethod: { kind: 'CARD' } }], returns: [] as Returned[],
  };
  const tx = {
    sale: {
      findUnique: async () => created ? sale : null,
      findFirst: async () => sale,
      aggregate: async () => ({ _max: { sequence: 0 } }),
      create: async ({ data }: { data: { requestHash: string } }) => { created = true; sale.requestHash = data.requestHash; return sale; },
      findUniqueOrThrow: async () => sale,
    },
    store: { findFirst: async () => ({ id: 'store' }) },
    posDevice: { findUnique: async () => ({ storeId: 'store', status: 'ACTIVE' }), update: async () => ({}) },
    cashShift: { findFirst: async () => ({ id: 'shift' }) },
    product: { findFirst: async () => ({ id: 'product', sku: 'A' }) },
    loyaltySettings: { findUnique: async () => null },
    storeProductSettings: { findUnique: async () => ({ active: true, priceMinor: 1001, costBasisMinor: 0 }) },
    productBatch: { findFirst: async () => null },
    salePaymentMethod: { findMany: async () => [{ id: 'card', kind: 'CARD', active: true }] },
    saleItem: { create: async () => ({ id: 'item' }) },
    payment: { create: async () => ({ id: 'payment' }) },
    user: {
      findUniqueOrThrow: async () => ({ id: 'employee', rewardPercent: percent, rewardBalanceMinor: balance }),
      update: async ({ where, data }: { where: { id: string }; data: { rewardBalanceMinor: Prisma.Decimal } }) => { assert.equal(where.id, 'employee'); balance = data.rewardBalanceMinor; },
    },
    employeeRewardTransaction: {
      findUnique: async ({ where }: { where: { operationId: string } }) => { const row = ledger.find(entry => entry.operationId === where.operationId); return row ? { ...row, deltaMinor: decimal(String(row.deltaMinor)) } : null; },
      create: async ({ data }: { data: Prisma.EmployeeRewardTransactionUncheckedCreateInput }) => { assert.equal(data.employeeId, 'employee'); ledger.push(data); return data; },
    },
    saleReturn: {
      findUnique: async ({ where }: { where: { operationId: string } }) => sale.returns.find(row => row.operationId === where.operationId) ?? null,
      create: async ({ data }: { data: { operationId: string; saleId: string; amountMinor: Prisma.Decimal } }) => { pending = { ...data, id: `return-${sale.returns.length}`, items: [], payments: [] }; return pending; },
    },
    saleReturnItem: { create: async ({ data }: { data: { saleItemId: string; quantity: number } }) => { pending!.items.push(data); return { id: 'return-item' }; } },
    saleReturnPayment: { create: async ({ data }: { data: { paymentId: string; amountMinor: Prisma.Decimal } }) => { pending!.payments.push(data); } },
    auditLog: { create: async () => ({}) },
  };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => { const result = await callback(tx); if (pending) { sale.returns.push(pending); pending = undefined; } return result; } } as unknown as DatabaseService;
  const service = new SalesService(db, { applyMovementInTransaction: async () => ({ newQuantity: 0 }) } as unknown as StockService, {} as FinanceService, { recordLargeDiscount: async () => undefined, recordLargeReturn: async () => undefined } as unknown as NotificationsService);
  const request = { operationId: 'original', deviceId: 'device', items: [{ productId: 'product', quantity: 3, discountMinor: '2002' }], payments: [{ paymentMethodId: 'card', amountMinor: '1001' }] };
  return { service, request, ledger, balance: () => balance.toString(), setRate: (rate: string) => { percent = decimal(rate); } };
}

test('personal percent is validated and accepts comma decimals', () => {
  assert.equal(rewardPercentSchema.parse('3,25'), '3.25');
  for (const invalid of ['-1', '100.01', '3.001', '', 'NaN']) assert.equal(rewardPercentSchema.safeParse(invalid).success, false);
});

test('successful receipt earns the personal percentage exactly once, including offline replay', async () => {
  for (const offline of [false, true]) {
    const f = fixture('3');
    await f.service.create('store', f.request, 'employee', offline);
    await f.service.create('store', f.request, 'employee', offline);
    assert.equal(f.balance(), '30');
    assert.equal(f.ledger.length, 1);
  }
  const f = fixture('5.50');
  await f.service.create('store', f.request, 'employee');
  assert.equal(f.balance(), '55');
  const zero = fixture('0');
  await zero.service.create('store', zero.request, 'employee');
  assert.equal(zero.ledger.length, 0);
});

test('partial and full returns reverse the original reward, independent of rate changes, without replay duplication', async () => {
  const f = fixture();
  await f.service.create('store', f.request, 'employee');
  f.setRate('50');
  for (const [index, expected] of ['21', '11', '0'].entries()) {
    const request = { operationId: `refund-${index}`, deviceId: 'device', cashShiftId: 'shift', reason: 'Return product', items: [{ saleItemId: 'item', quantity: 1 }] };
    await f.service.returnSale('store', 'sale', request, 'employee');
    await f.service.returnSale('store', 'sale', request, 'employee');
    assert.equal(f.balance(), expected);
  }
  assert.equal(f.ledger.length, 4);
});
