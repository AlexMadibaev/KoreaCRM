import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import { FinanceService } from '../finance/finance.service';
import { StockService } from '../stock/stock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { automaticPercent, defaultLoyaltySettings, loyaltySettingsSchema, percentBasisPoints } from '../loyalty/loyalty.rules';
import { allocateRefund } from './return-refunds';
import { paymentMethodPatchSchema, paymentMethodSchema, receiptlessReturnSchema, returnSaleSchema, saleListSchema, saleReturnListSchema, saleSchema } from './sales.schemas';

type SaleInput = z.infer<typeof saleSchema>;
const maximum = new Prisma.Decimal('999999999999999999');
const sum = (values: Prisma.Decimal[]) => values.reduce((value, part) => value.plus(part), new Prisma.Decimal(0));
const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);
const derivedOperationId = (id: string, kind: string) => { const hex = createHash('sha256').update(`${id}:${kind}`).digest('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`; };
const saleInclude = { items: { include: { product: { select: { name: true, sku: true } } } }, payments: { include: { paymentMethod: true } }, customer: { select: { id: true, firstName: true, lastName: true, phone: true } }, store: { select: { name: true, code: true, address: true, phone: true } }, employee: { select: { name: true } }, seller: { select: { id: true, name: true } }, returns: { include: { items: true, payments: { include: { paymentMethod: true } } }, orderBy: { createdAt: 'asc' } } } as const;

@Injectable()
export class SalesService {
  constructor(private readonly db: DatabaseService, private readonly stock: StockService, private readonly finance: FinanceService, private readonly notifications: NotificationsService) {}
  methods() { return this.db.salePaymentMethod.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }); }
  async createMethod(input: z.infer<typeof paymentMethodSchema>, actorId: string) {
    try { return await this.db.$transaction(async tx => {
      const last = await tx.salePaymentMethod.aggregate({ _max: { sortOrder: true } });
      const data = { ...input, code: input.code ?? `CUSTOM_${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`, sortOrder: input.sortOrder ?? (last._max.sortOrder ?? 0) + 10 };
      const method = await tx.salePaymentMethod.create({ data });
      await tx.auditLog.create({ data: { userId: actorId, action: 'SALE_PAYMENT_METHOD_CREATED', entityType: 'SalePaymentMethod', entityId: method.id, newValue: data } });
      return method;
    }); } catch (error) { if (retryable(error)) throw new ConflictException('Payment method code already exists'); throw error; }
  }
  async editMethod(id: string, input: z.infer<typeof paymentMethodPatchSchema>, actorId: string) {
    const existing = await this.db.salePaymentMethod.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Payment method not found');
    return this.db.$transaction(async tx => {
      if (existing.active && input.active === false && !await tx.salePaymentMethod.count({ where: { active: true, id: { not: id } } })) throw new ConflictException('At least one payment method must stay active');
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
  async returnWithoutReceipt(storeId: string, input: z.infer<typeof receiptlessReturnSchema>, actorId: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.db.$transaction(async tx => {
        const existing = await tx.receiptlessReturn.findUnique({ where: { operationId: input.operationId }, include: { product: { select: { name: true, sku: true } } } });
        if (existing) {
          if (existing.storeId !== storeId || existing.deviceId !== input.deviceId || existing.cashShiftId !== input.cashShiftId || existing.productId !== input.productId || existing.quantity !== input.quantity || !existing.amountMinor.eq(input.amountMinor) || existing.reason !== input.reason) throw new ConflictException('Operation ID was used for another return');
          return existing;
        }
        const device = await tx.posDevice.findUnique({ where: { deviceId: input.deviceId } });
        if (!device || device.storeId !== storeId || device.status !== 'ACTIVE') throw new ConflictException('POS device is not active in this store');
        if (!await tx.cashShift.findFirst({ where: { id: input.cashShiftId, storeId, deviceId: input.deviceId, status: 'OPEN' } })) throw new ConflictException('Device has no matching open cash shift');
        if (!await tx.product.findFirst({ where: { id: input.productId, deletedAt: null }, select: { id: true } })) throw new NotFoundException('Product not found');
        const amount = new Prisma.Decimal(input.amountMinor);
        // Without a receipt the refund cannot exceed what the goods cost today.
        const settings = await tx.storeProductSettings.findUnique({ where: { storeId_productId: { storeId, productId: input.productId } } });
        if (settings?.priceMinor === null || settings?.priceMinor === undefined) throw new ConflictException('Product has no price in this store');
        if (amount.gt(new Prisma.Decimal(settings.priceMinor).mul(input.quantity))) throw new ConflictException('Refund exceeds current product price');
        const record = await tx.receiptlessReturn.create({ data: { operationId: input.operationId, storeId, deviceId: input.deviceId, cashShiftId: input.cashShiftId, employeeId: actorId, productId: input.productId, quantity: input.quantity, amountMinor: amount, reason: input.reason }, include: { product: { select: { name: true, sku: true } } } });
        await this.stock.applyMovementInTransaction(tx, { storeId, productId: input.productId, type: 'RETURN', delta: input.quantity, sourceType: 'RECEIPTLESS_RETURN', sourceId: record.id, actorId, comment: input.reason });
        await this.finance.postCashInTransaction(tx, { storeId, shiftId: input.cashShiftId, actorId, type: 'WITHDRAWAL', amount: amount.neg(), sourceType: 'RECEIPTLESS_RETURN', sourceId: record.id, comment: input.reason });
        await tx.auditLog.create({ data: { userId: actorId, action: 'RECEIPTLESS_RETURN_CREATED', entityType: 'ReceiptlessReturn', entityId: record.id, newValue: { productId: input.productId, quantity: input.quantity, amountMinor: input.amountMinor, reason: input.reason, cashShiftId: input.cashShiftId } } });
        await tx.posDevice.update({ where: { deviceId: input.deviceId }, data: { lastActivityAt: new Date() } });
        return record;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (retryable(error) && attempt < 2) continue; if (retryable(error)) throw new ConflictException('Concurrent return'); throw error; }
    }
    throw new ConflictException('Return could not be completed');
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
        if (sale.payments.length === 0) throw new ConflictException('Sale has no payments to refund');
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
        const buyer = sale.customerId ? await tx.customer.findUniqueOrThrow({ where: { id: sale.customerId } }) : null;
        const refunds = amount.gt(0) ? allocateRefund(sale.payments, sale.returns, amount, buyer?.debtBalanceMinor ?? new Prisma.Decimal(0)) : [];
        const record = await tx.saleReturn.create({ data: { operationId: input.operationId, saleId: id, storeId, deviceId: input.deviceId, cashShiftId: input.cashShiftId, employeeId: actorId, amountMinor: amount, costMinor: cost, profitMinor: amount.minus(cost), reason: input.reason } });
        for (const line of lines) {
          const returnItem = await tx.saleReturnItem.create({ data: { saleReturnId: record.id, saleItemId: line.item.id, quantity: line.quantity, amountMinor: line.amount, costMinor: line.cost, profitMinor: line.profit } });
          await this.stock.applyMovementInTransaction(tx, { storeId, productId: line.item.productId, type: 'RETURN', delta: line.quantity, sourceType: 'SALE_RETURN_ITEM', sourceId: returnItem.id, actorId, comment: input.reason });
        }
        let cashMethodId: string | undefined;
        for (const part of refunds) {
          if (!part.paymentMethodId) {
            cashMethodId ??= (await tx.salePaymentMethod.findFirst({ where: { kind: 'CASH' }, orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }] }))?.id;
            if (!cashMethodId) throw new ConflictException('Cash payment method is required for this refund');
          }
          await tx.saleReturnPayment.create({ data: { saleReturnId: record.id, paymentId: part.paymentId, paymentMethodId: part.paymentMethodId ?? cashMethodId!, amountMinor: part.amount } });
        }
        const refundOf = (kind: string) => sum(refunds.filter(part => part.kind === kind).map(part => part.amount));
        const cashRefund = refundOf('CASH');
        if (cashRefund.gt(0)) await this.finance.postCashInTransaction(tx, { storeId, shiftId: input.cashShiftId, actorId, type: 'WITHDRAWAL', amount: cashRefund.neg(), sourceType: 'SALE_RETURN', sourceId: record.id, comment: input.reason });
        const debtRefund = refundOf('DEBT');
        if (debtRefund.gt(0) && buyer) {
          const balance = buyer.debtBalanceMinor.minus(debtRefund);
          await tx.customer.update({ where: { id: buyer.id }, data: { debtBalanceMinor: balance } });
          await tx.customerDebtEntry.create({ data: { customerId: buyer.id, saleId: sale.id, type: 'RETURN', amountMinor: debtRefund.neg(), balanceAfterMinor: balance } });
        }
        const bonusRefund = refundOf('BONUS');
        if (bonusRefund.gt(0) && buyer) {
          const current = await tx.customer.findUniqueOrThrow({ where: { id: buyer.id } });
          const nextBalance = current.bonusBalanceMinor.plus(bonusRefund);
          await tx.customer.update({ where: { id: buyer.id }, data: { bonusBalanceMinor: nextBalance } });
          await tx.bonusTransaction.create({ data: { operationId: derivedOperationId(input.operationId, 'return-spent'), customerId: buyer.id, actorId, type: 'CORRECTION', deltaMinor: bonusRefund, balanceAfterMinor: nextBalance, reason: `Возврат оплаты бонусами по чеку ${sale.number}` } });
        }
        if (sale.customerId) {
          const customer = await tx.customer.findUniqueOrThrow({ where: { id: sale.customerId } });
          const spent = customer.totalSpentMinor.minus(amount);
          const fullReturn = sale.items.every(item => (returnedByItem.get(item.id) ?? 0) + (requested.find(request => request.saleItemId === item.id)?.quantity ?? 0) === item.quantity);
          const orders = customer.ordersCount - (fullReturn ? 1 : 0);
          if (spent.lt(0) || orders < 0) throw new ConflictException('Customer totals cannot be reduced for this return');
          await tx.customer.update({ where: { id: sale.customerId }, data: { totalSpentMinor: spent, ordersCount: orders, averageCheckMinor: orders ? spent.div(orders).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP) : new Prisma.Decimal(0) } });
          const earned = await tx.bonusTransaction.findUnique({ where: { operationId: derivedOperationId(sale.operationId, 'earn') } });
          if (earned && earned.deltaMinor.gt(0) && sale.totalMinor.gt(0)) {
            const previouslyReturned = sum(sale.returns.map(previous => previous.amountMinor));
            const reversedBefore = earned.deltaMinor.mul(previouslyReturned).div(sale.totalMinor).floor();
            const reversedAfter = earned.deltaMinor.mul(previouslyReturned.plus(amount)).div(sale.totalMinor).floor();
            const reversal = reversedAfter.minus(reversedBefore);
            if (reversal.gt(0)) {
              const current = await tx.customer.findUniqueOrThrow({ where: { id: customer.id } });
              const nextBalance = current.bonusBalanceMinor.minus(reversal);
              await tx.customer.update({ where: { id: customer.id }, data: { bonusBalanceMinor: nextBalance } });
              await tx.bonusTransaction.create({ data: { operationId: derivedOperationId(input.operationId, 'return'), customerId: customer.id, actorId, type: 'CORRECTION', deltaMinor: reversal.neg(), balanceAfterMinor: nextBalance, reason: `Возврат бонусов по чеку ${sale.number}` } });
            }
          }
        }
        const reward = await tx.employeeRewardTransaction.findUnique({ where: { operationId: derivedOperationId(sale.operationId, 'employee-earn') } });
        if (reward && reward.deltaMinor.gt(0) && sale.totalMinor.gt(0)) {
          const previouslyReturned = sum(sale.returns.map(previous => previous.amountMinor));
          const reversedBefore = reward.deltaMinor.mul(previouslyReturned).div(sale.totalMinor).floor();
          const reversedAfter = reward.deltaMinor.mul(previouslyReturned.plus(amount)).div(sale.totalMinor).floor();
          const reversal = reversedAfter.minus(reversedBefore);
          if (reversal.gt(0)) {
            const employee = await tx.user.findUniqueOrThrow({ where: { id: reward.employeeId } });
            const nextBalance = employee.rewardBalanceMinor.minus(reversal);
            await tx.user.update({ where: { id: employee.id }, data: { rewardBalanceMinor: nextBalance } });
            await tx.employeeRewardTransaction.create({ data: { operationId: derivedOperationId(input.operationId, 'employee-return'), employeeId: employee.id, saleId: sale.id, deltaMinor: reversal.neg(), balanceAfterMinor: nextBalance, reason: `Возврат по чеку ${sale.number}` } });
          }
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
  /** Active staff who may sell in this store, for the seller picker on the till. */
  async sellers(storeId: string) {
    return this.db.user.findMany({ where: { active: true, deletedAt: null, role: { permissions: { some: { permission: { code: 'sales.create' } } } }, OR: [{ primaryStoreId: storeId }, { stores: { some: { storeId } } }, { role: { code: { in: ['SUPERUSER', 'OWNER', 'DIRECTOR'] } } }] }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }
  async create(storeId: string, input: SaleInput, actorId: string, allowNegativeStock = false, unlimitedDiscount = true) {
    if (new Set(input.items.map(item => item.productId)).size !== input.items.length) throw new BadRequestException('Duplicate products in sale');
    const requestHash = createHash('sha256').update(JSON.stringify({ storeId, ...input })).digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.db.$transaction(async tx => {
        const existing = await tx.sale.findUnique({ where: { operationId: input.operationId }, include: saleInclude });
        if (existing) {
          if (existing.storeId !== storeId || existing.requestHash !== requestHash) throw new ConflictException('Operation ID was used for another sale');
          return existing;
        }
        if (!await tx.store.findFirst({ where: { id: storeId, deletedAt: null, status: 'ACTIVE' } })) throw new NotFoundException('Active store not found');
        const device = await tx.posDevice.findUnique({ where: { deviceId: input.deviceId } });
        if (!device || device.storeId !== storeId || device.status !== 'ACTIVE') throw new ConflictException('POS device is not active in this store');
        const customer = input.customerId ? await tx.customer.findFirst({ where: { id: input.customerId, deletedAt: null } }) : null;
        if (input.customerId && !customer) throw new NotFoundException('Customer not found');
        const savedLoyalty = await tx.loyaltySettings.findUnique({ where: { id: 1 } });
        const loyalty = savedLoyalty ? loyaltySettingsSchema.parse(savedLoyalty.rules) : defaultLoyaltySettings;
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
          const purchasePriceMinor = batch?.purchasePriceMinor ?? (settings?.costBasisMinor == null ? null : new Prisma.Decimal(settings.costBasisMinor));
          if (purchasePriceMinor === null) throw new ConflictException(`Purchase cost is missing for ${product.sku}`);
          const price = new Prisma.Decimal(quotedPrice ?? settings!.priceMinor!);
          const gross = price.mul(item.quantity);
          const discount = new Prisma.Decimal(item.discountMinor);
          if (discount.gt(gross)) throw new BadRequestException('Line discount exceeds line price');
          const cost = purchasePriceMinor.mul(item.quantity);
          lines.push({ productId: item.productId, brandId: product.brandId, categoryId: product.categoryId, quantity: item.quantity, priceMinor: price, currentPriceMinor: settings?.priceMinor ?? null, purchasePriceMinor, discountMinor: discount, totalMinor: gross.minus(discount), profitMinor: gross.minus(discount).minus(cost), batchId: batch?.id ?? null, gross, cost });
        }
        const subtotal = sum(lines.map(line => line.gross));
        let manualDiscount = new Prisma.Decimal(0);
        for (const line of lines) {
          const percent = loyalty.mode === 'DISCOUNT' ? automaticPercent(loyalty, line, customer?.discountPercent.toString() ?? null, BigInt(subtotal.toString())) : '0';
          const minimumDiscount = line.gross.mul(percentBasisPoints(percent).toString()).div(10000).floor();
          if (line.discountMinor.lt(minimumDiscount)) throw new BadRequestException(`Automatic discount is missing for product ${line.productId}`);
          manualDiscount = manualDiscount.plus(line.discountMinor.minus(minimumDiscount));
        }
        if (!unlimitedDiscount && manualDiscount.mul(10000).gt(subtotal.mul(percentBasisPoints(loyalty.maxManualDiscountPercent).toString()))) throw new ForbiddenException('Manual discount exceeds limit');
        const seller = input.sellerId ? await tx.user.findFirst({ where: { id: input.sellerId, active: true, deletedAt: null }, select: { id: true } }) : null;
        if (input.sellerId && !seller) throw new NotFoundException('Seller not found');
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
          if (loyalty.mode !== 'BONUS') throw new BadRequestException('Bonus payments are disabled in discount mode');
          if (allowNegativeStock) throw new BadRequestException('Bonus payments require an online sale');
          if (!customer) throw new BadRequestException('Customer is required for bonus payment');
          if (bonus.gt(customer.bonusBalanceMinor)) throw new ConflictException('Customer bonus balance is insufficient');
          if (await tx.bonusTransaction.findUnique({ where: { operationId: input.operationId } })) throw new ConflictException('Operation ID was used for another bonus transaction');
        }
        if (cash.gt(0) && !input.cashShiftId) throw new BadRequestException('Cash shift is required for cash sales');
        let cashShiftId = input.cashShiftId;
        if (cashShiftId && !await tx.cashShift.findFirst({ where: { id: cashShiftId, storeId, deviceId: input.deviceId, status: 'OPEN' } })) {
          // A queued non-cash sale may arrive after its shift was closed; it then stays outside any shift.
          if (cash.gt(0) || !allowNegativeStock) throw new ConflictException('Device has no matching open cash shift');
          cashShiftId = undefined;
        }
        const sale = await tx.sale.create({ data: { operationId: input.operationId, requestHash, number: `S-${input.operationId}`, storeId, deviceId: input.deviceId, cashShiftId, customerId: input.customerId, employeeId: actorId, sellerId: seller?.id ?? null, comment: input.comment || null, subtotalMinor: subtotal, discountMinor: discount, totalMinor: total, costMinor: cost, profitMinor: total.minus(cost), debtMinor: debt } });
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
          if (loyalty.mode === 'BONUS') {
            const earned = total.minus(bonus).minus(debt).mul(percentBasisPoints(loyalty.bonusEarnPercent).toString()).div(10000).floor();
            if (earned.gt(0)) {
              const current = await tx.customer.findUniqueOrThrow({ where: { id: customer.id } });
              const nextBalance = current.bonusBalanceMinor.plus(earned);
              if (nextBalance.gt(maximum)) throw new ConflictException('Bonus balance exceeds database range');
              await tx.customer.update({ where: { id: customer.id }, data: { bonusBalanceMinor: nextBalance } });
              await tx.bonusTransaction.create({ data: { operationId: derivedOperationId(input.operationId, 'earn'), customerId: customer.id, actorId, type: 'EARN', deltaMinor: earned, balanceAfterMinor: nextBalance, reason: `Начисление по чеку ${sale.number}` } });
            }
          }
        }
        const rewardEarned = total.minus(debt).minus(bonus).mul(percentBasisPoints(loyalty.consultantEarnPercent).toString()).div(10000).floor();
        if (rewardEarned.gt(0)) {
          // The consultant reward goes to the seller named on the receipt, or to the cashier.
          const rewardedId = seller?.id ?? actorId;
          const employee = await tx.user.findUniqueOrThrow({ where: { id: rewardedId } });
          const nextBalance = employee.rewardBalanceMinor.plus(rewardEarned);
          if (nextBalance.gt(maximum)) throw new ConflictException('Employee reward balance exceeds database range');
          await tx.user.update({ where: { id: rewardedId }, data: { rewardBalanceMinor: nextBalance } });
          await tx.employeeRewardTransaction.create({ data: { operationId: derivedOperationId(input.operationId, 'employee-earn'), employeeId: rewardedId, saleId: sale.id, deltaMinor: rewardEarned, balanceAfterMinor: nextBalance, reason: `Продажа ${sale.number}` } });
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
