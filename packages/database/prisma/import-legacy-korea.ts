import { readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';

type LegacyProduct = {
  sku: string;
  name: string;
  barcodes: string[];
  unit: string;
  description: string | null;
  priceMinor: number | null;
  stocks: { sadbarg: number; delivery: number; ayni: number };
  minStock: number;
};
type LegacyCustomer = {
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  address: string | null;
  notes: string | null;
};
type LegacyData = { sourceDate: string; products: LegacyProduct[]; customers: LegacyCustomer[] };
const sourceId = 'korea-2026-10-28';

function loadLegacyData(): LegacyData {
  const data = JSON.parse(readFileSync(new URL('./legacy-data/korea-2026-10-28.json', import.meta.url), 'utf8')) as LegacyData;
  if (data.sourceDate !== '2026-10-28' || data.products.length !== 1646 || data.customers.length !== 1526) throw new Error('Legacy data count or version changed');
  if (new Set(data.products.map(item => item.sku)).size !== data.products.length) throw new Error('Legacy product SKUs are not unique');
  if (new Set(data.customers.map(item => item.phone)).size !== data.customers.length) throw new Error('Legacy customer phones are not unique');
  return data;
}

async function sourceStore(db: PrismaClient, code: string, name: string, aliases: string[]) {
  const byCode = await db.store.findUnique({ where: { code } });
  if (byCode) return byCode;
  for (const alias of aliases) {
    const byName = await db.store.findFirst({ where: { name: { contains: alias, mode: 'insensitive' }, deletedAt: null } });
    if (byName) return byName;
  }
  return db.store.create({ data: { code, name } });
}

export async function importLegacyKorea(db: PrismaClient) {
  const completed = await db.auditLog.findFirst({ where: { action: 'LEGACY_DATA_IMPORTED', entityType: 'LegacyImport', entityId: sourceId }, select: { id: true } });
  if (completed) { console.log('Legacy Korea import already completed'); return; }
  const data = loadLegacyData();
  const createdProducts = await db.product.createMany({
    data: data.products.map(item => ({ sku: item.sku, name: item.name, unit: item.unit, description: item.description })),
    skipDuplicates: true,
  });
  const products = await db.product.findMany({ where: { sku: { in: data.products.map(item => item.sku) } }, select: { id: true, sku: true } });
  const productIds = new Map(products.map(item => [item.sku, item.id]));
  if (productIds.size !== data.products.length) throw new Error('Legacy product import did not create all SKUs');

  const barcodes = data.products.flatMap(item => item.barcodes.map((value, index) => ({ productId: productIds.get(item.sku)!, value, primary: index === 0 })));
  const createdBarcodes = await db.productBarcode.createMany({ data: barcodes, skipDuplicates: true });
  const createdCustomers = await db.customer.createMany({
    data: data.customers.map(item => ({ ...item, birthday: item.birthday ? new Date(`${item.birthday}T00:00:00.000Z`) : null })),
    skipDuplicates: true,
  });

  const sadbarg = await sourceStore(db, 'LEGACY_SADBARG', 'Sadbarg', ['Sadbarg']);
  const ayni = await sourceStore(db, 'LEGACY_AYNI', 'Магазин Айни', ['Айни', 'Ayni']);
  const stores = await db.store.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, select: { id: true } });
  const settings = stores.flatMap(store => data.products.map(item => ({ storeId: store.id, productId: productIds.get(item.sku)!, priceMinor: item.priceMinor, minStock: item.minStock })));
  const createdSettings = await db.storeProductSettings.createMany({ data: settings, skipDuplicates: true });

  let createdStocks = 0;
  let negativeStocks = 0;
  for (const item of data.products) {
    for (const [store, quantity] of [[sadbarg, item.stocks.sadbarg], [ayni, item.stocks.ayni]] as const) {
      if (quantity < 0) { negativeStocks++; continue; }
      if (quantity === 0) continue;
      const productId = productIds.get(item.sku)!;
      const added = await db.$transaction(async tx => {
        const existing = await tx.stock.findUnique({ where: { storeId_productId: { storeId: store.id, productId } }, select: { productId: true } });
        if (existing) return false;
        await tx.stock.create({ data: { storeId: store.id, productId, quantity } });
        await tx.stockMovement.create({ data: { storeId: store.id, productId, type: 'CORRECTION', quantity, previousQuantity: 0, newQuantity: quantity, sourceType: 'LEGACY_IMPORT', sourceId, comment: 'Начальный остаток из каталога 28.10.2026' } });
        return true;
      });
      if (added) createdStocks++;
    }
  }
  const summary = { products: createdProducts.count, barcodes: createdBarcodes.count, customers: createdCustomers.count, storeSettings: createdSettings.count, stocks: createdStocks, negativeStockCellsSkipped: negativeStocks };
  await db.auditLog.create({ data: { action: 'LEGACY_DATA_IMPORTED', entityType: 'LegacyImport', entityId: sourceId, newValue: summary } });
  console.log('Legacy Korea import:', summary);
  return summary;
}
