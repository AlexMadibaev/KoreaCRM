import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { DatabaseService } from '../database.service';
import { canAccessStore, hasPermission, type AccessContext } from '../auth/policy';
import { localPeriod } from '../reports/reports.service';

export const documentKinds = ['SALE', 'SALE_RETURN', 'RECEIPTLESS_RETURN', 'PURCHASE', 'TRANSFER', 'INVENTORY', 'WRITE_OFF', 'ADJUSTMENT', 'RECEIVE_IN'] as const;
export type DocumentKind = (typeof documentKinds)[number];
const kindPermission: Record<DocumentKind, string> = {
  SALE: 'sales.view', SALE_RETURN: 'sales.view', RECEIPTLESS_RETURN: 'sales.view', PURCHASE: 'purchases.view',
  TRANSFER: 'transfers.view', INVENTORY: 'inventory.view', WRITE_OFF: 'inventory.view', ADJUSTMENT: 'inventory.view', RECEIVE_IN: 'inventory.view',
};
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const documentJournalSchema = z.object({
  from: dateOnly, to: dateOnly,
  storeId: z.string().uuid().optional(),
  kind: z.enum(documentKinds).optional(),
  paid: z.enum(['PAID', 'UNPAID']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type DocumentJournalQuery = z.infer<typeof documentJournalSchema>;

const sql = Prisma.sql;
const customerName = (alias: string) => Prisma.raw(`COALESCE(NULLIF(TRIM(${alias}."firstName" || ' ' || COALESCE(${alias}."lastName", '')), ''), 'Розничный покупатель')`);
const plain = (value: unknown): unknown => value === null || value === undefined ? null : value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? Number(value) : Prisma.Decimal.isDecimal(value) ? String(value) : typeof value === 'object' && 'toFixed' in (value as object) ? String(value) : value;
const row = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, plain(value)]));

/** One journal of every stock document, shaped after CloudShop "Движение товара". */
@Injectable()
export class DocumentsService {
  constructor(private readonly db: DatabaseService) {}

  allowedKinds(access: AccessContext) { return documentKinds.filter(kind => hasPermission(access, kindPermission[kind])); }

  private async scope(access: AccessContext, storeId?: string) {
    if (storeId) {
      if (!canAccessStore(access, storeId)) throw new ForbiddenException('Store access denied');
      return [storeId];
    }
    return (await this.db.store.findMany({ where: { deletedAt: null, ...(access.allStores ? {} : { id: { in: access.storeIds } }) }, select: { id: true } })).map(store => store.id);
  }

