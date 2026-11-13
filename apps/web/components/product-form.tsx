'use client';

import { BarcodeField } from './barcode-field';
import { FormEvent, useEffect, useState } from 'react';
import { api, type Brand, type Category, type Page, type Product } from '../lib/api';

type Values = Record<string, string>;
const labels: Record<string, string> = {
  name: 'Название', sku: 'Артикул', description: 'Описание', country: 'Страна', unit: 'Единица',
  shade: 'Оттенок', volume: 'Объём', weight: 'Вес', line: 'Линейка', collection: 'Коллекция',
  gender: 'Пол', skinType: 'Тип кожи', productType: 'Тип товара',
};
const fields = Object.keys(labels);

export type ProductDraft = Partial<Pick<Product, 'name' | 'sku' | 'description' | 'unit'>> & { barcodes?: string[] };

function initialValues(product?: Partial<Omit<Product, 'barcodes'>>): Values {
  return Object.fromEntries(fields.map((key) => [key, product?.[key as keyof Omit<Product, 'barcodes'>] ?? (key === 'unit' ? 'pcs' : '')])) as Values;
}

export function ProductForm({ product, initialDraft, onSaved, onSavingChange }: { product?: Product; initialDraft?: ProductDraft; onSaved: (product: Product) => void; onSavingChange?: (saving: boolean) => void }) {
  const [values, setValues] = useState<Values>(() => initialValues(product ?? initialDraft));
  const [brandId, setBrandId] = useState(product?.brandId ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [status, setStatus] = useState(product?.status ?? 'ACTIVE');
  const [barcodes, setBarcodes] = useState(product?.barcodes.map((item) => item.value) ?? initialDraft?.barcodes ?? []);
  const [barcodeDraft, setBarcodeDraft] = useState('');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api<Page<Brand>>('/brands?limit=100'), api<Page<Category>>('/categories?limit=100')])
      .then(([brandPage, categoryPage]) => { setBrands(brandPage.items); setCategories(categoryPage.items); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить справочники'));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const codes = [...new Set([...barcodes, barcodeDraft].filter(Boolean))];
    if (codes.length > 30) { setError('Можно добавить до 30 штрихкодов.'); return; }
    setSaving(true); onSavingChange?.(true); setError('');
    try {
      const body = {
        ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim() || (['name', 'sku', 'unit'].includes(key) ? '' : null)])),
        brandId: brandId || null, categoryId: categoryId || null, status,
        barcodes: codes,
      };
      const saved = await api<Product>(product ? `/products/${product.id}` : '/products', { method: product ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      onSaved(saved);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить товар'); }
    finally { setSaving(false); onSavingChange?.(false); }
  }

  return <form onSubmit={submit} className="crm-product-form">
    <section className="crm-panel"><div className="crm-product-section-head"><span className="crm-eyebrow">ОСНОВНОЕ</span><h2>Данные товара</h2><p>Название и артикул помогают найти товар в каталоге и кассе.</p></div>
      <div className="crm-product-form-grid">
        {(['name', 'sku', 'unit'] as const).map(key => <label key={key}>{labels[key]}<input value={values[key]} onChange={event => setValues({ ...values, [key]: event.target.value })} required /></label>)}
        <label>Бренд<select value={brandId} onChange={event => setBrandId(event.target.value)}><option value="">Без бренда</option>{brands.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Категория<select value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">Без категории</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Статус<select value={status} onChange={event => setStatus(event.target.value as 'ACTIVE' | 'INACTIVE')}><option value="ACTIVE">Активен</option><option value="INACTIVE">Неактивен</option></select></label>
        <label className="crm-product-form-wide">Описание<textarea rows={3} value={values.description} onChange={event => setValues({ ...values, description: event.target.value })} /></label>
      </div>
    </section>
    <section className="crm-panel"><div className="crm-product-section-head"><span className="crm-eyebrow">ИДЕНТИФИКАЦИЯ</span><h2>Штрихкоды</h2></div>
      <BarcodeField barcodes={barcodes} draft={barcodeDraft} onDraftChange={setBarcodeDraft} onChange={setBarcodes} disabled={saving} />
    </section>
    <section className="crm-panel"><div className="crm-product-section-head"><span className="crm-eyebrow">ХАРАКТЕРИСТИКИ</span><h2>Дополнительные данные</h2><p>Заполняйте только те поля, которые нужны для этого товара.</p></div>
      <div className="crm-product-form-grid">{fields.filter(key => !['name', 'sku', 'unit', 'description'].includes(key)).map(key => <label key={key}>{labels[key]}<input value={values[key]} onChange={event => setValues({ ...values, [key]: event.target.value })} /></label>)}</div>
    </section>
    {error && <p role="alert" className="crm-alert">{error}</p>}
    <div className="crm-product-form-footer"><button className="ks-button ks-button--primary crm-primary-button" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить товар'}</button></div>
  </form>;
}
