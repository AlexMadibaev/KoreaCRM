'use client';

import { useRef, useState } from 'react';
import { api, productImageUrl, type Product } from '../lib/api';
import { ProductImageCropper } from './product-image-cropper';
import { ProductGallery } from './product-gallery';

type ProductImage = Product['images'][number];
const maxBytes = 5_000_000;

export function ProductImages({ productId, images, onChange, readOnly = false }: { productId: string; images: ProductImage[]; onChange: (images: ProductImage[]) => void; readOnly?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<File[]>([]);
  const sorted = [...images].sort((a, b) => a.sortOrder - b.sortOrder);

  function select(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    const selected = Array.from(files);
    if (images.length + selected.length > 20) { setError('У товара может быть не более 20 изображений'); return; }
    if (selected.some(file => file.size > maxBytes || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setError('Выберите JPEG, PNG или WebP размером до 5 МБ'); return; }
    setQueue(selected);
  }

  async function save(blob: Blob) {
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', blob, 'product-photo.png');
      const image = await api<ProductImage>(`/products/${productId}/images`, { method: 'POST', body });
      onChange([...images, image]);
      setQueue(current => current.slice(1));
      if (input.current) input.current.value = '';
    } finally { setBusy(false); }
  }

  async function remove(image: ProductImage) {
    setBusy(true); setError('');
    try {
      await api(`/products/${productId}/images/${image.id}`, { method: 'DELETE' });
      onChange(images.filter(item => item.id !== image.id));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось удалить изображение'); }
    finally { setBusy(false); }
  }

  return <section className="crm-panel crm-product-images">
    <div className="crm-product-section-head"><div><span className="crm-eyebrow">ГАЛЕРЕЯ</span><h2>Фото товара</h2></div><span className="crm-product-image-count">{sorted.length} / 20</span></div>
    <ProductGallery images={sorted.map((image, index) => ({ id: image.id, src: productImageUrl(image.storageKey), alt: `Фото товара ${index + 1}` }))} empty={<div className="crm-product-image-empty"><span aria-hidden="true">◇</span><strong>Добавьте фото товара</strong><small>Первое фото появится в каталоге и кассе</small></div>} onRemove={readOnly ? undefined : imageId => { const image = sorted.find(item => item.id === imageId); if (image) void remove(image); }} disabled={busy} />
    {!readOnly && <div className="crm-product-image-toolbar"><p>JPEG, PNG или WebP до 5 МБ · кадрирование 360 × 360</p><label className="crm-outline-button crm-product-upload">{busy ? 'Загрузка…' : '＋ Добавить фото'}<input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || queue.length > 0 || images.length >= 20} onChange={event => select(event.target.files)} /></label></div>}
    {error && <p role="alert" className="crm-alert">{error}</p>}
    {queue[0] && <ProductImageCropper key={queue[0].name + queue[0].lastModified} file={queue[0]} busy={busy} onSave={save} onCancel={() => { setQueue([]); if (input.current) input.current.value = ''; }} />}
  </section>;
}
