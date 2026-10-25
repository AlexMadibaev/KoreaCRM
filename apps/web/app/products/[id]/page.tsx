'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ProductForm } from '../../../components/product-form';
import { ProductImages } from '../../../components/product-images';
import { ProductPriceEditor } from '../../../components/product-price-editor';
import { api, type Product } from '../../../lib/api';

const attributes = [
  ['country', 'Страна'], ['shade', 'Оттенок'], ['volume', 'Объём'],
  ['weight', 'Вес'], ['line', 'Линейка'], ['collection', 'Коллекция'],
  ['gender', 'Пол'], ['skinType', 'Тип кожи'], ['productType', 'Тип товара'],
] as const;

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Product>(`/products/${id}`).then(setProduct).catch((caught) => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить товар')).finally(() => setLoading(false));
  }, [id]);

  async function remove() {
    if (!product || !window.confirm(`Удалить товар «${product.name}»?`)) return;
    setDeleting(true); setError('');
    try { await api(`/products/${id}`, { method: 'DELETE' }); router.push('/products'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось удалить товар'); setDeleting(false); }
  }

  if (loading) return <p className="crm-product-message">Загрузка товара…</p>;
  if (!product) return <p role="alert" className="crm-alert">{error || 'Товар не найден'}</p>;

  const filledAttributes = attributes.filter(([key]) => product[key]);
  return <section className="crm-product-detail">
    <Link href="/products" className="crm-product-back">← Каталог товаров</Link>
    <div className="crm-product-detail-header">
      <div><span className="crm-eyebrow">КАРТОЧКА ТОВАРА</span><h1>{product.name}</h1><p>Артикул {product.sku}</p></div>
      <div className="crm-product-detail-actions">
        <button type="button" className="crm-outline-button" onClick={() => setEditing(!editing)}>{editing ? 'Отменить изменения' : 'Изменить товар'}</button>
        <button type="button" className="crm-product-delete" disabled={deleting} onClick={() => void remove()}>{deleting ? 'Удаление…' : 'Удалить'}</button>
      </div>
    </div>
    {error && <p role="alert" className="crm-alert">{error}</p>}
    {editing ? <ProductForm product={product} onSaved={(saved) => { setProduct(saved); setEditing(false); }} /> : <>
      <div className="crm-product-detail-grid">
        <ProductImages productId={product.id} images={product.images} onChange={images => setProduct(current => current ? { ...current, images } : current)} />
        <div className="crm-product-detail-side">
          <section className="crm-panel crm-product-facts"><div className="crm-product-section-head"><span className="crm-eyebrow">ОСНОВНОЕ</span><h2>О товаре</h2></div>
            <dl>
              <div><dt>Статус</dt><dd><span className={`crm-status-pill ${product.status === 'ACTIVE' ? 'on' : 'off'}`}>{product.status === 'ACTIVE' ? 'Активен' : 'Неактивен'}</span></dd></div>
              <div><dt>Артикул</dt><dd>{product.sku}</dd></div>
              <div><dt>Бренд</dt><dd>{product.brand?.name ?? '—'}</dd></div>
              <div><dt>Категория</dt><dd>{product.category?.name ?? '—'}</dd></div>
              <div><dt>Единица</dt><dd>{product.unit}</dd></div>
              <div><dt>Штрихкоды</dt><dd>{product.barcodes.map((item) => item.value).join(', ') || '—'}</dd></div>
            </dl>
            {product.description && <div className="crm-product-description"><span>Описание</span><p>{product.description}</p></div>}
          </section>
          <ProductPriceEditor productId={product.id} />
        </div>
      </div>
      <section className="crm-panel crm-product-attributes"><div className="crm-product-section-head"><span className="crm-eyebrow">ХАРАКТЕРИСТИКИ</span><h2>Дополнительные данные</h2></div>
        {filledAttributes.length ? <dl>{filledAttributes.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{product[key]}</dd></div>)}</dl> : <p>Дополнительные характеристики пока не заполнены.</p>}
      </section>
    </>}
  </section>;
}
