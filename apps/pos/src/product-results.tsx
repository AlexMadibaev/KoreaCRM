import type { PosProduct } from '@koreacrm/types';
import type { CachedProduct } from './local-cache';
import { formatMinor } from './calculations';
import { useEffect, useState } from 'react';
import { fetchProductImage } from './product-image-url';

export type PosCatalogProduct = PosProduct & {
  images: { storageKey: string }[];
  priceMinor: number | null;
  availableQuantity: number;
  active: boolean;
};
export type CatalogItem = PosCatalogProduct | CachedProduct;

export function ProductImage({ storageKey, apiUrl }: { storageKey?: string | null; apiUrl: string }) {
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const imageKey = `${apiUrl}:${storageKey ?? ''}`;
  useEffect(() => {
    if (!storageKey) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void fetchProductImage(apiUrl, storageKey, fetch, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setImage({ key: imageKey, url: objectUrl });
      setFailed(false);
    }).catch(() => { if (!controller.signal.aborted) { setImage(null); setFailed(true); } });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [apiUrl, storageKey, imageKey, retry]);
  useEffect(() => {
    if (!failed) return;
    const retryImage = () => setRetry(value => value + 1);
    window.addEventListener('online', retryImage);
    const timer = window.setTimeout(retryImage, 30_000);
    return () => { window.removeEventListener('online', retryImage); window.clearTimeout(timer); };
  }, [failed]);
  if (!storageKey) return <span aria-hidden="true">✦</span>;
  if (image?.key === imageKey) return <img src={image.url} alt="" loading="lazy" onError={() => { setImage(null); setFailed(true); }} />;
  return <span aria-hidden="true">✦</span>;
}

export function ProductResults({ products, apiUrl, disabled, onAdd }: { products: CatalogItem[]; apiUrl: string; disabled: boolean; onAdd: (product: CatalogItem) => void }) {
  return <ul className="results product-cards">{products.map(product => {
    const key = 'images' in product ? product.images[0]?.storageKey : product.imageKey;
    const canAdd = product.active && product.priceMinor !== null && product.availableQuantity > 0;
    return <li className="product-card" key={product.id}>
      <button type="button" className="product-card-button" disabled={disabled || !canAdd} onClick={() => onAdd(product)} aria-label={canAdd ? `Добавить ${product.name} в чек` : `${product.name} недоступен`}>
        <span className="product-card-media"><ProductImage key={`${apiUrl}:${key}`} storageKey={key} apiUrl={apiUrl} /></span>
        <span className="product-card-body"><strong className="product-card-title" title={product.name}>{product.name}</strong><small className="product-card-sku">Артикул: {product.sku}</small><strong className="product-card-price">{product.priceMinor === null ? 'Цена не указана' : `${formatMinor(product.priceMinor)} сомони`}</strong><span className={`product-card-stock ${product.availableQuantity > 0 ? '' : 'is-empty'}`}>{product.availableQuantity > 0 ? `В наличии: ${product.availableQuantity} шт.` : 'Нет в наличии'}</span></span>
      </button>
    </li>;
  })}</ul>;
}
