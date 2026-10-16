'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { MoneyInput, formatCurrencyMinor } from '@koreacrm/ui';
import { api } from '../lib/api';

type Store = { id: string; name: string };
type Settings = { priceMinor: number | null; active: boolean } | null;

export function ProductPriceEditor({ productId }: { productId: string }) {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [priceMinor, setPriceMinor] = useState('');
  const [savedPrice, setSavedPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api<Store[]>('/stores').then(items => { setStores(items); setStoreId(items[0]?.id ?? ''); })
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить магазины'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    setLoading(true); setError(''); setNotice(''); setPriceMinor(''); setSavedPrice(null);
    api<Settings>(`/stores/${storeId}/products/${productId}/settings`)
      .then(settings => { if (active) { setSavedPrice(settings?.priceMinor ?? null); setPriceMinor(settings?.priceMinor == null ? '' : String(settings.priceMinor)); } })
      .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить цену'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId, storeId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const value = Number(priceMinor);
    if (!priceMinor || !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
      setError('Укажите цену от 0 до 21 474 836,47 сум'); return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      const settings = await api<Settings>(`/stores/${storeId}/products/${productId}/settings`, { method: 'PATCH', body: JSON.stringify({ priceMinor: value, active: true }) });
      setSavedPrice(settings?.priceMinor ?? value);
      setNotice('Цена сохранена. Товар теперь доступен в кассе при наличии остатка.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить цену'); }
    finally { setSaving(false); }
  }

  return <section className="space-y-3 rounded-lg border bg-white p-5">
    <div><h2 className="text-lg font-semibold">Цена продажи</h2><p className="text-sm text-slate-500">Цена задаётся отдельно для каждого магазина. Без неё товар нельзя добавить в чек.</p></div>
    <form onSubmit={save} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Магазин<select className="mt-1 block min-w-48 rounded border p-2" value={storeId} onChange={event => setStoreId(event.target.value)} disabled={saving || !stores.length}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
      <label className="text-sm">Цена, сум<MoneyInput aria-label="Цена продажи, сум" className="mt-1 block w-44 rounded border p-2" valueMinor={priceMinor} onMinorChange={setPriceMinor} placeholder="0,00" disabled={loading || saving || !storeId} required /></label>
      <button className="rounded bg-violet-700 px-4 py-2 text-white disabled:opacity-50" disabled={loading || saving || !storeId || !priceMinor}>{saving ? 'Сохранение…' : 'Сохранить цену'}</button>
    </form>
    {storeId && !loading && <p className="text-sm text-slate-600">Текущая цена: {savedPrice === null ? 'не установлена' : formatCurrencyMinor(String(savedPrice))}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
  </section>;
}
