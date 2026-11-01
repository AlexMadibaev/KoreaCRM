import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCachedProducts, posCatalogPath } from '../src/catalog-filters.ts';

test('POS category and search filters use server paging', () => {
  assert.equal(posCatalogPath('store-a', 'Missha', 'category-a', 2), '/stores/store-a/pos-products?page=2&limit=24&search=Missha&categoryId=category-a');
  assert.equal(posCatalogPath('store-a', '', 'uncategorized', 1), '/stores/store-a/pos-products?page=1&limit=24&uncategorized=true');
});

test('offline category filter matches the selected category', () => {
  const row = (categoryId, name) => ({ categoryId, name, sku: name, barcodes: [], active: true, priceMinor: 100, availableQuantity: 2 });
  const products = [row('category-a', 'Cream'), row('category-b', 'Toner'), row(null, 'Mask')];
  assert.deepEqual(filterCachedProducts(products, '', 'category-a').map(product => product.name), ['Cream']);
  assert.deepEqual(filterCachedProducts(products, 'mask', 'uncategorized').map(product => product.name), ['Mask']);
});
