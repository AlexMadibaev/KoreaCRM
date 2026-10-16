import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import { FinanceService } from '../finance/finance.service';
import { StockService } from '../stock/stock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paymentMethodPatchSchema, paymentMethodSchema, returnSaleSchema, saleListSchema, saleReturnListSchema, saleSchema } from './sales.schemas';

type SaleInput = z.infer<typeof saleSchema>;
const maximum = new Prisma.Decimal('999999999999999999');
const sum = (values: Prisma.Decimal[]) => values.reduce((value, part) => value.plus(part), new Prisma.Decimal(0));
const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);
const saleInclude = { items: { include: { product: { select: { name: true, sku: true } } } }, payments: { include: { paymentMethod: true } }, customer: { select: { id: true, firstName: true, lastName: true, phone: true } }, store: { select: { name: true, code: true, address: true, phone: true } }, employee: { select: { name: true } }, returns: { include: { items: true }, orderBy: { createdAt: 'asc' } } } as const;

@Injectable()
export class SalesService {
  constructor(private readonly db: DatabaseService, private readonly stock: StockService, private readonly finance: FinanceService, private readonly notifications: NotificationsService) {}
  methods() { return this.db.salePaymentMethod.findMany({ orderBy: { code: 'asc' } }); }
  async createMethod(input: z.infer<typeof paymentMethodSchema>, actorId: string) {
    try { return await this.db.$transaction(async tx => {
      const method = await tx.salePaymentMethod.create({ data: input });
      await tx.auditLog.create({ data: { userId: actorId, action: 'SALE_PAYMENT_METHOD_CREATED', entityType: 'SalePaymentMethod', entityId: method.id, newValue: input } });
      return method;
    }); } catch (error) { if (retryable(error)) throw new ConflictException('Payment method code already exists'); throw error; }
  }
  async editMethod(id: string, input: z.infer<typeof paymentMethodPatchSchema>, actorId: string) {
    const existing = await this.db.salePaymentMethod.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Payment method not found');
    if (existing.system && input.active === false) throw new ConflictException('System payment method cannot be disabled');
    return this.db.$transaction(async tx => {
      const method = await tx.salePaymentMethod.update({ where: { id }, data: input });
      await tx.auditLog.create({ data: { userId: actorId, action: 'SALE_PAYMENT_METHOD_UPDATED', entityType: 'SalePaymentMethod', entityId: id, newValue: input } });
      return method;
    });
  }
  async list(storeId: string, query: z.infer<typeof saleListSchema>) {
    if (!await this.db.store.findFirst({ where: { id: storeId, deletedAt: null } })) throw new NotFoundException('Store not found');
    const where: Prisma.SaleWhereInput = { storeId, ...(query.search ? { OR: [{ number: { contains: query.search, mode: 'insensitive' } }, { customer: { phone: { contains: query.search } } }] } : {}) };
    const [items, total] = await this.db.$transaction([this.db.sale.findMany({ where, include: saleInclude, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }), this.db.sale.count({ where })]);
    return { items, total, ...query };
  }
  async listReturns(storeId: string, query: z.infer<typeof saleReturnListSchema>) {
    if (!await this.db.store.findFirst({ where: { id: storeId, deletedAt: null } })) throw new NotFoundException('Store not found');
    const where: Prisma.SaleReturnWhereInput = { storeId, ...(query.search ? { sale: { OR: [{ number: { contains: query.search, mode: 'insensitive' } }, { customer: { phone: { contains: query.search } } }] } } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.saleReturn.findMany({ where, include: { sale: { select: { id: true, number: true, createdAt: true, totalMinor: true, customer: { select: { firstName: true, lastName: true, phone: true } } } }, items: { include: { saleItem: { include: { product: { select: { name: true, sku: true } } } } } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.db.saleReturn.count({ where }),
    ]);
    return { items, total, ...query };
  }
  async get(storeId: string, id: string) {
    const sale = await this.db.sale.findFirst({ where: { id, storeId }, include: saleInclude });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }
  async returnSale(storeId: string, id: string, input: z.infer<typeof returnSaleSchema>, actorId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.db.$transaction(async tx => {
        const existing = await tx.saleReturn.findUnique({ where: { operationId: input.operationId }, include: { items: true } });
        if (existing) {
          if (existing.storeId !== storeId || existing.saleId !== id || existing.deviceId !== input.deviceId || existing.cashShiftId !== input.cashShiftId || existing.reason !== input.reason) throw new ConflictException('Operation ID was used for another return');
          if (input.items && (input.items.length !== existing.items.length || input.items.some(line => !existing.items.some(saved => saved.saleItemId === line.saleItemId && saved.quantity === line.quantity)))) throw new ConflictException('Operation ID was used for different return items');
          return tx.sale.findUniqueOrThrow({ where: { id }, include: saleInclude });
        }
        const sale = await tx.sale.findFirst({ where: { id, storeId }, include: saleInclude });
        if (!sale) throw new NotFoundException('Sale not found');
        if (sale.status !== 'COMPLETED') throw new ConflictException('Only completed sales can be returned');
        if (!sale.cashShiftId || sale.debtMinor.gt(0) || sale.payments.length === 0 || sale.payments.some(payment => payment.paymentMethod.kind !== 'CASH')) throw new ConflictException('Only fully cash-paid sales can be returned');
        if (input.items && new Set(input.items.map(item => item.saleItemId)).size !== input.items.length) throw new BadRequestException('Duplicate sale items in return');
        const returnedByItem = new Map<string, number>();
        for (const record of sale.returns) for (const line of record.items) returnedByItem.set(line.saleItemId, (returnedByItem.get(line.saleItemId) ?? 0) + line.quantity);
        const requested = input.items ?? sale.items.map(item => ({ saleItemId: item.id, quantity: item.quantity - (returnedByItem.get(item.id) ?? 0) })).filter(item => item.quantity > 0);
        if (!requested.length) throw new ConflictException('Sale has already been fully returned');
        const lines = requested.map(request => {
          const item = sale.items.find(candidate => candidate.id === request.saleItemId);
          if (!item) throw new BadRequestException('Return item does not belong to this sale');
          const already = returnedByItem.get(item.id) ?? 0;
          if (request.quantity > item.quantity - already) throw new ConflictException('Return quantity exceeds unreturned sale quantity');
          const amount = item.totalMinor.mul(already + request.quantity).div(item.quantity).floor().minus(item.totalMinor.mul(already).div(item.quantity).floor());
          const cost = item.purchasePriceMinor.mul(request.quantity);
          return { item, quantity: request.quantity, amount, cost, profit: amount.minus(cost) };
        });
        const amount = sum(lines.map(line => line.amount));
        const cost = sum(lines.map(line => line.cost));
        if (amount.lt(0)) throw new ConflictException('Return amount cannot be negative');
        const device = await tx.posDevice.findUnique({ where: { deviceId: input.deviceId } });
        if (!device || device.storeId !== storeId || device.status !== 'ACTIVE') throw new ConflictException('POS device is not active in this store');
        const shift = await tx.cashShift.findFirst({ where: { id: input.cashShiftId, storeId, deviceId: input.deviceId, status: 'OPEN' } });
        if (!shift) throw new ConflictException('Device has no matching open cash shift');
        const record = await tx.saleReturn.create({ data: { operationId: input.operationId, saleId: id, storeId, deviceId: input.deviceId, cashShiftId: input.cashShiftId, employeeId: actorId, amountMinor: amount, costMinor: cost, profitMinor: amount.minus(cost), reason: input.reason } });
        for (const line of lines) {
          const returnItem = await tx.saleReturnItem.create({ data: { saleReturnId: record.id, saleItemId: line.item.id, quantity: line.quantity, amountMinor: line.amount, costMinor: line.cost, profitMinor: line.profit } });
          await this.stock.applyMovementInTransaction(tx, { storeId, productId: line.item.productId, type: 'RETURN', delta: line.quantity, sourceType: 'SALE_RETURN_ITEM', sourceId: returnItem.id, actorId, comment: input.reason });
        }
        if (amount.gt(0)) await this.finance.postCashInTransaction(tx, { storeId, shiftId: input.cashShiftId, actorId, type: 'WITHDRAWAL', amount: amount.neg(), sourceType: 'SALE_RETURN', sourceId: record.id, comment: input.reason });
        if (sale.customerId) {
          const customer = await tx.customer.findUniqueOrThrow({ where: { id: sale.customerId } });
          const spent = customer.totalSpentMinor.minus(amount);
          const fullReturn = sale.items.every(item => (returnedByItem.get(item.id) ?? 0) + (requested.find(request => request.saleItemId === item.id)?.quantity ?? 0) === item.quantity);
          const orders = customer.ordersCount - (fullReturn ? 1 : 0);
          if (spent.lt(0) || orders < 0) throw new ConflictException('Customer totals cannot be reduced for this return');
          await tx.customer.update({ where: { id: sale.customerId }, data: { totalSpentMinor: spent, ordersCount: orders, averageCheckMinor: orders ? spent.div(orders).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP) : new Prisma.Decimal(0) } });
        }
        await tx.auditLog.create({ data: { userId: actorId, action: 'SALE_RETURNED', entityType: 'SaleReturn', entityId: record.id, newValue: { saleId: id, amountMinor: amount.toString(), reason: input.reason, cashShiftId: input.cashShiftId, items: requested } } });
        await tx.posDevice.update({ where: { deviceId: input.deviceId }, data: { lastActivityAt: new Date() } });
        await this.notifications.recordLargeReturn(tx, record, sale.number, amount);
        return tx.sale.findUniqueOrThrow({ where: { id }, include: saleInclude });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (retryable(error) && attempt < 2) continue; if (retryable(error)) throw new ConflictException('Concurrent return'); throw error; }
    }
    throw new ConflictException('Return could not be completed');
  }
  async create(storeId: string, input: SaleInput, actorId: string, allowNegativeStock = false) {
    if (new Set(input.items.map(item => item.productId)).size !== input.items.length) throw new BadRequestException('Duplicate products in sale');
    const requestHash = createHash('sha256').update(JSON.stringify({ storeId, ...input })).digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.db.$transaction(async tx => {
        const existing = await tx.sale.findUnique({ where: { operationId: input.operationId }, include: saleInclude });
        if (existing) {
          if (existing.storeId !== storeId || existing.requestHash !== requestHash) throw new ConflictException('Operation ID was used for another sale');
          return existing;
        }
        if (!await tx.store.findFirst({ where: { id: storeId, deletedAt: null } })) throw new NotFoundException('Store not found');
        const device = await tx.posDevice.findUnique({ where: { deviceId: input.deviceId } });
        if (!device || device.storeId !== storeId || device.status !== 'ACTIVE') throw new ConflictException('POS device is not active in this store');
        const customer = input.customerId ? await tx.customer.findFirst({ where: { id: input.customerId, deletedAt: null } }) : null;
        if (input.customerId && !customer) throw new NotFoundException('Customer not found');
        const lines = [];
        for (const item of input.items) {
          const product = await tx.product.findFirst({ where: { id: item.productId, deletedAt: null } });
          if (!product) throw new NotFoundException('Product not found');
          const settings = await tx.storeProductSettings.findUnique({ where: { storeId_productId: { storeId, productId: item.productId } } });
          const quotedPrice = allowNegativeStock ? item.priceMinor : undefined;
          if (quotedPrice === undefined && (!settings?.active || settings.priceMinor === null || settings.priceMinor < 0)) throw new ConflictException(`Product ${product.sku} has no active store price`);
          const stock = await tx.stock.findUnique({ where: { storeId_productId: { storeId, productId: item.productId } } });
          if (!allowNegativeStock && (!stock || stock.quantity - stock.reservedQuantity < item.quantity)) throw new ConflictException(`Insufficient stock for ${product.sku}`);
          const batch = await tx.productBatch.findFirst({ where: { productId: item.productId, storeId }, orderBy: { receivedAt: 'desc' } });
          if (!batch) throw new ConflictException(`Purchase cost is missing for ${product.sku}`);
          const price = new Prisma.Decimal(quotedPrice ?? settings!.priceMinor!);
          const gross = price.mul(item.quantity);
          const discount = new Prisma.Decimal(item.discountMinor);
          if (discount.gt(gross)) throw new BadRequestException('Line discount exceeds line price');
          const cost = batch.purchasePriceMinor.mul(item.quantity);
          lines.push({ productId: item.productId, quantity: item.quantity, priceMinor: price, currentPriceMinor: settings?.priceMinor ?? null, purchasePriceMinor: batch.purchasePriceMinor, discountMinor: discount, totalMinor: gross.minus(discount), profitMinor: gross.minus(discount).minus(cost), batchId: batch.id, gross, cost });
        }
        const subtotal = sum(lines.map(line => line.gross));
        const discount = sum(lines.map(line => line.discountMinor));
        const total = subtotal.minus(discount);
        const cost = sum(lines.map(line => line.cost));
        if (total.gt(maximum) || cost.gt(maximum) || subtotal.gt(maximum)) throw new BadRequestException('Sale amount exceeds database range');
        const methodIds = [...new Set(input.payments.map(payment => payment.paymentMethodId))];
        const methods = await tx.salePaymentMethod.findMany({ where: { id: { in: methodIds }, active: true } });
        if (methods.length !== methodIds.length) throw new BadRequestException('Payment method is unavailable');
        const byId = new Map(methods.map(method => [method.id, method]));
        let cash = new Prisma.Decimal(0);
        let debt = new Prisma.Decimal(0);
        let bonus = new Prisma.Decimal(0);
        for (const payment of input.payments) {
          const amount = new Prisma.Decimal(payment.amountMinor);
          if (amount.lte(0)) throw new BadRequestException('Payment amount must be positive');
          const method = byId.get(payment.paymentMethodId)!;
          if (method.kind === 'BONUS') bonus = bonus.plus(amount);
          if (method.kind === 'DEBT') debt = debt.plus(amount);
          if (method.kind === 'CASH') cash = cash.plus(amount);
        }
        if (!sum(input.payments.map(payment => new Prisma.Decimal(payment.amountMinor))).eq(total)) throw new BadRequestException('Payments must equal sale total');
        if (debt.gt(0) && !customer) throw new BadRequestException('Customer is required for debt sale');
        if (bonus.gt(0)) {
          if (allowNegativeStock) throw new BadRequestException('Bonus payments require an online sale');
          if (!customer) throw new BadRequestException('Customer is required for bonus payment');
          if (bonus.gt(customer.bonusBalanceMinor)) throw new ConflictException('Customer bonus balance is insufficient');
          if (await tx.bonusTransaction.findUnique({ where: { operationId: input.operationId } })) throw new ConflictException('Operation ID was used for another bonus transaction');
        }
        if (cash.gt(0) !== Boolean(input.cashShiftId)) throw new BadRequestException('Cash shift is required only for cash sales');
        if (input.cashShiftId) {
          const shift = await tx.cashShift.findFirst({ where: { id: input.cashShiftId, storeId, deviceId: input.deviceId, status: 'OPEN' } });
          if (!shift) throw new ConflictException('Device has no matching open cash shift');
        }
        const sale = await tx.sale.create({ data: { operationId: input.operationId, requestHash, number: `S-${input.operationId}`, storeId, deviceId: input.deviceId, cashShiftId: input.cashShiftId, customerId: input.customerId, employeeId: actorId, subtotalMinor: subtotal, discountMinor: discount, totalMinor: total, costMinor: cost, profitMinor: total.minus(cost), debtMinor: debt } });
        for (const line of lines) {
          const saleItem = await tx.saleItem.create({ data: { saleId: sale.id, productId: line.productId, quantity: line.quantity, priceMinor: line.priceMinor, purchasePriceMinor: line.purchasePriceMinor, discountMinor: line.discountMinor, totalMinor: line.totalMinor, profitMinor: line.profitMinor, batchId: line.batchId } });
          if (allowNegativeStock && line.currentPriceMinor !== null && !line.priceMinor.eq(line.currentPriceMinor)) await tx.auditLog.create({ data: { userId: actorId, action: 'OFFLINE_PRICE_DIFFERENCE', entityType: 'SaleItem', entityId: saleItem.id, newValue: { saleId: sale.id, productId: line.productId, quotedPriceMinor: line.priceMinor.toString(), currentPriceMinor: String(line.currentPriceMinor) } } });
          const movement = await this.stock.applyMovementInTransaction(tx, { storeId, productId: line.productId, type: 'SALE', delta: -line.quantity, sourceType: 'SALE_ITEM', sourceId: saleItem.id, actorId });
          if (movement.newQuantity < 0) await tx.auditLog.create({ data: { userId: actorId, action: 'NEGATIVE_STOCK', entityType: 'Stock', entityId: `${storeId}:${line.productId}`, newValue: { quantity: movement.newQuantity, saleId: sale.id, productId: line.productId } } });
        }
        for (const part of input.payments) {
          const payment = await tx.payment.create({ data: { saleId: sale.id, paymentMethodId: part.paymentMethodId, amountMinor: part.amountMinor, reference: part.reference } });
          if (byId.get(part.paymentMethodId)!.kind === 'CASH') await this.finance.postCashInTransaction(tx, { storeId, shiftId: input.cashShiftId!, actorId, type: 'SALE', amount: new Prisma.Decimal(part.amountMinor), sourceType: 'SALE_PAYMENT', sourceId: payment.id });
        }
        if (customer) {
          const spent = customer.totalSpentMinor.plus(total);
          const orders = customer.ordersCount + 1;
          const balance = customer.debtBalanceMinor.plus(debt);
          if (spent.gt(maximum) || balance.gt(maximum)) throw new ConflictException('Customer balance exceeds database range');
          await tx.customer.update({ where: { id: customer.id }, data: { totalSpentMinor: spent, ordersCount: orders, averageCheckMinor: spent.div(orders).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP), debtBalanceMinor: balance } });
          if (debt.gt(0)) await tx.customerDebtEntry.create({ data: { customerId: customer.id, saleId: sale.id, type: 'SALE', amountMinor: debt, balanceAfterMinor: balance } });
          if (bonus.gt(0)) {
            const bonusBalance = customer.bonusBalanceMinor.minus(bonus);
            await tx.customer.update({ where: { id: customer.id }, data: { bonusBalanceMinor: bonusBalance } });
            const transaction = await tx.bonusTransaction.create({ data: { operationId: input.operationId, customerId: customer.id, actorId, type: 'SPEND', deltaMinor: bonus.neg(), balanceAfterMinor: bonusBalance, reason: `Оплата бонусами по чеку ${sale.number}` } });
            await tx.auditLog.create({ data: { userId: actorId, action: 'CUSTOMER_BONUS_SPENT', entityType: 'BonusTransaction', entityId: transaction.id, newValue: { customerId: customer.id, saleId: sale.id, amountMinor: bonus.toString() } } });
          }
        }
        await tx.auditLog.create({ data: { userId: actorId, action: 'SALE_COMPLETED', entityType: 'Sale', entityId: sale.id, newValue: { storeId, totalMinor: total.toString(), debtMinor: debt.toString(), itemCount: lines.length } } });
        await tx.posDevice.update({ where: { deviceId: input.deviceId }, data: { lastActivityAt: new Date() } });
        await this.notifications.recordLargeDiscount(tx, sale, subtotal, discount);
        return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: saleInclude });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (retryable(error) && attempt < 2) continue; if (retryable(error)) throw new ConflictException('Concurrent sale'); throw error; }
    }
    throw new ConflictException('Sale could not be completed');
  }
}
