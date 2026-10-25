'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CatalogShell } from '../../components/catalog-shell';
import { api, type Page, type Product } from '../../lib/api';

type Store = { id: string; name: string };
type Access = { permissions: string[]; allStores: boolean; storeIds: string[] };
type Item = { id: string; productId: string; quantity: number; receivedQuantity: number; product: { name: string; sku: string } };
type Transfer = { id: string; fromStoreId: string; toStoreId: string; fromStore: Store; toStore: Store; status: 'DRAFT' | 'REQUESTED' | 'APPROVED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED'; createdAt: string; items: Item[] };
type DraftItem = { productId: string; quantity: string };
const transferStatus: Record<Transfer['status'], string> = {
  DRAFT: 'Черновик',
  REQUESTED: 'Запрошено',
  APPROVED: 'Согласовано',
  IN_TRANSIT: 'В пути',
  RECEIVED: 'Принято',
  CANCELLED: 'Отменено',
};

export default function TransfersPage() {
  const [access, setAccess] = useState<Access | null>(null), [stores, setStores] = useState<Store[]>([]), [products, setProducts] = useState<Product[]>([]);
  const [list, setList] = useState<Transfer[]>([]), [selected, setSelected] = useState<Transfer | null>(null);
  const [fromStoreId, setFromStoreId] = useState(''), [toStoreId, setToStoreId] = useState(''), [draftItems, setDraftItems] = useState<DraftItem[]>([{ productId: '', quantity: '1' }]);
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, string>>({}), [receiptOperationId, setReceiptOperationId] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const can = (permission: string) => access?.permissions.includes(permission) ?? false;
  const canUseStore = (id: string) => access?.allStores || access?.storeIds.includes(id);
  useEffect(() => {
    api<Access>('/auth/me').then(async (me) => {
      setAccess(me);
      if (me.permissions.includes('transfers.create')) {
        const [available, catalog] = await Promise.all([api<Store[]>('/transfers/stores'), api<Page<Product>>('/products?limit=100')]);
        setStores(available); setProducts(catalog.items);
        setFromStoreId(available.find((item) => me.allStores || me.storeIds.includes(item.id))?.id ?? '');
      }
    }).catch((caught) => { setError(caught instanceof Error ? caught.message : 'Ошибка загрузки'); setLoading(false); });
  }, []);
  const load = useCallback(async () => { setLoading(true); try { const result = await api<Page<Transfer>>('/transfers?limit=100'); setList(result.items); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка загрузки'); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const open = useCallback(async (id: string) => {
    try {
      const item = await api<Transfer>(`/transfers/${id}`);
      setSelected(item);
      const url = new URL(window.location.href);
      url.searchParams.set('id', item.id);
      window.history.replaceState(null, '', url);
      setReceiptQuantities(Object.fromEntries(item.items.map((row) => [row.id, '0'])));
      setReceiptOperationId(crypto.randomUUID());
      window.setTimeout(() => document.getElementById('transfer-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось открыть перемещение'); }
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) void open(id);
  }, [open]);
  function close() { setSelected(null); const url = new URL(window.location.href); url.searchParams.delete('id'); window.history.replaceState(null, '', url); }
  async function create(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { const items = draftItems.map((row) => ({ productId: row.productId, quantity: Number(row.quantity) })); const item = await api<Transfer>('/transfers', { method: 'POST', body: JSON.stringify({ fromStoreId, toStoreId, items }) }); setDraftItems([{ productId: '', quantity: '1' }]); await load(); await open(item.id); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка создания'); } finally { setBusy(false); } }
  async function action(verb: 'request' | 'approve' | 'send' | 'cancel') { if (!selected) return; setBusy(true); setError(''); try { await api(`/transfers/${selected.id}/${verb}`, { method: 'POST' }); await Promise.all([load(), open(selected.id)]); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка операции'); } finally { setBusy(false); } }
  async function receive(event: FormEvent) { event.preventDefault(); if (!selected) return; const items = selected.items.map((item) => ({ transferItemId: item.id, quantity: Number(receiptQuantities[item.id] ?? 0) })).filter((item) => item.quantity > 0); if (!items.length) { setError('Укажите количество хотя бы для одного товара'); return; } setBusy(true); setError(''); try { await api(`/transfers/${selected.id}/receive`, { method: 'POST', body: JSON.stringify({ operationId: receiptOperationId, items }) }); await Promise.all([load(), open(selected.id)]); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка приёмки. Повторите запрос с теми же количествами.'); } finally { setBusy(false); } }
  return <CatalogShell><main className="space-y-5 crm-transfers-page"><div className="crm-page-head"><div><span className="crm-eyebrow">ЛОГИСТИКА</span><h1>Перемещения</h1><p>Отслеживайте отправку и приёмку товаров между магазинами.</p></div></div>{error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}{can('transfers.create') && <form onSubmit={create} className="space-y-3 rounded border bg-white p-4"><h2 className="font-semibold">Новое перемещение</h2><div className="flex flex-wrap gap-3"><label>Откуда<select required className="ml-2 rounded border p-2" value={fromStoreId} onChange={(event) => setFromStoreId(event.target.value)}><option value="">Выберите</option>{stores.filter((store) => canUseStore(store.id)).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>Куда<select required className="ml-2 rounded border p-2" value={toStoreId} onChange={(event) => setToStoreId(event.target.value)}><option value="">Выберите</option>{stores.filter((store) => store.id !== fromStoreId).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label></div>{draftItems.map((row, index) => <div key={index} className="flex flex-wrap gap-2"><label>Товар<select required className="ml-2 rounded border p-2" value={row.productId} onChange={(event) => setDraftItems(draftItems.map((item, at) => at === index ? { ...item, productId: event.target.value } : item))}><option value="">Выберите</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}</select></label><label>Количество<input required min="1" max="2147483647" type="number" inputMode="numeric" className="ml-2 w-28 rounded border p-2" value={row.quantity} onChange={(event) => setDraftItems(draftItems.map((item, at) => at === index ? { ...item, quantity: event.target.value } : item))} /></label>{draftItems.length > 1 && <button type="button" onClick={() => setDraftItems(draftItems.filter((_, at) => at !== index))} className="underline">Убрать</button>}</div>)}<div className="flex flex-wrap gap-2"><button type="button" onClick={() => setDraftItems([...draftItems, { productId: '', quantity: '1' }])} className="rounded border px-4 py-2">Добавить товар</button><button disabled={busy || !fromStoreId || !toStoreId} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Создать черновик</button></div></form>}{loading ? <p>Загрузка…</p> : <div className="rounded border bg-white"><ul className="divide-y">{list.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 p-3"><span>{item.fromStore.name} → {item.toStore.name} · <span className="crm-transfer-status">{transferStatus[item.status]}</span> · {new Date(item.createdAt).toLocaleString('ru-RU')}</span><button className="underline" onClick={() => void open(item.id)}>Открыть</button></li>)}</ul>{list.length === 0 && <p className="p-4 text-slate-500">Перемещений пока нет</p>}</div>}{selected && <section id="transfer-detail" className="space-y-4 rounded border bg-white p-4"><div className="flex items-start justify-between gap-3"><h2 className="min-w-0 font-semibold">{selected.fromStore.name} → {selected.toStore.name} · {transferStatus[selected.status]}</h2><button className="underline" onClick={close}>Закрыть</button></div><div className="flex flex-wrap gap-2">{selected.status === 'DRAFT' && canUseStore(selected.fromStoreId) && can('transfers.request') && <button disabled={busy} className="rounded border px-3 py-2" onClick={() => void action('request')}>Отправить заявку</button>}{selected.status === 'REQUESTED' && canUseStore(selected.fromStoreId) && can('transfers.approve') && <button disabled={busy} className="rounded border px-3 py-2" onClick={() => void action('approve')}>Согласовать</button>}{selected.status === 'APPROVED' && canUseStore(selected.fromStoreId) && can('transfers.send') && <button disabled={busy} className="rounded border px-3 py-2" onClick={() => void action('send')}>Отгрузить</button>}{['DRAFT', 'REQUESTED', 'APPROVED'].includes(selected.status) && canUseStore(selected.fromStoreId) && can('transfers.cancel') && <button disabled={busy} className="rounded border px-3 py-2" onClick={() => void action('cancel')}>Отменить</button>}</div><div className="overflow-x-auto rounded border"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Товар</th><th className="p-2">Отправлено</th><th className="p-2">Получено</th><th className="p-2">Принять сейчас</th></tr></thead><tbody>{selected.items.map((item) => <tr key={item.id} className="border-t"><td data-label="Товар" className="p-2">{item.product.name} ({item.product.sku})</td><td data-label="Отправлено" className="p-2">{item.quantity}</td><td data-label="Получено" className="p-2">{item.receivedQuantity}</td><td data-label="Принять сейчас" className="p-2">{selected.status === 'IN_TRANSIT' && canUseStore(selected.toStoreId) && can('transfers.receive') ? <input aria-label={`Принять ${item.product.name}`} type="number" inputMode="numeric" min="0" max={item.quantity - item.receivedQuantity} className="w-24 rounded border p-1" value={receiptQuantities[item.id] ?? '0'} onChange={(event) => { setReceiptQuantities({ ...receiptQuantities, [item.id]: event.target.value }); setReceiptOperationId(crypto.randomUUID()); }} /> : '—'}</td></tr>)}</tbody></table></div>{selected.status === 'IN_TRANSIT' && canUseStore(selected.toStoreId) && can('transfers.receive') && <form onSubmit={receive}><button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-white">Принять выбранное количество</button></form>}</section>}</main></CatalogShell>;
}
