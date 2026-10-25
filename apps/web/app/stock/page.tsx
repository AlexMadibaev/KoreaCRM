'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CatalogShell } from '../../components/catalog-shell';
import { api, queryString, type Page } from '../../lib/api';

type Store = { id: string; name: string; code: string };
type StockItem = { productId: string; name: string; sku: string; quantity: number; reservedQuantity: number; minStock: number; negative: boolean; low: boolean };
type Movement = { id: string; productId: string; type: string; quantity: number; previousQuantity: number; newQuantity: number; sourceType: string; sourceId: string; comment: string | null; createdAt: string; product: { name: string; sku: string } };
type Filter = 'all' | 'low' | 'negative' | 'zero';

export default function StockPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [canAdjust, setCanAdjust] = useState(false);
  const [canEditSettings, setCanEditSettings] = useState(false);
  const [items, setItems] = useState<StockItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<StockItem | null>(null);
  const [minimum, setMinimum] = useState('0');
  const [savingMinimum, setSavingMinimum] = useState(false);
  const [targetQuantity, setTargetQuantity] = useState('');
  const [type, setType] = useState<'CORRECTION' | 'INVENTORY'>('CORRECTION');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [writeOffQuantity, setWriteOffQuantity] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');
  const [writeOffOperationId, setWriteOffOperationId] = useState(() => crypto.randomUUID());
  const [writingOff, setWritingOff] = useState(false);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    Promise.all([api<Store[]>('/stores'), api<{ permissions: string[] }>('/auth/me')])
      .then(([available, user]) => { const params = new URLSearchParams(window.location.search); const selectedStore = available.find(store => store.id === params.get('storeId')); const selectedFilter = params.get('filter'); setStores(available); setStoreId(selectedStore?.id ?? available[0]?.id ?? ''); if (selectedFilter === 'low' || selectedFilter === 'negative' || selectedFilter === 'zero') setFilter(selectedFilter); setCanAdjust(user.permissions.includes('inventory.adjust')); setCanEditSettings(user.permissions.includes('products.edit')); })
      .catch((caught) => { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить магазины'); setLoading(false); });
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => setAppliedSearch(search), 300); return () => window.clearTimeout(timer); }, [search]);

  const load = useCallback(async () => {
    if (!storeId) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const result = await api<Page<StockItem>>(`/stores/${storeId}/stock?${queryString({ page, limit: 20, search: appliedSearch, filter })}`);
      setItems(result.items); setTotal(result.total);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить остатки'); }
    finally { setLoading(false); }
  }, [storeId, page, appliedSearch, filter]);
  useEffect(() => { void load(); }, [load]);

  const loadHistory = useCallback(async () => {
    if (!storeId || !selected) return;
    setHistoryLoading(true);
    try {
      const result = await api<Page<Movement>>(`/stores/${storeId}/stock/movements?${queryString({ productId: selected.productId, page: historyPage, limit: 10 })}`);
      setMovements(result.items); setHistoryTotal(result.total);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить историю'); }
    finally { setHistoryLoading(false); }
  }, [storeId, selected, historyPage]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function adjust(event: FormEvent) {
    event.preventDefault();
    if (!storeId || !selected) return;
    const quantity = Number(targetQuantity);
    const delta = quantity - selected.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 0 || delta === 0) { setError('Укажите новое количество, отличающееся от текущего'); return; }
    setSaving(true); setError('');
    try {
      await api(`/stores/${storeId}/stock/adjustments`, { method: 'POST', body: JSON.stringify({ productId: selected.productId, type, delta, comment }) });
      setSelected({ ...selected, quantity, low: quantity <= selected.minStock, negative: false });
      setTargetQuantity(String(quantity)); setComment(''); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось изменить остаток'); }
    finally { setSaving(false); }
  }

  async function saveMinimum(event: FormEvent) {
    event.preventDefault();
    if (!storeId || !selected) return;
    setSavingMinimum(true); setError('');
    try {
      await api(`/stores/${storeId}/products/${selected.productId}/settings`, { method: 'PATCH', body: JSON.stringify({ minStock: Number(minimum) }) });
      setSelected({ ...selected, minStock: Number(minimum) });
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось изменить минимум'); }
    finally { setSavingMinimum(false); }
  }

  async function writeOff(event: FormEvent) {
    event.preventDefault();
    if (!storeId || !selected) return;
    const quantity = Number(writeOffQuantity);
    const available = Math.max(0, selected.quantity - selected.reservedQuantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > available) { setError(`Можно списать от 1 до ${available} шт.`); return; }
    if (writeOffReason.trim().length < 3) { setError('Укажите причину списания не короче 3 символов'); return; }
    setWritingOff(true); setError('');
    try {
      await api(`/stores/${storeId}/stock/write-offs`, { method: 'POST', body: JSON.stringify({ operationId: writeOffOperationId, productId: selected.productId, quantity, comment: writeOffReason.trim() }) });
      const remaining = selected.quantity - quantity;
      setSelected({ ...selected, quantity: remaining, low: remaining <= selected.minStock, negative: false });
      setTargetQuantity(String(remaining)); setWriteOffQuantity(''); setWriteOffReason(''); setWriteOffOperationId(crypto.randomUUID());
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось списать товар'); }
    finally { setWritingOff(false); }
  }

  function openStock(item: StockItem) {
    setSelected(item); setMinimum(String(item.minStock)); setTargetQuantity(String(item.quantity)); setWriteOffQuantity(''); setWriteOffReason(''); setWriteOffOperationId(crypto.randomUUID()); setHistoryPage(1);
    window.setTimeout(() => document.getElementById('stock-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  return <CatalogShell><section className="crm-workspace-page crm-stock-page space-y-6">
    <div className="crm-page-head"><div><span className="crm-eyebrow">УЧЁТ ТОВАРОВ</span><h1>Остатки</h1><p>Выберите товар, чтобы указать фактическое количество и посмотреть историю.</p></div></div>
    <div className="crm-filter-card grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-3">
      <label className="text-sm">Магазин<select className="mt-1 w-full rounded border p-2" value={storeId} onChange={(event) => { setStoreId(event.target.value); setSelected(null); setPage(1); }}><option value="">Выберите магазин</option>{stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-sm">Товар, SKU или штрихкод<input type="search" enterKeyHint="search" autoComplete="off" className="mt-1 w-full rounded border p-2" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
      <label className="text-sm">Состояние<select className="mt-1 w-full rounded border p-2" value={filter} onChange={(event) => { setFilter(event.target.value as Filter); setPage(1); }}><option value="all">Все</option><option value="low">На уровне минимума или ниже</option><option value="zero">Нулевой остаток</option><option value="negative">Отрицательный остаток</option></select></label>
    </div>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
    {loading ? <p>Загрузка…</p> : <div className="overflow-x-auto rounded-lg border bg-white"><table className="crm-mobile-cards w-full text-left text-sm"><thead className="bg-slate-100"><tr><th className="p-3">Товар</th><th className="p-3">SKU</th><th className="p-3">Остаток</th><th className="p-3">Резерв</th><th className="p-3">Минимум</th><th className="p-3">Состояние</th><th className="p-3">Действие</th></tr></thead><tbody>{items.map((item) => <tr key={item.productId} className="border-t"><td className="p-3 font-semibold">{item.name}</td><td data-label="SKU" className="p-3">{item.sku}</td><td data-label="Остаток" className="p-3 font-medium">{item.quantity}</td><td data-label="Резерв" className="p-3">{item.reservedQuantity}</td><td data-label="Минимум" className="p-3">{item.minStock}</td><td data-label="Состояние" className={`p-3 ${item.negative ? 'text-red-700' : item.low || item.quantity === 0 ? 'text-amber-700' : 'text-green-700'}`}>{item.negative ? 'Отрицательный' : item.quantity === 0 ? 'Нет в наличии' : item.low ? 'Ниже минимума' : 'Норма'}</td><td className="p-3"><button className="crm-stock-action" onClick={() => openStock(item)}>{canAdjust ? 'Указать остаток' : 'История'}</button></td></tr>)}</tbody></table>{items.length === 0 && <p className="p-5 text-slate-500">Товары не найдены</p>}</div>}
    <div className="flex flex-wrap items-center gap-3"><button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page === 1} onClick={() => setPage(page - 1)}>Назад</button><span>Страница {page} · всего {total}</span><button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Далее</button></div>
    {selected && <section className="space-y-4 rounded-lg border bg-white p-5" id="stock-editor"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-xl font-semibold">{selected.name}</h2><p className="text-sm text-slate-500">Сейчас в магазине: {selected.quantity} шт. · SKU {selected.sku}</p></div><button className="text-sm underline" onClick={() => setSelected(null)}>Закрыть</button></div>
      {canEditSettings && <form onSubmit={saveMinimum} className="flex flex-wrap items-end gap-3 border-b pb-5"><label className="text-sm">Минимальный остаток<input className="mt-1 block w-40 rounded border p-2" type="number" inputMode="numeric" min="0" max="2147483647" step="1" required value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label><button disabled={savingMinimum} className="rounded border px-4 py-2 disabled:opacity-50">{savingMinimum ? 'Сохранение…' : 'Сохранить минимум'}</button></form>}
      {canAdjust && <form onSubmit={adjust} className="grid gap-3 border-b pb-5 md:grid-cols-4"><label className="text-sm">Операция<select className="mt-1 w-full rounded border p-2" value={type} onChange={(event) => setType(event.target.value as 'CORRECTION' | 'INVENTORY')}><option value="CORRECTION">Корректировка</option><option value="INVENTORY">Инвентаризация</option></select></label><label className="text-sm">Новое количество, шт.<input className="mt-1 w-full rounded border p-2" type="number" inputMode="numeric" min="0" max="2147483647" step="1" required value={targetQuantity} onChange={(event) => setTargetQuantity(event.target.value)} /></label><label className="text-sm">Причина изменения<input className="mt-1 w-full rounded border p-2" required minLength={3} maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Например, поступление товара" /></label><div className="flex items-end"><button disabled={saving || targetQuantity === String(selected.quantity)} className="rounded bg-violet-700 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Сохранение…' : 'Сохранить остаток'}</button></div></form>}
      {canAdjust && <form onSubmit={writeOff} className="grid gap-3 border-b pb-5 md:grid-cols-4"><div className="md:col-span-4"><h3 className="font-semibold">Списание товара</h3><p className="text-sm text-slate-500">Доступно для списания: {Math.max(0, selected.quantity - selected.reservedQuantity)} шт. После сохранения операция появится в истории движений.</p></div><label className="text-sm">Количество, шт.<input aria-label="Количество для списания" className="mt-1 w-full rounded border p-2" type="number" inputMode="numeric" min="1" max={Math.max(0, selected.quantity - selected.reservedQuantity)} step="1" required value={writeOffQuantity} onChange={event => setWriteOffQuantity(event.target.value)} disabled={writingOff || selected.quantity <= selected.reservedQuantity} /></label><label className="text-sm md:col-span-2">Причина списания<input aria-label="Причина списания" className="mt-1 w-full rounded border p-2" required minLength={3} maxLength={1000} value={writeOffReason} onChange={event => setWriteOffReason(event.target.value)} placeholder="Например, повреждена упаковка" disabled={writingOff || selected.quantity <= selected.reservedQuantity} /></label><div className="flex items-end"><button disabled={writingOff || !writeOffQuantity || !writeOffReason.trim() || selected.quantity <= selected.reservedQuantity} className="rounded bg-amber-700 px-4 py-2 text-white disabled:opacity-50">{writingOff ? 'Списываем…' : 'Списать товар'}</button></div></form>}
      {historyLoading ? <p>Загрузка истории…</p> : <div className="overflow-x-auto"><table className="crm-mobile-cards w-full text-left text-sm"><thead><tr><th className="p-2">Дата</th><th className="p-2">Тип</th><th className="p-2">Изменение</th><th className="p-2">Было → стало</th><th className="p-2">Причина</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id} className="border-t"><td data-label="Дата" className="p-2">{new Date(movement.createdAt).toLocaleString('ru-RU')}</td><td data-label="Тип" className="p-2">{movement.type === 'WRITE_OFF' ? 'Списание' : movement.type}</td><td data-label="Изменение" className="p-2">{movement.quantity > 0 ? '+' : ''}{movement.quantity}</td><td data-label="Было → стало" className="p-2">{movement.previousQuantity} → {movement.newQuantity}</td><td data-label="Причина" className="p-2">{movement.comment || movement.sourceType}</td></tr>)}</tbody></table>{movements.length === 0 && <p className="p-3 text-slate-500">Движений пока нет</p>}</div>}
      <div className="flex flex-wrap items-center gap-3"><button className="rounded border px-3 py-1 disabled:opacity-40" disabled={historyPage === 1} onClick={() => setHistoryPage(historyPage - 1)}>Назад</button><span>Страница {historyPage} · всего {historyTotal}</span><button className="rounded border px-3 py-1 disabled:opacity-40" disabled={historyPage * 10 >= historyTotal} onClick={() => setHistoryPage(historyPage + 1)}>Далее</button></div>
    </section>}
  </section></CatalogShell>;
}
