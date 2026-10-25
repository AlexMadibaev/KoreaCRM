'use client';

import { useEffect, useState } from 'react';
import { api, queryString, type Page } from '../../lib/api';

type Activity = { id: string; kind: 'SALE' | 'RETURN' | 'PAYMENT' | 'COMMENT' | 'BONUS' | 'PROFILE'; title: string; detail: string; amountMinor: string | null; createdAt: string; actorName: string | null };
const money = (minor: string) => { const value = BigInt(minor); const absolute = value < 0n ? -value : value; return `${value < 0n ? '−' : ''}${new Intl.NumberFormat('ru-RU').format(absolute / 100n)},${String(absolute % 100n).padStart(2, '0')} сомони`; };

export function CustomerActivity({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Activity> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setLoading(true);
    api<Page<Activity>>(`/customers/${customerId}/activity?${queryString({ page, limit: 10 })}`)
      .then(value => { if (current) { setResult(value); setError(''); } })
      .catch(caught => { if (current) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить историю'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [customerId, page]);
  return <div className="mt-3 space-y-3">
    <p className="text-sm text-slate-600">Все события клиента по доступным вам магазинам.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {loading ? <p className="text-sm text-slate-500">Загрузка истории…</p> : <>
      <ol className="space-y-2">{result?.items.map(entry => <li key={`${entry.kind}:${entry.id}`} className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><strong className="text-sm text-slate-900">{entry.title}</strong>{entry.amountMinor !== null && <span className="text-sm font-semibold text-slate-900">{money(entry.amountMinor)}</span>}</div>
        {entry.detail && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{entry.detail}</p>}
        <p className="mt-2 text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString('ru-RU')}{entry.actorName ? ` · ${entry.actorName}` : ''}</p>
      </li>)}{result?.items.length === 0 && <li className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500">Событий пока нет</li>}</ol>
      {(result?.total ?? 0) > 10 && <div className="flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border bg-white px-3 py-1 disabled:opacity-50">Назад</button><span>{page} / {Math.ceil((result?.total ?? 0) / 10)}</span><button type="button" disabled={page * 10 >= (result?.total ?? 0)} onClick={() => setPage(page + 1)} className="rounded border bg-white px-3 py-1 disabled:opacity-50">Далее</button></div>}
    </>}
  </div>;
}
