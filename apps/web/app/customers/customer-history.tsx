'use client';

import { useEffect, useState } from 'react';
import { api, queryString, type Page } from '../../lib/api';
import { CustomerComments } from './customer-comments';
import { CustomerActivity } from './customer-activity';
import { CustomerBonuses } from './customer-bonuses';

type Purchase = { id: string; number: string; createdAt: string; totalMinor: string; status: string; store: { name: string }; items: { id: string; quantity: number; totalMinor: string; product: { name: string } }[] };
type Return = { id: string; createdAt: string; amountMinor: string; reason: string; sale: { id: string; number: string }; items: { id: string; quantity: number; amountMinor: string; saleItem: { product: { name: string } } }[] };
type DebtEntry = { id: string; createdAt: string; type: 'SALE' | 'PAYMENT'; amountMinor: string; sale: { number: string } | null; customerPayment: { paymentMethod: { name: string } } | null };
const money = (minor: string) => { const value = BigInt(minor); const absolute = value < 0n ? -value : value; const fraction = absolute % 100n; return `${value < 0n ? '−' : ''}${new Intl.NumberFormat('ru-RU').format(absolute / 100n)}${fraction ? `,${String(fraction).padStart(2, '0')}` : ''} сум`; };

export function CustomerHistory({ customerId, debtBalanceMinor, canComment, canCorrectBonus, onBonusChanged }: { customerId: string; debtBalanceMinor: string; canComment: boolean; canCorrectBonus: boolean; onBonusChanged: () => Promise<void> }) {
  const [kind, setKind] = useState<'sales' | 'returns' | 'bonuses' | 'debts' | 'comments' | 'activity'>('sales');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Purchase | Return | DebtEntry> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (kind === 'comments' || kind === 'activity' || kind === 'bonuses') return;
    let current = true;
    setLoading(true);
    setError('');
    api<Page<Purchase | Return | DebtEntry>>(`/customers/${customerId}/history?${queryString({ kind, page, limit: 10 })}`)
      .then(value => { if (current) setResult(value); })
      .catch(caught => { if (current) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить историю'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [customerId, kind, page, debtBalanceMinor]);

  function selectKind(value: 'sales' | 'returns' | 'bonuses' | 'debts' | 'comments' | 'activity') { setKind(value); setPage(1); setResult(null); }
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold">История клиента</h3>
      <div role="tablist" aria-label="История клиента" className="flex gap-1 rounded-lg bg-white p-1 shadow-sm">
        <button type="button" role="tab" aria-selected={kind === 'sales'} onClick={() => selectKind('sales')} className={`rounded-md px-3 py-2 text-sm ${kind === 'sales' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Покупки</button>
        <button type="button" role="tab" aria-selected={kind === 'returns'} onClick={() => selectKind('returns')} className={`rounded-md px-3 py-2 text-sm ${kind === 'returns' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Возвраты</button>
        <button type="button" role="tab" aria-selected={kind === 'bonuses'} onClick={() => selectKind('bonuses')} className={`rounded-md px-3 py-2 text-sm ${kind === 'bonuses' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Бонусы</button>
        <button type="button" role="tab" aria-selected={kind === 'debts'} onClick={() => selectKind('debts')} className={`rounded-md px-3 py-2 text-sm ${kind === 'debts' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Долги</button>
        <button type="button" role="tab" aria-selected={kind === 'comments'} onClick={() => selectKind('comments')} className={`rounded-md px-3 py-2 text-sm ${kind === 'comments' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Комментарии</button>
        <button type="button" role="tab" aria-selected={kind === 'activity'} onClick={() => selectKind('activity')} className={`rounded-md px-3 py-2 text-sm ${kind === 'activity' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>История</button>
      </div>
    </div>
    {kind === 'debts' && <p className="mt-3 text-sm text-slate-700">Текущий долг: <strong>{money(debtBalanceMinor)}</strong></p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {kind === 'comments' ? <CustomerComments customerId={customerId} canComment={canComment} /> : kind === 'activity' ? <CustomerActivity customerId={customerId} /> : kind === 'bonuses' ? <CustomerBonuses customerId={customerId} canCorrect={canCorrectBonus} onUpdated={onBonusChanged} /> : loading ? <p className="mt-4 text-sm text-slate-500">Загрузка истории…</p> : <>
      <ul className="mt-3 space-y-2">{result?.items.map(entry => <li key={entry.id} className="rounded-lg border border-slate-200 bg-white p-3">
        {kind === 'sales' ? <>
          <div className="flex flex-wrap justify-between gap-2"><strong>Чек №{(entry as Purchase).number}</strong><span className="font-semibold">{money((entry as Purchase).totalMinor)}</span></div>
          <p className="mt-1 text-sm text-slate-500">{new Date(entry.createdAt).toLocaleString('ru-RU')} · {(entry as Purchase).store.name}</p>
          <p className="mt-2 text-sm text-slate-700">{(entry as Purchase).items.map(item => `${item.product.name} × ${item.quantity}`).join(', ')}</p>
        </> : kind === 'returns' ? <>
          <div className="flex flex-wrap justify-between gap-2"><strong>Возврат по чеку №{(entry as Return).sale.number}</strong><span className="font-semibold">{money((entry as Return).amountMinor)}</span></div>
          <p className="mt-1 text-sm text-slate-500">{new Date(entry.createdAt).toLocaleString('ru-RU')} · {(entry as Return).reason}</p>
          <p className="mt-2 text-sm text-slate-700">{(entry as Return).items.map(item => `${item.saleItem.product.name} × ${item.quantity}`).join(', ')}</p>
        </> : <>
          <div className="flex flex-wrap justify-between gap-2"><strong>{(entry as DebtEntry).type === 'SALE' ? 'Долг по продаже' : 'Погашение долга'}</strong><span className={`font-semibold ${(entry as DebtEntry).type === 'SALE' ? 'text-amber-700' : 'text-emerald-700'}`}>{money((entry as DebtEntry).amountMinor)}</span></div>
          <p className="mt-1 text-sm text-slate-500">{new Date(entry.createdAt).toLocaleString('ru-RU')} · {(entry as DebtEntry).sale?.number ? `Чек №${(entry as DebtEntry).sale?.number}` : (entry as DebtEntry).customerPayment?.paymentMethod.name ?? ''}</p>
        </>}
      </li>)}{result?.items.length === 0 && <li className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500">{kind === 'sales' ? 'У клиента пока нет покупок' : kind === 'returns' ? 'У клиента пока нет возвратов' : 'Операций по долгу пока нет'}</li>}</ul>
      {(result?.total ?? 0) > 10 && <div className="mt-3 flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border bg-white px-3 py-1 disabled:opacity-50">Назад</button><span>{page} / {Math.ceil((result?.total ?? 0) / 10)}</span><button type="button" disabled={page * 10 >= (result?.total ?? 0)} onClick={() => setPage(page + 1)} className="rounded border bg-white px-3 py-1 disabled:opacity-50">Далее</button></div>}
    </>}
  </section>;
}
