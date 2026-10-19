'use client';

import { useRef, useState } from 'react';
import { api, productImageUrl, type Product } from '../lib/api';

type ProductImage = Product['images'][number];
const maxBytes = 5_000_000;

export function ProductImages({ productId, images, onChange }: { productId: string; images: ProductImage[]; onChange: (images: ProductImage[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sorted = [...images].sort((a, b) => a.sortOrder - b.sortOrder);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    const selected = Array.from(files);
    if (images.length + selected.length > 20) { setError('У товара может быть не более 20 изображений'); return; }
    if (selected.some(file => file.size > maxBytes || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setError('Выберите JPEG, PNG или WebP размером до 5 МБ'); return; }
    setBusy(true);
    const next = [...images];
    try {
      for (const file of selected) {
        const body = new FormData(); body.append('file', file);
        const image = await api<ProductImage>(`/products/${productId}/images`, { method: 'POST', body });
        next.push(image);
        onChange([...next]);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить изображение'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  async function remove(image: ProductImage) {
    setBusy(true); setError('');
    try {
      await api(`/products/${productId}/images/${image.id}`, { method: 'DELETE' });
      onChange(images.filter(item => item.id !== image.id));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось удалить изображение'); }
    finally { setBusy(false); }
  }

  return <section className="space-y-4 rounded-lg border bg-white p-5">
    <div><h2 className="text-lg font-semibold">Фото товара</h2><p className="text-sm text-slate-500">До 20 фото. JPEG, PNG или WebP, каждое до 5 МБ. Первое фото показывается в каталоге.</p></div>
    <label className="inline-flex cursor-pointer rounded border px-4 py-2 text-sm font-medium">{busy ? 'Загрузка…' : 'Добавить фото'}<input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || images.length >= 20} onChange={event => void add(event.target.files)} /></label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {sorted.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{sorted.map((image, index) => <div key={image.id} className="overflow-hidden rounded-lg border"><img className="aspect-square w-full object-cover" src={productImageUrl(image.storageKey)} alt={`Фото товара ${index + 1}`} /><div className="flex items-center justify-between gap-2 p-2 text-xs"><span>{index === 0 ? 'Главное фото' : `Фото ${index + 1}`}</span><button type="button" className="text-red-700 underline disabled:opacity-50" disabled={busy} onClick={() => void remove(image)} aria-label={`Удалить фото ${index + 1}`}>Удалить</button></div></div>)}</div> : <p className="text-sm text-slate-500">Фото пока нет</p>}
  </section>;
}
