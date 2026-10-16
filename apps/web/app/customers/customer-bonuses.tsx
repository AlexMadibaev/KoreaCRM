'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, queryString, type Page } from '../../lib/api';

type BonusTransaction = { id: string; type: 'EARN' | 'SPEND' | 'CORRECTION' | 'EXPIRE'; deltaMinor: string; balanceAfterMinor: string; reason: string; createdAt: string; actor: { name: string } };
type BonusPage = Page<BonusTransaction> & { balanceMinor: string };
const money = (minor: string) => { const value = BigInt(minor); const absolute = value < 0n ? -value : value; return `${value < 0n ? '−' : ''}${new Intl.NumberFormat('ru-RU').format(absolute / 100n)},${String(absolute % 100n).padStart(2, '0')} сум`; };
const toMinor = (value: string) => { const [whole = '0', fraction = ''] = value.replace(',', '.').split('.'); return String(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0')); };

export function CustomerBonuses({ customerId, canCorrect, onUpdated }: { customerId: string; canCorrect: boolean; onUpdated: () => Promise<void> }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<BonusPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let current = true;
    setLoading(true);
    api<BonusPage>(`/customers/${customerId}/bonuses?${queryString({ page, limit: 10 })}`)
      .then(value => { if (current) { setResult(value); setError(''); } })
      .catch(caught => { if (current) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить бонусы'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [customerId, page, revision]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const minor = toMinor(amount);
      await api(`/customers/${customerId}/bonuses/corrections`, { method: 'POST', body: JSON.stringify({ operationId, deltaMinor: direction === 'increase' ? minor : `-${minor}`, reason: reason.trim() }) });
      setOperationId(crypto.randomUUID()); setAmount(''); setReason(''); setPage(1); setRevision(value => value + 1);
      await onUpdated();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось изменить баланс'); }
    finally { setBusy(false); }
  }

  return <div className="mt-3 space-y-3">
    <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-sm text-slate-500">Бонусный баланс</p><strong className="text-lg">{result ? money(result.balanceMinor) : '—'}</strong><p className="mt-1 text-xs text-slate-500">Автоматическое начисление и оплата бонусами в кассе пока не включены.</p></div>
    {canCorrect && <form onSubmit={submit} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
      <h4 className="font-medium sm:col-span-2">Ручная корректировка</h4>
      <label className="text-sm">Действие<select value={direction} onChange={event => setDirection(event.target.value as 'increase' | 'decrease')} className="mt-1 block w-full rounded border p-2"><option value="increase">Увеличить баланс</option><option value="decrease">Уменьшить баланс</option></select></label>
      <label className="text-sm">Сумма, сум<input required inputMode="decimal" pattern="[0-9]{1,12}([.,][0-9]{1,2})?" value={amount} onChange={event => setAmount(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
      <label className="text-sm sm:col-span-2">Причина<textarea required minLength={5} maxLength={500} rows={2} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
      <button disabled={busy || !amount || !reason.trim() || /^0+(?:[.,]0{0,2})?$/.test(amount)} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50 sm:col-span-2">Сохранить корректировку</button>
    </form>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {loading ? <p className="text-sm text-slate-500">Загрузка операций…</p> : <>
      <ul className="space-y-2">{result?.items.map(item => <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex justify-between gap-2"><strong className="text-sm">{item.type === 'CORRECTION' ? 'Корректировка' : item.type === 'EARN' ? 'Начисление' : item.type === 'SPEND' ? 'Списание' : 'Сгорание'}</strong><span className={`text-sm font-semibold ${BigInt(item.deltaMinor) < 0n ? 'text-red-700' : 'text-emerald-700'}`}>{BigInt(item.deltaMinor) > 0n ? '+' : ''}{money(item.deltaMinor)}</span></div><p className="mt-1 text-sm text-slate-700">{item.reason}</p><p className="mt-2 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString('ru-RU')} · {item.actor.name} · Остаток {money(item.balanceAfterMinor)}</p></li>)}{result?.items.length === 0 && <li className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500">Бонусных операций пока нет</li>}</ul>
      {(result?.total ?? 0) > 10 && <div className="flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border bg-white px-3 py-1 disabled:opacity-50">Назад</button><span>{page} / {Math.ceil((result?.total ?? 0) / 10)}</span><button type="button" disabled={page * 10 >= (result?.total ?? 0)} onClick={() => setPage(page + 1)} className="rounded border bg-white px-3 py-1 disabled:opacity-50">Далее</button></div>}
    </>}
  </div>;
}
