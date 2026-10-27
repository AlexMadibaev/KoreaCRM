import type { PosProduct } from '@koreacrm/types';
import type { CachedProduct } from './local-cache';
import { formatMinor } from './calculations';
import { useState } from 'react';

export type PosCatalogProduct = PosProduct & {
  images: { storageKey: string }[];
  priceMinor: number | null;
  availableQuantity: number;
  active: boolean;
};
export type CatalogItem = PosCatalogProduct | CachedProduct;

export function ProductImage({ storageKey, apiUrl }: { storageKey?: string | null; apiUrl: string }) {
  const [attempt, setAttempt] = useState(0);
  if (!storageKey) return <span aria-hidden="true">✦</span>;
  const base = apiUrl.trim().replace(/\/+$/, '');
  const primary = `${base}/product-images/${encodeURIComponent(storageKey)}`;
  const url = new URL(base);
  const fallback = url.pathname.replace(/\/+$/, '') === '/api' ? `${url.origin}/product-images/${encodeURIComponent(storageKey)}` : null;
  if (attempt > (fallback ? 1 : 0)) return <span aria-hidden="true">✦</span>;
  return <img src={attempt === 0 ? primary : fallback!} alt="" loading="lazy" onError={() => setAttempt(value => value + 1)} />;
}

export function ProductResults({ products, apiUrl, disabled, onAdd }: { products: CatalogItem[]; apiUrl: string; disabled: boolean; onAdd: (product: CatalogItem) => void }) {
  return <ul className="results product-cards">{products.map(product => {
    const key = 'images' in product ? product.images[0]?.storageKey : product.imageKey;
    const canAdd = product.active && product.priceMinor !== null && product.availableQuantity > 0;
    return <li className="product-card" key={product.id}>
      <button type="button" className="product-card-button" disabled={disabled || !canAdd} onClick={() => onAdd(product)} aria-label={canAdd ? `Добавить ${product.name} в чек` : `${product.name} недоступен`}>
        <span className="product-card-media"><ProductImage key={key} storageKey={key} apiUrl={apiUrl} /></span>
        <span className="product-card-body"><strong className="product-card-title" title={product.name}>{product.name}</strong><small className="product-card-sku">Артикул: {product.sku}</small><strong className="product-card-price">{product.priceMinor === null ? 'Цена не указана' : `${formatMinor(product.priceMinor)} сомони`}</strong><span className={`product-card-stock ${product.availableQuantity > 0 ? '' : 'is-empty'}`}>{product.availableQuantity > 0 ? `В наличии: ${product.availableQuantity} шт.` : 'Нет в наличии'}</span></span>
      </button>
    </li>;
  })}</ul>;
}
