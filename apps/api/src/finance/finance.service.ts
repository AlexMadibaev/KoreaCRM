import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CashOperationType, Prisma } from '@prisma/client';
import type { z } from 'zod';
import { canAccessStore, type AccessContext } from '../auth/policy';
import { DatabaseService } from '../database.service';
import { cashOperationSchema, categorySchema, closeShiftSchema, expenseSchema, openShiftSchema, pageSchema, summarySchema, supplierPaymentSchema } from './finance.schemas';

type Page = z.infer<typeof pageSchema>;
type ExpenseInput = z.infer<typeof expenseSchema>;
type CashInput = z.infer<typeof cashOperationSchema>;
type PaymentInput = z.infer<typeof supplierPaymentSchema>;
const maxMoney = new Prisma.Decimal('999999999999999999');
const money = (value: string) => new Prisma.Decimal(value);
const toString = (value: Prisma.Decimal | null | undefined) => value?.toString() ?? '0';
const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);

function dateRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to) throw new BadRequestException('Invalid date');
  if (end < start || end.getTime() - start.getTime() > 366 * 86_400_000) throw new BadRequestException('Invalid date range');
  return { gte: start, lt: new Date(end.getTime() + 86_400_000) };
}

@Injectable()
export class FinanceService {
  constructor(private readonly db: DatabaseService) {}

  async stores(access: AccessContext, scope: 'active' | 'all' = 'active') { return this.db.store.findMany({ where: { deletedAt: scope === 'active' ? null : undefined, status: scope === 'active' ? 'ACTIVE' : undefined, id: access.allStores ? undefined : { in: access.storeIds } }, select: { id: true, name: true, code: true, status: true, deletedAt: true }, orderBy: { name: 'asc' } }); }

  private async reportStores(input: z.infer<typeof summarySchema>, access: AccessContext): Promise<string | string[] | undefined> {
    if (input.storeId) {
      if (!canAccessStore(access, input.storeId)) throw new ForbiddenException('Store access denied');
      return input.storeId;
    }
    if (input.scope === 'all') return access.allStores ? undefined : access.storeIds;
    if (!access.allStores && !access.storeIds.length) return [];
    const stores = await this.db.store.findMany({ where: { deletedAt: null, status: 'ACTIVE', id: access.allStores ? undefined : { in: access.storeIds } }, select: { id: true } });
    return stores.map(store => store.id);
  }

