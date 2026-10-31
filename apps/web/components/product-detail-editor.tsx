'use client';

import { useEffect, useRef, useState } from 'react';
import { MoneyInput, formatCurrencyMinor } from '@koreacrm/ui';
import { api, productImageUrl, type Brand, type Category, type Page, type Product } from '../lib/api';
import { ProductImageCropper } from './product-image-cropper';
import { ProductGallery } from './product-gallery';

const fieldLabels = {
  name: 'Название', sku: 'Артикул', unit: 'Единица', description: 'Описание', country: 'Страна',
  shade: 'Оттенок', volume: 'Объём', weight: 'Вес', line: 'Линейка', collection: 'Коллекция',
  gender: 'Пол', skinType: 'Тип кожи', productType: 'Тип товара',
} as const;
type Field = keyof typeof fieldLabels;
type Store = { id: string; name: string };
type PendingImage = { id: string; blob: Blob; url: string };
const fields = Object.keys(fieldLabels) as Field[];
const maxBytes = 5_000_000;

export function ProductDetailEditor({ product, onSaved, onCancel }: { product: Product; onSaved: (product: Product) => void; onCancel: () => void }) {
  const [values, setValues] = useState<Record<Field, string>>(() => Object.fromEntries(fields.map(key => [key, String(product[key] ?? '')])) as Record<Field, string>);
  const [brandId, setBrandId] = useState(product.brandId ?? '');
  const [categoryId, setCategoryId] = useState(product.categoryId ?? '');
  const [status, setStatus] = useState(product.status);
  const [barcodes, setBarcodes] = useState(product.barcodes.map(item => item.value).join('\n'));
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [savedPrices, setSavedPrices] = useState<Record<string, number | null>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [priceLoading, setPriceLoading] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const pendingRef = useRef<PendingImage[]>([]);
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [imageQueue, setImageQueue] = useState<File[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const completedRemovals = useRef(new Set<string>());
  const completedAdds = useRef(new Set<string>());
  const completedPrices = useRef(new Set<string>());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api<Page<Brand>>('/brands?limit=100'), api<Page<Category>>('/categories?limit=100'), api<Store[]>('/stores')])
      .then(([brandPage, categoryPage, storeList]) => { setBrands(brandPage.items); setCategories(categoryPage.items); setStores(storeList); setStoreId(storeList[0]?.id ?? ''); })
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить справочники'));
  }, []);

  useEffect(() => {
    if (!storeId || Object.hasOwn(savedPrices, storeId)) return;
    let active = true;
    setPriceLoading(true);
    api<{ priceMinor: number | null } | null>(`/stores/${storeId}/products/${product.id}/settings`)
      .then(settings => { if (active) {
        const price = settings?.priceMinor ?? null;
        setSavedPrices(current => ({ ...current, [storeId]: price }));
        setPriceDrafts(current => ({ ...current, [storeId]: price === null ? '' : String(price) }));
      } })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить цену'); })
      .finally(() => { if (active) setPriceLoading(false); });
    return () => { active = false; };
  }, [storeId, product.id, savedPrices]);

  useEffect(() => { pendingRef.current = pendingImages; }, [pendingImages]);
  useEffect(() => () => { pendingRef.current.forEach(item => URL.revokeObjectURL(item.url)); }, []);

  const changedFields = fields.filter(key => values[key].trim() !== String(product[key] ?? ''));
  const cleanBarcodes = barcodes.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const oldBarcodes = product.barcodes.map(item => item.value);
  const changedPrices = stores.filter(store => Object.hasOwn(savedPrices, store.id) && priceDrafts[store.id] !== (savedPrices[store.id] === null ? '' : String(savedPrices[store.id])));
  const changes = [
    ...changedFields.map(key => fieldLabels[key]),
    ...(brandId !== (product.brandId ?? '') ? ['Бренд'] : []),
    ...(categoryId !== (product.categoryId ?? '') ? ['Категория'] : []),
    ...(status !== product.status ? ['Статус'] : []),
    ...(JSON.stringify(cleanBarcodes) !== JSON.stringify(oldBarcodes) ? ['Штрихкоды'] : []),
    ...changedPrices.map(store => `Цена · ${store.name}`),
    ...(pendingImages.length ? [`Новые фото · ${pendingImages.length}`] : []),
    ...(removedImages.length ? [`Удалить фото · ${removedImages.length}`] : []),
  ];
  const changeRows = [
    ...changedFields.map(key => ({ label: fieldLabels[key], before: String(product[key] ?? '—'), after: values[key].trim() || '—' })),
    ...(brandId !== (product.brandId ?? '') ? [{ label: 'Бренд', before: product.brand?.name ?? '—', after: brands.find(item => item.id === brandId)?.name ?? '—' }] : []),
    ...(categoryId !== (product.categoryId ?? '') ? [{ label: 'Категория', before: product.category?.name ?? '—', after: categories.find(item => item.id === categoryId)?.name ?? '—' }] : []),
    ...(status !== product.status ? [{ label: 'Статус', before: product.status === 'ACTIVE' ? 'Активен' : 'Неактивен', after: status === 'ACTIVE' ? 'Активен' : 'Неактивен' }] : []),
    ...(JSON.stringify(cleanBarcodes) !== JSON.stringify(oldBarcodes) ? [{ label: 'Штрихкоды', before: oldBarcodes.join(', ') || '—', after: cleanBarcodes.join(', ') || '—' }] : []),
    ...changedPrices.map(store => ({ label: `Цена · ${store.name}`, before: savedPrices[store.id] === null ? '—' : formatCurrencyMinor(String(savedPrices[store.id])), after: priceDrafts[store.id] ? formatCurrencyMinor(priceDrafts[store.id]) : '—' })),
    ...(pendingImages.length || removedImages.length ? [{ label: 'Фотографии', before: `${product.images.length} шт.`, after: `${product.images.length - removedImages.length + pendingImages.length} шт.` }] : []),
  ];
  const productChanged = changedFields.length > 0 || brandId !== (product.brandId ?? '') || categoryId !== (product.categoryId ?? '') || status !== product.status || JSON.stringify(cleanBarcodes) !== JSON.stringify(oldBarcodes);
  const visibleImages = product.images.filter(image => !removedImages.includes(image.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  const galleryImages = [
    ...visibleImages.map((image, index) => ({ id: image.id, src: productImageUrl(image.storageKey), alt: `Фото товара ${index + 1}` })),
    ...pendingImages.map((image, index) => ({ id: image.id, src: image.url, alt: `Новое фото товара ${index + 1}`, pending: true })),
  ];

  function removeImage(imageId: string) {
    const pending = pendingImages.find(image => image.id === imageId);
    if (pending) {
      setPendingImages(current => current.filter(image => image.id !== imageId));
      URL.revokeObjectURL(pending.url);
    } else setRemovedImages(current => [...current, imageId]);
  }

  function selectImages(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    if (visibleImages.length + pendingImages.length + selected.length > 20) { setError('У товара может быть не более 20 фото'); return; }
    if (selected.some(file => file.size > maxBytes || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setError('Выберите JPEG, PNG или WebP до 5 МБ'); return; }
    setError(''); setImageQueue(selected);
  }

  async function stageImage(blob: Blob) {
    const item = { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) };
    setPendingImages(current => [...current, item]);
    setImageQueue(current => current.slice(1));
    if (input.current) input.current.value = '';
  }

  async function save() {
    if (!changes.length || saving) return;
    if (!values.name.trim() || !values.sku.trim() || !values.unit.trim()) { setError('Укажите название, артикул и единицу товара'); return; }
    for (const store of changedPrices) {
      const value = Number(priceDrafts[store.id]);
      if (!priceDrafts[store.id] || !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) { setError(`Укажите корректную цену для магазина «${store.name}»`); return; }
    }
    setSaving(true); setError('');
    try {
      if (productChanged) {
        const body: Record<string, unknown> = Object.fromEntries(changedFields.map(key => [key, values[key].trim() || (['name', 'sku', 'unit'].includes(key) ? '' : null)]));
        if (brandId !== (product.brandId ?? '')) body.brandId = brandId || null;
        if (categoryId !== (product.categoryId ?? '')) body.categoryId = categoryId || null;
        if (status !== product.status) body.status = status;
        if (JSON.stringify(cleanBarcodes) !== JSON.stringify(oldBarcodes)) body.barcodes = cleanBarcodes;
        await api<Product>(`/products/${product.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      }
      for (const store of changedPrices) {
        const priceKey = `${store.id}:${priceDrafts[store.id]}`;
        if (completedPrices.current.has(priceKey)) continue;
        await api(`/stores/${store.id}/products/${product.id}/settings`, { method: 'PATCH', body: JSON.stringify({ priceMinor: Number(priceDrafts[store.id]), active: true }) });
        completedPrices.current.add(priceKey);
      }
      for (const imageId of removedImages) {
        if (completedRemovals.current.has(imageId)) continue;
        await api(`/products/${product.id}/images/${imageId}`, { method: 'DELETE' });
        completedRemovals.current.add(imageId);
      }
      for (const item of pendingImages) {
        if (completedAdds.current.has(item.id)) continue;
        const body = new FormData(); body.append('file', item.blob, 'product-photo.png');
        await api(`/products/${product.id}/images`, { method: 'POST', body });
        completedAdds.current.add(item.id);
      }
      const saved = await api<Product>(`/products/${product.id}`);
      onSaved(saved);
    } catch (caught) { setError(`${caught instanceof Error ? caught.message : 'Не удалось сохранить изменения'}. Уже выполненные шаги сохранены; повторите сохранение.`); }
    finally { setSaving(false); }
  }

  return <div className="crm-product-edit-layout">
    <div className="crm-product-detail-grid">
      <section className="crm-panel crm-product-images crm-product-edit-gallery">
        <div className="crm-product-section-head"><span className="crm-eyebrow">ГАЛЕРЕЯ</span><h2>Фото товара</h2><p>Фото появятся в карточке после сохранения изменений.</p></div>
        <span className="crm-product-image-count">{visibleImages.length + pendingImages.length} / 20</span>
        <ProductGallery images={galleryImages} empty={<div className="crm-product-image-empty">Добавьте фото товара</div>} onRemove={removeImage} disabled={saving} />
        <div className="crm-product-image-toolbar"><p>Квадрат 360 × 360 · WebP после сохранения</p><label className="crm-outline-button crm-product-upload">＋ Добавить фото<input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={saving || imageQueue.length > 0 || visibleImages.length + pendingImages.length >= 20} onChange={event => selectImages(event.target.files)} /></label></div>
      </section>
      <div className="crm-product-detail-side">
        <section className="crm-panel crm-product-edit-section"><div className="crm-product-section-head"><span className="crm-eyebrow">ОСНОВНОЕ</span><h2>О товаре</h2></div><div className="crm-product-form-grid">
          {(['name', 'sku', 'unit'] as Field[]).map(key => <label key={key}>{fieldLabels[key]}<input value={values[key]} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} disabled={saving} required /></label>)}
          <label>Бренд<select value={brandId} onChange={event => setBrandId(event.target.value)} disabled={saving}><option value="">Без бренда</option>{brands.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Категория<select value={categoryId} onChange={event => setCategoryId(event.target.value)} disabled={saving}><option value="">Без категории</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Статус<select value={status} onChange={event => setStatus(event.target.value as Product['status'])} disabled={saving}><option value="ACTIVE">Активен</option><option value="INACTIVE">Неактивен</option></select></label>
          <label className="crm-product-form-wide">Описание<textarea rows={3} value={values.description} onChange={event => setValues(current => ({ ...current, description: event.target.value }))} disabled={saving} /></label>
          <label className="crm-product-form-wide">Штрихкоды, по одному в строке<textarea rows={2} value={barcodes} onChange={event => setBarcodes(event.target.value)} disabled={saving} /></label>
        </div></section>
        <section className="crm-panel crm-product-price crm-product-edit-section"><div className="crm-product-section-head"><span className="crm-eyebrow">ПРОДАЖИ</span><h2>Цена продажи</h2><p>Цена задаётся отдельно для каждого магазина.</p></div>
          <div className="crm-product-edit-price"><label>Магазин<select value={storeId} onChange={event => setStoreId(event.target.value)} disabled={saving || !stores.length}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
          <label>Новая цена, сомони<MoneyInput aria-label="Новая цена, сомони" valueMinor={priceDrafts[storeId] ?? ''} onMinorChange={value => setPriceDrafts(current => ({ ...current, [storeId]: value }))} disabled={saving || priceLoading || !storeId} placeholder="0,00" /></label></div>
          {storeId && Object.hasOwn(savedPrices, storeId) && <p className="crm-product-price-caption">Сейчас: {savedPrices[storeId] === null ? 'цена не установлена' : formatCurrencyMinor(String(savedPrices[storeId]))}</p>}
        </section>
      </div>
    </div>
    <section className="crm-panel crm-product-edit-section"><div className="crm-product-section-head"><span className="crm-eyebrow">ХАРАКТЕРИСТИКИ</span><h2>Дополнительные данные</h2></div><div className="crm-product-form-grid">{fields.filter(key => !['name', 'sku', 'unit', 'description'].includes(key)).map(key => <label key={key}>{fieldLabels[key]}<input value={values[key]} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} disabled={saving} /></label>)}</div></section>
    {changeRows.length > 0 && <section className="crm-panel crm-product-change-preview"><div className="crm-product-section-head"><span className="crm-eyebrow">ПЕРЕД СОХРАНЕНИЕМ</span><h2>Что изменится</h2></div><div className="crm-product-change-grid">{changeRows.map(row => <div key={row.label}><strong>{row.label}</strong><span>{row.before}</span><span aria-hidden="true">→</span><b>{row.after}</b></div>)}</div></section>}
    <div className="crm-product-save-bar"><div><strong>{changes.length ? `Изменений: ${changes.length}` : 'Изменений пока нет'}</strong><p>{changes.length ? changes.join(' · ') : 'Измените поля, цену или фотографии — здесь появится список изменений.'}</p></div><div><button type="button" className="crm-outline-button" disabled={saving} onClick={onCancel}>Отмена</button><button type="button" className="crm-primary-button" disabled={saving || !changes.length || imageQueue.length > 0} onClick={() => void save()}>{saving ? 'Сохраняем…' : 'Сохранить изменения'}</button></div></div>
    {error && <p role="alert" className="crm-alert">{error}</p>}
    {imageQueue[0] && <ProductImageCropper key={imageQueue[0].name + imageQueue[0].lastModified} file={imageQueue[0]} busy={false} onSave={stageImage} onCancel={() => { setImageQueue([]); if (input.current) input.current.value = ''; }} />}
  </div>;
}
