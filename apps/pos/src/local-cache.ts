import { invoke } from '@tauri-apps/api/core';
import type { PosCustomer, PosPage } from '@koreacrm/types';
import { createApiClient } from '@koreacrm/api-client';
import type { PosCatalogProduct } from './product-results';

type Client = ReturnType<typeof createApiClient>;
export type CacheStatus = { storeId: string; productCount: number; customerCount: number; lastSyncedAt: string | null };
export type DatabaseHealth = { integrity: string; journalMode: string };
export type CachedProduct = { id: string; name: string; sku: string; brandId: string | null; categoryId: string | null; imageKey: string | null; barcodes: string[]; priceMinor: number | null; availableQuantity: number; active: boolean };

export function hasDesktopCache() { return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window; }

export async function readCatalogCacheStatus(userId: string, storeId: string): Promise<CacheStatus> {
  return invoke<CacheStatus>('catalog_cache_status', { userId, storeId });
}

export function readDatabaseHealth(): Promise<DatabaseHealth> {
  return invoke<DatabaseHealth>('database_health');
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
  const [products, customers] = await Promise.all([
    allPages<PosCatalogProduct>(client, `/stores/${storeId}/pos-products`),
    permissions.includes('customers.view') ? allPages<PosCustomer>(client, '/customers') : Promise.resolve([]),
  ]);
  const cachedProducts = products.map(product => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    brandId: product.brandId,
    categoryId: product.categoryId,
    imageKey: product.images[0]?.storageKey ?? null,
    barcodes: product.barcodes.map(barcode => barcode.value),
    priceMinor: product.priceMinor,
    availableQuantity: product.availableQuantity,
    active: product.active,
  }));
  progress('Сохраняем локальную базу…');
  return invoke<CacheStatus>('save_catalog_snapshot', {
    snapshot: {
      userId, storeId, products: cachedProducts,
      customers: customers.map(customer => ({ id: customer.id, firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone, discountPercent: customer.discountPercent ?? '0' })),
      permissions,
    },
  });
}
