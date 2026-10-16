'use client';

import { useEffect, useState } from 'react';
import { api, queryString, type Page } from '../lib/api';
import { SaleReturnForm } from './sale-return-form';

type Product = { id: string; name: string; sku: string };
type Customer = { firstName: string; lastName: string | null; phone: string };
type ReturnLine = { id: string; saleItemId: string; quantity: number; amountMinor: string; saleItem?: { product: Product } };
type ReturnRecord = { id: string; operationId: string; amountMinor: string; reason: string; createdAt: string; items: ReturnLine[] };
export type Sale = {
  id: string; number: string; status: 'COMPLETED' | 'VOIDED'; totalMinor: string; discountMinor: string; costMinor: string; createdAt: string;
  items: { id: string; quantity: number; priceMinor: string; discountMinor: string; totalMinor: string; product: Product }[];
  payments: { id: string; amountMinor: string; paymentMethod: { name: string; kind: string } }[];
  customer: Customer | null; returns: ReturnRecord[];
};
type ReturnEntry = ReturnRecord & { sale: { id: string; number: string; createdAt: string; totalMinor: string; customer: Customer | null } };
type Tab = 'sales' | 'returns';
const money = (minor: string | bigint) => { const value = BigInt(minor); const absolute = value < 0n ? -value : value; return `${value < 0n ? '-' : ''}${new Intl.NumberFormat('ru-RU').format(absolute / 100n)},${String(absolute % 100n).padStart(2, '0')}`; };
const returned = (sale: Sale) => (sale.returns ?? []).reduce((total, record) => total + BigInt(record.amountMinor), 0n);
const fullyReturned = (sale: Sale) => sale.items.every(item => (sale.returns ?? []).reduce((total, record) => total + record.items.filter(line => line.saleItemId === item.id).reduce((sum, line) => sum + line.quantity, 0), 0) >= item.quantity);
const saleStatus = (sale: Sale) => sale.status === 'VOIDED' ? 'Аннулирована' : fullyReturned(sale) && sale.returns?.length ? 'Возвращена' : sale.returns?.length ? 'Частичный возврат' : 'Завершена';

