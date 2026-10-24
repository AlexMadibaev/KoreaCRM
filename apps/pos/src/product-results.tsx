import type { PosProduct } from '@koreacrm/types';
import type { CachedProduct } from './local-cache';
import { formatMinor } from './calculations';

export type PosCatalogProduct = PosProduct & {
  images: { storageKey: string }[];
  priceMinor: number | null;
  availableQuantity: number;
  active: boolean;
};
export type CatalogItem = PosCatalogProduct | CachedProduct;

export function ProductResults({ products, apiUrl, disabled, onAdd }: { products: CatalogItem[]; apiUrl: string; disabled: boolean; onAdd: (product: CatalogItem) => void }) {
  const base = apiUrl.trim().replace(/\/+$/, '');
  return <ul className="results product-cards">{products.map(product => {
    const key = 'images' in product ? product.images[0]?.storageKey : null;
    const canAdd = product.active && product.priceMinor !== null && product.availableQuantity > 0;
    return <li className="product-card" key={product.id}>
      <button type="button" className="product-card-button" disabled={disabled || !canAdd} onClick={() => onAdd(product)} aria-label={canAdd ? `Добавить ${product.name} в чек` : `${product.name} недоступен`}>
        <span className="product-card-media">{key ? <img src={`${base}/product-images/${encodeURIComponent(key)}`} alt="" loading="lazy" /> : <span aria-hidden="true">✦</span>}</span>
        <span className="product-card-body"><strong className="product-card-title" title={product.name}>{product.name}</strong><small className="product-card-sku">{product.sku}</small><strong className="product-card-price">{product.priceMinor === null ? 'Цена не указана' : `${formatMinor(product.priceMinor)} сум`}</strong><span className={`product-card-stock ${product.availableQuantity > 0 ? '' : 'is-empty'}`}>{product.availableQuantity > 0 ? `В наличии: ${product.availableQuantity} шт.` : 'Нет в наличии'}</span></span>
      </button>
    </li>;
  })}</ul>;
}
