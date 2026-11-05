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
  async shifts(storeId: string, page: Page & { status?: 'OPEN' | 'CLOSED' }) {
    await this.requireStore(storeId);
    const where = { storeId, ...(page.status ? { status: page.status } : {}) };
    const [items, total] = await this.db.$transaction([this.db.cashShift.findMany({ where, orderBy: { openedAt: 'desc' }, skip: (page.page - 1) * page.limit, take: page.limit }), this.db.cashShift.count({ where })]);
    return { items, total, ...page };
  }
  async lastClosedShift(storeId: string, deviceId: string) {
    await this.requireStore(storeId);
    const shift = await this.db.cashShift.findFirst({ where: { storeId, deviceId, status: 'CLOSED' }, orderBy: { closedAt: 'desc' }, select: { id: true, closedAt: true, closingCashMinor: true } });
    return shift ? { id: shift.id, closedAt: shift.closedAt, closingCashMinor: toString(shift.closingCashMinor) } : null;
  }
  async openShift(storeId: string, input: z.infer<typeof openShiftSchema>, actorId: string) {
    await this.requireStore(storeId);
    return this.serializable(async (tx) => {
      if (await tx.cashShift.findFirst({ where: { storeId, deviceId: input.deviceId, status: 'OPEN' } })) throw new ConflictException('Device already has an open cash shift');
      // The drawer is recounted at opening; a gap against the previous closing count needs an explanation.
      const previous = await tx.cashShift.findFirst({ where: { storeId, deviceId: input.deviceId, status: 'CLOSED' }, orderBy: { closedAt: 'desc' }, select: { closingCashMinor: true } });
      const opening = money(input.openingCashMinor);
      const variance = previous?.closingCashMinor ? opening.minus(previous.closingCashMinor) : new Prisma.Decimal(0);
      if (!variance.isZero() && !input.comment) throw new BadRequestException('Comment is required for opening cash discrepancy');
      const shift = await tx.cashShift.create({ data: { storeId, deviceId: input.deviceId, openedById: actorId, openingCashMinor: opening, expectedCashMinor: opening, openingVarianceMinor: variance, openingComment: input.comment || null } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'CASH_SHIFT_OPENED', entityType: 'CashShift', entityId: shift.id, newValue: { openingCashMinor: input.openingCashMinor, deviceId: input.deviceId, varianceMinor: variance.toString(), comment: input.comment ?? null } } });
      return shift;
    });
  }
  private async shiftReward(tx: Prisma.TransactionClient, shiftId: string, employeeId: string) {
    const employee = await tx.user.findUniqueOrThrow({ where: { id: employeeId }, select: { id: true, name: true, rewardBalanceMinor: true } });
    const sales = await tx.sale.findMany({ where: { cashShiftId: shiftId, employeeId, status: 'COMPLETED' }, select: { id: true } });
    const earned = await tx.employeeRewardTransaction.aggregate({ where: { employeeId, saleId: { in: sales.map(sale => sale.id) } }, _sum: { deltaMinor: true } });
    const payout = await tx.employeeRewardPayout.findUnique({ where: { cashShiftId: shiftId } });
    const earnedMinor = earned._sum.deltaMinor ?? new Prisma.Decimal(0);
    // A reversal of a previously paid receipt reduces the available balance for later shifts.
    const payableMinor = payout ? new Prisma.Decimal(0) : Prisma.Decimal.max(0, Prisma.Decimal.min(earnedMinor, employee.rewardBalanceMinor));
    return { employee, earnedMinor, payableMinor, paidMinor: payout?.amountMinor ?? new Prisma.Decimal(0) };
  }
  async closeShift(storeId: string, id: string, input: z.infer<typeof closeShiftSchema>, actorId: string) {
    return this.serializable(async (tx) => {
      const shift = await tx.cashShift.findFirst({ where: { id, storeId } });
      if (!shift) throw new NotFoundException('Cash shift not found');
      if (shift.status !== 'OPEN') {
        // A retry of the same confirmed close must not withdraw cash twice.
        const payout = await tx.employeeRewardPayout.findUnique({ where: { cashShiftId: id } });
        if (shift.closedById === actorId && shift.actualCashMinor?.eq(input.actualCashMinor) && (shift.closingComment ?? '') === (input.comment ?? '') && money(input.rewardPayoutMinor ?? '0').eq(payout?.amountMinor ?? 0)) return shift;
        throw new ConflictException('Cash shift is already closed');
      }
      const reward = await this.shiftReward(tx, id, shift.openedById);
      if (!money(input.rewardPayoutMinor ?? '0').eq(reward.payableMinor)) throw new ConflictException('Reward changed or was not confirmed. Refresh the shift report and confirm the payout.');
      const actual = money(input.actualCashMinor);
      if (actual.lt(reward.payableMinor)) throw new ConflictException('Insufficient counted cash for employee reward payout');
      const variance = actual.minus(shift.expectedCashMinor);
      if (!variance.isZero() && !input.comment) throw new BadRequestException('Comment is required for closing cash discrepancy');
      // The shortage or surplus is booked inside the shift being closed, so the next shift starts clean.
      if (!variance.isZero()) await this.postCashInTransaction(tx, { storeId, shiftId: id, actorId, type: 'CORRECTION', amount: variance, sourceType: 'SHIFT_CLOSE_VARIANCE', sourceId: id, comment: input.comment });
      if (reward.payableMinor.gt(0)) {
        const balance = reward.employee.rewardBalanceMinor.minus(reward.payableMinor);
        await tx.employeeRewardPayout.create({ data: { cashShiftId: id, employeeId: shift.openedById, amountMinor: reward.payableMinor, balanceAfterMinor: balance } });
        await tx.user.update({ where: { id: shift.openedById }, data: { rewardBalanceMinor: balance } });
        await this.postCashInTransaction(tx, { storeId, shiftId: id, actorId, type: 'WITHDRAWAL', amount: reward.payableMinor.neg(), sourceType: 'EMPLOYEE_REWARD_PAYOUT', sourceId: id, comment: `Вознаграждение: ${reward.employee.name}` });
      }
      const closingCash = actual.minus(reward.payableMinor);
      const updated = await tx.cashShift.update({ where: { id }, data: { status: 'CLOSED', actualCashMinor: actual, closingCashMinor: closingCash, closingComment: input.comment || null, closedById: actorId, closedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'CASH_SHIFT_CLOSED', entityType: 'CashShift', entityId: id, newValue: { expectedCashMinor: shift.expectedCashMinor.toString(), actualCashMinor: actual.toString(), varianceMinor: variance.toString(), rewardPayoutMinor: reward.payableMinor.toString(), rewardEmployeeId: shift.openedById, closingCashMinor: closingCash.toString(), comment: input.comment ?? null } } });
      return updated;
    });
  }
  async shiftReport(storeId: string, id: string) {
    const shift = await this.db.cashShift.findFirst({ where: { id, storeId }, include: { store: { select: { name: true, address: true } }, openedBy: { select: { name: true } }, closedBy: { select: { name: true } } } });
    if (!shift) throw new NotFoundException('Cash shift not found');
    const zero = new Prisma.Decimal(0);
    const reward = await this.shiftReward(this.db, id, shift.openedById);
    const [sales, salePayments, returns, refunds, customerPayments, operations, methods, receiptless, bySeller] = await Promise.all([
      this.db.sale.aggregate({ where: { cashShiftId: id, status: 'COMPLETED' }, _count: { id: true }, _sum: { subtotalMinor: true, discountMinor: true, totalMinor: true, debtMinor: true } }),
      this.db.payment.groupBy({ by: ['paymentMethodId'], where: { sale: { cashShiftId: id, status: 'COMPLETED' } }, _sum: { amountMinor: true } }),
      this.db.saleReturn.findMany({ where: { cashShiftId: id }, select: { amountMinor: true, payments: { select: { id: true } } } }),
      this.db.saleReturnPayment.groupBy({ by: ['paymentMethodId'], where: { saleReturn: { cashShiftId: id } }, _sum: { amountMinor: true } }),
      this.db.customerPayment.groupBy({ by: ['paymentMethodId'], where: { cashShiftId: id }, _count: { _all: true }, _sum: { amountMinor: true } }),
      this.db.cashOperation.findMany({ where: { cashShiftId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, type: true, amountMinor: true, sourceType: true, comment: true, createdAt: true, employee: { select: { name: true } } } }),
      this.db.salePaymentMethod.findMany({ select: { id: true, name: true, kind: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      this.db.receiptlessReturn.aggregate({ where: { cashShiftId: id }, _count: { id: true }, _sum: { amountMinor: true } }),
      this.db.sale.groupBy({ by: ['sellerId'], where: { cashShiftId: id, status: 'COMPLETED', sellerId: { not: null } }, _count: { _all: true }, _sum: { totalMinor: true } }),
    ]);
    const sellerNames = new Map((await this.db.user.findMany({ where: { id: { in: bySeller.map(row => row.sellerId!) } }, select: { id: true, name: true } })).map(user => [user.id, user.name]));
    const cashMethod = methods.find(method => method.kind === 'CASH');
    const byMethod = (rows: { paymentMethodId: string; _sum: { amountMinor: Prisma.Decimal | null } }[], extraCash = zero) => {
      const amounts = new Map(rows.map(row => [row.paymentMethodId, row._sum.amountMinor ?? zero]));
      if (cashMethod && !extraCash.isZero()) amounts.set(cashMethod.id, (amounts.get(cashMethod.id) ?? zero).plus(extraCash));
      return methods.filter(method => amounts.has(method.id)).map(method => ({ paymentMethodId: method.id, name: method.name, kind: method.kind, amountMinor: amounts.get(method.id)!.toString() }));
    };
    // Returns made before refunds were itemized by payment method were cash-only.
    const receiptlessAmount = receiptless._sum.amountMinor ?? zero;
    const legacyCashRefunds = returns.filter(record => !record.payments.length).reduce((total, record) => total.plus(record.amountMinor), zero);
    const refundSource = (sourceType: string) => sourceType === 'SALE_RETURN' || sourceType === 'RECEIPTLESS_RETURN';
    const sumOps = (predicate: (operation: (typeof operations)[number]) => boolean) => operations.filter(predicate).reduce((total, operation) => total.plus(operation.amountMinor), zero).toString();
    const manual = (operation: (typeof operations)[number]) => ['DEPOSIT', 'WITHDRAWAL', 'EXPENSE', 'CORRECTION'].includes(operation.type) && !refundSource(operation.sourceType);
    const closingVariance = operations.find(operation => operation.sourceType === 'SHIFT_CLOSE_VARIANCE')?.amountMinor ?? zero;
    return {
      reward: { employeeId: shift.openedById, employeeName: reward.employee.name, earnedMinor: reward.earnedMinor.toString(), payableMinor: shift.status === 'OPEN' ? reward.payableMinor.toString() : '0', paidMinor: reward.paidMinor.toString(), balanceMinor: reward.employee.rewardBalanceMinor.toString() },
      shift: { id: shift.id, deviceId: shift.deviceId, status: shift.status, openedAt: shift.openedAt, closedAt: shift.closedAt, openedBy: shift.openedBy.name, closedBy: shift.closedBy?.name ?? null, store: shift.store, openingCashMinor: shift.openingCashMinor.toString(), openingVarianceMinor: shift.openingVarianceMinor.toString(), openingComment: shift.openingComment, expectedCashMinor: shift.expectedCashMinor.toString(), actualCashMinor: shift.actualCashMinor?.toString() ?? null, closingCashMinor: shift.closingCashMinor?.toString() ?? null, closingVarianceMinor: closingVariance.toString(), closingComment: shift.closingComment },
      sales: { count: sales._count.id, subtotalMinor: toString(sales._sum.subtotalMinor), discountMinor: toString(sales._sum.discountMinor), totalMinor: toString(sales._sum.totalMinor), debtMinor: toString(sales._sum.debtMinor), byMethod: byMethod(salePayments), bySeller: bySeller.map(row => ({ sellerId: row.sellerId!, name: sellerNames.get(row.sellerId!) ?? 'Сотрудник', count: row._count._all, totalMinor: toString(row._sum.totalMinor) })) },
      returns: { count: returns.length + receiptless._count.id, amountMinor: returns.reduce((total, record) => total.plus(record.amountMinor), receiptlessAmount).toString(), byMethod: byMethod(refunds, legacyCashRefunds.plus(receiptlessAmount)), receiptlessCount: receiptless._count.id, receiptlessMinor: receiptlessAmount.toString() },
      customerPayments: { count: customerPayments.reduce((total, row) => total + row._count._all, 0), amountMinor: customerPayments.reduce((total, row) => total.plus(row._sum.amountMinor ?? zero), zero).toString(), byMethod: byMethod(customerPayments) },
      cash: { openingMinor: shift.openingCashMinor.toString(), salesMinor: sumOps(operation => operation.type === 'SALE'), customerPaymentsMinor: sumOps(operation => operation.type === 'CUSTOMER_PAYMENT'), refundsMinor: sumOps(operation => refundSource(operation.sourceType)), depositsMinor: sumOps(operation => operation.type === 'DEPOSIT'), withdrawalsMinor: sumOps(operation => operation.type === 'WITHDRAWAL' && !refundSource(operation.sourceType)), expensesMinor: sumOps(operation => operation.type === 'EXPENSE'), correctionsMinor: sumOps(operation => operation.type === 'CORRECTION'), expectedMinor: shift.expectedCashMinor.toString() },
      operations: operations.filter(manual).map(operation => ({ id: operation.id, type: operation.type, amountMinor: operation.amountMinor.toString(), sourceType: operation.sourceType, comment: operation.comment, createdAt: operation.createdAt, employee: operation.employee.name })),
    };
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
