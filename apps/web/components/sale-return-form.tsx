'use client';

import { useState, type FormEvent } from 'react';
import { MoneyInput } from '@koreacrm/ui';
import { api } from '../lib/api';
import type { Sale } from './sales-ledger';

const money = (minor: bigint) => `${new Intl.NumberFormat('ru-RU').format(minor / 100n)},${String(minor % 100n).padStart(2, '0')}`;

export function SaleReturnForm({ sale, storeId, deviceId, deviceReady, cashShiftId, canOpenShift, onShiftOpened, onReturned }: {
  sale: Sale; storeId: string; deviceId: string; deviceReady: boolean; cashShiftId: string; canOpenShift: boolean;
  onShiftOpened: (shift: { id: string; deviceId: string; status: string; expectedCashMinor: string }) => void;
  onReturned: (sale: Sale) => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [openingCash, setOpeningCash] = useState('0');
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const cashSale = sale.status === 'COMPLETED' && sale.payments.length > 0 && sale.payments.every(payment => payment.paymentMethod.kind === 'CASH');
  const remaining = sale.items.map(item => {
    const returned = (sale.returns ?? []).reduce((sum, record) => sum + record.items.filter(line => line.saleItemId === item.id).reduce((count, line) => count + line.quantity, 0), 0);
    const available = item.quantity - returned;
    const selected = quantities[item.id] ?? 0;
    const amount = selected > 0 && selected <= available
      ? BigInt(item.totalMinor) * BigInt(returned + selected) / BigInt(item.quantity) - BigInt(item.totalMinor) * BigInt(returned) / BigInt(item.quantity)
      : 0n;
    return { item, returned, available, selected, amount };
  });
  if (!cashSale || !remaining.some(line => line.available > 0)) return null;
  const amount = remaining.reduce((sum, line) => sum + line.amount, 0n);
  const validSelection = remaining.some(line => line.selected > 0) && remaining.every(line => Number.isInteger(line.selected) && line.selected >= 0 && line.selected <= line.available);

  async function openShift(event: FormEvent) {
    event.preventDefault();
    setError(''); setBusy(true);
    try {
      const shift = await api<{ id: string; deviceId: string; status: string; expectedCashMinor: string }>(`/stores/${storeId}/finance/cash-shifts`, { method: 'POST', body: JSON.stringify({ deviceId, openingCashMinor: openingCash }) });
      onShiftOpened(shift);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось открыть смену'); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validSelection || reason.trim().length < 5 || !deviceReady || !cashShiftId) return;
    setError(''); setSuccess(''); setBusy(true);
    try {
      const updated = await api<Sale>(`/stores/${storeId}/sales/${sale.id}/return`, { method: 'POST', body: JSON.stringify({ operationId, deviceId, cashShiftId, reason: reason.trim(), items: remaining.filter(line => line.selected > 0).map(line => ({ saleItemId: line.item.id, quantity: line.selected })) }) });
      setSuccess(`Возврат оформлен: ${money(amount)}`);
      setQuantities({}); setReason(''); setOperationId(crypto.randomUUID());
      onReturned(updated);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось оформить возврат'); }
    finally { setBusy(false); }
  }

  return <div className="mt-4 rounded-lg border border-violet-100 bg-white p-4" aria-label={`Возврат по чеку ${sale.number}`}>
    <h4 className="font-semibold text-slate-800">Оформить возврат</h4>
    <p className="mt-1 text-xs text-slate-500">Выберите количество из ещё не возвращённых товаров. Возврат будет выдан наличными.</p>
    {!cashShiftId && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <p>Для возврата откройте кассовую смену этого устройства.</p>
      {canOpenShift && <form onSubmit={openShift} className="mt-3 flex flex-wrap items-end gap-2"><label>Начальный остаток, сомони<MoneyInput required className="mt-1 block w-40 rounded border border-amber-200 bg-white p-2" valueMinor={openingCash} onMinorChange={setOpeningCash} /></label><button type="submit" disabled={busy || !deviceReady} className="rounded-lg bg-white px-3 py-2 font-semibold text-amber-900 disabled:opacity-40">Открыть смену</button></form>}
    </div>}
    <form onSubmit={submit} className="mt-3 space-y-3">
      {remaining.map(({ item, available, selected }) => <label key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm"><span className="min-w-0">{item.product.name}<small className="ml-2 text-slate-500">Доступно для возврата: {available}</small></span><input aria-label={`Вернуть ${item.product.name}`} type="number" inputMode="numeric" min="0" max={available} step="1" disabled={!available || busy} className="w-20 rounded border border-slate-200 p-2 text-right" value={selected} onChange={event => setQuantities(current => ({ ...current, [item.id]: Number(event.target.value) }))} /></label>)}
      <label className="block text-sm font-medium text-slate-700">Причина возврата<textarea required minLength={5} maxLength={500} className="mt-1 block w-full rounded border border-slate-200 p-2" rows={2} value={reason} onChange={event => setReason(event.target.value)} placeholder="Например, товар не подошёл покупателю" /></label>
      <div className="flex flex-wrap items-center justify-between gap-3"><strong className="text-sm">К выдаче: {money(amount)}</strong><button type="submit" disabled={busy || !validSelection || reason.trim().length < 5 || !cashShiftId || !deviceReady} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Оформляем…' : 'Оформить возврат'}</button></div>
    </form>
    {error && <p role="alert" className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    {success && <p role="status" className="mt-3 rounded bg-emerald-50 p-2 text-sm text-emerald-700">{success}</p>}
  </div>;
}
