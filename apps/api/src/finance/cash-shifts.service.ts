import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { DatabaseService } from '../database.service';
import { canAccessStore, hasPermission, type AccessContext } from '../auth/policy';
import { localPeriod } from '../reports/reports.service';

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const shiftJournalQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  storeId: uuid.optional(),
  employeeId: uuid.optional(),
  deviceId: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ShiftJournalQuery = z.infer<typeof shiftJournalQuerySchema>;

const text = (value: unknown) => value === null || value === undefined ? null : String(value);
const sql = Prisma.sql;

/** Back-office view of cash shifts, shaped after the CloudShop shift journal and shift card. */
@Injectable()
export class CashShiftsService {
  constructor(private readonly db: DatabaseService) {}

  private async storeIds(access: AccessContext, storeId?: string) {
    if (storeId) {
      if (!canAccessStore(access, storeId)) throw new ForbiddenException('Store access denied');
      return [storeId];
    }
    const stores = await this.db.store.findMany({ where: { deletedAt: null, ...(access.allStores ? {} : { id: { in: access.storeIds } }) }, select: { id: true } });
    return stores.map(store => store.id);
  }

  async journal(query: ShiftJournalQuery, access: AccessContext) {
    const storeIds = await this.storeIds(access, query.storeId);
    const empty = { items: [], total: 0, page: query.page, limit: query.limit, filters: { cashiers: [], devices: [] } };
    if (!storeIds.length) return empty;
    const scope = sql`cs."storeId" IN (${Prisma.join(storeIds.map(id => sql`${id}::uuid`))})`;
    const period = query.from && query.to ? localPeriod(query.from, query.to).range : null;
    const where = sql`WHERE TRUE
      ${period ? sql`AND n."openedAt" >= ${period.gte} AND n."openedAt" < ${period.lt}` : Prisma.empty}
      ${query.employeeId ? sql`AND n."openedById" = ${query.employeeId}::uuid` : Prisma.empty}
      ${query.deviceId ? sql`AND n."deviceId" = ${query.deviceId}` : Prisma.empty}
      ${query.status ? sql`AND n.status = ${query.status}::"CashShiftStatus"` : Prisma.empty}`;
    // Shift numbers run per store in opening order, like "Смена #12" in CloudShop.
    const numbered = sql`WITH n AS (SELECT cs.*, ROW_NUMBER() OVER (PARTITION BY cs."storeId" ORDER BY cs."openedAt", cs.id)::int AS number FROM "CashShift" cs WHERE ${scope})`;
    const [rows, filters] = await Promise.all([
      this.db.$queryRaw<Record<string, unknown>[]>`${numbered}
        SELECT n.id, n.number, n."storeId", st.name AS store, n."deviceId", n.status, n."openedAt", n."closedAt", u.name AS cashier,
               sales.count AS "salesCount", sales.total AS "salesMinor", pay.cash AS "cashMinor", pay.noncash AS "noncashMinor",
               ret.count AS "returnsCount", ret.amount AS "returnsMinor", sales.total - ret.amount AS "revenueMinor",
               n."openingCashMinor", ops.ins AS "depositsMinor", ops.outs AS "outflowsMinor", n."closingCashMinor", n."expectedCashMinor",
               COUNT(*) OVER () AS "__total"
        FROM n JOIN "Store" st ON st.id = n."storeId" JOIN "User" u ON u.id = n."openedById"
        LEFT JOIN LATERAL (SELECT COUNT(*)::int AS count, COALESCE(SUM(s."totalMinor"), 0) AS total FROM "Sale" s WHERE s."cashShiftId" = n.id AND s.status = 'COMPLETED') sales ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(p."amountMinor") FILTER (WHERE pm.kind = 'CASH'), 0) AS cash,
                 COALESCE(SUM(p."amountMinor") FILTER (WHERE pm.kind NOT IN ('CASH', 'BONUS', 'DEBT')), 0) AS noncash
          FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId" JOIN "SalePaymentMethod" pm ON pm.id = p."paymentMethodId"
          WHERE s."cashShiftId" = n.id AND s.status = 'COMPLETED'
        ) pay ON TRUE
        LEFT JOIN LATERAL (
          SELECT ((SELECT COUNT(*) FROM "SaleReturn" r WHERE r."cashShiftId" = n.id) + (SELECT COUNT(*) FROM "ReceiptlessReturn" rr WHERE rr."cashShiftId" = n.id))::int AS count,
                 COALESCE((SELECT SUM(r."amountMinor") FROM "SaleReturn" r WHERE r."cashShiftId" = n.id), 0) + COALESCE((SELECT SUM(rr."amountMinor") FROM "ReceiptlessReturn" rr WHERE rr."cashShiftId" = n.id), 0) AS amount
        ) ret ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(co."amountMinor") FILTER (WHERE co."amountMinor" > 0), 0) AS ins, COALESCE(-SUM(co."amountMinor") FILTER (WHERE co."amountMinor" < 0), 0) AS outs
          FROM "CashOperation" co WHERE co."cashShiftId" = n.id
        ) ops ON TRUE
        ${where}
        ORDER BY n."openedAt" DESC, n.id DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      this.db.$queryRaw<{ kind: string; id: string; name: string; storeId: string | null }[]>`
        SELECT DISTINCT 'cashier' AS kind, u.id::text AS id, u.name, NULL::text AS "storeId" FROM "CashShift" cs JOIN "User" u ON u.id = cs."openedById" WHERE ${scope}
        UNION ALL
        SELECT DISTINCT 'device', cs."deviceId", cs."deviceId", cs."storeId"::text FROM "CashShift" cs WHERE ${scope}`,
    ]);
    const total = rows.length ? Number(rows[0]!.__total) : 0;
    return {
      items: rows.map(row => ({
        id: row.id, number: row.number, storeId: row.storeId, store: row.store, deviceId: row.deviceId, status: row.status,
        openedAt: row.openedAt, closedAt: row.closedAt, cashier: row.cashier, salesCount: row.salesCount, returnsCount: row.returnsCount,
        revenueMinor: text(row.revenueMinor), salesMinor: text(row.salesMinor), cashMinor: text(row.cashMinor), noncashMinor: text(row.noncashMinor),
        returnsMinor: text(row.returnsMinor), openingCashMinor: text(row.openingCashMinor), depositsMinor: text(row.depositsMinor),
        outflowsMinor: text(row.outflowsMinor), closingCashMinor: text(row.closingCashMinor), expectedCashMinor: text(row.expectedCashMinor),
      })),
      total, page: query.page, limit: query.limit,
      filters: {
        cashiers: filters.filter(item => item.kind === 'cashier').map(item => ({ id: item.id, name: item.name })).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
        devices: filters.filter(item => item.kind === 'device').map(item => ({ deviceId: item.id, storeId: item.storeId })),
      },
    };
  }

  /** Documents, money movements and products of one shift for the shift card tabs. */
  async activity(storeId: string, shiftId: string, access: AccessContext) {
    const shift = await this.db.cashShift.findFirst({ where: { id: shiftId, storeId }, select: { id: true } });
    if (!shift) throw new NotFoundException('Cash shift not found');
    const canSeeProfit = hasPermission(access, 'finance.view');
    const id = sql`${shiftId}::uuid`;
    const [documents, money, sold, returned, number] = await Promise.all([
      this.db.$queryRaw<Record<string, unknown>[]>`
        SELECT 'SALE' AS kind, s.id, s.number, s."createdAt", s.status::text AS status, s."totalMinor" AS "amountMinor", s."subtotalMinor", s."discountMinor", s."debtMinor",
               COALESCE(TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')), 'Розничный покупатель') AS customer, COALESCE(seller.name, e.name) AS employee,
               (SELECT COUNT(*)::int FROM "SaleItem" si WHERE si."saleId" = s.id) AS positions, NULL::text AS reason
        FROM "Sale" s JOIN "User" e ON e.id = s."employeeId" LEFT JOIN "User" seller ON seller.id = s."sellerId" LEFT JOIN "Customer" c ON c.id = s."customerId"
        WHERE s."cashShiftId" = ${id}
        UNION ALL
        SELECT 'RETURN', r.id, s.number, r."createdAt", 'COMPLETED', r."amountMinor", r."amountMinor", 0, 0,
               COALESCE(TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')), 'Розничный покупатель'), u.name,
               (SELECT COUNT(*)::int FROM "SaleReturnItem" ri WHERE ri."saleReturnId" = r.id), r.reason
        FROM "SaleReturn" r JOIN "Sale" s ON s.id = r."saleId" JOIN "User" u ON u.id = r."employeeId" LEFT JOIN "Customer" c ON c.id = s."customerId"
        WHERE r."cashShiftId" = ${id}
        UNION ALL
        SELECT 'RECEIPTLESS_RETURN', rr.id, NULL, rr."createdAt", 'COMPLETED', rr."amountMinor", rr."amountMinor", 0, 0, 'Розничный покупатель', u.name, 1, rr.reason
        FROM "ReceiptlessReturn" rr JOIN "User" u ON u.id = rr."employeeId"
        WHERE rr."cashShiftId" = ${id}
        ORDER BY 4 DESC LIMIT 300`,
      this.db.$queryRaw<Record<string, unknown>[]>`
        SELECT 'IN' AS direction, 'Оплата от клиента' AS category, s."createdAt", p."amountMinor", pm.name AS account, pm.kind::text AS "accountKind",
               COALESCE(TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')), 'Розничный покупатель') AS counterparty, 'Продажа ' || s.number AS document, COALESCE(seller.name, e.name) AS employee
        FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId" JOIN "SalePaymentMethod" pm ON pm.id = p."paymentMethodId" JOIN "User" e ON e.id = s."employeeId"
        LEFT JOIN "User" seller ON seller.id = s."sellerId" LEFT JOIN "Customer" c ON c.id = s."customerId"
        WHERE s."cashShiftId" = ${id} AND s.status = 'COMPLETED' AND pm.kind NOT IN ('BONUS', 'DEBT')
        UNION ALL
        SELECT 'OUT', 'Возврат денежных средств клиенту', r."createdAt", rp."amountMinor", pm.name, pm.kind::text,
               COALESCE(TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')), 'Розничный покупатель'), 'Возврат по чеку ' || s.number, u.name
        FROM "SaleReturnPayment" rp JOIN "SaleReturn" r ON r.id = rp."saleReturnId" JOIN "Sale" s ON s.id = r."saleId" JOIN "SalePaymentMethod" pm ON pm.id = rp."paymentMethodId"
        JOIN "User" u ON u.id = r."employeeId" LEFT JOIN "Customer" c ON c.id = s."customerId"
        WHERE r."cashShiftId" = ${id} AND pm.kind NOT IN ('BONUS', 'DEBT')
        UNION ALL
        SELECT 'IN', 'Погашение долга', cp."createdAt", cp."amountMinor", pm.name, pm.kind::text, TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')), NULL, u.name
        FROM "CustomerPayment" cp JOIN "SalePaymentMethod" pm ON pm.id = cp."paymentMethodId" JOIN "Customer" c ON c.id = cp."customerId" JOIN "User" u ON u.id = cp."employeeId"
        WHERE cp."cashShiftId" = ${id} AND pm.kind <> 'CASH'
        UNION ALL
        SELECT CASE WHEN co."amountMinor" >= 0 THEN 'IN' ELSE 'OUT' END,
               CASE co."sourceType"
                 WHEN 'SALE_PAYMENT' THEN 'Оплата от клиента' WHEN 'CUSTOMER_PAYMENT' THEN 'Погашение долга'
                 WHEN 'SALE_RETURN' THEN 'Возврат денежных средств клиенту' WHEN 'RECEIPTLESS_RETURN' THEN 'Возврат без чека'
                 WHEN 'EXPENSE' THEN COALESCE(ec.name, 'Расход') WHEN 'SUPPLIER_PAYMENT' THEN 'Оплата поставщику'
                 WHEN 'EMPLOYEE_REWARD_PAYOUT' THEN 'Выплата вознаграждения' WHEN 'SHIFT_CLOSE_VARIANCE' THEN 'Расхождение при закрытии'
                 ELSE CASE co.type WHEN 'DEPOSIT' THEN 'Внесение' WHEN 'WITHDRAWAL' THEN 'Изъятие' ELSE 'Корректировка' END END,
               co."createdAt", ABS(co."amountMinor"), 'Касса', 'CASH',
               CASE WHEN co."sourceType" = 'SUPPLIER_PAYMENT' THEN sup.name WHEN co."sourceType" = 'CUSTOMER_PAYMENT' THEN TRIM(cc."firstName" || ' ' || COALESCE(cc."lastName", '')) ELSE NULL END,
               co.comment, u.name
        FROM "CashOperation" co JOIN "User" u ON u.id = co."employeeId"
        LEFT JOIN "Expense" ex ON co."sourceType" = 'EXPENSE' AND ex.id::text = co."sourceId"
        LEFT JOIN "ExpenseCategory" ec ON ec.id = ex."categoryId"
        LEFT JOIN "SupplierPayment" spay ON co."sourceType" = 'SUPPLIER_PAYMENT' AND spay.id::text = co."sourceId"
        LEFT JOIN "Supplier" sup ON sup.id = spay."supplierId"
        LEFT JOIN "CustomerPayment" cpay ON co."sourceType" = 'CUSTOMER_PAYMENT' AND cpay.id::text = co."sourceId"
        LEFT JOIN "Customer" cc ON cc.id = cpay."customerId"
        WHERE co."cashShiftId" = ${id} AND co."sourceType" NOT IN ('SALE_PAYMENT', 'SALE_RETURN')
        ORDER BY 3 DESC LIMIT 300`,
      this.db.$queryRaw<Record<string, unknown>[]>`
        SELECT p.id AS "productId", p.name AS product, p.sku, SUM(si.quantity) AS quantity, SUM(si."totalMinor") AS "amountMinor", SUM(si."profitMinor") AS "profitMinor"
        FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" JOIN "Product" p ON p.id = si."productId"
        WHERE s."cashShiftId" = ${id} AND s.status = 'COMPLETED'
        GROUP BY p.id, p.name, p.sku ORDER BY p.name`,
      this.db.$queryRaw<Record<string, unknown>[]>`
        SELECT x."productId", x.product, x.sku, SUM(x.quantity) AS quantity, SUM(x.amount) AS "amountMinor" FROM (
          SELECT p.id AS "productId", p.name AS product, p.sku, ri.quantity, ri."amountMinor" AS amount
          FROM "SaleReturnItem" ri JOIN "SaleReturn" r ON r.id = ri."saleReturnId" JOIN "SaleItem" si ON si.id = ri."saleItemId" JOIN "Product" p ON p.id = si."productId"
          WHERE r."cashShiftId" = ${id}
          UNION ALL
          SELECT p.id, p.name, p.sku, rr.quantity, rr."amountMinor" FROM "ReceiptlessReturn" rr JOIN "Product" p ON p.id = rr."productId" WHERE rr."cashShiftId" = ${id}
        ) x GROUP BY x."productId", x.product, x.sku ORDER BY x.product`,
      this.db.$queryRaw<{ number: number }[]>`SELECT number FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY "openedAt", id)::int AS number FROM "CashShift" WHERE "storeId" = ${storeId}::uuid) x WHERE id = ${id}`,
    ]);
    const plain = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? Number(value) : value !== null && typeof value === 'object' ? String(value) : value]));
    return {
      number: number[0]?.number ?? null,
      documents: documents.map(plain),
      money: money.map(plain),
      products: {
        sold: sold.map(plain).map(row => canSeeProfit ? row : { ...row, profitMinor: null }),
        returned: returned.map(plain),
      },
      canSeeProfit,
    };
  }
}