  async journal(query: DocumentJournalQuery, access: AccessContext) {
    const kinds = this.allowedKinds(access).filter(kind => !query.kind || kind === query.kind);
    const stores = await this.scope(access, query.storeId);
    if (!kinds.length || !stores.length) return { items: [], total: 0, page: query.page, limit: query.limit, kinds: this.allowedKinds(access) };
    const { range } = localPeriod(query.from, query.to);
    const inStores = (column: string) => sql`${Prisma.raw(column)} IN (${Prisma.join(stores.map(id => sql`${id}::uuid`))})`;
    const period = (column: string) => sql`${Prisma.raw(column)} >= ${range.gte} AND ${Prisma.raw(column)} < ${range.lt}`;
    const parts: Prisma.Sql[] = [];
    const has = (kind: DocumentKind) => kinds.includes(kind);
    if (has('SALE')) parts.push(sql`
      SELECT 'SALE' AS kind, s.id::text AS id, s.number, s."createdAt" AS "occurredAt", s.status::text AS status,
             (SELECT COUNT(*) FROM "SaleItem" si WHERE si."saleId" = s.id)::int AS positions, s."totalMinor" AS "amountMinor", s."totalMinor" - s."debtMinor" AS "paidMinor",
             'Магазин ' || st.name AS sender, 'Клиент ' || ${customerName('c')} AS receiver, COALESCE(seller.name, e.name) AS author, s.comment AS comment
      FROM "Sale" s JOIN "Store" st ON st.id = s."storeId" JOIN "User" e ON e.id = s."employeeId" LEFT JOIN "User" seller ON seller.id = s."sellerId" LEFT JOIN "Customer" c ON c.id = s."customerId"
      WHERE ${inStores('s."storeId"')} AND ${period('s."createdAt"')}`);
    if (has('SALE_RETURN')) parts.push(sql`
      SELECT 'SALE_RETURN', r.id::text, s.number, r."createdAt", 'COMPLETED',
             (SELECT COUNT(*) FROM "SaleReturnItem" ri WHERE ri."saleReturnId" = r.id)::int, r."amountMinor", r."amountMinor",
             'Клиент ' || ${customerName('c')}, 'Магазин ' || st.name, u.name, r.reason
      FROM "SaleReturn" r JOIN "Sale" s ON s.id = r."saleId" JOIN "Store" st ON st.id = r."storeId" JOIN "User" u ON u.id = r."employeeId" LEFT JOIN "Customer" c ON c.id = s."customerId"
      WHERE ${inStores('r."storeId"')} AND ${period('r."createdAt"')}`);
    if (has('RECEIPTLESS_RETURN')) parts.push(sql`
      SELECT 'RECEIPTLESS_RETURN', rr.id::text, NULL, rr."createdAt", 'COMPLETED', 1, rr."amountMinor", rr."amountMinor",
             'Клиент Розничный покупатель', 'Магазин ' || st.name, u.name, rr.reason
      FROM "ReceiptlessReturn" rr JOIN "Store" st ON st.id = rr."storeId" JOIN "User" u ON u.id = rr."employeeId"
      WHERE ${inStores('rr."storeId"')} AND ${period('rr."createdAt"')}`);
    if (has('PURCHASE')) parts.push(sql`
      SELECT 'PURCHASE', p.id::text, p.number, p."createdAt", p.status::text,
             (SELECT COUNT(*) FROM "PurchaseItem" pi WHERE pi."purchaseId" = p.id)::int, p."totalMinor", p."paidMinor",
             'Поставщик ' || sup.name, 'Магазин ' || st.name, u.name, NULL
      FROM "Purchase" p JOIN "Supplier" sup ON sup.id = p."supplierId" JOIN "Store" st ON st.id = p."storeId" JOIN "User" u ON u.id = p."createdById"
      WHERE ${inStores('p."storeId"')} AND ${period('p."createdAt"')}`);
    if (has('TRANSFER')) parts.push(sql`
      SELECT 'TRANSFER', t.id::text, UPPER(LEFT(t.id::text, 8)), t."createdAt", t.status::text,
             (SELECT COUNT(*) FROM "TransferItem" ti WHERE ti."transferId" = t.id)::int, NULL::numeric, NULL::numeric,
             'Магазин ' || fs.name, 'Магазин ' || ts.name, u.name, NULL
      FROM "Transfer" t JOIN "Store" fs ON fs.id = t."fromStoreId" JOIN "Store" ts ON ts.id = t."toStoreId" JOIN "User" u ON u.id = t."createdById"
      WHERE (${inStores('t."fromStoreId"')} OR ${inStores('t."toStoreId"')}) AND ${period('t."createdAt"')}`);
    if (has('INVENTORY')) parts.push(sql`
      SELECT 'INVENTORY', i.id::text, UPPER(LEFT(i.id::text, 8)), i."createdAt", i.status::text,
             (SELECT COUNT(*) FROM "InventoryItem" ii WHERE ii."inventoryId" = i.id)::int, NULL::numeric, NULL::numeric,
             NULL, 'Магазин ' || st.name, u.name, NULL
      FROM "Inventory" i JOIN "Store" st ON st.id = i."storeId" JOIN "User" u ON u.id = i."createdById"
      WHERE ${inStores('i."storeId"')} AND ${period('i."createdAt"')}`);
    for (const [kind, sourceType] of [['WRITE_OFF', 'MANUAL_WRITE_OFF'], ['ADJUSTMENT', 'MANUAL_ADJUSTMENT'], ['RECEIVE_IN', 'MANUAL_RECEIVE']] as const) if (has(kind)) parts.push(sql`
      SELECT ${kind}, MIN(sm."sourceId"), UPPER(LEFT(MIN(sm."sourceId"), 8)), MIN(sm."createdAt"), 'COMPLETED', COUNT(*)::int, NULL::numeric, NULL::numeric,
             ${kind === 'RECEIVE_IN' ? 'Оприходование' : sql`'Магазин ' || st.name`}, ${kind === 'WRITE_OFF' ? 'Списание' : kind === 'RECEIVE_IN' ? sql`'Магазин ' || st.name` : 'Корректировка остатка'}, MIN(u.name), MIN(sm.comment)
      FROM "StockMovement" sm JOIN "Store" st ON st.id = sm."storeId" LEFT JOIN "User" u ON u.id = sm."employeeId"
      WHERE sm."sourceType" = ${sourceType} AND ${inStores('sm."storeId"')} AND ${period('sm."createdAt"')}
      GROUP BY sm."sourceId", st.name`);
    const filters = sql`WHERE TRUE
      ${query.paid === 'PAID' ? sql`AND d."amountMinor" IS NOT NULL AND d."paidMinor" >= d."amountMinor"` : Prisma.empty}
      ${query.paid === 'UNPAID' ? sql`AND d."amountMinor" IS NOT NULL AND d."paidMinor" < d."amountMinor"` : Prisma.empty}
      ${query.q ? sql`AND (d.number ILIKE ${`%${query.q}%`} OR d.comment ILIKE ${`%${query.q}%`} OR d.sender ILIKE ${`%${query.q}%`} OR d.receiver ILIKE ${`%${query.q}%`})` : Prisma.empty}`;
    const rows = await this.db.$queryRaw<Record<string, unknown>[]>`
      WITH d(kind, id, number, "occurredAt", status, positions, "amountMinor", "paidMinor", sender, receiver, author, comment) AS (${Prisma.join(parts, ' UNION ALL ')})
      SELECT d.*, COUNT(*) OVER () AS "__total" FROM d ${filters}
      ORDER BY d."occurredAt" DESC, d.id DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
    const total = rows.length ? Number(rows[0]!.__total) : 0;
    return { items: rows.map(record => { const { __total: _unused, ...rest } = row(record); void _unused; return rest; }), total, page: query.page, limit: query.limit, kinds: this.allowedKinds(access) };
  }

  /** Header, payments and lines of one document for the side card. */
  async document(kind: string, id: string, access: AccessContext) {
    if (!(documentKinds as readonly string[]).includes(kind)) throw new NotFoundException('Document not found');
    const documentKind = kind as DocumentKind;
    if (!hasPermission(access, kindPermission[documentKind])) throw new ForbiddenException();
    const guard = (...storeIds: string[]) => { if (!storeIds.some(storeId => canAccessStore(access, storeId))) throw new NotFoundException('Document not found'); };
    const profit = hasPermission(access, 'finance.view');
    const barcodes = async (productIds: string[]) => new Map((await this.db.productBarcode.findMany({ where: { productId: { in: productIds } }, select: { productId: true, value: true } })).map(item => [item.productId, item.value]));
    switch (documentKind) {
      case 'SALE': {
        const sale = await this.db.sale.findUnique({ where: { id }, include: { store: { select: { name: true } }, customer: { select: { firstName: true, lastName: true } }, employee: { select: { name: true } }, seller: { select: { name: true } }, cashShift: { select: { id: true, deviceId: true } }, items: { include: { product: { select: { id: true, name: true, sku: true } } } }, payments: { include: { paymentMethod: { select: { name: true, kind: true } } } }, returns: { select: { id: true, amountMinor: true, createdAt: true, reason: true } } } });
        if (!sale) throw new NotFoundException('Document not found');
        guard(sale.storeId);
        const codes = await barcodes(sale.items.map(item => item.productId));
        const shiftNumber = sale.cashShiftId ? (await this.db.$queryRaw<{ number: number }[]>`SELECT number FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY "openedAt", id)::int AS number FROM "CashShift" WHERE "storeId" = ${sale.storeId}::uuid) x WHERE id = ${sale.cashShiftId}::uuid`)[0]?.number ?? null : null;
        return {
          kind, id: sale.id, number: sale.number, occurredAt: sale.createdAt, status: sale.status, storeId: sale.storeId, comment: sale.comment,
          fields: [['Магазин', sale.store.name], ['Клиент', sale.customer ? `${sale.customer.firstName} ${sale.customer.lastName ?? ''}`.trim() : 'Розничный покупатель'], ['Автор', sale.seller?.name ?? sale.employee.name], ['Касса', sale.deviceId], ['Смена', shiftNumber ? `#${shiftNumber}` : '—']],
          totals: { subtotalMinor: sale.subtotalMinor.toString(), discountMinor: sale.discountMinor.toString(), amountMinor: sale.totalMinor.toString(), paidMinor: sale.totalMinor.minus(sale.debtMinor).toString(), debtMinor: sale.debtMinor.toString() },
          payments: sale.payments.map(payment => ({ account: payment.paymentMethod.kind === 'CASH' ? 'Касса' : payment.paymentMethod.name, method: payment.paymentMethod.name, amountMinor: payment.amountMinor.toString(), occurredAt: sale.createdAt })),
          lines: sale.items.map(item => ({ productId: item.productId, name: item.product.name, sku: item.product.sku, barcode: codes.get(item.productId) ?? null, quantity: item.quantity, priceMinor: item.priceMinor.toString(), discountMinor: item.discountMinor.toString(), totalMinor: item.totalMinor.toString(), profitMinor: profit ? item.profitMinor.toString() : null })),
          related: sale.returns.map(record => ({ kind: 'SALE_RETURN', id: record.id, title: 'Возврат продажи', amountMinor: record.amountMinor.toString(), occurredAt: record.createdAt, note: record.reason })),
        };
      }
      case 'SALE_RETURN': {
        const record = await this.db.saleReturn.findUnique({ where: { id }, include: { sale: { select: { id: true, number: true, customer: { select: { firstName: true, lastName: true } } } }, items: { include: { saleItem: { include: { product: { select: { id: true, name: true, sku: true } } } } } }, payments: { include: { paymentMethod: { select: { name: true, kind: true } } } } } });
        if (!record) throw new NotFoundException('Document not found');
        guard(record.storeId);
        const [store, employee] = await Promise.all([this.db.store.findUniqueOrThrow({ where: { id: record.storeId }, select: { name: true } }), this.db.user.findUniqueOrThrow({ where: { id: record.employeeId }, select: { name: true } })]);
        const codes = await barcodes(record.items.map(item => item.saleItem.productId));
        return {
          kind, id: record.id, number: record.sale.number, occurredAt: record.createdAt, status: 'COMPLETED', storeId: record.storeId, comment: record.reason,
          fields: [['Магазин', store.name], ['Клиент', record.sale.customer ? `${record.sale.customer.firstName} ${record.sale.customer.lastName ?? ''}`.trim() : 'Розничный покупатель'], ['Автор', employee.name], ['Касса', record.deviceId], ['Причина', record.reason]],
          totals: { amountMinor: record.amountMinor.toString(), paidMinor: record.amountMinor.toString() },
          payments: record.payments.map(payment => ({ account: payment.paymentMethod.kind === 'CASH' ? 'Касса' : payment.paymentMethod.name, method: payment.paymentMethod.name, amountMinor: payment.amountMinor.toString(), occurredAt: record.createdAt })),
          lines: record.items.map(item => ({ productId: item.saleItem.productId, name: item.saleItem.product.name, sku: item.saleItem.product.sku, barcode: codes.get(item.saleItem.productId) ?? null, quantity: item.quantity, priceMinor: item.saleItem.priceMinor.toString(), discountMinor: '0', totalMinor: item.amountMinor.toString(), profitMinor: null })),
          related: [{ kind: 'SALE', id: record.sale.id, title: `Продажа ${record.sale.number}`, amountMinor: null, occurredAt: null, note: null }],
        };
      }
      case 'RECEIPTLESS_RETURN': {
        const record = await this.db.receiptlessReturn.findUnique({ where: { id }, include: { product: { select: { id: true, name: true, sku: true } } } });
        if (!record) throw new NotFoundException('Document not found');
        guard(record.storeId);
        const [store, employee] = await Promise.all([this.db.store.findUniqueOrThrow({ where: { id: record.storeId }, select: { name: true } }), this.db.user.findUniqueOrThrow({ where: { id: record.employeeId }, select: { name: true } })]);
        return {
          kind, id: record.id, number: null, occurredAt: record.createdAt, status: 'COMPLETED', storeId: record.storeId, comment: record.reason,
          fields: [['Магазин', store.name], ['Автор', employee.name], ['Касса', record.deviceId], ['Причина', record.reason]],
          totals: { amountMinor: record.amountMinor.toString(), paidMinor: record.amountMinor.toString() },
          payments: [{ account: 'Касса', method: 'Наличные', amountMinor: record.amountMinor.toString(), occurredAt: record.createdAt }],
          lines: [{ productId: record.productId, name: record.product.name, sku: record.product.sku, barcode: null, quantity: record.quantity, priceMinor: null, discountMinor: '0', totalMinor: record.amountMinor.toString(), profitMinor: null }],
          related: [],
        };
      }
      case 'PURCHASE': {
        const purchase = await this.db.purchase.findUnique({ where: { id }, include: { supplier: { select: { name: true } }, store: { select: { name: true } }, createdBy: { select: { name: true } }, items: { include: { product: { select: { id: true, name: true, sku: true } } } }, payments: { select: { amountMinor: true, paymentMethod: true, createdAt: true } } } });
        if (!purchase) throw new NotFoundException('Document not found');
        guard(purchase.storeId);
        const codes = await barcodes(purchase.items.map(item => item.productId));
        const methodName: Record<string, string> = { CASH: 'Наличные', CARD: 'Карта', BANK_TRANSFER: 'Перевод' };
        return {
          kind, id: purchase.id, number: purchase.number, occurredAt: purchase.createdAt, status: purchase.status, storeId: purchase.storeId, comment: null,
          fields: [['Магазин', purchase.store.name], ['Поставщик', purchase.supplier.name], ['Автор', purchase.createdBy.name]],
          totals: { amountMinor: purchase.totalMinor.toString(), paidMinor: purchase.paidMinor.toString(), debtMinor: purchase.debtMinor.toString() },
          payments: purchase.payments.map(payment => ({ account: payment.paymentMethod === 'CASH' ? 'Касса' : 'Расчётный счёт', method: methodName[payment.paymentMethod] ?? payment.paymentMethod, amountMinor: payment.amountMinor.toString(), occurredAt: payment.createdAt })),
          lines: purchase.items.map(item => ({ productId: item.productId, name: item.product.name, sku: item.product.sku, barcode: codes.get(item.productId) ?? null, quantity: item.quantityOrdered, received: item.quantityReceived, priceMinor: item.purchasePriceMinor.toString(), discountMinor: '0', totalMinor: item.purchasePriceMinor.mul(item.quantityOrdered).toString(), profitMinor: null })),
          related: [],
        };
      }
      case 'TRANSFER': {
        const transfer = await this.db.transfer.findUnique({ where: { id }, include: { fromStore: { select: { name: true } }, toStore: { select: { name: true } }, createdBy: { select: { name: true } }, items: { include: { product: { select: { id: true, name: true, sku: true } } } } } });
        if (!transfer) throw new NotFoundException('Document not found');
        guard(transfer.fromStoreId, transfer.toStoreId);
        const codes = await barcodes(transfer.items.map(item => item.productId));
        return {
          kind, id: transfer.id, number: transfer.id.slice(0, 8).toUpperCase(), occurredAt: transfer.createdAt, status: transfer.status, storeId: transfer.fromStoreId, comment: null,
          fields: [['Откуда', transfer.fromStore.name], ['Куда', transfer.toStore.name], ['Автор', transfer.createdBy.name], ['Получено', transfer.receivedAt ? transfer.receivedAt.toISOString() : '—']],
          totals: {}, payments: [],
          lines: transfer.items.map(item => ({ productId: item.productId, name: item.product.name, sku: item.product.sku, barcode: codes.get(item.productId) ?? null, quantity: item.quantity, received: item.receivedQuantity, priceMinor: null, discountMinor: '0', totalMinor: null, profitMinor: null })),
          related: [],
        };
      }
      case 'INVENTORY': {
        const inventory = await this.db.inventory.findUnique({ where: { id }, include: { store: { select: { name: true } }, createdBy: { select: { name: true } }, items: { include: { product: { select: { id: true, name: true, sku: true } } } } } });
        if (!inventory) throw new NotFoundException('Document not found');
        guard(inventory.storeId);
        const codes = await barcodes(inventory.items.map(item => item.productId));
        return {
          kind, id: inventory.id, number: inventory.id.slice(0, 8).toUpperCase(), occurredAt: inventory.createdAt, status: inventory.status, storeId: inventory.storeId, comment: null,
          fields: [['Магазин', inventory.store.name], ['Автор', inventory.createdBy.name], ['Завершена', inventory.completedAt ? inventory.completedAt.toISOString() : '—']],
          totals: {}, payments: [],
          lines: inventory.items.map(item => ({ productId: item.productId, name: item.product.name, sku: item.product.sku, barcode: codes.get(item.productId) ?? null, quantity: item.actualQuantity, expected: item.expectedQuantity, priceMinor: null, discountMinor: '0', totalMinor: null, profitMinor: null })),
          related: [],
        };
      }
      case 'WRITE_OFF':
      case 'ADJUSTMENT':
      case 'RECEIVE_IN': {
        const movements = await this.db.stockMovement.findMany({ where: { sourceType: documentKind === 'WRITE_OFF' ? 'MANUAL_WRITE_OFF' : documentKind === 'RECEIVE_IN' ? 'MANUAL_RECEIVE' : 'MANUAL_ADJUSTMENT', sourceId: id }, include: { product: { select: { id: true, name: true, sku: true } }, store: { select: { name: true } }, employee: { select: { name: true } } } });
        if (!movements.length) throw new NotFoundException('Document not found');
        guard(movements[0]!.storeId);
        const codes = await barcodes(movements.map(item => item.productId));
        const first = movements[0]!;
        return {
          kind, id, number: id.slice(0, 8).toUpperCase(), occurredAt: first.createdAt, status: 'COMPLETED', storeId: first.storeId, comment: first.comment,
          fields: [['Магазин', first.store.name], ['Автор', first.employee?.name ?? '—'], ['Комментарий', first.comment ?? '—']],
          totals: {}, payments: [],
          lines: movements.map(item => ({ productId: item.productId, name: item.product.name, sku: item.product.sku, barcode: codes.get(item.productId) ?? null, quantity: item.quantity, before: item.previousQuantity, after: item.newQuantity, priceMinor: null, discountMinor: '0', totalMinor: null, profitMinor: null })),
          related: [],
        };
      }
    }
  }
}
