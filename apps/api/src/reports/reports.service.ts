import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database.service';
import { canAccessStore, hasPermission, type AccessContext } from '../auth/policy';
import { reportKeys, type ReportKey, type ReportQuery } from './reports.schemas';

/** Business days are counted in the store time zone (Dushanbe, UTC+5, no DST). */
export const REPORT_TIME_ZONE = 'Asia/Dushanbe';
const ZONE_OFFSET = '+05:00';
const EXPORT_LIMIT = 10_000;

export type ColumnType = 'text' | 'date' | 'datetime' | 'money' | 'quantity' | 'count' | 'percent';
export type ReportColumn = { key: string; label: string; type: ColumnType; finance?: boolean };
type ReportContext = {
  range: { gte: Date; lt: Date } | null;
  utcDays: { gte: Date; lt: Date } | null;
  storeIds: string[] | null; // null = every store
  employeeId?: string;
  categoryIds?: string[];
  q?: string;
  lowOnly: boolean;
  canSeeCustomers: boolean;
};
type ReportDefinition = {
  title: string;
  description: string;
  group: 'Продажи' | 'Прибыль' | 'Склад' | 'Деньги' | 'Клиенты';
  requires: string[];
  period: boolean;
  filters: Array<'store' | 'employee' | 'category' | 'q' | 'lowOnly'>;
  columns: ReportColumn[];
  sort: { key: string; dir: 'asc' | 'desc' };
  /** Raw SQL select list over `data`; constant text only, never user input. */
  totals?: string;
  build: (ctx: ReportContext) => Prisma.Sql;
};

const raw = Prisma.raw;
const localDay = (column: string) => raw(`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE '${REPORT_TIME_ZONE}', 'YYYY-MM-DD')`);
const inPeriod = (ctx: ReportContext, column: string) => ctx.range ? Prisma.sql`AND ${raw(column)} >= ${ctx.range.gte} AND ${raw(column)} < ${ctx.range.lt}` : Prisma.empty;
const inStores = (ctx: ReportContext, column: string) => ctx.storeIds ? Prisma.sql`AND ${raw(column)} IN (${Prisma.join(ctx.storeIds.map(id => Prisma.sql`${id}::uuid`))})` : Prisma.empty;
const seller = (ctx: ReportContext, saleAlias = 's') => ctx.employeeId ? Prisma.sql`AND COALESCE(${raw(`${saleAlias}."sellerId"`)}, ${raw(`${saleAlias}."employeeId"`)}) = ${ctx.employeeId}::uuid` : Prisma.empty;
const inCategories = (ctx: ReportContext, column: string) => ctx.categoryIds ? Prisma.sql`AND ${raw(column)} IN (${Prisma.join(ctx.categoryIds.map(id => Prisma.sql`${id}::uuid`))})` : Prisma.empty;
const productSearch = (ctx: ReportContext, alias = 'p') => ctx.q ? Prisma.sql`AND (${raw(`${alias}.name`)} ILIKE ${`%${ctx.q}%`} OR ${raw(`${alias}.sku`)} ILIKE ${`%${ctx.q}%`} OR EXISTS (SELECT 1 FROM "ProductBarcode" pb WHERE pb."productId" = ${raw(`${alias}.id`)} AND pb.value = ${ctx.q}))` : Prisma.empty;
const methodLabel = (column: string) => raw(`CASE ${column} WHEN 'CASH' THEN 'Наличные' WHEN 'CARD' THEN 'Карта' WHEN 'BANK_TRANSFER' THEN 'Перевод' ELSE ${column}::text END`);

/** Sales aggregated by any sale-level key; returns are attributed by `returnKey` (their own date/store or the original seller). */
function saleAggregates(ctx: ReportContext, saleKey: Prisma.Sql, returnKey: Prisma.Sql) {
  return Prisma.sql`
    s_agg AS (
      SELECT ${saleKey} AS k, COUNT(*)::int AS checks, SUM(s."subtotalMinor") AS gross, SUM(s."totalMinor") AS sales,
             SUM(s."discountMinor") AS discounts, SUM(s."profitMinor") AS profit
      FROM "Sale" s
      WHERE s.status = 'COMPLETED' ${inPeriod(ctx, 's."createdAt"')} ${inStores(ctx, 's."storeId"')} ${seller(ctx)}
      GROUP BY 1
    ),
    r_agg AS (
      SELECT ${returnKey} AS k, COUNT(*)::int AS return_count, SUM(r."amountMinor") AS returns, SUM(r."profitMinor") AS profit
      FROM "SaleReturn" r JOIN "Sale" s ON s.id = r."saleId"
      WHERE TRUE ${inPeriod(ctx, 'r."createdAt"')} ${inStores(ctx, 'r."storeId"')} ${seller(ctx)}
      GROUP BY 1
    ),
    agg AS (
      SELECT COALESCE(s_agg.k, r_agg.k) AS k, COALESCE(s_agg.checks, 0) AS checks, COALESCE(s_agg.gross, 0) AS gross,
             COALESCE(s_agg.sales, 0) AS sales, COALESCE(s_agg.discounts, 0) AS discounts,
             COALESCE(r_agg.returns, 0) AS returns, COALESCE(r_agg.return_count, 0) AS return_count,
             COALESCE(s_agg.profit, 0) - COALESCE(r_agg.profit, 0) AS profit
      FROM s_agg FULL JOIN r_agg ON s_agg.k = r_agg.k
    )`;
}
const saleColumns = Prisma.sql`agg.checks AS "checks", agg.sales AS "salesMinor", agg.discounts AS "discountsMinor", agg.returns AS "returnsMinor",
  agg.sales - agg.returns AS "netMinor", agg.profit AS "profitMinor",
  CASE WHEN agg.checks > 0 THEN ROUND(agg.sales / agg.checks) ELSE 0 END AS "averageCheckMinor"`;
const saleColumnDefs: ReportColumn[] = [
  { key: 'checks', label: 'Чеков', type: 'count' },
  { key: 'salesMinor', label: 'Продажи', type: 'money' },
  { key: 'discountsMinor', label: 'Скидки', type: 'money' },
  { key: 'returnsMinor', label: 'Возвраты', type: 'money' },
  { key: 'netMinor', label: 'Выручка', type: 'money' },
  { key: 'profitMinor', label: 'Валовая прибыль', type: 'money', finance: true },
  { key: 'averageCheckMinor', label: 'Средний чек', type: 'money' },
];
const saleTotals = `SUM(checks)::int AS "checks", SUM("salesMinor") AS "salesMinor", SUM("discountsMinor") AS "discountsMinor", SUM("returnsMinor") AS "returnsMinor", SUM("netMinor") AS "netMinor", SUM("profitMinor") AS "profitMinor", CASE WHEN SUM(checks) > 0 THEN ROUND(SUM("salesMinor") / SUM(checks)) ELSE 0 END AS "averageCheckMinor"`;

