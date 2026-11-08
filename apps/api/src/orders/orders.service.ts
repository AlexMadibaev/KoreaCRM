import { paymentMethodStoreFilter } from '../sales/payment-method-scope';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { DatabaseService } from '../database.service';
import { FinanceService } from '../finance/finance.service';
import { SalesService } from '../sales/sales.service';
import {
  automaticPercent,
  defaultLoyaltySettings,
  loyaltySettingsSchema,
  percentBasisPoints,
} from '../loyalty/loyalty.rules';
import {
  cancelOrderSchema,
  completeOrderSchema,
  createOrderSchema,
  editOrderSchema,
  orderDraftSchema,
  orderListSchema,
  orderPaymentSchema,
} from './orders.schemas';

const orderInclude = {
  store: { select: { status: true, deletedAt: true } },
  items: { orderBy: { id: 'asc' as const } },
  customer: {
    select: { id: true, firstName: true, lastName: true, phone: true },
  },
  payments: {
    include: { paymentMethod: { select: { name: true, kind: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  events: {
    include: { employee: { select: { name: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  sale: {
    select: {
      id: true,
      number: true,
      cashShiftId: true,
      returns: { select: { id: true, amountMinor: true, createdAt: true } },
    },
  },
} satisfies Prisma.CustomerOrderInclude;
type Order = Prisma.CustomerOrderGetPayload<{ include: typeof orderInclude }>;
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sum = (values: Prisma.Decimal[]) =>
  values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));

function paymentStatus(order: {
  paidMinor: Prisma.Decimal;
  totalMinor: Prisma.Decimal;
}) {
  if (order.paidMinor.isZero()) return 'UNPAID';
  if (order.paidMinor.eq(order.totalMinor)) return 'PAID';
  return 'PARTIALLY_PAID';
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly finance: FinanceService,
    private readonly sales: SalesService,
  ) {}

  private async transaction<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(action, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const concurrent =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2002'].includes(error.code);
        if (concurrent && attempt < 2) continue;
        if (concurrent)
          throw new ConflictException(
            'Заказ изменён одновременно. Обновите страницу.',
          );
        throw error;
      }
    }
    throw new ConflictException('Не удалось сохранить заказ.');
  }

  private async requireOrder(
    tx: Prisma.TransactionClient,
    storeId: string,
    id: string,
  ) {
    const order = await tx.customerOrder.findFirst({
      where: { id, storeId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Заказ не найден.');
    return { ...order, paymentStatus: paymentStatus(order) };
  }

  private requireActiveStore(order: Order) {
    if (order.store.status !== 'ACTIVE' || order.store.deletedAt)
      throw new BadRequestException('Магазин отключён.');
  }

  private async event(
    tx: Prisma.TransactionClient,
    orderId: string,
    actorId: string,
    action: string,
    details: Prisma.InputJsonObject,
  ) {
    await tx.orderEvent.create({
      data: { orderId, employeeId: actorId, action, details },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action,
        entityType: 'CustomerOrder',
        entityId: orderId,
        newValue: details,
      },
    });
  }

  async list(storeId: string, query: z.infer<typeof orderListSchema>) {
    const number = Number(query.search);
    const where: Prisma.CustomerOrderWhereInput = {
      storeId,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              ...(Number.isSafeInteger(number) && number > 0
                ? [{ number }]
                : []),
              {
                customer: {
                  firstName: { contains: query.search, mode: 'insensitive' },
                },
              },
              { contactPhone: { contains: query.search } },
              { comment: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.customerOrder.findMany({
        where,
        include: { customer: { select: { firstName: true, phone: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.customerOrder.count({ where }),
    ]);
    return {
      items: items.map((order) => ({
        ...order,
        paymentStatus: paymentStatus(order),
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async get(storeId: string, id: string) {
    return this.requireOrder(this.db, storeId, id);
  }

  private async quote(
    tx: Prisma.TransactionClient,
    storeId: string,
    draft: z.infer<typeof orderDraftSchema>,
  ) {
    if (
      !(await tx.store.findFirst({
        where: { id: storeId, status: 'ACTIVE', deletedAt: null },
      }))
    )
      throw new NotFoundException('Магазин отключён.');
    const customer = draft.customerId
      ? await tx.customer.findFirst({
          where: { id: draft.customerId, deletedAt: null },
        })
      : null;
    if (draft.customerId && !customer)
      throw new NotFoundException('Клиент не найден.');
    const products = await tx.product.findMany({
      where: {
        id: { in: draft.items.map((item) => item.productId) },
        deletedAt: null,
        status: 'ACTIVE',
      },
      include: { storeSettings: { where: { storeId, active: true } } },
    });
    const lines = draft.items.map((item) => {
      const product = products.find((product) => product.id === item.productId);
      const price = product?.storeSettings[0]?.priceMinor;
      if (!product || price == null)
        throw new BadRequestException(
          'У товара нет активной цены в этом магазине.',
        );
      return {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        quantity: item.quantity,
        priceMinor: new Prisma.Decimal(price),
        brandId: product.brandId,
        categoryId: product.categoryId,
      };
    });
    const subtotal = sum(
      lines.map((line) => line.priceMinor.mul(line.quantity)),
    );
    const saved = await tx.loyaltySettings.findUnique({ where: { id: 1 } });
    const loyalty = saved
      ? loyaltySettingsSchema.parse(saved.rules)
      : defaultLoyaltySettings;
    const items = lines.map((line) => {
      const percent = automaticPercent(
        loyalty,
        line,
        customer?.discountPercent.toString() ?? null,
        BigInt(subtotal.toString()),
      );
      const gross = line.priceMinor.mul(line.quantity);
      const discountMinor = gross
        .mul(percentBasisPoints(percent).toString())
        .div(10000)
        .floor();
      return {
        productId: line.productId,
        name: line.name,
        sku: line.sku,
        quantity: line.quantity,
        priceMinor: line.priceMinor,
        discountMinor,
        totalMinor: gross.minus(discountMinor),
      };
    });
    const totalMinor = sum(items.map((item) => item.totalMinor));
    if (totalMinor.lte(0) || totalMinor.gt('999999999999999999'))
      throw new BadRequestException(
        'Сумма заказа должна быть положительной и укладываться в допустимый диапазон.',
      );
    return { items, totalMinor };
  }

  async create(
    storeId: string,
    input: z.infer<typeof createOrderSchema>,
    actorId: string,
  ) {
    const requestHash = fingerprint({ storeId, ...input });
    return this.transaction(async (tx) => {
      const existing = await tx.customerOrder.findUnique({
        where: { operationId: input.operationId },
      });
      if (existing) {
        if (
          existing.storeId !== storeId ||
          existing.requestHash !== requestHash
        )
          throw new ConflictException(
            'Идентификатор уже использован для другого заказа.',
          );
        return this.requireOrder(tx, storeId, existing.id);
      }
      const quote = await this.quote(tx, storeId, input.draft);
      const number =
        ((
          await tx.customerOrder.aggregate({
            where: { storeId },
            _max: { number: true },
          })
        )._max.number ?? 0) + 1;
      const details = {
        customerId: input.draft.customerId ?? null,
        deliveryMethod: input.draft.deliveryMethod,
        deliveryAddress: input.draft.deliveryAddress,
        contactPhone: input.draft.contactPhone,
        comment: input.draft.comment,
      };
      const order = await tx.customerOrder.create({
        data: {
          ...details,
          storeId,
          number,
          operationId: input.operationId,
          requestHash,
          createdById: actorId,
          totalMinor: quote.totalMinor,
          items: { create: quote.items },
        },
      });
      await this.event(tx, order.id, actorId, 'ORDER_CREATED', { number });
      return this.requireOrder(tx, storeId, order.id);
    });
  }

  async edit(
    storeId: string,
    id: string,
    input: z.infer<typeof editOrderSchema>,
    actorId: string,
  ) {
    return this.transaction(async (tx) => {
      const order = await this.requireOrder(tx, storeId, id);
      if (order.status !== 'DRAFT' || order.version !== input.version)
        throw new ConflictException(
          'Редактируется только актуальный черновик. Обновите заказ.',
        );
      const quote = await this.quote(tx, storeId, input.draft);
      const details = {
        customerId: input.draft.customerId ?? null,
        deliveryMethod: input.draft.deliveryMethod,
        deliveryAddress: input.draft.deliveryAddress,
        contactPhone: input.draft.contactPhone,
        comment: input.draft.comment,
      };
      await tx.orderItem.deleteMany({ where: { orderId: id } });
      await tx.customerOrder.update({
        where: { id },
        data: {
          ...details,
          totalMinor: quote.totalMinor,
          version: { increment: 1 },
          items: { create: quote.items },
        },
      });
      await this.event(tx, id, actorId, 'ORDER_EDITED', {
        previousVersion: order.version,
        totalMinor: quote.totalMinor.toString(),
      });
      return this.requireOrder(tx, storeId, id);
    });
  }

  private async reserve(
    tx: Prisma.TransactionClient,
    order: Order,
    release: boolean,
  ) {
    for (const item of order.items) {
      const stock = await tx.stock.findUnique({
        where: {
          storeId_productId: {
            storeId: order.storeId,
            productId: item.productId,
          },
        },
      });
      if (
        !stock ||
        (!release && stock.quantity - stock.reservedQuantity < item.quantity)
      )
        throw new ConflictException(
          `Недостаточно свободного остатка для ${item.name}.`,
        );
      const reservedQuantity =
        stock.reservedQuantity + (release ? -item.quantity : item.quantity);
      if (reservedQuantity < 0 || reservedQuantity > 2147483647)
        throw new ConflictException('Некорректный резерв товара.');
      await tx.stock.update({
        where: {
          storeId_productId: {
            storeId: order.storeId,
            productId: item.productId,
          },
        },
        data: { reservedQuantity },
      });
    }
  }

  async confirm(storeId: string, id: string, version: number, actorId: string) {
    return this.transaction(async (tx) => {
      const order = await this.requireOrder(tx, storeId, id);
      if (order.status === 'CONFIRMED' || order.status === 'READY')
        return order;
      if (order.status !== 'DRAFT' || order.version !== version)
        throw new ConflictException('Подтвердите актуальный черновик.');
      this.requireActiveStore(order);
      await this.reserve(tx, order, false);
      await tx.customerOrder.update({
        where: { id },
        data: { status: 'CONFIRMED', version: { increment: 1 } },
      });
      await this.event(tx, id, actorId, 'ORDER_CONFIRMED', {});
      return this.requireOrder(tx, storeId, id);
    });
  }

  async ready(storeId: string, id: string, actorId: string) {
    return this.transaction(async (tx) => {
      const order = await this.requireOrder(tx, storeId, id);
      if (order.status === 'READY') return order;
      if (order.status !== 'CONFIRMED')
        throw new ConflictException('Сначала подтвердите заказ.');
      await tx.customerOrder.update({
        where: { id },
        data: { status: 'READY', version: { increment: 1 } },
      });
      await this.event(tx, id, actorId, 'ORDER_READY', {});
      return this.requireOrder(tx, storeId, id);
    });
  }

  private async requireShift(
    tx: Prisma.TransactionClient,
    storeId: string,
    cashShiftId: string | undefined,
  ) {
    const shift = cashShiftId
      ? await tx.cashShift.findFirst({
          where: { id: cashShiftId, storeId, status: 'OPEN' },
        })
      : null;
    if (!shift)
      throw new BadRequestException(
        'Выберите открытую кассовую смену этого магазина.',
      );
    return shift;
  }

  async pay(
    storeId: string,
    id: string,
    input: z.infer<typeof orderPaymentSchema>,
    actorId: string,
    canUseCash: boolean,
  ) {
    const requestHash = fingerprint({ storeId, id, ...input });
    return this.transaction(async (tx) => {
      const existing = await tx.orderPayment.findUnique({
        where: { operationId: input.operationId },
      });
      if (existing) {
        if (existing.orderId !== id || existing.requestHash !== requestHash)
          throw new ConflictException('Идентификатор платежа уже использован.');
        return this.requireOrder(tx, storeId, id);
      }
      const order = await this.requireOrder(tx, storeId, id);
      if (!['CONFIRMED', 'READY'].includes(order.status))
        throw new ConflictException(
          'Оплата доступна только для подтверждённого заказа.',
        );
      this.requireActiveStore(order);
      const method = await tx.salePaymentMethod.findFirst({
        where: { id: input.paymentMethodId, active: true, ...paymentMethodStoreFilter(storeId) },
      });
      if (!method || ['BONUS', 'DEBT'].includes(method.kind))
        throw new BadRequestException(
          'Для предоплаты выберите денежный способ оплаты.',
        );
      if (method.kind === 'CASH' && !canUseCash)
        throw new ForbiddenException('Нет права проводить наличные операции.');
      if (method.kind !== 'CASH' && input.cashShiftId)
        throw new BadRequestException(
          'Смена указывается только для наличной предоплаты.',
        );
      if (method.kind === 'CASH')
        await this.requireShift(tx, storeId, input.cashShiftId);
      const amount = new Prisma.Decimal(input.amountMinor);
      const paid = order.paidMinor.plus(amount);
      if (paid.gt(order.totalMinor))
        throw new BadRequestException('Оплата превышает остаток по заказу.');
      const payment = await tx.orderPayment.create({
        data: { ...input, requestHash, orderId: id, employeeId: actorId },
      });
      if (method.kind === 'CASH')
        await this.finance.postCashInTransaction(tx, {
          storeId,
          shiftId: input.cashShiftId!,
          actorId,
          type: 'DEPOSIT',
          amount,
          sourceType: 'ORDER_PREPAYMENT',
          sourceId: payment.id,
          comment: `Предоплата заказа №${order.number}`,
        });
      await tx.customerOrder.update({
        where: { id },
        data: { paidMinor: paid, version: { increment: 1 } },
      });
      await this.event(tx, id, actorId, 'ORDER_PAYMENT', {
        amountMinor: amount.toString(),
        method: method.name,
      });
      return this.requireOrder(tx, storeId, id);
    });
  }

  async complete(
    storeId: string,
    id: string,
    input: z.infer<typeof completeOrderSchema>,
    actorId: string,
    canSell: boolean,
  ) {
    if (!canSell)
      throw new ForbiddenException(
        'Для выдачи заказа нужно право создания продаж.',
      );
    return this.transaction(async (tx) => {
      const order = await this.requireOrder(tx, storeId, id);
      if (
        order.status === 'COMPLETED' &&
        order.completionOperationId === input.operationId &&
        order.saleId &&
        order.sale?.cashShiftId === input.cashShiftId
      )
        return order;
      if (
        !['CONFIRMED', 'READY'].includes(order.status) ||
        !order.paidMinor.eq(order.totalMinor)
      )
        throw new ConflictException(
          'Перед выдачей подтвердите и полностью оплатите заказ.',
        );
      const shift = await this.requireShift(tx, storeId, input.cashShiftId);
      if (shift.openedById !== actorId)
        throw new BadRequestException('Выдайте заказ в своей кассовой смене.');
      this.requireActiveStore(order);
      const paymentTotals = new Map<string, Prisma.Decimal>();
      for (const payment of order.payments)
        paymentTotals.set(
          payment.paymentMethodId,
          (
            paymentTotals.get(payment.paymentMethodId) ?? new Prisma.Decimal(0)
          ).plus(payment.amountMinor),
        );
      await this.reserve(tx, order, true);
      const sale = await this.sales.createInTransaction(
        tx,
        storeId,
        {
          operationId: input.operationId,
          deviceId: shift.deviceId,
          cashShiftId: shift.id,
          customerId: order.customerId ?? undefined,
          comment: `Заказ №${order.number}`,
          items: order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            discountMinor: item.discountMinor.toString(),
          })),
          payments: [...paymentTotals].map(([paymentMethodId, amount]) => ({
            paymentMethodId,
            amountMinor: amount.toString(),
            reference: `Order ${order.id}`,
          })),
        },
        actorId,
        {
          orderPrices: new Map(
            order.items.map((item) => [
              item.productId,
              item.priceMinor.toString(),
            ]),
          ),
          prepaidCashMinor: sum(
            order.payments
              .filter((payment) => payment.paymentMethod.kind === 'CASH')
              .map((payment) => payment.amountMinor),
          ),
        },
      );
      await tx.customerOrder.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          saleId: sale.id,
          completionOperationId: input.operationId,
          version: { increment: 1 },
        },
      });
      await this.event(tx, id, actorId, 'ORDER_COMPLETED', {
        saleId: sale.id,
        number: sale.number,
      });
      return this.requireOrder(tx, storeId, id);
    });
  }

  async cancel(
    storeId: string,
    id: string,
    input: z.infer<typeof cancelOrderSchema>,
    actorId: string,
    canUseCash: boolean,
  ) {
    const requestHash = fingerprint(input);
    return this.transaction(async (tx) => {
      const order = await this.requireOrder(tx, storeId, id);
      if (
        order.status === 'CANCELLED' &&
        order.cancellationHash === requestHash
      )
        return order;
      if (['CANCELLED', 'COMPLETED'].includes(order.status))
        throw new ConflictException(
          'Заказ уже закрыт. Для выданного заказа оформите возврат чека.',
        );
      const hasCash = order.payments.some(
        (payment) => payment.paymentMethod.kind === 'CASH',
      );
      if (hasCash) {
        if (!canUseCash)
          throw new BadRequestException(
            'Нет права проводить наличные операции.',
          );
        await this.requireShift(tx, storeId, input.cashShiftId);
      }
      if (order.status !== 'DRAFT') await this.reserve(tx, order, true);
      for (const payment of order.payments) {
        const hex = fingerprint({
          operationId: input.operationId,
          paymentId: payment.id,
        });
        const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
        const cashShiftId =
          payment.paymentMethod.kind === 'CASH' ? input.cashShiftId : undefined;
        const refund = await tx.orderPayment.create({
          data: {
            operationId,
            requestHash,
            orderId: id,
            paymentMethodId: payment.paymentMethodId,
            amountMinor: payment.amountMinor.neg(),
            employeeId: actorId,
            cashShiftId,
          },
        });
        if (cashShiftId)
          await this.finance.postCashInTransaction(tx, {
            storeId,
            shiftId: cashShiftId,
            actorId,
            type: 'WITHDRAWAL',
            amount: payment.amountMinor.neg(),
            sourceType: 'ORDER_REFUND',
            sourceId: refund.id,
            comment: `Отмена заказа №${order.number}: ${input.reason}`,
          });
      }
      await tx.customerOrder.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          paidMinor: 0,
          cancellationOperationId: input.operationId,
          cancellationHash: requestHash,
          version: { increment: 1 },
        },
      });
      await this.event(tx, id, actorId, 'ORDER_CANCELLED', {
        reason: input.reason,
        refundedMinor: order.paidMinor.toString(),
      });
      return this.requireOrder(tx, storeId, id);
    });
  }
}
