import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { DatabaseService } from '../database.service';
import { canAccessStore, type AccessContext } from '../auth/policy';
import { localPeriod } from '../reports/reports.service';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const moneyJournalSchema = z.object({
  from: dateOnly, to: dateOnly,
  storeId: z.string().uuid().optional(),
  direction: z.enum(['IN', 'OUT']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type MoneyJournalQuery = z.infer<typeof moneyJournalSchema>;

const sql = Prisma.sql;
const customer = (alias: string) => Prisma.raw(`COALESCE(NULLIF(TRIM(${alias}."firstName" || ' ' || COALESCE(${alias}."lastName", '')), ''), 'Розничный покупатель')`);
const method = (column: string) => Prisma.raw(`CASE ${column} WHEN 'CASH' THEN 'Наличные' WHEN 'CARD' THEN 'Карта' WHEN 'BANK_TRANSFER' THEN 'Перевод' ELSE ${column}::text END`);
const plain = (value: unknown) => value === null || value === undefined ? null : value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? Number(value) : typeof value === 'object' ? String(value) : value;

/** Money journal shaped after CloudShop "Движение денег": every receipt and payout with account, counterparty and category. */
@Injectable()
export class MoneyService {
  constructor(private readonly db: DatabaseService) {}

  async journal(query: MoneyJournalQuery, access: AccessContext) {
    if (query.storeId && !canAccessStore(access, query.storeId)) throw new ForbiddenException('Store access denied');
    const stores = query.storeId ? [query.storeId] : (await this.db.store.findMany({ where: { deletedAt: null, ...(access.allStores ? {} : { id: { in: access.storeIds } }) }, select: { id: true } })).map(store => store.id);
    const empty = { items: [], total: 0, page: query.page, limit: query.limit, totals: { inMinor: '0', outMinor: '0' } };
    if (!stores.length) return empty;
    const { range } = localPeriod(query.from, query.to);
    const scope = (column: string) => sql`${Prisma.raw(column)} IN (${Prisma.join(stores.map(id => sql`${id}::uuid`))})`;
    // Numbers run per direction over the whole history of the visible stores, so "Приход #7" stays stable when filters change.
    const ops = sql`
      SELECT 'SALE_PAYMENT' AS source, p.id::text AS id, s."createdAt" AS at, s."storeId" AS store_id, p."amountMinor" AS amount,
             CASE WHEN pm.kind = 'CASH' THEN 'Касса ' || UPPER(LEFT(REGEXP_REPLACE(s."deviceId", '^(WEB|POS)-', ''), 8)) ELSE pm.name END AS account, pm.kind::text AS account_kind,
             'Клиент ' || ${customer('c')} AS counterparty, 'Оплата от клиента' AS category, COALESCE(seller.name, e.name) AS author, NULL::text AS comment,
             'SALE' AS doc_kind, s.id::text AS doc_id, 'Продажа ' || s.number AS doc_title
      FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId" JOIN "SalePaymentMethod" pm ON pm.id = p."paymentMethodId" JOIN "User" e ON e.id = s."employeeId"
      LEFT JOIN "User" seller ON seller.id = s."sellerId" LEFT JOIN "Customer" c ON c.id = s."customerId"
      WHERE s.status = 'COMPLETED' AND pm.kind NOT IN ('BONUS', 'DEBT') AND ${scope('s."storeId"')}
      UNION ALL
      SELECT 'SALE_RETURN_PAYMENT', rp.id::text, r."createdAt", r."storeId", -rp."amountMinor",
             CASE WHEN pm.kind = 'CASH' THEN 'Касса ' || UPPER(LEFT(REGEXP_REPLACE(r."deviceId", '^(WEB|POS)-', ''), 8)) ELSE pm.name END, pm.kind::text,
             'Клиент ' || ${customer('c')}, 'Возврат денежных средств клиенту', u.name, r.reason, 'SALE_RETURN', r.id::text, 'Возврат продажи ' || s.number
      FROM "SaleReturnPayment" rp JOIN "SaleReturn" r ON r.id = rp."saleReturnId" JOIN "Sale" s ON s.id = r."saleId" JOIN "SalePaymentMethod" pm ON pm.id = rp."paymentMethodId"
      JOIN "User" u ON u.id = r."employeeId" LEFT JOIN "Customer" c ON c.id = s."customerId"
      WHERE pm.kind NOT IN ('BONUS', 'DEBT') AND ${scope('r."storeId"')}
      UNION ALL
      SELECT 'RECEIPTLESS_RETURN', rr.id::text, rr."createdAt", rr."storeId", -rr."amountMinor", 'Касса ' || UPPER(LEFT(REGEXP_REPLACE(rr."deviceId", '^(WEB|POS)-', ''), 8)), 'CASH',
             'Клиент Розничный покупатель', 'Возврат денежных средств клиенту', u.name, rr.reason, 'RECEIPTLESS_RETURN', rr.id::text, 'Возврат без чека'
      FROM "ReceiptlessReturn" rr JOIN "User" u ON u.id = rr."employeeId" WHERE ${scope('rr."storeId"')}
      UNION ALL
      SELECT 'CUSTOMER_PAYMENT', cp.id::text, cp."createdAt", cp."storeId", cp."amountMinor", CASE WHEN pm.kind = 'CASH' THEN COALESCE('Касса ' || UPPER(LEFT(REGEXP_REPLACE(ccs."deviceId", '^(WEB|POS)-', ''), 8)), 'Касса') ELSE pm.name END, pm.kind::text,
             'Клиент ' || ${customer('c')}, 'Погашение долга клиентом', u.name, NULL, NULL, NULL, NULL
      FROM "CustomerPayment" cp JOIN "SalePaymentMethod" pm ON pm.id = cp."paymentMethodId" JOIN "Customer" c ON c.id = cp."customerId" JOIN "User" u ON u.id = cp."employeeId" LEFT JOIN "CashShift" ccs ON ccs.id = cp."cashShiftId"
      WHERE ${scope('cp."storeId"')}
      UNION ALL
      SELECT 'EXPENSE', ex.id::text, ex."createdAt", ex."storeId", -ex."amountMinor", CASE WHEN ex."paymentMethod" = 'CASH' THEN COALESCE('Касса ' || UPPER(LEFT(REGEXP_REPLACE(ecs."deviceId", '^(WEB|POS)-', ''), 8)), 'Касса') ELSE ${method('ex."paymentMethod"')} END, ex."paymentMethod"::text,
             NULL, ec.name, u.name, ex.description, NULL, NULL, NULL
      FROM "Expense" ex JOIN "ExpenseCategory" ec ON ec.id = ex."categoryId" LEFT JOIN "User" u ON u.id = ex."employeeId" LEFT JOIN "CashOperation" eco ON eco."sourceType" = 'EXPENSE' AND eco."sourceId" = ex.id::text LEFT JOIN "CashShift" ecs ON ecs.id = eco."cashShiftId" WHERE ${scope('ex."storeId"')}
      UNION ALL
      SELECT 'SUPPLIER_PAYMENT', sp.id::text, sp."createdAt", sp."storeId", -sp."amountMinor", CASE WHEN sp."paymentMethod" = 'CASH' THEN COALESCE('Касса ' || UPPER(LEFT(REGEXP_REPLACE(scs."deviceId", '^(WEB|POS)-', ''), 8)), 'Касса') ELSE ${method('sp."paymentMethod"')} END, sp."paymentMethod"::text,
             'Поставщик ' || sup.name, 'Оплата поставщику', u.name, NULL, 'PURCHASE', pu.id::text, 'Закупка ' || pu.number
      FROM "SupplierPayment" sp JOIN "Purchase" pu ON pu.id = sp."purchaseId" JOIN "Supplier" sup ON sup.id = pu."supplierId" JOIN "User" u ON u.id = sp."employeeId" LEFT JOIN "CashShift" scs ON scs.id = sp."cashShiftId"
      WHERE ${scope('sp."storeId"')}
      UNION ALL
      SELECT co."sourceType", co.id::text, co."createdAt", co."storeId", co."amountMinor", 'Касса ' || UPPER(LEFT(REGEXP_REPLACE(cs."deviceId", '^(WEB|POS)-', ''), 8)), 'CASH', NULL,
             CASE co."sourceType" WHEN 'EMPLOYEE_REWARD_PAYOUT' THEN 'Выплата вознаграждения' WHEN 'SHIFT_CLOSE_VARIANCE' THEN 'Корректировка баланса счёта'
               ELSE CASE co.type WHEN 'DEPOSIT' THEN 'Внесение наличных' WHEN 'WITHDRAWAL' THEN 'Изъятие наличных' ELSE 'Корректировка баланса счёта' END END,
             u.name, co.comment, NULL, NULL, NULL
      FROM "CashOperation" co JOIN "CashShift" cs ON cs.id = co."cashShiftId" JOIN "User" u ON u.id = co."employeeId"
      WHERE co."sourceType" IN ('MANUAL_CASH_OPERATION', 'SHIFT_CLOSE_VARIANCE', 'EMPLOYEE_REWARD_PAYOUT') AND ${scope('co."storeId"')}`;
    const where = sql`WHERE n.at >= ${range.gte} AND n.at < ${range.lt}
      ${query.direction === 'IN' ? sql`AND n.amount >= 0` : query.direction === 'OUT' ? sql`AND n.amount < 0` : Prisma.empty}
      ${query.q ? sql`AND (n.counterparty ILIKE ${`%${query.q}%`} OR n.comment ILIKE ${`%${query.q}%`} OR n.category ILIKE ${`%${query.q}%`} OR n.doc_title ILIKE ${`%${query.q}%`} OR n.number::text = ${query.q.replace(/^#/, '')})` : Prisma.empty}`;
    const numbered = sql`WITH o(source, id, at, store_id, amount, account, account_kind, counterparty, category, author, comment, doc_kind, doc_id, doc_title) AS (${ops}),
      n AS (SELECT o.*, ROW_NUMBER() OVER (PARTITION BY (o.amount >= 0) ORDER BY o.at, o.id)::int AS number FROM o)`;
    const [rows, totals] = await Promise.all([
      this.db.$queryRaw<Record<string, unknown>[]>`${numbered}
        SELECT n.*, st.name AS store, COUNT(*) OVER () AS "__total" FROM n JOIN "Store" st ON st.id = n.store_id ${where}
        ORDER BY n.at DESC, n.id DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      this.db.$queryRaw<{ in_minor: unknown; out_minor: unknown }[]>`${numbered}
        SELECT COALESCE(SUM(n.amount) FILTER (WHERE n.amount >= 0), 0) AS in_minor, COALESCE(-SUM(n.amount) FILTER (WHERE n.amount < 0), 0) AS out_minor FROM n ${where}`,
    ]);
    return {
      items: rows.map(record => ({
        id: `${record.source}:${record.id}`, source: record.source, number: plain(record.number), direction: Number(String(record.amount)) >= 0 ? 'IN' : 'OUT',
        occurredAt: plain(record.at), amountMinor: String(record.amount).replace(/^-/, ''), account: record.account, accountKind: record.account_kind,
        counterparty: record.counterparty, category: record.category, author: record.author, comment: record.comment, store: record.store,
        document: record.doc_kind ? { kind: record.doc_kind, id: record.doc_id, title: record.doc_title } : null,
      })),
      total: rows.length ? Number(rows[0]!.__total) : 0, page: query.page, limit: query.limit,
      totals: { inMinor: String(totals[0]?.in_minor ?? 0), outMinor: String(totals[0]?.out_minor ?? 0) },
    };
  }
}
