import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AccessContext } from '../auth/policy';
import { DatabaseService } from '../database.service';
import { consultantPeriods } from './consultant-periods';

export function consultantSalesWhere(
  actor: AccessContext,
): Prisma.SaleWhereInput {
  return {
    ...(actor.allStores ? {} : { storeId: { in: actor.storeIds } }),
    status: 'COMPLETED',
    OR: [
      { sellerId: actor.userId },
      { sellerId: null, employeeId: actor.userId },
    ],
  };
}

@Injectable()
export class ConsultantService {
  constructor(private readonly db: DatabaseService) {}

  async performance(actor: AccessContext) {
    const periods = consultantPeriods();
    const attribution = consultantSalesWhere(actor);
    return this.db.$transaction(
      async (tx) => {
        const result = {} as Record<
          keyof typeof periods,
          {
            salesMinor: string;
            returnsMinor: string;
            netMinor: string;
            saleCount: number;
            averageCheckMinor: string;
            closedShiftCount: number;
          }
        >;
        for (const key of ['day', 'month', 'quarter'] as const) {
          const { from, to } = periods[key];
          const interval = { gte: from, lt: to };
          const [sales, returns, shifts] = await Promise.all([
            tx.sale.aggregate({
              where: { ...attribution, createdAt: interval },
              _count: { id: true },
              _sum: { totalMinor: true },
            }),
            tx.saleReturn.aggregate({
              where: { sale: attribution, createdAt: interval },
              _sum: { amountMinor: true },
            }),
            tx.cashShift.count({
              where: {
                ...(actor.allStores ? {} : { storeId: { in: actor.storeIds } }),
                status: 'CLOSED',
                closedAt: interval,
                OR: [
                  { openedById: actor.userId },
                  { sales: { some: attribution } },
                ],
              },
            }),
          ]);
          const revenue = sales._sum.totalMinor ?? new Prisma.Decimal(0);
          const refunded = returns._sum.amountMinor ?? new Prisma.Decimal(0);
          result[key] = {
            salesMinor: revenue.toFixed(0),
            returnsMinor: refunded.toFixed(0),
            netMinor: revenue.minus(refunded).toFixed(0),
            saleCount: sales._count.id,
            averageCheckMinor: sales._count.id
              ? revenue
                  .div(sales._count.id)
                  .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
                  .toFixed(0)
              : '0',
            closedShiftCount: shifts,
          };
        }
        return { timezone: 'Asia/Dushanbe', periods, ...result };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async sales(actor: AccessContext, page: number, limit: number) {
    const where = consultantSalesWhere(actor);
    const [items, total] = await this.db.$transaction([
      this.db.sale.findMany({
        where,
        select: {
          id: true,
          number: true,
          createdAt: true,
          totalMinor: true,
          status: true,
          store: { select: { name: true } },
          items: {
            select: {
              quantity: true,
              product: { select: { name: true, sku: true } },
            },
          },
          returns: { select: { amountMinor: true, createdAt: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.sale.count({ where }),
    ]);
    return { items, total, page, limit };
  }
}
