export type PosCategory = { id: string; name: string };
export type CategoryFilter = 'all' | 'uncategorized' | string;

export function posCatalogPath(storeId: string, search: string, categoryId: CategoryFilter, page: number, limit = 24): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search.trim()) params.set('search', search.trim());
  if (categoryId === 'uncategorized') params.set('uncategorized', 'true');
  else if (categoryId !== 'all') params.set('categoryId', categoryId);
  return `/stores/${storeId}/pos-products?${params}`;
}

export function filterCachedProducts<T extends { categoryId: string | null; name: string; sku: string; barcodes: string[]; active: boolean; priceMinor: number | null; availableQuantity: number }>(products: T[], search: string, categoryId: CategoryFilter): T[] {
  const query = search.trim().toLocaleLowerCase('ru');
  return products.filter(product => product.active && product.priceMinor !== null && product.availableQuantity > 0
    && (categoryId === 'all' || (categoryId === 'uncategorized' ? product.categoryId === null : product.categoryId === categoryId))
    && (!query || `${product.name} ${product.sku} ${product.barcodes.join(' ')}`.toLocaleLowerCase('ru').includes(query)));
}