  private async requireStore(storeId: string) {
    if (!await this.db.store.findFirst({ where: { id: storeId, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Store not found');
  }
  private async serializable<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.db.$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (retryable(error) && attempt < 2) continue; if (retryable(error)) throw new ConflictException('Concurrent finance operation'); throw error; }
    }
    throw new ConflictException('Finance operation could not be completed');
  }
  async categories() { return this.db.expenseCategory.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }); }
  async createCategory(input: z.infer<typeof categorySchema>, actorId: string) {
    try { return await this.db.$transaction(async (tx) => {
      const category = await tx.expenseCategory.create({ data: input });
      await tx.auditLog.create({ data: { userId: actorId, action: 'EXPENSE_CATEGORY_CREATED', entityType: 'ExpenseCategory', entityId: category.id, newValue: input } });
      return category;
    }); } catch (error) { if (retryable(error)) throw new ConflictException('Category name already exists'); throw error; }
  }
  async editCategory(id: string, input: z.infer<typeof categorySchema>, actorId: string) {
    const existing = await this.db.expenseCategory.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Category not found');
    try { return await this.db.$transaction(async (tx) => {
      const category = await tx.expenseCategory.update({ where: { id }, data: input });
      await tx.auditLog.create({ data: { userId: actorId, action: 'EXPENSE_CATEGORY_UPDATED', entityType: 'ExpenseCategory', entityId: id, oldValue: { name: existing.name }, newValue: input } });
      return category;
    }); } catch (error) { if (retryable(error)) throw new ConflictException('Category name already exists'); throw error; }
  }
  async deleteCategory(id: string, actorId: string) {
    const category = await this.db.expenseCategory.findFirst({ where: { id, deletedAt: null } });
    if (!category) throw new NotFoundException('Category not found');
    return this.db.$transaction(async (tx) => {
      const updated = await tx.expenseCategory.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'EXPENSE_CATEGORY_DELETED', entityType: 'ExpenseCategory', entityId: id } });
      return updated;
    });
  }
  async expenses(storeId: string, page: Page) {
    await this.requireStore(storeId);
    const where = { storeId };
    const [items, total] = await this.db.$transaction([this.db.expense.findMany({ where, include: { category: { select: { name: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (page.page - 1) * page.limit, take: page.limit }), this.db.expense.count({ where })]);
    return { items, total, ...page };
  }
  async postCashInTransaction(tx: Prisma.TransactionClient, input: { storeId: string; shiftId: string; actorId: string; type: CashOperationType; amount: Prisma.Decimal; sourceType: string; sourceId: string; comment?: string }) {
    const existing = await tx.cashOperation.findUnique({ where: { sourceType_sourceId: { sourceType: input.sourceType, sourceId: input.sourceId } } });
    if (existing) {
      if (existing.cashShiftId !== input.shiftId || existing.storeId !== input.storeId || existing.type !== input.type || !existing.amountMinor.eq(input.amount)) throw new ConflictException('Operation ID was used for different cash operation');
      return existing;
    }
    const shift = await tx.cashShift.findFirst({ where: { id: input.shiftId, storeId: input.storeId } });
    if (!shift) throw new NotFoundException('Cash shift not found');
    if (shift.status !== 'OPEN') throw new ConflictException('Cash shift is closed');
    const expected = shift.expectedCashMinor.plus(input.amount);
    if (expected.lt(0) || expected.gt(maxMoney)) throw new ConflictException('Cash balance would be outside allowed range');
    const operation = await tx.cashOperation.create({ data: { cashShiftId: input.shiftId, storeId: input.storeId, employeeId: input.actorId, type: input.type, amountMinor: input.amount, sourceType: input.sourceType, sourceId: input.sourceId, comment: input.comment } });
    await tx.cashShift.update({ where: { id: input.shiftId }, data: { expectedCashMinor: expected } });
    await tx.auditLog.create({ data: { userId: input.actorId, action: 'CASH_OPERATION_CREATED', entityType: 'CashOperation', entityId: operation.id, newValue: { type: input.type, amountMinor: input.amount.toString(), sourceType: input.sourceType, sourceId: input.sourceId } } });
    return operation;
  }
  async createExpense(storeId: string, input: ExpenseInput, actorId: string) {
    await this.requireStore(storeId);
    const date = dateRange(input.date, input.date).gte;
    if (input.paymentMethod === 'CASH' && !input.cashShiftId || input.paymentMethod !== 'CASH' && input.cashShiftId) throw new BadRequestException('Cash shift is required only for cash expenses');
    return this.serializable(async (tx) => {
      const existing = await tx.expense.findUnique({ where: { operationId: input.operationId } });
      if (existing) {
        const cashOperation = input.cashShiftId ? await tx.cashOperation.findUnique({ where: { sourceType_sourceId: { sourceType: 'EXPENSE', sourceId: existing.id } } }) : null;
        if (existing.storeId !== storeId || existing.categoryId !== input.categoryId || !existing.amountMinor.eq(input.amountMinor) || existing.paymentMethod !== input.paymentMethod || existing.date.getTime() !== date.getTime() || (existing.description ?? '') !== (input.description ?? '') || (existing.attachmentKey ?? '') !== (input.attachmentKey ?? '') || (cashOperation?.cashShiftId ?? null) !== (input.cashShiftId ?? null)) throw new ConflictException('Operation ID was used for different expense');
        return existing;
      }
      const category = await tx.expenseCategory.findFirst({ where: { id: input.categoryId, deletedAt: null } });
      if (!category) throw new NotFoundException('Expense category not found');
      const expense = await tx.expense.create({ data: { operationId: input.operationId, storeId, categoryId: input.categoryId, amountMinor: money(input.amountMinor), paymentMethod: input.paymentMethod, employeeId: actorId, description: input.description, date, attachmentKey: input.attachmentKey } });
      if (input.cashShiftId) await this.postCashInTransaction(tx, { storeId, shiftId: input.cashShiftId, actorId, type: 'EXPENSE', amount: money(input.amountMinor).neg(), sourceType: 'EXPENSE', sourceId: expense.id });
      await tx.auditLog.create({ data: { userId: actorId, action: 'EXPENSE_CREATED', entityType: 'Expense', entityId: expense.id, newValue: { amountMinor: input.amountMinor, paymentMethod: input.paymentMethod } } });
      return expense;
    });
  }
  async shifts(storeId: string, page: Page) {
    await this.requireStore(storeId);
    const where = { storeId };
    const [items, total] = await this.db.$transaction([this.db.cashShift.findMany({ where, orderBy: { openedAt: 'desc' }, skip: (page.page - 1) * page.limit, take: page.limit }), this.db.cashShift.count({ where })]);
    return { items, total, ...page };
  }
  async openShift(storeId: string, input: z.infer<typeof openShiftSchema>, actorId: string) {
    await this.requireStore(storeId);
    return this.serializable(async (tx) => {
      if (await tx.cashShift.findFirst({ where: { storeId, deviceId: input.deviceId, status: 'OPEN' } })) throw new ConflictException('Device already has an open cash shift');
      const shift = await tx.cashShift.create({ data: { storeId, deviceId: input.deviceId, openedById: actorId, openingCashMinor: money(input.openingCashMinor), expectedCashMinor: money(input.openingCashMinor) } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'CASH_SHIFT_OPENED', entityType: 'CashShift', entityId: shift.id, newValue: { openingCashMinor: input.openingCashMinor, deviceId: input.deviceId } } });
      return shift;
    });
  }
  async closeShift(storeId: string, id: string, input: z.infer<typeof closeShiftSchema>, actorId: string) {
    return this.serializable(async (tx) => {
      const shift = await tx.cashShift.findFirst({ where: { id, storeId } });
      if (!shift) throw new NotFoundException('Cash shift not found');
      if (shift.status !== 'OPEN') throw new ConflictException('Cash shift is already closed');
      const actual = money(input.actualCashMinor);
      const updated = await tx.cashShift.update({ where: { id }, data: { status: 'CLOSED', actualCashMinor: actual, closingCashMinor: actual, closedById: actorId, closedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'CASH_SHIFT_CLOSED', entityType: 'CashShift', entityId: id, newValue: { expectedCashMinor: shift.expectedCashMinor.toString(), actualCashMinor: actual.toString(), varianceMinor: actual.minus(shift.expectedCashMinor).toString() } } });
      return updated;
    });
  }
  async operations(storeId: string, shiftId: string, page: Page) {
    if (!await this.db.cashShift.findFirst({ where: { id: shiftId, storeId }, select: { id: true } })) throw new NotFoundException('Cash shift not found');
    const where = { storeId, cashShiftId: shiftId };
    const [items, total] = await this.db.$transaction([this.db.cashOperation.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.limit, take: page.limit }), this.db.cashOperation.count({ where })]);
    return { items, total, ...page };
  }
  async createCashOperation(storeId: string, shiftId: string, input: CashInput, actorId: string) {
    const amount = money(input.amountMinor);
    if (input.type !== 'CORRECTION' && amount.lte(0)) throw new BadRequestException('Use a positive amount for deposit or withdrawal');
    const signed = input.type === 'WITHDRAWAL' ? amount.neg() : amount;
    return this.serializable((tx) => this.postCashInTransaction(tx, { storeId, shiftId, actorId, type: input.type, amount: signed, sourceType: 'MANUAL_CASH_OPERATION', sourceId: input.operationId, comment: input.comment }));
  }
  async supplierPayments(storeId: string, page: Page) {
    await this.requireStore(storeId);
    const where = { storeId };
    const [items, total] = await this.db.$transaction([this.db.supplierPayment.findMany({ where, include: { supplier: { select: { id: true, name: true } }, purchase: { select: { id: true, number: true } } }, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.limit, take: page.limit }), this.db.supplierPayment.count({ where })]);
    return { items, total, ...page };
  }
  async paySupplier(storeId: string, input: PaymentInput, actorId: string) {
    await this.requireStore(storeId);
    if (input.paymentMethod === 'CASH' && !input.cashShiftId || input.paymentMethod !== 'CASH' && input.cashShiftId) throw new BadRequestException('Cash shift is required only for cash payments');
    return this.serializable(async (tx) => {
      const existing = await tx.supplierPayment.findUnique({ where: { operationId: input.operationId } });
      if (existing) {
        if (existing.storeId !== storeId || existing.purchaseId !== input.purchaseId || !existing.amountMinor.eq(input.amountMinor) || existing.paymentMethod !== input.paymentMethod || existing.cashShiftId !== (input.cashShiftId ?? null)) throw new ConflictException('Operation ID was used for different payment');
        return existing;
      }
      const purchase = await tx.purchase.findFirst({ where: { id: input.purchaseId, storeId } });
      if (!purchase) throw new NotFoundException('Purchase not found');
      const amount = money(input.amountMinor);
      if (amount.gt(purchase.debtMinor)) throw new ConflictException('Payment exceeds purchase debt');
      const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: purchase.supplierId } });
      if (amount.gt(supplier.balanceMinor)) throw new ConflictException('Payment exceeds supplier balance');
      const payment = await tx.supplierPayment.create({ data: { operationId: input.operationId, purchaseId: purchase.id, supplierId: purchase.supplierId, storeId, amountMinor: amount, paymentMethod: input.paymentMethod, cashShiftId: input.cashShiftId, employeeId: actorId } });
      if (input.cashShiftId) await this.postCashInTransaction(tx, { storeId, shiftId: input.cashShiftId, actorId, type: 'WITHDRAWAL', amount: amount.neg(), sourceType: 'SUPPLIER_PAYMENT', sourceId: payment.id });
      await tx.purchase.update({ where: { id: purchase.id }, data: { paidMinor: { increment: amount }, debtMinor: { decrement: amount } } });
      await tx.supplier.update({ where: { id: purchase.supplierId }, data: { balanceMinor: { decrement: amount } } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'SUPPLIER_PAYMENT_CREATED', entityType: 'SupplierPayment', entityId: payment.id, newValue: { purchaseId: purchase.id, amountMinor: input.amountMinor, paymentMethod: input.paymentMethod } } });
      return payment;
    });
  }
  async summary(input: z.infer<typeof summarySchema>, access: AccessContext) {
    const range = dateRange(input.from, input.to);
    const selectedStores = await this.reportStores(input, access);
    const storeId: Prisma.StringFilter | string | undefined = Array.isArray(selectedStores) ? { in: selectedStores } : selectedStores;
    const [expenses, cashFlow, supplierDebt, supplierPayments, openCash, sales, returns, customerDebt] = await this.db.$transaction([
      this.db.expense.aggregate({ where: { storeId, date: range }, _sum: { amountMinor: true } }),
      this.db.cashOperation.aggregate({ where: { storeId, createdAt: range }, _sum: { amountMinor: true } }),
      this.db.purchase.aggregate({ where: { storeId }, _sum: { debtMinor: true } }),
      this.db.supplierPayment.aggregate({ where: { storeId, createdAt: range }, _sum: { amountMinor: true } }),
      this.db.cashShift.aggregate({ where: { storeId, status: 'OPEN' }, _sum: { expectedCashMinor: true } }),
      this.db.sale.aggregate({ where: { storeId, status: 'COMPLETED', createdAt: range }, _count: { id: true }, _sum: { totalMinor: true, costMinor: true, profitMinor: true, discountMinor: true } }),
      this.db.saleReturn.aggregate({ where: { storeId, createdAt: range }, _count: { id: true }, _sum: { amountMinor: true, costMinor: true, profitMinor: true } }),
      this.db.customer.aggregate({ _sum: { debtBalanceMinor: true } }),
    ]);
    const revenue = (sales._sum.totalMinor ?? new Prisma.Decimal(0)).minus(returns._sum.amountMinor ?? 0);
    const cogs = (sales._sum.costMinor ?? new Prisma.Decimal(0)).minus(returns._sum.costMinor ?? 0);
    const grossProfit = (sales._sum.profitMinor ?? new Prisma.Decimal(0)).minus(returns._sum.profitMinor ?? 0);
    const checksCount = sales._count.id;
    const averageCheckMinor = checksCount ? (sales._sum.totalMinor ?? new Prisma.Decimal(0)).div(checksCount).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toString() : '0';
    return { from: input.from, to: input.to, storeId: input.storeId ?? null, expensesMinor: toString(expenses._sum.amountMinor), cashDrawerFlowMinor: toString(cashFlow._sum.amountMinor), supplierDebtMinor: toString(supplierDebt._sum.debtMinor), supplierPaymentsMinor: toString(supplierPayments._sum.amountMinor), openCashMinor: toString(openCash._sum.expectedCashMinor), revenueMinor: revenue.toString(), cogsMinor: cogs.toString(), grossProfitMinor: grossProfit.toString(), operationalResultMinor: grossProfit.minus(expenses._sum.amountMinor ?? 0).toString(), customerDebtMinor: input.storeId || !access.allStores ? null : toString(customerDebt._sum.debtBalanceMinor), cashFlowMinor: null, salesMetricsAvailable: true, checksCount, averageCheckMinor, discountsMinor: toString(sales._sum.discountMinor), returnsCount: returns._count.id, returnsMinor: toString(returns._sum.amountMinor) };
  }

  async salesTrend(input: z.infer<typeof summarySchema>, access: AccessContext) {
    const range = dateRange(input.from, input.to);
    const selectedStores = await this.reportStores(input, access);
    type Row = { day: string; salesMinor: Prisma.Decimal; returnsMinor: Prisma.Decimal; checksCount: Prisma.Decimal };
    let rows: Row[] = [];
    if (!Array.isArray(selectedStores) || selectedStores.length) {
      const storeScope = typeof selectedStores === 'string' ? Prisma.sql`AND "storeId" = ${selectedStores}::uuid` : selectedStores === undefined ? Prisma.empty : Prisma.sql`AND "storeId" IN (${Prisma.join(selectedStores.map(id => Prisma.sql`${id}::uuid`))})`;
      rows = await this.db.$queryRaw<Row[]>`
        SELECT day, SUM("salesMinor") AS "salesMinor", SUM("returnsMinor") AS "returnsMinor", SUM("checksCount") AS "checksCount"
        FROM (
          SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 SUM("totalMinor") AS "salesMinor", 0::numeric AS "returnsMinor", COUNT(*) AS "checksCount"
          FROM "Sale"
          WHERE status = 'COMPLETED' AND "createdAt" >= ${range.gte} AND "createdAt" < ${range.lt} ${storeScope}
          GROUP BY day
          UNION ALL
          SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 0::numeric AS "salesMinor", SUM("amountMinor") AS "returnsMinor", 0::bigint AS "checksCount"
          FROM "SaleReturn"
          WHERE "createdAt" >= ${range.gte} AND "createdAt" < ${range.lt} ${storeScope}
          GROUP BY day
        ) events
        GROUP BY day ORDER BY day
      `;
    }
    const byDay = new Map(rows.map(row => [row.day, row]));
    const days = [];
    for (let time = range.gte.getTime(); time < range.lt.getTime(); time += 86_400_000) {
      const day = new Date(time).toISOString().slice(0, 10);
      const row = byDay.get(day);
      const sales = row?.salesMinor ?? new Prisma.Decimal(0);
      const returns = row?.returnsMinor ?? new Prisma.Decimal(0);
      days.push({ date: day, salesMinor: sales.toString(), returnsMinor: returns.toString(), netMinor: sales.minus(returns).toString(), checksCount: Number(row?.checksCount ?? 0) });
    }
    return { from: input.from, to: input.to, storeId: input.storeId ?? null, days };
  }

  async topProducts(input: z.infer<typeof summarySchema>, access: AccessContext) {
    const range = dateRange(input.from, input.to);
    const selectedStores = await this.reportStores(input, access);
    type Row = { productId: string; name: string; sku: string; netQuantity: Prisma.Decimal; netRevenueMinor: Prisma.Decimal };
    let rows: Row[] = [];
    if (!Array.isArray(selectedStores) || selectedStores.length) {
      const ids = Array.isArray(selectedStores) ? selectedStores.map(id => Prisma.sql`${id}::uuid`) : [];
      const saleScope = typeof selectedStores === 'string' ? Prisma.sql`AND s."storeId" = ${selectedStores}::uuid` : selectedStores === undefined ? Prisma.empty : Prisma.sql`AND s."storeId" IN (${Prisma.join(ids)})`;
      const returnScope = typeof selectedStores === 'string' ? Prisma.sql`AND r."storeId" = ${selectedStores}::uuid` : selectedStores === undefined ? Prisma.empty : Prisma.sql`AND r."storeId" IN (${Prisma.join(ids)})`;
      rows = await this.db.$queryRaw<Row[]>`
        SELECT p.id AS "productId", p.name, p.sku,
               SUM(events.quantity) AS "netQuantity", SUM(events.revenue) AS "netRevenueMinor"
        FROM (
          SELECT si."productId", SUM(si.quantity)::numeric AS quantity, SUM(si."totalMinor") AS revenue
          FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
          WHERE s.status = 'COMPLETED' AND s."createdAt" >= ${range.gte} AND s."createdAt" < ${range.lt} ${saleScope}
          GROUP BY si."productId"
          UNION ALL
          SELECT si."productId", -SUM(ri.quantity)::numeric AS quantity, -SUM(ri."amountMinor") AS revenue
          FROM "SaleReturnItem" ri
          JOIN "SaleReturn" r ON r.id = ri."saleReturnId"
          JOIN "SaleItem" si ON si.id = ri."saleItemId"
          WHERE r."createdAt" >= ${range.gte} AND r."createdAt" < ${range.lt} ${returnScope}
          GROUP BY si."productId"
        ) events
        JOIN "Product" p ON p.id = events."productId"
        GROUP BY p.id, p.name, p.sku
        HAVING SUM(events.quantity) > 0
        ORDER BY "netQuantity" DESC, "netRevenueMinor" DESC, p.id
        LIMIT 5
      `;
    }
    return { from: input.from, to: input.to, storeId: input.storeId ?? null, items: rows.map(row => ({ productId: row.productId, name: row.name, sku: row.sku, quantity: Number(row.netQuantity), revenueMinor: row.netRevenueMinor.toString() })) };
  }
}
