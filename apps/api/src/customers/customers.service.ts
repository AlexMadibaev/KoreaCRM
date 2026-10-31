import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import { FinanceService } from '../finance/finance.service';
import type { AccessContext } from '../auth/policy';
import { activitySchema, bonusCorrectionSchema, bonusListSchema, commentListSchema, commentSchema, createSchema, debtPaymentSchema, historySchema, listSchema, patchSchema } from './customers.schemas';
import { normalizeCustomerName } from './customer-name';
import { defaultSegmentSettings, deriveCustomerSegments, segmentCutoffs, segmentSettingsSchema, type SegmentSettings } from './customer-segments';

type CustomerInput = z.infer<typeof createSchema>;
const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);

@Injectable()
export class CustomersService {
  constructor(private readonly db: DatabaseService, private readonly finance: FinanceService) {}

  async segmentSettings(): Promise<SegmentSettings> {
    const row = await this.db.customerSegmentSettings.findUnique({ where: { id: 1 } });
    return row ? segmentSettingsSchema.parse(row.rules) : defaultSegmentSettings;
  }

  async saveSegmentSettings(settings: SegmentSettings, actorId: string) {
    const previous = await this.segmentSettings();
    await this.db.$transaction(async tx => {
      await tx.customerSegmentSettings.upsert({ where: { id: 1 }, create: { id: 1, rules: settings }, update: { rules: settings } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'CUSTOMER_SEGMENT_SETTINGS_UPDATED', entityType: 'CustomerSegmentSettings', entityId: '1', oldValue: previous, newValue: settings } });
    });
    return settings;
  }

  async list(query: z.infer<typeof listSchema>) {
    const settings = await this.segmentSettings();
    const matches: Prisma.CustomerWhereInput[] = query.search ? [{ phone: { contains: query.search } }, { firstName: { contains: query.search, mode: 'insensitive' } }, { lastName: { contains: query.search, mode: 'insensitive' } }] : [];
    if (query.search && /^[0-9a-f-]{36}$/i.test(query.search)) matches.push({ id: query.search });
    const conditions: Prisma.CustomerWhereInput[] = [];
    const { dormant, frequent } = segmentCutoffs(new Date(), settings);
    if (query.segment && !settings[query.segment].enabled) return { items: [], total: 0, page: query.page, limit: query.limit };
    if (query.segment === 'NEW') conditions.push({ ordersCount: { lte: settings.NEW.maxOrders } });
    if (query.segment === 'REGULAR') conditions.push({ ordersCount: { gte: settings.REGULAR.minOrders } });
    if (query.segment === 'VIP') conditions.push({ ordersCount: { gte: settings.VIP.minOrders }, totalSpentMinor: { gte: settings.VIP.minSpentMinor } });
    if (query.segment === 'DORMANT') conditions.push({ sales: { some: { status: 'COMPLETED', createdAt: { lt: dormant } } } }, { sales: { none: { status: 'COMPLETED', createdAt: { gte: dormant } } } });
    if (query.segment === 'HIGH_CHECK') conditions.push({ ordersCount: { gt: 0 }, averageCheckMinor: { gte: settings.HIGH_CHECK.minAverageMinor } });
    if (query.segment === 'FREQUENT') {
      const groups = await this.db.sale.groupBy({ by: ['customerId'], where: { customerId: { not: null }, status: 'COMPLETED', createdAt: { gte: frequent } }, _count: { _all: true } });
      conditions.push({ id: { in: groups.filter(group => group.customerId && group._count._all >= settings.FREQUENT.minOrders).map(group => group.customerId!) }, ordersCount: { gte: settings.FREQUENT.minOrders } });
    }
    const where: Prisma.CustomerWhereInput = { deletedAt: null, OR: matches.length ? matches : undefined, AND: conditions.length ? conditions : undefined };
    const [items, total] = await this.db.$transaction([this.db.customer.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }), this.db.customer.count({ where })]);
    return { items, total, page: query.page, limit: query.limit };
  }
  async get(id: string) {
    const customer = await this.db.customer.findFirst({ where: { id, deletedAt: null } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
  async segments(id: string) {
    const customer = await this.get(id);
    const settings = await this.segmentSettings();
    const now = new Date();
    const { frequent } = segmentCutoffs(now, settings);
    const [latest, recentSales] = await Promise.all([
      this.db.sale.findFirst({ where: { customerId: id, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.db.sale.count({ where: { customerId: id, status: 'COMPLETED', createdAt: { gte: frequent } } }),
    ]);
    return { items: deriveCustomerSegments(customer, latest?.createdAt ?? null, recentSales, now, settings), lastPurchaseAt: latest?.createdAt ?? null, settings };
  }
  async history(id: string, query: z.infer<typeof historySchema>, actor: AccessContext) {
    if (!await this.db.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Customer not found');
    const storeIds = actor.allStores ? undefined : actor.storeIds;
    const skip = (query.page - 1) * query.limit;
    if (query.kind === 'sales') {
      const where: Prisma.SaleWhereInput = { customerId: id, storeId: storeIds ? { in: storeIds } : undefined };
      const [items, total] = await this.db.$transaction([
        this.db.sale.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: query.limit, select: { id: true, number: true, createdAt: true, totalMinor: true, status: true, store: { select: { name: true } }, items: { select: { id: true, quantity: true, totalMinor: true, product: { select: { name: true } } } } } }),
        this.db.sale.count({ where }),
      ]);
      return { items, total, page: query.page, limit: query.limit };
    }
    if (query.kind === 'returns') {
      const where: Prisma.SaleReturnWhereInput = { sale: { customerId: id }, storeId: storeIds ? { in: storeIds } : undefined };
      const [items, total] = await this.db.$transaction([
        this.db.saleReturn.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: query.limit, select: { id: true, createdAt: true, amountMinor: true, reason: true, sale: { select: { id: true, number: true } }, items: { select: { id: true, quantity: true, amountMinor: true, saleItem: { select: { product: { select: { name: true } } } } } } } }),
        this.db.saleReturn.count({ where }),
      ]);
      return { items, total, page: query.page, limit: query.limit };
    }
    const where: Prisma.CustomerDebtEntryWhereInput = { customerId: id, OR: storeIds ? [{ sale: { storeId: { in: storeIds } } }, { customerPayment: { storeId: { in: storeIds } } }] : undefined };
    const [items, total] = await this.db.$transaction([
      this.db.customerDebtEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: query.limit, select: { id: true, createdAt: true, type: true, amountMinor: true, sale: { select: { number: true } }, customerPayment: { select: { paymentMethod: { select: { name: true } } } } } }),
      this.db.customerDebtEntry.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
  async comments(id: string, query: z.infer<typeof commentListSchema>) {
    if (!await this.db.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Customer not found');
    const where: Prisma.CustomerCommentWhereInput = { customerId: id };
    const [items, total] = await this.db.$transaction([
      this.db.customerComment.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit, select: { id: true, text: true, createdAt: true, author: { select: { id: true, name: true, login: true } } } }),
      this.db.customerComment.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
  async bonuses(id: string, query: z.infer<typeof bonusListSchema>) {
    const customer = await this.db.customer.findFirst({ where: { id, deletedAt: null }, select: { bonusBalanceMinor: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    const where: Prisma.BonusTransactionWhereInput = { customerId: id };
    const [items, total] = await this.db.$transaction([
      this.db.bonusTransaction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit, select: { id: true, type: true, deltaMinor: true, balanceAfterMinor: true, reason: true, createdAt: true, actor: { select: { name: true } } } }),
      this.db.bonusTransaction.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit, balanceMinor: customer.bonusBalanceMinor };
  }
  async correctBonus(id: string, input: z.infer<typeof bonusCorrectionSchema>, actorId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.db.$transaction(async tx => {
        const delta = new Prisma.Decimal(input.deltaMinor);
        const existing = await tx.bonusTransaction.findUnique({ where: { operationId: input.operationId } });
        if (existing) {
          if (existing.customerId !== id || existing.type !== 'CORRECTION' || !existing.deltaMinor.eq(delta) || existing.reason !== input.reason) throw new ConflictException('Operation ID was used for another bonus correction');
          return existing;
        }
        const customer = await tx.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true, bonusBalanceMinor: true } });
        if (!customer) throw new NotFoundException('Customer not found');
        const balance = customer.bonusBalanceMinor.plus(delta);
        if (balance.lt(0)) throw new ConflictException('Bonus balance cannot be negative');
        if (balance.gte('1000000000000000000')) throw new ConflictException('Bonus balance limit exceeded');
        await tx.customer.update({ where: { id }, data: { bonusBalanceMinor: balance } });
        const transaction = await tx.bonusTransaction.create({ data: { operationId: input.operationId, customerId: id, actorId, type: 'CORRECTION', deltaMinor: delta, balanceAfterMinor: balance, reason: input.reason } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'CUSTOMER_BONUS_CORRECTED', entityType: 'BonusTransaction', entityId: transaction.id, newValue: { customerId: id, deltaMinor: input.deltaMinor } } });
        return transaction;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (retryable(error) && attempt < 2) continue; if (retryable(error)) throw new ConflictException('Concurrent bonus correction'); throw error; }
    }
    throw new ConflictException('Bonus correction could not be completed');
  }
  async activity(id: string, query: z.infer<typeof activitySchema>, actor: AccessContext) {
    if (!await this.db.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Customer not found');
    const storeIds = actor.allStores ? undefined : actor.storeIds;
    const salesWhere: Prisma.SaleWhereInput = { customerId: id, storeId: storeIds ? { in: storeIds } : undefined };
    const returnsWhere: Prisma.SaleReturnWhereInput = { sale: { customerId: id }, storeId: storeIds ? { in: storeIds } : undefined };
    const paymentsWhere: Prisma.CustomerPaymentWhereInput = { customerId: id, storeId: storeIds ? { in: storeIds } : undefined };
    const auditsWhere: Prisma.AuditLogWhereInput = { entityType: 'Customer', entityId: id, action: { in: ['CUSTOMER_CREATED', 'CUSTOMER_UPDATED', 'CUSTOMER_DISCOUNT_UPDATED'] } };
    const take = query.page * query.limit;
    const [sales, returns, payments, comments, bonuses, audits, saleCount, returnCount, paymentCount, commentCount, bonusCount, auditCount] = await Promise.all([
      this.db.sale.findMany({ where: salesWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select: { id: true, number: true, totalMinor: true, createdAt: true, store: { select: { name: true } }, employee: { select: { name: true } } } }),
      this.db.saleReturn.findMany({ where: returnsWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select: { id: true, amountMinor: true, reason: true, createdAt: true, sale: { select: { number: true } } } }),
      this.db.customerPayment.findMany({ where: paymentsWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select: { id: true, amountMinor: true, createdAt: true, paymentMethod: { select: { name: true } }, employee: { select: { name: true } } } }),
      this.db.customerComment.findMany({ where: { customerId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select: { id: true, text: true, createdAt: true, author: { select: { name: true } } } }),
      this.db.bonusTransaction.findMany({ where: { customerId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select: { id: true, type: true, deltaMinor: true, reason: true, createdAt: true, actor: { select: { name: true } } } }),
      this.db.auditLog.findMany({ where: auditsWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select: { id: true, action: true, oldValue: true, newValue: true, createdAt: true, user: { select: { name: true } } } }),
      this.db.sale.count({ where: salesWhere }), this.db.saleReturn.count({ where: returnsWhere }), this.db.customerPayment.count({ where: paymentsWhere }), this.db.customerComment.count({ where: { customerId: id } }), this.db.bonusTransaction.count({ where: { customerId: id } }), this.db.auditLog.count({ where: auditsWhere }),
    ]);
    const items = [
      ...sales.map(sale => ({ id: sale.id, kind: 'SALE', title: `Покупка · чек №${sale.number}`, detail: sale.store.name, amountMinor: sale.totalMinor.toString(), createdAt: sale.createdAt, actorName: sale.employee.name })),
      ...returns.map(record => ({ id: record.id, kind: 'RETURN', title: `Возврат · чек №${record.sale.number}`, detail: record.reason, amountMinor: record.amountMinor.toString(), createdAt: record.createdAt, actorName: null })),
      ...payments.map(payment => ({ id: payment.id, kind: 'PAYMENT', title: 'Погашение долга', detail: payment.paymentMethod.name, amountMinor: payment.amountMinor.toString(), createdAt: payment.createdAt, actorName: payment.employee.name })),
      ...comments.map(comment => ({ id: comment.id, kind: 'COMMENT', title: 'Комментарий', detail: comment.text, amountMinor: null, createdAt: comment.createdAt, actorName: comment.author.name })),
      ...bonuses.map(bonus => ({ id: bonus.id, kind: 'BONUS', title: bonus.type === 'CORRECTION' ? 'Корректировка бонусов' : bonus.type === 'EARN' ? 'Начисление бонусов' : bonus.type === 'SPEND' ? 'Списание бонусов' : 'Сгорание бонусов', detail: bonus.reason, amountMinor: bonus.deltaMinor.toString(), createdAt: bonus.createdAt, actorName: bonus.actor.name })),
      ...audits.map(audit => ({ id: audit.id, kind: 'PROFILE', title: audit.action === 'CUSTOMER_CREATED' ? 'Карточка создана' : audit.action === 'CUSTOMER_DISCOUNT_UPDATED' ? 'Персональная скидка изменена' : 'Карточка изменена', detail: audit.action === 'CUSTOMER_DISCOUNT_UPDATED' ? `${(audit.oldValue as { discountPercent?: string } | null)?.discountPercent ?? '0'}% → ${(audit.newValue as { discountPercent?: string } | null)?.discountPercent ?? '0'}%` : '', amountMinor: null, createdAt: audit.createdAt, actorName: audit.user?.name ?? null })),
    ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
    return { items: items.slice((query.page - 1) * query.limit, take), total: saleCount + returnCount + paymentCount + commentCount + bonusCount + auditCount, page: query.page, limit: query.limit };
  }
  async addComment(id: string, input: z.infer<typeof commentSchema>, actorId: string) {
    return this.db.$transaction(async tx => {
      if (!await tx.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Customer not found');
      const comment = await tx.customerComment.create({ data: { customerId: id, authorId: actorId, text: input.text }, select: { id: true, text: true, createdAt: true, author: { select: { id: true, name: true, login: true } } } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'CUSTOMER_COMMENT_CREATED', entityType: 'CustomerComment', entityId: comment.id, newValue: { customerId: id } } });
      return comment;
    });
  }
  async create(input: CustomerInput, actorId: string) {
    try { return await this.db.$transaction(async tx => {
      const customer = await tx.customer.create({ data: { ...input, firstName: normalizeCustomerName(input.firstName), lastName: input.lastName ? normalizeCustomerName(input.lastName) : null, discountPercent: input.discountPercent ?? '0' } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'CUSTOMER_CREATED', entityType: 'Customer', entityId: customer.id, newValue: { phone: customer.phone } } });
      if (customer.discountPercent.gt(0)) await tx.auditLog.create({ data: { userId: actorId, action: 'CUSTOMER_DISCOUNT_UPDATED', entityType: 'Customer', entityId: customer.id, oldValue: { discountPercent: '0' }, newValue: { discountPercent: customer.discountPercent.toString() } } });
      return customer;
    }); } catch (error) { if (retryable(error)) throw new ConflictException('Customer phone already exists'); throw error; }
  }
  async edit(id: string, input: z.infer<typeof patchSchema>, actorId: string) {
    const existing = await this.db.customer.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Customer not found');
    try { return await this.db.$transaction(async tx => {
      const normalized = { ...input, ...(input.firstName !== undefined ? { firstName: normalizeCustomerName(input.firstName) } : {}), ...(input.lastName !== undefined ? { lastName: input.lastName ? normalizeCustomerName(input.lastName) : null } : {}) };
      const customer = await tx.customer.update({ where: { id }, data: normalized });
      await tx.auditLog.create({ data: { userId: actorId, action: 'CUSTOMER_UPDATED', entityType: 'Customer', entityId: id, newValue: normalized } });
      if (input.discountPercent !== undefined && !existing.discountPercent.eq(input.discountPercent)) await tx.auditLog.create({ data: { userId: actorId, action: 'CUSTOMER_DISCOUNT_UPDATED', entityType: 'Customer', entityId: id, oldValue: { discountPercent: existing.discountPercent.toString() }, newValue: { discountPercent: input.discountPercent } } });
      return customer;
    }); } catch (error) { if (retryable(error)) throw new ConflictException('Customer phone already exists'); throw error; }
  }
  async setPersonalDiscount(id: string, discountPercent: string, actorId: string) {
    return this.db.$transaction(async tx => {
      const existing = await tx.customer.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Customer not found');
      if (existing.discountPercent.eq(discountPercent)) return existing;
      const updated = await tx.customer.update({ where: { id }, data: { discountPercent } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'CUSTOMER_DISCOUNT_UPDATED', entityType: 'Customer', entityId: id, oldValue: { discountPercent: existing.discountPercent.toString() }, newValue: { discountPercent } } });
      return updated;
    });
  }
  async delete(id: string, actorId: string) {
    const customer = await this.db.customer.findFirst({ where: { id, deletedAt: null } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.debtBalanceMinor.gt(0)) throw new ConflictException('Customer has unpaid debt');
    return this.db.$transaction(async tx => {
      const updated = await tx.customer.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: actorId, action: 'CUSTOMER_DELETED', entityType: 'Customer', entityId: id } });
      return updated;
    });
  }
  async payments(storeId: string, customerId: string) {
    if (!await this.db.customer.findFirst({ where: { id: customerId, deletedAt: null } })) throw new NotFoundException('Customer not found');
    return this.db.customerPayment.findMany({ where: { storeId, customerId }, include: { paymentMethod: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  async payDebt(storeId: string, customerId: string, input: z.infer<typeof debtPaymentSchema>, actorId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.db.$transaction(async tx => {
        const existing = await tx.customerPayment.findUnique({ where: { operationId: input.operationId } });
        if (existing) {
          if (existing.storeId !== storeId || existing.customerId !== customerId || existing.paymentMethodId !== input.paymentMethodId || !existing.amountMinor.eq(input.amountMinor) || existing.cashShiftId !== (input.cashShiftId ?? null)) throw new ConflictException('Operation ID was used for another payment');
          return existing;
        }
        const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
        if (!customer) throw new NotFoundException('Customer not found');
        if (!await tx.store.findFirst({ where: { id: storeId, deletedAt: null } })) throw new NotFoundException('Store not found');
        const method = await tx.salePaymentMethod.findFirst({ where: { id: input.paymentMethodId, active: true } });
        if (!method || ['BONUS', 'DEBT'].includes(method.kind)) throw new BadRequestException('Payment method is unavailable for debt repayment');
        if (Boolean(input.cashShiftId) !== (method.kind === 'CASH')) throw new BadRequestException('Cash shift is required only for cash payments');
        const amount = new Prisma.Decimal(input.amountMinor);
        if (amount.gt(customer.debtBalanceMinor)) throw new ConflictException('Payment exceeds customer debt');
        const payment = await tx.customerPayment.create({ data: { operationId: input.operationId, customerId, storeId, paymentMethodId: method.id, cashShiftId: input.cashShiftId, amountMinor: amount, employeeId: actorId } });
        if (input.cashShiftId) await this.finance.postCashInTransaction(tx, { storeId, shiftId: input.cashShiftId, actorId, type: 'CUSTOMER_PAYMENT', amount, sourceType: 'CUSTOMER_PAYMENT', sourceId: payment.id });
        const balance = customer.debtBalanceMinor.minus(amount);
        await tx.customer.update({ where: { id: customerId }, data: { debtBalanceMinor: balance } });
        await tx.customerDebtEntry.create({ data: { customerId, customerPaymentId: payment.id, type: 'PAYMENT', amountMinor: amount.neg(), balanceAfterMinor: balance } });
        await tx.auditLog.create({ data: { userId: actorId, action: 'CUSTOMER_PAYMENT_CREATED', entityType: 'CustomerPayment', entityId: payment.id, newValue: { amountMinor: input.amountMinor, customerId, storeId } } });
        return payment;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (retryable(error) && attempt < 2) continue; if (retryable(error)) throw new ConflictException('Concurrent customer payment'); throw error; }
    }
    throw new ConflictException('Customer payment could not be completed');
  }
}
