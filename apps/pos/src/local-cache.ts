import { invoke } from '@tauri-apps/api/core';
import type { PosCustomer, PosPage, PosProduct, PosSettings, PosStock } from '@koreacrm/types';
import { createApiClient } from '@koreacrm/api-client';

type Client = ReturnType<typeof createApiClient>;
export type CacheStatus = { storeId: string; productCount: number; customerCount: number; lastSyncedAt: string | null };
export type CachedProduct = { id: string; name: string; sku: string; barcodes: string[]; priceMinor: number | null; availableQuantity: number; active: boolean };

export function hasDesktopCache() { return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window; }

export async function readCatalogCacheStatus(userId: string, storeId: string): Promise<CacheStatus> {
  return invoke<CacheStatus>('catalog_cache_status', { userId, storeId });
}

export function readCachedProducts(userId: string, storeId: string): Promise<CachedProduct[]> {
  return invoke<CachedProduct[]>('cached_products', { userId, storeId });
}

export function readCachedCustomers(userId: string, storeId: string): Promise<PosCustomer[]> {
  return invoke<PosCustomer[]>('cached_customers', { userId, storeId });
}

async function allPages<T>(client: Client, path: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const result = await client.get<PosPage<T>>(`${path}${separator}page=${page}&limit=100`);
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
    page += 1;
  }
}

export async function refreshCatalogCache(client: Client, userId: string, storeId: string, permissions: string[], progress: (value: string) => void): Promise<CacheStatus> {
  progress('Загружаем товары и остатки…');
  const [products, stocks, customers] = await Promise.all([
    allPages<PosProduct>(client, '/products'),
    allPages<PosStock>(client, `/stores/${storeId}/stock`),
    permissions.includes('customers.view') ? allPages<PosCustomer>(client, '/customers') : Promise.resolve([]),
  ]);
  const stockByProduct = new Map(stocks.map(stock => [stock.productId, stock]));
  const cachedProducts = [];
  for (let start = 0; start < products.length; start += 8) {
    const batch = await Promise.all(products.slice(start, start + 8).map(async product => {
      const settings = await client.get<PosSettings>(`/stores/${storeId}/products/${product.id}/settings`);
      const stock = stockByProduct.get(product.id);
      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcodes: product.barcodes.map(barcode => barcode.value),
        priceMinor: settings?.priceMinor ?? null,
        availableQuantity: Math.max(0, (stock?.quantity ?? 0) - (stock?.reservedQuantity ?? 0)),
        active: product.status === 'ACTIVE' && Boolean(settings?.active),
      };
    }));
    cachedProducts.push(...batch);
    progress(`Цены товаров: ${cachedProducts.length} из ${products.length}`);
  }
  progress('Сохраняем локальную базу…');
  return invoke<CacheStatus>('save_catalog_snapshot', {
    snapshot: {
      userId, storeId, products: cachedProducts,
      customers: customers.map(customer => ({ id: customer.id, firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone, discountPercent: customer.discountPercent ?? '0' })),
      permissions,
    },
  });
}
