import { Controller, ForbiddenException, Get, Injectable, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessGuard, RequirePermission } from '../auth/guards';
import { canAccessStore, hasPermission, type AccessContext } from '../auth/policy';
import { DatabaseService } from '../database.service';
import { parseInput } from '../finance/finance.schemas';

export const productsOverviewSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().max(100).optional(),
  brandId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
type OverviewQuery = z.infer<typeof productsOverviewSchema>;
const sql = Prisma.sql;
const text = (value: unknown) => value === null || value === undefined ? null : String(value);

/** Wide catalog rows like the CloudShop product list: prices, cost, margin, markup and stock per store in one query. */
@Injectable()
export class ProductsOverviewService {
  constructor(private readonly db: DatabaseService) {}
  async list(query: OverviewQuery, access: AccessContext) {
    if (query.storeId && !canAccessStore(access, query.storeId)) throw new ForbiddenException('Store access denied');
    const stores = await this.db.store.findMany({ where: { deletedAt: null, status: 'ACTIVE', ...(access.allStores ? {} : { id: { in: access.storeIds } }) }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const priceStore = query.storeId ?? stores[0]?.id ?? null;
    const finance = hasPermission(access, 'finance.view') || hasPermission(access, 'purchases.view');
    const inventory = hasPermission(access, 'inventory.view');
    const like = query.search ? `%${query.search}%` : null;
    const where = sql`WHERE p."deletedAt" IS NULL
      ${query.status ? sql`AND p.status::text = ${query.status}` : Prisma.empty}
      ${query.brandId ? sql`AND p."brandId" = ${query.brandId}::uuid` : Prisma.empty}
      ${query.categoryId ? sql`AND p."categoryId" = ${query.categoryId}::uuid` : Prisma.empty}
      ${like ? sql`AND (p.name ILIKE ${like} OR p.sku ILIKE ${like} OR EXISTS (SELECT 1 FROM "ProductBarcode" b WHERE b."productId" = p.id AND b.value ILIKE ${like}))` : Prisma.empty}`;
    const storeIds = stores.map(store => store.id);
    const rows = await this.db.$queryRaw<Record<string, unknown>[]>`
      SELECT p.id, p.name, p.sku, p.unit, p.country, p.status::text AS status, p."createdAt", br.name AS brand, c.name AS category,
             (SELECT b.value FROM "ProductBarcode" b WHERE b."productId" = p.id ORDER BY b.value LIMIT 1) AS barcode,
             sps."priceMinor" AS "priceMinor", sps."minStock" AS "minStock", sps."costBasisMinor" AS "costBasisMinor",
             (SELECT b."purchasePriceMinor" FROM "ProductBatch" b WHERE b."productId" = p.id ${priceStore ? sql`AND b."storeId" = ${priceStore}::uuid` : Prisma.empty} ORDER BY b."receivedAt" DESC LIMIT 1) AS "purchasePriceMinor",
             (SELECT sup.name FROM "PurchaseItem" pi JOIN "Purchase" pu ON pu.id = pi."purchaseId" JOIN "Supplier" sup ON sup.id = pu."supplierId" WHERE pi."productId" = p.id ORDER BY pu."createdAt" DESC LIMIT 1) AS supplier,
             ${storeIds.length ? sql`(SELECT json_object_agg(s."storeId", s.quantity) FROM "Stock" s WHERE s."productId" = p.id AND s."storeId" IN (${Prisma.join(storeIds.map(id => sql`${id}::uuid`))}))` : sql`NULL::json`} AS stock,
             COUNT(*) OVER () AS "__total"
      FROM "Product" p LEFT JOIN "Brand" br ON br.id = p."brandId" LEFT JOIN "Category" c ON c.id = p."categoryId"
      LEFT JOIN "StoreProductSettings" sps ON sps."productId" = p.id AND sps."storeId" = ${priceStore}::uuid
      ${where}
      ORDER BY p.name, p.id LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
    return {
      stores: inventory ? stores : [], priceStoreId: priceStore, canSeeCost: finance,
      total: rows.length ? Number(rows[0]!.__total) : 0, page: query.page, limit: query.limit,
      items: rows.map(row => {
        const price = row.priceMinor === null || row.priceMinor === undefined ? null : BigInt(String(row.priceMinor));
        const costRaw = row.costBasisMinor ?? row.purchasePriceMinor;
        const cost = costRaw === null || costRaw === undefined ? null : BigInt(String(costRaw).split('.')[0]!);
        const percent = (numerator: bigint, denominator: bigint) => denominator === 0n ? null : (Math.round(Number(numerator) * 10000 / Number(denominator)) / 100).toFixed(2);
        return {
          id: row.id, name: row.name, sku: row.sku, unit: row.unit, country: row.country, status: row.status, brand: row.brand, category: row.category, barcode: row.barcode,
          createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt, supplier: row.supplier,
          priceMinor: price === null ? null : price.toString(), minStock: row.minStock ?? null,
          costMinor: finance && cost !== null ? cost.toString() : null,
          purchasePriceMinor: finance ? text(row.purchasePriceMinor) : null,
          marginPercent: finance && price !== null && cost !== null && price > 0n ? percent(price - cost, price) : null,
          markupPercent: finance && price !== null && cost !== null && cost > 0n ? percent(price - cost, cost) : null,
          stock: inventory ? (row.stock as Record<string, number> | null) ?? {} : {},
        };
      }),
    };
  }
}

@ApiTags('catalog') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('products-overview')
export class ProductsOverviewController {
  constructor(private readonly service: ProductsOverviewService) {}
  @Get() @RequirePermission('products.view') list(@Query() query: unknown, @Req() req: Request & { access: AccessContext }) { return this.service.list(parseInput(productsOverviewSchema, query), req.access); }
}