/** Net sold quantity, revenue and profit per product after returns. */
function productAggregates(ctx: ReportContext) {
  return Prisma.sql`
    sold AS (
      SELECT si."productId" AS pid, SUM(si.quantity) AS qty, SUM(si."totalMinor") AS revenue, SUM(si."profitMinor") AS profit
      FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
      WHERE s.status = 'COMPLETED' ${inPeriod(ctx, 's."createdAt"')} ${inStores(ctx, 's."storeId"')} ${seller(ctx)}
      GROUP BY 1
    ),
    ret AS (
      SELECT si."productId" AS pid, SUM(ri.quantity) AS qty, SUM(ri."amountMinor") AS revenue, SUM(ri."profitMinor") AS profit
      FROM "SaleReturnItem" ri
      JOIN "SaleReturn" r ON r.id = ri."saleReturnId"
      JOIN "SaleItem" si ON si.id = ri."saleItemId"
      JOIN "Sale" s ON s.id = r."saleId"
      WHERE TRUE ${inPeriod(ctx, 'r."createdAt"')} ${inStores(ctx, 'r."storeId"')} ${seller(ctx)}
      GROUP BY 1
    ),
    pr AS (
      SELECT COALESCE(sold.pid, ret.pid) AS pid, COALESCE(sold.qty, 0) AS sold_qty, COALESCE(ret.qty, 0) AS ret_qty,
             COALESCE(sold.revenue, 0) - COALESCE(ret.revenue, 0) AS revenue,
             COALESCE(sold.profit, 0) - COALESCE(ret.profit, 0) AS profit
      FROM sold FULL JOIN ret ON sold.pid = ret.pid
    )`;
}
const margin = (profit: string, revenue: string) => `CASE WHEN ${revenue} <> 0 THEN ROUND(${profit} * 100.0 / ${revenue}, 2) END`;

