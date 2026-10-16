'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ProductForm } from '../../../components/product-form';
import { ProductPriceEditor } from '../../../components/product-price-editor';
import { api, type Product } from '../../../lib/api';

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
  if (loading) return <p>Загрузка…</p>;
  if (!product) return <p role="alert" className="text-red-700">{error || 'Товар не найден'}</p>;
  return <section className="space-y-5">
    <Link href="/products" className="text-sm underline">← К товарам</Link>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{product.name}</h1><div className="flex gap-2"><button className="rounded border px-4 py-2" onClick={() => setEditing(!editing)}>{editing ? 'Отмена' : 'Изменить'}</button><button className="rounded border border-red-300 px-4 py-2 text-red-700 disabled:opacity-50" disabled={deleting} onClick={() => void remove()}>{deleting ? 'Удаление…' : 'Удалить'}</button></div></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {editing ? <ProductForm product={product} onSaved={(saved) => { setProduct(saved); setEditing(false); }} /> : <dl className="grid gap-4 rounded-lg border bg-white p-5 md:grid-cols-2">
      <div><dt className="text-sm text-slate-500">SKU</dt><dd>{product.sku}</dd></div><div><dt className="text-sm text-slate-500">Статус</dt><dd>{product.status === 'ACTIVE' ? 'Активен' : 'Неактивен'}</dd></div>
      <div><dt className="text-sm text-slate-500">Бренд</dt><dd>{product.brand?.name ?? '—'}</dd></div><div><dt className="text-sm text-slate-500">Категория</dt><dd>{product.category?.name ?? '—'}</dd></div>
      <div><dt className="text-sm text-slate-500">Штрихкоды</dt><dd>{product.barcodes.map((item) => item.value).join(', ') || '—'}</dd></div><div><dt className="text-sm text-slate-500">Единица</dt><dd>{product.unit}</dd></div>
      <div className="md:col-span-2"><dt className="text-sm text-slate-500">Описание</dt><dd>{product.description || '—'}</dd></div>
      {([['country', 'Страна'], ['shade', 'Оттенок'], ['volume', 'Объём'], ['weight', 'Вес'], ['line', 'Линейка'], ['collection', 'Коллекция'], ['gender', 'Пол'], ['skinType', 'Тип кожи'], ['productType', 'Тип товара']] as const).map(([key, label]) => <div key={key}><dt className="text-sm text-slate-500">{label}</dt><dd>{product[key] || '—'}</dd></div>)}
    </dl>}
    <ProductPriceEditor productId={product.id} />
  </section>;
}