export function SalesLedger({ storeId, revision, onReceipt, deviceId, deviceReady, cashShiftId, canReturn, canOpenShift, onShiftOpened, onReturned }: {
  storeId: string; revision: number; onReceipt: (sale: Sale) => void; deviceId: string; deviceReady: boolean; cashShiftId: string;
  canReturn: boolean; canOpenShift: boolean; onShiftOpened: (shift: { id: string; deviceId: string; status: string; expectedCashMinor: string }) => void;
  onReturned: (sale: Sale) => void;
}) {
  const [tab, setTab] = useState<Tab>('sales');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sales, setSales] = useState<Page<Sale> | null>(null);
  const [returns, setReturns] = useState<Page<ReturnEntry> | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [selectedReturnId, setSelectedReturnId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!storeId) { setSales(null); setReturns(null); return; }
    let active = true;
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      const path = `/stores/${storeId}/sales${tab === 'returns' ? '/returns' : ''}?${queryString({ page, limit: 20, search: search.trim() })}`;
      if (tab === 'sales') api<Page<Sale>>(path).then(result => { if (active) setSales(result); }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить продажи'); }).finally(() => { if (active) setLoading(false); });
      else api<Page<ReturnEntry>>(path).then(result => { if (active) setReturns(result); }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить возвраты'); }).finally(() => { if (active) setLoading(false); });
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [storeId, revision, tab, search, page]);

  const result = tab === 'sales' ? sales : returns;
  const selectTab = (value: Tab) => { setTab(value); setPage(1); setSelectedSaleId(''); setSelectedReturnId(''); };
  const searchChange = (value: string) => { setSearch(value); setPage(1); setSelectedSaleId(''); setSelectedReturnId(''); };

  return <section className="rounded-xl border border-slate-200 bg-white p-5 print:hidden" aria-label="История продаж и возвратов">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">История операций</h2><p className="mt-1 text-sm text-slate-500">Продажи и возвраты выбранного магазина</p></div>
      <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40" disabled={!search && page === 1} onClick={() => { setPage(1); setSearch(''); setSelectedSaleId(''); setSelectedReturnId(''); }}>Сбросить фильтр</button>
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-3 border-b border-slate-100">
      <button type="button" className={`border-b-2 px-2 py-3 text-sm font-semibold ${tab === 'sales' ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500'}`} aria-pressed={tab === 'sales'} onClick={() => selectTab('sales')}>Продажи</button>
      <button type="button" className={`border-b-2 px-2 py-3 text-sm font-semibold ${tab === 'returns' ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500'}`} aria-pressed={tab === 'returns'} onClick={() => selectTab('returns')}>Возвраты</button>
    </div>
    <label className="mt-5 block max-w-md text-xs font-semibold text-slate-600">Номер чека или телефон клиента<input className="mt-2 block w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-violet-500" value={search} onChange={event => searchChange(event.target.value)} placeholder="Например, DEMO-0001" /></label>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading && <p role="status" className="mt-5 text-sm text-slate-500">Загружаем операции…</p>}
    {!loading && result && <p className="mt-4 text-xs text-slate-500">Найдено: {result.total}</p>}
    {!loading && tab === 'sales' && sales && <div className="mt-3 divide-y divide-slate-100">
      {sales.items.map(sale => {
        const refunded = returned(sale);
        const open = selectedSaleId === sale.id;
        return <article key={sale.id} className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm text-slate-800">{sale.number}</strong><p className="mt-1 text-xs text-slate-500">{new Date(sale.createdAt).toLocaleString('ru-RU')} · {sale.customer?.phone ?? 'Без клиента'}</p><span className={`mt-2 inline-block rounded-full px-2 py-1 text-xs ${refunded > 0n ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{saleStatus(sale)}</span></div><div className="flex items-center gap-4"><div className="text-right"><strong className="block text-sm text-slate-800">{money(sale.totalMinor)}</strong>{refunded > 0n && <small className="text-xs text-amber-700">Возвращено {money(refunded)}</small>}</div><button type="button" className="rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700" aria-expanded={open} onClick={() => setSelectedSaleId(open ? '' : sale.id)}>{open ? 'Скрыть' : 'Подробнее'}</button></div></div>
          {open && <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>Чек и состав</strong><button type="button" className="text-xs font-semibold text-violet-700 underline" onClick={() => onReceipt(sale)}>Показать чек для печати</button></div><ul className="mt-3 divide-y divide-slate-200">{sale.items.map(item => <li key={item.id} className="flex justify-between gap-3 py-2"><span>{item.product.name} · {item.product.sku} × {item.quantity}</span><strong>{money(item.totalMinor)}</strong></li>)}</ul><p className="mt-3 text-slate-600">Оплата: {sale.payments.map(payment => `${payment.paymentMethod.name} ${money(payment.amountMinor)}`).join(' · ')}</p>{(sale.returns ?? []).map(record => <div key={record.id} className="mt-3 rounded-lg border border-amber-100 bg-amber-50 p-3"><strong className="text-amber-800">Возврат {money(record.amountMinor)}</strong><p className="mt-1 text-xs text-slate-600">{new Date(record.createdAt).toLocaleString('ru-RU')} · {record.reason}</p><p className="mt-1 text-xs text-slate-600">{record.items.map(line => `${sale.items.find(item => item.id === line.saleItemId)?.product.name ?? 'Товар'} × ${line.quantity}`).join(' · ')}</p></div>)}<p className="mt-3 font-semibold">После возвратов: {money(BigInt(sale.totalMinor) - refunded)}</p>{canReturn && <SaleReturnForm sale={sale} storeId={storeId} deviceId={deviceId} deviceReady={deviceReady} cashShiftId={cashShiftId} canOpenShift={canOpenShift} onShiftOpened={onShiftOpened} onReturned={onReturned} />}</div>}
        </article>;
      })}
      {!sales.items.length && <p className="py-8 text-center text-sm text-slate-500">Продажи не найдены</p>}
    </div>}
    {!loading && tab === 'returns' && returns && <div className="mt-3 divide-y divide-slate-100">
      {returns.items.map(record => {
        const open = selectedReturnId === record.id;
        return <article key={record.id} className="py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm text-slate-800">{record.sale.number}</strong><p className="mt-1 text-xs text-slate-500">Возврат: {new Date(record.createdAt).toLocaleString('ru-RU')} · {record.sale.customer?.phone ?? 'Без клиента'}</p><p className="mt-2 text-sm text-slate-600">{record.reason}</p></div><div className="flex items-center gap-4"><strong className="text-sm text-amber-800">−{money(record.amountMinor)}</strong><button type="button" className="rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700" aria-expanded={open} onClick={() => setSelectedReturnId(open ? '' : record.id)}>{open ? 'Скрыть' : 'Подробнее'}</button></div></div>{open && <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm"><strong>Возвращённые товары</strong><ul className="mt-3 divide-y divide-amber-100">{record.items.map(item => <li key={item.id} className="flex justify-between gap-3 py-2"><span>{item.saleItem?.product.name ?? 'Товар'} · {item.saleItem?.product.sku ?? ''} × {item.quantity}</span><strong>{money(item.amountMinor)}</strong></li>)}</ul><button type="button" className="mt-3 text-xs font-semibold text-violet-700 underline" onClick={() => { selectTab('sales'); setSearch(record.sale.number); }}>Открыть исходный чек</button></div>}</article>;
      })}
      {!returns.items.length && <p className="py-8 text-center text-sm text-slate-500">Возвраты не найдены</p>}
    </div>}
    {!loading && result && result.total > 20 && <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-500"><button type="button" className="rounded-lg border border-slate-200 px-3 py-2 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Назад</button><span>Страница {page} из {Math.ceil(result.total / 20)}</span><button type="button" className="rounded-lg border border-slate-200 px-3 py-2 disabled:opacity-40" disabled={page * 20 >= result.total} onClick={() => setPage(value => value + 1)}>Далее</button></div>}
  </section>;
}