export const reportDefinitions: Record<ReportKey, ReportDefinition> = {
  'sales-by-day': {
    title: 'Продажи по датам', group: 'Продажи', description: 'Чеки, скидки, возвраты и выручка за каждый день периода.',
    requires: ['sales.view'], period: true, filters: ['store', 'employee'],
    columns: [{ key: 'day', label: 'Дата', type: 'date' }, ...saleColumnDefs], sort: { key: 'day', dir: 'asc' }, totals: saleTotals,
    build: ctx => Prisma.sql`WITH ${saleAggregates(ctx, localDay('s."createdAt"'), localDay('r."createdAt"'))}
      SELECT agg.k AS "day", ${saleColumns} FROM agg`,
  },
  'sales-by-product': {
    title: 'Продажи по товарам', group: 'Продажи', description: 'Продано, возвращено, выручка и прибыль по каждому товару.',
    requires: ['sales.view'], period: true, filters: ['store', 'employee', 'category', 'q'],
    columns: [
      { key: 'product', label: 'Товар', type: 'text' }, { key: 'sku', label: 'Артикул', type: 'text' }, { key: 'category', label: 'Категория', type: 'text' },
      { key: 'soldQuantity', label: 'Продано', type: 'quantity' }, { key: 'returnedQuantity', label: 'Возвращено', type: 'quantity' }, { key: 'netQuantity', label: 'Итого, шт.', type: 'quantity' },
      { key: 'revenueMinor', label: 'Выручка', type: 'money' }, { key: 'costMinor', label: 'Себестоимость', type: 'money', finance: true },
      { key: 'profitMinor', label: 'Прибыль', type: 'money', finance: true }, { key: 'marginPercent', label: 'Маржа, %', type: 'percent', finance: true },
    ],
    sort: { key: 'revenueMinor', dir: 'desc' },
    totals: `SUM("soldQuantity") AS "soldQuantity", SUM("returnedQuantity") AS "returnedQuantity", SUM("netQuantity") AS "netQuantity", SUM("revenueMinor") AS "revenueMinor", SUM("costMinor") AS "costMinor", SUM("profitMinor") AS "profitMinor", ${margin('SUM("profitMinor")', 'SUM("revenueMinor")')} AS "marginPercent"`,
    build: ctx => Prisma.sql`WITH ${productAggregates(ctx)}
      SELECT p.name AS "product", p.sku AS "sku", COALESCE(c.name, 'Без категории') AS "category",
             pr.sold_qty AS "soldQuantity", pr.ret_qty AS "returnedQuantity", pr.sold_qty - pr.ret_qty AS "netQuantity",
             pr.revenue AS "revenueMinor", pr.revenue - pr.profit AS "costMinor", pr.profit AS "profitMinor", ${raw(margin('pr.profit', 'pr.revenue'))} AS "marginPercent"
      FROM pr JOIN "Product" p ON p.id = pr.pid LEFT JOIN "Category" c ON c.id = p."categoryId"
      WHERE TRUE ${inCategories(ctx, 'p."categoryId"')} ${productSearch(ctx)}`,
  },
  'sales-by-category': {
    title: 'Продажи по категориям', group: 'Продажи', description: 'Вклад каждой категории в выручку и прибыль.',
    requires: ['sales.view'], period: true, filters: ['store', 'employee', 'category'],
    columns: [
      { key: 'category', label: 'Категория', type: 'text' }, { key: 'products', label: 'Товаров', type: 'count' }, { key: 'netQuantity', label: 'Продано, шт.', type: 'quantity' },
      { key: 'revenueMinor', label: 'Выручка', type: 'money' }, { key: 'sharePercent', label: 'Доля выручки, %', type: 'percent' },
      { key: 'profitMinor', label: 'Прибыль', type: 'money', finance: true }, { key: 'marginPercent', label: 'Маржа, %', type: 'percent', finance: true },
    ],
    sort: { key: 'revenueMinor', dir: 'desc' },
    totals: `SUM(products)::int AS "products", SUM("netQuantity") AS "netQuantity", SUM("revenueMinor") AS "revenueMinor", CASE WHEN SUM("revenueMinor") <> 0 THEN 100 END AS "sharePercent", SUM("profitMinor") AS "profitMinor", ${margin('SUM("profitMinor")', 'SUM("revenueMinor")')} AS "marginPercent"`,
    build: ctx => Prisma.sql`WITH ${productAggregates(ctx)}
      SELECT COALESCE(c.name, 'Без категории') AS "category", COUNT(DISTINCT p.id)::int AS "products", SUM(pr.sold_qty - pr.ret_qty) AS "netQuantity",
             SUM(pr.revenue) AS "revenueMinor", ROUND(SUM(pr.revenue) * 100.0 / NULLIF(SUM(SUM(pr.revenue)) OVER (), 0), 2) AS "sharePercent",
             SUM(pr.profit) AS "profitMinor", ${raw(margin('SUM(pr.profit)', 'SUM(pr.revenue)'))} AS "marginPercent"
      FROM pr JOIN "Product" p ON p.id = pr.pid LEFT JOIN "Category" c ON c.id = p."categoryId"
      WHERE TRUE ${inCategories(ctx, 'p."categoryId"')}
      GROUP BY c.id, c.name`,
  },
  'sales-by-store': {
    title: 'Продажи по магазинам', group: 'Продажи', description: 'Сравнение торговых точек по выручке, чекам и прибыли.',
    requires: ['sales.view'], period: true, filters: ['store', 'employee'],
    columns: [{ key: 'store', label: 'Магазин', type: 'text' }, ...saleColumnDefs], sort: { key: 'netMinor', dir: 'desc' }, totals: saleTotals,
    build: ctx => Prisma.sql`WITH ${saleAggregates(ctx, Prisma.sql`s."storeId"`, Prisma.sql`r."storeId"`)}
      SELECT st.name AS "store", ${saleColumns} FROM agg JOIN "Store" st ON st.id = agg.k`,
  },
  'sales-by-employee': {
    title: 'Продажи по сотрудникам', group: 'Продажи', description: 'Чеки и выручка продавцов; возвраты относятся к продавцу исходного чека.',
    requires: ['sales.view'], period: true, filters: ['store', 'employee'],
    columns: [{ key: 'employee', label: 'Сотрудник', type: 'text' }, ...saleColumnDefs], sort: { key: 'netMinor', dir: 'desc' }, totals: saleTotals,
    build: ctx => Prisma.sql`WITH ${saleAggregates(ctx, Prisma.sql`COALESCE(s."sellerId", s."employeeId")`, Prisma.sql`COALESCE(s."sellerId", s."employeeId")`)}
      SELECT u.name AS "employee", ${saleColumns} FROM agg JOIN "User" u ON u.id = agg.k`,
  },
  'gross-profit': {
    title: 'Валовая прибыль', group: 'Прибыль', description: 'Выручка, себестоимость, валовая прибыль, расходы и операционный результат по дням.',
    requires: ['finance.view'], period: true, filters: ['store'],
    columns: [
      { key: 'day', label: 'Дата', type: 'date' }, { key: 'netMinor', label: 'Выручка', type: 'money' }, { key: 'costMinor', label: 'Себестоимость', type: 'money' },
      { key: 'profitMinor', label: 'Валовая прибыль', type: 'money' }, { key: 'marginPercent', label: 'Маржа, %', type: 'percent' },
      { key: 'expensesMinor', label: 'Расходы', type: 'money' }, { key: 'resultMinor', label: 'Операционный результат', type: 'money' },
    ],
    sort: { key: 'day', dir: 'asc' },
    totals: `SUM("netMinor") AS "netMinor", SUM("costMinor") AS "costMinor", SUM("profitMinor") AS "profitMinor", ${margin('SUM("profitMinor")', 'SUM("netMinor")')} AS "marginPercent", SUM("expensesMinor") AS "expensesMinor", SUM("resultMinor") AS "resultMinor"`,
    build: ctx => Prisma.sql`WITH ${saleAggregates(ctx, localDay('s."createdAt"'), localDay('r."createdAt"'))},
      e_agg AS (
        SELECT to_char(e.date, 'YYYY-MM-DD') AS k, SUM(e."amountMinor") AS expenses FROM "Expense" e
        WHERE e.date >= ${ctx.utcDays!.gte} AND e.date < ${ctx.utcDays!.lt} ${inStores(ctx, 'e."storeId"')} GROUP BY 1
      ),
      days AS (SELECT k FROM agg UNION SELECT k FROM e_agg)
      SELECT days.k AS "day", COALESCE(agg.sales - agg.returns, 0) AS "netMinor", COALESCE(agg.sales - agg.returns - agg.profit, 0) AS "costMinor",
             COALESCE(agg.profit, 0) AS "profitMinor", ${raw(margin('agg.profit', '(agg.sales - agg.returns)'))} AS "marginPercent",
             COALESCE(e_agg.expenses, 0) AS "expensesMinor", COALESCE(agg.profit, 0) - COALESCE(e_agg.expenses, 0) AS "resultMinor"
      FROM days LEFT JOIN agg ON agg.k = days.k LEFT JOIN e_agg ON e_agg.k = days.k`,
  },
  cost: {
    title: 'Себестоимость', group: 'Прибыль', description: 'Себестоимость проданных товаров (за вычетом возвратов) и средняя цена единицы.',
    requires: ['finance.view'], period: true, filters: ['store', 'category', 'q'],
    columns: [
      { key: 'product', label: 'Товар', type: 'text' }, { key: 'sku', label: 'Артикул', type: 'text' }, { key: 'netQuantity', label: 'Продано, шт.', type: 'quantity' },
      { key: 'costMinor', label: 'Себестоимость', type: 'money' }, { key: 'unitCostMinor', label: 'За единицу', type: 'money' },
      { key: 'revenueMinor', label: 'Выручка', type: 'money' }, { key: 'costSharePercent', label: 'Доля в себестоимости, %', type: 'percent' },
    ],
    sort: { key: 'costMinor', dir: 'desc' },
    totals: `SUM("netQuantity") AS "netQuantity", SUM("costMinor") AS "costMinor", CASE WHEN SUM("netQuantity") <> 0 THEN ROUND(SUM("costMinor") / SUM("netQuantity")) END AS "unitCostMinor", SUM("revenueMinor") AS "revenueMinor", CASE WHEN SUM("costMinor") <> 0 THEN 100 END AS "costSharePercent"`,
    build: ctx => Prisma.sql`WITH ${productAggregates(ctx)}
      SELECT p.name AS "product", p.sku AS "sku", pr.sold_qty - pr.ret_qty AS "netQuantity", pr.revenue - pr.profit AS "costMinor",
             CASE WHEN pr.sold_qty - pr.ret_qty <> 0 THEN ROUND((pr.revenue - pr.profit) / (pr.sold_qty - pr.ret_qty)) END AS "unitCostMinor",
             pr.revenue AS "revenueMinor", ROUND((pr.revenue - pr.profit) * 100.0 / NULLIF(SUM(pr.revenue - pr.profit) OVER (), 0), 2) AS "costSharePercent"
      FROM pr JOIN "Product" p ON p.id = pr.pid
      WHERE TRUE ${inCategories(ctx, 'p."categoryId"')} ${productSearch(ctx)}`,
  },
  stock: {
    title: 'Остатки', group: 'Склад', description: 'Текущие остатки, резерв и оценка запаса по себестоимости и розничным ценам.',
    requires: ['inventory.view'], period: false, filters: ['store', 'category', 'q', 'lowOnly'],
    columns: [
      { key: 'product', label: 'Товар', type: 'text' }, { key: 'sku', label: 'Артикул', type: 'text' }, { key: 'store', label: 'Магазин', type: 'text' },
      { key: 'quantity', label: 'Остаток', type: 'quantity' }, { key: 'reserved', label: 'Резерв', type: 'quantity' }, { key: 'available', label: 'Доступно', type: 'quantity' },
      { key: 'minStock', label: 'Мин. остаток', type: 'quantity' }, { key: 'status', label: 'Состояние', type: 'text' },
      { key: 'costValueMinor', label: 'Сумма по себестоимости', type: 'money', finance: true }, { key: 'retailValueMinor', label: 'Сумма в розничных ценах', type: 'money' },
    ],
    sort: { key: 'product', dir: 'asc' },
    totals: `SUM(quantity) AS "quantity", SUM(reserved) AS "reserved", SUM(available) AS "available", SUM("costValueMinor") AS "costValueMinor", SUM("retailValueMinor") AS "retailValueMinor"`,
    build: ctx => Prisma.sql`
      SELECT p.name AS "product", p.sku AS "sku", st.name AS "store", s.quantity AS "quantity", s."reservedQuantity" AS "reserved",
             s.quantity - s."reservedQuantity" AS "available", COALESCE(sps."minStock", 0) AS "minStock",
             CASE WHEN s.quantity <= 0 THEN 'Нет в наличии' WHEN s.quantity <= COALESCE(sps."minStock", 0) THEN 'Мало' ELSE 'В наличии' END AS "status",
             GREATEST(s.quantity, 0) * COALESCE(sps."costBasisMinor", lb."purchasePriceMinor", 0)::numeric AS "costValueMinor",
             GREATEST(s.quantity, 0) * COALESCE(sps."priceMinor", 0)::numeric AS "retailValueMinor"
      FROM "Stock" s
      JOIN "Product" p ON p.id = s."productId" AND p."deletedAt" IS NULL
      JOIN "Store" st ON st.id = s."storeId"
      LEFT JOIN "StoreProductSettings" sps ON sps."storeId" = s."storeId" AND sps."productId" = s."productId"
      LEFT JOIN LATERAL (SELECT b."purchasePriceMinor" FROM "ProductBatch" b WHERE b."productId" = s."productId" AND b."storeId" = s."storeId" ORDER BY b."receivedAt" DESC LIMIT 1) lb ON TRUE
      WHERE TRUE ${inStores(ctx, 's."storeId"')} ${inCategories(ctx, 'p."categoryId"')} ${productSearch(ctx)}
        ${ctx.lowOnly ? Prisma.sql`AND (s.quantity <= 0 OR s.quantity <= COALESCE(sps."minStock", 0))` : Prisma.empty}`,
  },
  'stock-movements': {
    title: 'Движение товаров', group: 'Склад', description: 'Остаток на начало и конец периода, приход и расход по типам документов.',
    requires: ['inventory.view'], period: true, filters: ['store', 'category', 'q'],
    columns: [
      { key: 'product', label: 'Товар', type: 'text' }, { key: 'sku', label: 'Артикул', type: 'text' }, { key: 'store', label: 'Магазин', type: 'text' },
      { key: 'opening', label: 'На начало', type: 'quantity' }, { key: 'purchases', label: 'Закупки', type: 'quantity' }, { key: 'sales', label: 'Продажи', type: 'quantity' },
      { key: 'returns', label: 'Возвраты', type: 'quantity' }, { key: 'transfersIn', label: 'Перемещено в', type: 'quantity' }, { key: 'transfersOut', label: 'Перемещено из', type: 'quantity' },
      { key: 'writeOffs', label: 'Списания', type: 'quantity' }, { key: 'adjustments', label: 'Инвентаризация и корректировки', type: 'quantity' },
      { key: 'supplierReturns', label: 'Возвраты поставщику', type: 'quantity' }, { key: 'closing', label: 'На конец', type: 'quantity' },
    ],
    sort: { key: 'product', dir: 'asc' },
    build: ctx => Prisma.sql`WITH m AS (
        SELECT sm.*, ROW_NUMBER() OVER (PARTITION BY sm."storeId", sm."productId" ORDER BY sm."createdAt", sm.id) AS first_rn,
               ROW_NUMBER() OVER (PARTITION BY sm."storeId", sm."productId" ORDER BY sm."createdAt" DESC, sm.id DESC) AS last_rn
        FROM "StockMovement" sm WHERE TRUE ${inPeriod(ctx, 'sm."createdAt"')} ${inStores(ctx, 'sm."storeId"')}
      )
      SELECT p.name AS "product", p.sku AS "sku", st.name AS "store",
             MAX(m."previousQuantity") FILTER (WHERE m.first_rn = 1) AS "opening",
             COALESCE(SUM(m.quantity) FILTER (WHERE m.type = 'PURCHASE'), 0) AS "purchases",
             COALESCE(SUM(m.quantity) FILTER (WHERE m.type = 'SALE'), 0) AS "sales",
             COALESCE(SUM(m.quantity) FILTER (WHERE m.type = 'RETURN'), 0) AS "returns",
             COALESCE(SUM(m.quantity) FILTER (WHERE m.type = 'TRANSFER_IN'), 0) AS "transfersIn",
             COALESCE(SUM(m.quantity) FILTER (WHERE m.type = 'TRANSFER_OUT'), 0) AS "transfersOut",
             COALESCE(SUM(m.quantity) FILTER (WHERE m.type = 'WRITE_OFF'), 0) AS "writeOffs",
             COALESCE(SUM(m.quantity) FILTER (WHERE m.type IN ('INVENTORY', 'CORRECTION')), 0) AS "adjustments",
             COALESCE(SUM(m.quantity) FILTER (WHERE m.type = 'SUPPLIER_RETURN'), 0) AS "supplierReturns",
             MAX(m."newQuantity") FILTER (WHERE m.last_rn = 1) AS "closing"
      FROM m JOIN "Product" p ON p.id = m."productId" JOIN "Store" st ON st.id = m."storeId"
      WHERE TRUE ${inCategories(ctx, 'p."categoryId"')} ${productSearch(ctx)}
      GROUP BY p.id, p.name, p.sku, st.id, st.name`,
  },
  'finance-operations': {
    title: 'Финансовые операции', group: 'Деньги', description: 'Поступления и выплаты: выручка по способам оплаты, возвраты, расходы, поставщики, долги клиентов и кассовые операции.',
    requires: ['finance.view'], period: true, filters: ['store'],
    columns: [
      { key: 'day', label: 'Дата', type: 'date' }, { key: 'store', label: 'Магазин', type: 'text' }, { key: 'kind', label: 'Операция', type: 'text' },
      { key: 'details', label: 'Описание', type: 'text' }, { key: 'method', label: 'Способ', type: 'text' }, { key: 'employee', label: 'Сотрудник', type: 'text' },
      { key: 'incomeMinor', label: 'Приход', type: 'money' }, { key: 'outcomeMinor', label: 'Расход', type: 'money' },
    ],
    sort: { key: 'day', dir: 'desc' },
    totals: `SUM("incomeMinor") AS "incomeMinor", SUM("outcomeMinor") AS "outcomeMinor"`,
    build: ctx => Prisma.sql`WITH ops AS (
        SELECT ${localDay('s."createdAt"')} AS day, s."storeId" AS store_id, 'Выручка' AS kind, 'Оплата чеков: ' || COUNT(DISTINCT s.id) || ' шт.' AS details,
               pm.name AS method, NULL::text AS employee, SUM(p."amountMinor") AS amount
        FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId" JOIN "SalePaymentMethod" pm ON pm.id = p."paymentMethodId"
        WHERE s.status = 'COMPLETED' AND pm.kind NOT IN ('BONUS', 'DEBT') ${inPeriod(ctx, 's."createdAt"')} ${inStores(ctx, 's."storeId"')}
        GROUP BY 1, 2, pm.name
        UNION ALL
        SELECT ${localDay('r."createdAt"')}, r."storeId", 'Возврат покупателю', 'Чек ' || s.number || ': ' || r.reason, pm.name, u.name, -rp."amountMinor"
        FROM "SaleReturnPayment" rp JOIN "SaleReturn" r ON r.id = rp."saleReturnId" JOIN "Sale" s ON s.id = r."saleId"
        JOIN "SalePaymentMethod" pm ON pm.id = rp."paymentMethodId" LEFT JOIN "User" u ON u.id = r."employeeId"
        WHERE pm.kind NOT IN ('BONUS', 'DEBT') ${inPeriod(ctx, 'r."createdAt"')} ${inStores(ctx, 'r."storeId"')}
        UNION ALL
        SELECT ${localDay('rr."createdAt"')}, rr."storeId", 'Возврат без чека', p.name || ' × ' || rr.quantity || ': ' || rr.reason, 'Наличные', u.name, -rr."amountMinor"
        FROM "ReceiptlessReturn" rr JOIN "Product" p ON p.id = rr."productId" LEFT JOIN "User" u ON u.id = rr."employeeId"
        WHERE TRUE ${inPeriod(ctx, 'rr."createdAt"')} ${inStores(ctx, 'rr."storeId"')}
        UNION ALL
        SELECT to_char(e.date, 'YYYY-MM-DD'), e."storeId", 'Расход', ec.name || COALESCE(': ' || e.description, ''), ${methodLabel('e."paymentMethod"')}, u.name, -e."amountMinor"
        FROM "Expense" e JOIN "ExpenseCategory" ec ON ec.id = e."categoryId" LEFT JOIN "User" u ON u.id = e."employeeId"
        WHERE e.date >= ${ctx.utcDays?.gte ?? new Date(0)} AND e.date < ${ctx.utcDays?.lt ?? new Date(0)} ${inStores(ctx, 'e."storeId"')}
        UNION ALL
        SELECT ${localDay('sp."createdAt"')}, sp."storeId", 'Оплата поставщику', sup.name || ', закупка ' || pu.number, ${methodLabel('sp."paymentMethod"')}, u.name, -sp."amountMinor"
        FROM "SupplierPayment" sp JOIN "Purchase" pu ON pu.id = sp."purchaseId" JOIN "Supplier" sup ON sup.id = pu."supplierId" LEFT JOIN "User" u ON u.id = sp."employeeId"
        WHERE TRUE ${inPeriod(ctx, 'sp."createdAt"')} ${inStores(ctx, 'sp."storeId"')}
        UNION ALL
        SELECT ${localDay('cp."createdAt"')}, cp."storeId", 'Погашение долга покупателем', TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')), pm.name, u.name, cp."amountMinor"
        FROM "CustomerPayment" cp JOIN "Customer" c ON c.id = cp."customerId" JOIN "SalePaymentMethod" pm ON pm.id = cp."paymentMethodId" LEFT JOIN "User" u ON u.id = cp."employeeId"
        WHERE TRUE ${inPeriod(ctx, 'cp."createdAt"')} ${inStores(ctx, 'cp."storeId"')}
        UNION ALL
        SELECT ${localDay('co."createdAt"')}, co."storeId",
               CASE co."sourceType" WHEN 'EMPLOYEE_REWARD_PAYOUT' THEN 'Выплата вознаграждения' WHEN 'SHIFT_CLOSE_VARIANCE' THEN 'Расхождение при закрытии смены'
                    ELSE CASE co.type WHEN 'DEPOSIT' THEN 'Внесение в кассу' WHEN 'WITHDRAWAL' THEN 'Изъятие из кассы' ELSE 'Корректировка кассы' END END,
               COALESCE(co.comment, ''), 'Наличные', u.name, co."amountMinor"
        FROM "CashOperation" co LEFT JOIN "User" u ON u.id = co."employeeId"
        WHERE co."sourceType" IN ('MANUAL_CASH_OPERATION', 'SHIFT_CLOSE_VARIANCE', 'EMPLOYEE_REWARD_PAYOUT') ${inPeriod(ctx, 'co."createdAt"')} ${inStores(ctx, 'co."storeId"')}
      )
      SELECT ops.day AS "day", st.name AS "store", ops.kind AS "kind", ops.details AS "details", ops.method AS "method", ops.employee AS "employee",
             GREATEST(ops.amount, 0) AS "incomeMinor", GREATEST(-ops.amount, 0) AS "outcomeMinor"
      FROM ops JOIN "Store" st ON st.id = ops.store_id`,
  },
  returns: {
    title: 'Возвраты', group: 'Продажи', description: 'Все возвраты по чеку и без чека: причина, состав и сумма.',
    requires: ['sales.view'], period: true, filters: ['store', 'employee'],
    columns: [
      { key: 'occurredAt', label: 'Дата и время', type: 'datetime' }, { key: 'store', label: 'Магазин', type: 'text' }, { key: 'kind', label: 'Тип', type: 'text' },
      { key: 'saleNumber', label: 'Чек', type: 'text' }, { key: 'details', label: 'Состав', type: 'text' }, { key: 'reason', label: 'Причина', type: 'text' },
      { key: 'employee', label: 'Оформил', type: 'text' }, { key: 'quantity', label: 'Кол-во', type: 'quantity' }, { key: 'amountMinor', label: 'Сумма', type: 'money' },
    ],
    sort: { key: 'occurredAt', dir: 'desc' },
    totals: `SUM(quantity) AS "quantity", SUM("amountMinor") AS "amountMinor"`,
    build: ctx => Prisma.sql`
      SELECT r."createdAt" AS "occurredAt", st.name AS "store", 'По чеку' AS "kind", s.number AS "saleNumber",
             (SELECT string_agg(p.name || ' × ' || ri.quantity, ', ' ORDER BY p.name) FROM "SaleReturnItem" ri JOIN "SaleItem" si ON si.id = ri."saleItemId" JOIN "Product" p ON p.id = si."productId" WHERE ri."saleReturnId" = r.id) AS "details",
             r.reason AS "reason", u.name AS "employee",
             (SELECT COALESCE(SUM(ri.quantity), 0) FROM "SaleReturnItem" ri WHERE ri."saleReturnId" = r.id) AS "quantity", r."amountMinor" AS "amountMinor"
      FROM "SaleReturn" r JOIN "Sale" s ON s.id = r."saleId" JOIN "Store" st ON st.id = r."storeId" LEFT JOIN "User" u ON u.id = r."employeeId"
      WHERE TRUE ${inPeriod(ctx, 'r."createdAt"')} ${inStores(ctx, 'r."storeId"')} ${ctx.employeeId ? Prisma.sql`AND r."employeeId" = ${ctx.employeeId}::uuid` : Prisma.empty}
      UNION ALL
      SELECT rr."createdAt", st.name, 'Без чека', NULL, p.name || ' × ' || rr.quantity, rr.reason, u.name, rr.quantity, rr."amountMinor"
      FROM "ReceiptlessReturn" rr JOIN "Product" p ON p.id = rr."productId" JOIN "Store" st ON st.id = rr."storeId" LEFT JOIN "User" u ON u.id = rr."employeeId"
      WHERE TRUE ${inPeriod(ctx, 'rr."createdAt"')} ${inStores(ctx, 'rr."storeId"')} ${ctx.employeeId ? Prisma.sql`AND rr."employeeId" = ${ctx.employeeId}::uuid` : Prisma.empty}`,
  },
  debts: {
    title: 'Задолженности', group: 'Деньги', description: 'Текущие долги покупателей и задолженность перед поставщиками по закупкам.',
    requires: ['finance.view'], period: false, filters: ['store', 'q'],
    columns: [
      { key: 'kind', label: 'Контрагент', type: 'text' }, { key: 'name', label: 'Название', type: 'text' }, { key: 'phone', label: 'Телефон', type: 'text' },
      { key: 'documents', label: 'Документов', type: 'count' }, { key: 'debtMinor', label: 'Долг', type: 'money' }, { key: 'lastOperationAt', label: 'Последняя операция', type: 'datetime' },
    ],
    sort: { key: 'debtMinor', dir: 'desc' },
    totals: `SUM(documents)::int AS "documents", SUM("debtMinor") AS "debtMinor"`,
    build: ctx => {
      const search = (column: string) => ctx.q ? Prisma.sql`AND ${raw(column)} ILIKE ${`%${ctx.q}%`}` : Prisma.empty;
      const customers = ctx.canSeeCustomers ? Prisma.sql`
        SELECT 'Покупатель' AS "kind", TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')) AS "name", c.phone AS "phone",
               (SELECT COUNT(*)::int FROM "Sale" ds WHERE ds."customerId" = c.id AND ds."debtMinor" > 0) AS "documents",
               c."debtBalanceMinor" AS "debtMinor", (SELECT MAX(de."createdAt") FROM "CustomerDebtEntry" de WHERE de."customerId" = c.id) AS "lastOperationAt"
        FROM "Customer" c
        WHERE c."debtBalanceMinor" > 0 AND c."deletedAt" IS NULL
          ${ctx.q ? Prisma.sql`AND (TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')) ILIKE ${`%${ctx.q}%`} OR c.phone ILIKE ${`%${ctx.q}%`})` : Prisma.empty}
          ${ctx.storeIds ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Sale" ds WHERE ds."customerId" = c.id AND ds."debtMinor" > 0 ${inStores(ctx, 'ds."storeId"')})` : Prisma.empty}
        UNION ALL` : Prisma.empty;
      return Prisma.sql`${customers}
        SELECT 'Поставщик', sup.name, sup.phone, COUNT(*)::int, SUM(pu."debtMinor"), MAX(pu."updatedAt")
        FROM "Purchase" pu JOIN "Supplier" sup ON sup.id = pu."supplierId"
        WHERE pu."debtMinor" > 0 ${inStores(ctx, 'pu."storeId"')} ${search('sup.name')}
        GROUP BY sup.id, sup.name, sup.phone`;
    },
  },
  discounts: {
    title: 'Эффективность скидок', group: 'Клиенты', description: 'Доля чеков со скидкой, размер скидок, оплата бонусами и средний чек со скидкой и без.',
    requires: ['sales.view'], period: true, filters: ['store', 'employee'],
    columns: [
      { key: 'day', label: 'Дата', type: 'date' }, { key: 'checks', label: 'Чеков', type: 'count' }, { key: 'discountedChecks', label: 'Со скидкой', type: 'count' },
      { key: 'discountedSharePercent', label: 'Доля со скидкой, %', type: 'percent' }, { key: 'grossMinor', label: 'Сумма до скидок', type: 'money' },
      { key: 'discountsMinor', label: 'Скидки', type: 'money' }, { key: 'discountPercent', label: 'Скидка, % от суммы', type: 'percent' },
      { key: 'bonusPaidMinor', label: 'Оплачено бонусами', type: 'money' },
      { key: 'averageDiscountedCheckMinor', label: 'Средний чек со скидкой', type: 'money' }, { key: 'averageFullCheckMinor', label: 'Средний чек без скидки', type: 'money' },
    ],
    sort: { key: 'day', dir: 'asc' },
    totals: `SUM(checks)::int AS "checks", SUM("discountedChecks")::int AS "discountedChecks", CASE WHEN SUM(checks) > 0 THEN ROUND(SUM("discountedChecks") * 100.0 / SUM(checks), 2) END AS "discountedSharePercent",
      SUM("grossMinor") AS "grossMinor", SUM("discountsMinor") AS "discountsMinor", CASE WHEN SUM("grossMinor") > 0 THEN ROUND(SUM("discountsMinor") * 100.0 / SUM("grossMinor"), 2) END AS "discountPercent",
      SUM("bonusPaidMinor") AS "bonusPaidMinor", CASE WHEN SUM("discountedChecks") > 0 THEN ROUND(SUM(discounted_total) / SUM("discountedChecks")) END AS "averageDiscountedCheckMinor",
      CASE WHEN SUM(checks) - SUM("discountedChecks") > 0 THEN ROUND(SUM(full_total) / (SUM(checks) - SUM("discountedChecks"))) END AS "averageFullCheckMinor"`,
    build: ctx => Prisma.sql`WITH d AS (
        SELECT ${localDay('s."createdAt"')} AS day, COUNT(*)::int AS checks, (COUNT(*) FILTER (WHERE s."discountMinor" > 0))::int AS discounted,
               SUM(s."subtotalMinor") AS gross, SUM(s."discountMinor") AS discounts,
               COALESCE(SUM(s."totalMinor") FILTER (WHERE s."discountMinor" > 0), 0) AS discounted_total,
               COALESCE(SUM(s."totalMinor") FILTER (WHERE s."discountMinor" = 0), 0) AS full_total
        FROM "Sale" s WHERE s.status = 'COMPLETED' ${inPeriod(ctx, 's."createdAt"')} ${inStores(ctx, 's."storeId"')} ${seller(ctx)}
        GROUP BY 1
      ), b AS (
        SELECT ${localDay('s."createdAt"')} AS day, SUM(p."amountMinor") AS bonus
        FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId" JOIN "SalePaymentMethod" pm ON pm.id = p."paymentMethodId"
        WHERE s.status = 'COMPLETED' AND pm.kind = 'BONUS' ${inPeriod(ctx, 's."createdAt"')} ${inStores(ctx, 's."storeId"')} ${seller(ctx)}
        GROUP BY 1
      )
      SELECT d.day AS "day", d.checks AS "checks", d.discounted AS "discountedChecks", ROUND(d.discounted * 100.0 / d.checks, 2) AS "discountedSharePercent",
             d.gross AS "grossMinor", d.discounts AS "discountsMinor", CASE WHEN d.gross > 0 THEN ROUND(d.discounts * 100.0 / d.gross, 2) END AS "discountPercent",
             COALESCE(b.bonus, 0) AS "bonusPaidMinor",
             CASE WHEN d.discounted > 0 THEN ROUND(d.discounted_total / d.discounted) END AS "averageDiscountedCheckMinor",
             CASE WHEN d.checks - d.discounted > 0 THEN ROUND(d.full_total / (d.checks - d.discounted)) END AS "averageFullCheckMinor",
             d.discounted_total, d.full_total
      FROM d LEFT JOIN b ON b.day = d.day`,
  },
  'customer-activity': {
    title: 'Покупательская активность', group: 'Клиенты', description: 'Покупки, средний чек, скидки и бонусы каждого покупателя за период.',
    requires: ['customers.view', 'sales.view'], period: true, filters: ['store', 'employee', 'q'],
    columns: [
      { key: 'customer', label: 'Покупатель', type: 'text' }, { key: 'phone', label: 'Телефон', type: 'text' }, { key: 'checks', label: 'Покупок', type: 'count' },
      { key: 'netMinor', label: 'Сумма покупок', type: 'money' }, { key: 'averageCheckMinor', label: 'Средний чек', type: 'money' },
      { key: 'discountsMinor', label: 'Скидки', type: 'money' }, { key: 'bonusEarnedMinor', label: 'Начислено бонусов', type: 'money' },
      { key: 'bonusSpentMinor', label: 'Списано бонусов', type: 'money' }, { key: 'lastPurchaseAt', label: 'Последняя покупка', type: 'datetime' },
      { key: 'lifetimeMinor', label: 'Всего за всё время', type: 'money' },
    ],
    sort: { key: 'netMinor', dir: 'desc' },
    totals: `SUM(checks)::int AS "checks", SUM("netMinor") AS "netMinor", CASE WHEN SUM(checks) > 0 THEN ROUND(SUM(sales_total) / SUM(checks)) END AS "averageCheckMinor", SUM("discountsMinor") AS "discountsMinor", SUM("bonusEarnedMinor") AS "bonusEarnedMinor", SUM("bonusSpentMinor") AS "bonusSpentMinor"`,
    build: ctx => Prisma.sql`WITH cs AS (
        SELECT s."customerId" AS cid, COUNT(*)::int AS checks, SUM(s."totalMinor") AS sales, SUM(s."discountMinor") AS discounts, MAX(s."createdAt") AS last_at
        FROM "Sale" s WHERE s.status = 'COMPLETED' AND s."customerId" IS NOT NULL ${inPeriod(ctx, 's."createdAt"')} ${inStores(ctx, 's."storeId"')} ${seller(ctx)}
        GROUP BY 1
      ), cr AS (
        SELECT s."customerId" AS cid, SUM(r."amountMinor") AS returns
        FROM "SaleReturn" r JOIN "Sale" s ON s.id = r."saleId"
        WHERE s."customerId" IS NOT NULL ${inPeriod(ctx, 'r."createdAt"')} ${inStores(ctx, 'r."storeId"')} ${seller(ctx)}
        GROUP BY 1
      ), cb AS (
        SELECT bt."customerId" AS cid, COALESCE(SUM(bt."deltaMinor") FILTER (WHERE bt.type = 'EARN'), 0) AS earned, COALESCE(-SUM(bt."deltaMinor") FILTER (WHERE bt.type = 'SPEND'), 0) AS spent
        FROM "BonusTransaction" bt WHERE TRUE ${inPeriod(ctx, 'bt."createdAt"')}
        GROUP BY 1
      )
      SELECT TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')) AS "customer", c.phone AS "phone", cs.checks AS "checks",
             cs.sales - COALESCE(cr.returns, 0) AS "netMinor", ROUND(cs.sales / cs.checks) AS "averageCheckMinor", cs.discounts AS "discountsMinor",
             COALESCE(cb.earned, 0) AS "bonusEarnedMinor", COALESCE(cb.spent, 0) AS "bonusSpentMinor", cs.last_at AS "lastPurchaseAt",
             c."totalSpentMinor" AS "lifetimeMinor", cs.sales AS sales_total
      FROM cs JOIN "Customer" c ON c.id = cs.cid LEFT JOIN cr ON cr.cid = cs.cid LEFT JOIN cb ON cb.cid = cs.cid
      WHERE TRUE ${ctx.q ? Prisma.sql`AND (TRIM(c."firstName" || ' ' || COALESCE(c."lastName", '')) ILIKE ${`%${ctx.q}%`} OR c.phone ILIKE ${`%${ctx.q}%`})` : Prisma.empty}`,
  },
};

export function localPeriod(from: string, to: string) {
  const gte = new Date(`${from}T00:00:00.000${ZONE_OFFSET}`);
  const end = new Date(`${to}T00:00:00.000${ZONE_OFFSET}`);
  const valid = (value: Date, text: string) => !Number.isNaN(value.getTime()) && new Date(value.getTime() + 5 * 3_600_000).toISOString().slice(0, 10) === text;
  if (!valid(gte, from) || !valid(end, to)) throw new BadRequestException('Invalid date');
  if (end < gte || end.getTime() - gte.getTime() > 366 * 86_400_000) throw new BadRequestException('Invalid date range');
  return {
    range: { gte, lt: new Date(end.getTime() + 86_400_000) },
    utcDays: { gte: new Date(`${from}T00:00:00.000Z`), lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000) },
  };
}

function plain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toString();
  if (typeof value === 'object' && value && 'toFixed' in value && 'd' in value) return String(value);
  return value;
}

export function visibleColumns(definition: ReportDefinition, access: AccessContext) {
  return definition.columns.filter(column => !column.finance || hasPermission(access, 'finance.view'));
}

export function canOpenReport(definition: ReportDefinition, access: AccessContext) {
  return hasPermission(access, 'reports.view') && definition.requires.every(permission => hasPermission(access, permission));
}

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  catalog(access: AccessContext) {
    return reportKeys.map(key => {
      const definition = reportDefinitions[key];
      return { key, title: definition.title, description: definition.description, group: definition.group, period: definition.period, filters: definition.filters, available: canOpenReport(definition, access) };
    });
  }

  private async storeScope(query: ReportQuery, access: AccessContext): Promise<string[] | null> {
    if (query.storeId) {
      if (!canAccessStore(access, query.storeId)) throw new ForbiddenException('Store access denied');
      return [query.storeId];
    }
    if (query.scope === 'all') return access.allStores ? null : access.storeIds;
    // Same default as the dashboard: only active stores unless the archive is requested explicitly.
    const stores = await this.db.store.findMany({ where: { deletedAt: null, status: 'ACTIVE', id: access.allStores ? undefined : { in: access.storeIds } }, select: { id: true } });
    return stores.map(store => store.id);
  }

  private async categoryTree(categoryId: string) {
    const categories = await this.db.category.findMany({ where: { deletedAt: null }, select: { id: true, parentId: true } });
    if (!categories.some(category => category.id === categoryId)) throw new NotFoundException('Category not found');
    const result = new Set([categoryId]);
    for (let grew = true; grew;) {
      grew = false;
      for (const category of categories) if (category.parentId && result.has(category.parentId) && !result.has(category.id)) { result.add(category.id); grew = true; }
    }
    return [...result];
  }

  async run(key: string, query: ReportQuery, access: AccessContext) {
    if (!(reportKeys as readonly string[]).includes(key)) throw new NotFoundException('Report not found');
    const definition = reportDefinitions[key as ReportKey];
    if (!canOpenReport(definition, access)) throw new ForbiddenException();
    const columns = visibleColumns(definition, access);
    let period: ReturnType<typeof localPeriod> | null = null;
    if (definition.period) {
      if (!query.from || !query.to) throw new BadRequestException('Period is required');
      period = localPeriod(query.from, query.to);
    }
    const sortColumn = columns.find(column => column.key === (query.sort ?? definition.sort.key)) ?? columns.find(column => column.key === definition.sort.key) ?? columns[0]!;
    const dir = query.dir ?? (query.sort ? 'asc' : definition.sort.dir);
    const limit = query.export ? EXPORT_LIMIT : query.limit;
    const page = query.export ? 1 : query.page;
    const storeIds = await this.storeScope(query, access);
    const base = { key, title: definition.title, description: definition.description, timeZone: REPORT_TIME_ZONE, from: definition.period ? query.from! : null, to: definition.period ? query.to! : null, storeId: query.storeId ?? null, columns, sort: sortColumn.key, dir, page, limit, generatedAt: new Date().toISOString() };
    if (storeIds && !storeIds.length) return { ...base, rows: [], totals: {}, total: 0, truncated: false };
    const ctx: ReportContext = {
      range: period?.range ?? null,
      utcDays: period?.utcDays ?? null,
      storeIds,
      employeeId: definition.filters.includes('employee') ? query.employeeId : undefined,
      categoryIds: definition.filters.includes('category') && query.categoryId ? await this.categoryTree(query.categoryId) : undefined,
      q: definition.filters.includes('q') && query.q ? query.q : undefined,
      lowOnly: definition.filters.includes('lowOnly') && Boolean(query.lowOnly),
      canSeeCustomers: hasPermission(access, 'customers.view'),
    };
    const data = Prisma.sql`WITH data AS (${definition.build(ctx)})`;
    const order = raw(`"${sortColumn.key}" ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`);
    const tiebreak = raw(columns.filter(column => column.key !== sortColumn.key && column.type === 'text').slice(0, 2).map(column => `"${column.key}" ASC`).join(', ') || '1');
    const summable = columns.filter(column => ['money', 'quantity', 'count'].includes(column.type));
    const totalsSelect = raw(definition.totals ?? (summable.map(column => `SUM("${column.key}") AS "${column.key}"`).join(', ') || 'NULL AS none'));
    const [rows, totalsRows] = await Promise.all([
      this.db.$queryRaw<Record<string, unknown>[]>`${data} SELECT *, COUNT(*) OVER () AS "__total" FROM data ORDER BY ${order}, ${tiebreak} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      this.db.$queryRaw<Record<string, unknown>[]>`${data} SELECT ${totalsSelect} FROM data`,
    ]);
    let total = rows.length ? Number(rows[0]!.__total) : 0;
    if (!rows.length && page > 1) total = Number((await this.db.$queryRaw<{ count: bigint }[]>`${data} SELECT COUNT(*) AS count FROM data`)[0]?.count ?? 0);
    const keys = new Set(columns.map(column => column.key));
    const pick = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([name]) => keys.has(name)).map(([name, value]) => [name, plain(value)]));
    return { ...base, rows: rows.map(pick), totals: pick(totalsRows[0] ?? {}), total, truncated: Boolean(query.export) && total > EXPORT_LIMIT };
  }
}
