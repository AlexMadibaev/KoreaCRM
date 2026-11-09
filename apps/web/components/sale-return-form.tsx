'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { MoneyInput } from '@koreacrm/ui';
import { api, withDiscrepancyComment, type Page } from '../lib/api';
import type { Sale } from './sales-ledger';

type ReturnShift = { id: string; deviceId: string; status: string; expectedCashMinor: string; openedAt?: string };

const money = (minor: bigint) => `${new Intl.NumberFormat('ru-RU').format(minor / 100n)},${String(minor % 100n).padStart(2, '0')}`;

export function SaleReturnForm({ sale, storeId, deviceId, deviceReady, cashShiftId, canOpenShift, onShiftOpened, onReturned }: {
  sale: Sale; storeId: string; deviceId: string; deviceReady: boolean; cashShiftId: string; canOpenShift: boolean;
  onShiftOpened: (shift: { id: string; deviceId: string; status: string; expectedCashMinor: string }) => void;
  onReturned: (sale: Sale) => void;
}) {
  const [shifts, setShifts] = useState<ReturnShift[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [loadingShifts, setLoadingShifts] = useState(true);
  const [shiftError, setShiftError] = useState('');
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const items: ReturnShift[] = [];
        for (let page = 1; ; page += 1) {
          const result = await api<Page<ReturnShift>>(`/stores/${storeId}/finance/cash-shifts?status=OPEN&limit=100&page=${page}`);
          items.push(...result.items);
          if (!result.items.length || items.length >= result.total) break;
        }
        if (active) { setShifts(items); setShiftError(''); }
      } catch (caught) { if (active) { setShifts([]); setShiftError(caught instanceof Error ? caught.message : 'Не удалось проверить смены'); } }
      finally { refreshing = false; if (active) setLoadingShifts(false); }
    };
    setLoadingShifts(true); setShifts([]); setSelectedShiftId('');
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [storeId, cashShiftId]);
  const selectedShift = shifts.find(shift => shift.id === (selectedShiftId || cashShiftId));
  const returnDeviceId = selectedShift?.deviceId ?? '';
  const returnShiftId = selectedShift?.id ?? '';
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [openingCash, setOpeningCash] = useState('0');
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const returnable = sale.status === 'COMPLETED' && sale.payments.length > 0;
  const remaining = sale.items.map(item => {
    const returned = (sale.returns ?? []).reduce((sum, record) => sum + record.items.filter(line => line.saleItemId === item.id).reduce((count, line) => count + line.quantity, 0), 0);
    const available = item.quantity - returned;
    const selected = quantities[item.id] ?? 0;
    const amount = selected > 0 && selected <= available
      ? BigInt(item.totalMinor) * BigInt(returned + selected) / BigInt(item.quantity) - BigInt(item.totalMinor) * BigInt(returned) / BigInt(item.quantity)
      : 0n;
    return { item, returned, available, selected, amount };
  });
  if (!returnable || !remaining.some(line => line.available > 0)) return null;
  const amount = remaining.reduce((sum, line) => sum + line.amount, 0n);
  const validSelection = remaining.some(line => line.selected > 0) && remaining.every(line => Number.isInteger(line.selected) && line.selected >= 0 && line.selected <= line.available);

  async function openShift(event: FormEvent) {
    event.preventDefault();
    setError(''); setBusy(true);
    try {
      const shift = await withDiscrepancyComment(comment => api<{ id: string; deviceId: string; status: string; expectedCashMinor: string }>(`/stores/${storeId}/finance/cash-shifts`, { method: 'POST', body: JSON.stringify({ deviceId, openingCashMinor: openingCash, comment }) }));
      onShiftOpened(shift);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось открыть смену'); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validSelection || reason.trim().length < 5 || !returnShiftId) return;
    setError(''); setSuccess(''); setBusy(true);
    try {
      const updated = await api<Sale>(`/stores/${storeId}/sales/${sale.id}/return`, { method: 'POST', body: JSON.stringify({ operationId, deviceId: returnDeviceId, cashShiftId: returnShiftId, reason: reason.trim(), items: remaining.filter(line => line.selected > 0).map(line => ({ saleItemId: line.item.id, quantity: line.selected })) }) });
      setSuccess(`Возврат оформлен: ${money(amount)}`);
      setQuantities({}); setReason(''); setOperationId(crypto.randomUUID());
      onReturned(updated);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось оформить возврат'); }
    finally { setBusy(false); }
  }

  return <div className="mt-4 rounded-lg border border-violet-100 bg-white p-4" aria-label={`Возврат по чеку ${sale.number}`}>
    <h4 className="font-semibold text-slate-800">Оформить возврат</h4>
    <p className="mt-1 text-xs text-slate-500">Выберите количество из ещё не возвращённых товаров. Деньги вернутся тем же способом, которым платил покупатель: сначала спишется долг, наличные выдаются в последнюю очередь.</p>
    {loadingShifts && <p role="status">Проверяем открытые смены…</p>}
    {shiftError && <p role="alert" className="mt-3 text-red-700">{shiftError}</p>}
    {shifts.length > 0 && <label className="mt-3 block text-sm">Касса для возврата<select className="mt-1 block w-full rounded border p-2" value={selectedShift?.id ?? ''} disabled={busy} onChange={event => setSelectedShiftId(event.target.value)}><option value="">Выберите открытую кассу</option>{shifts.map(shift => <option key={shift.id} value={shift.id}>{shift.deviceId} · наличные {money(BigInt(shift.expectedCashMinor))}{shift.openedAt ? ` · открыта ${new Date(shift.openedAt).toLocaleString('ru-RU')}` : ''}</option>)}</select><small>Возврат и выдача наличных будут записаны в выбранную смену.</small></label>}
    {!loadingShifts && !shiftError && !shifts.length && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <p>В магазине нет открытых смен. Откройте смену на кассе или создайте отдельную смену веб-кассы.</p>
      {canOpenShift && <form onSubmit={openShift} className="mt-3 flex flex-wrap items-end gap-2"><label>Начальный остаток, сомони<MoneyInput required className="mt-1 block w-40 rounded border border-amber-200 bg-white p-2" valueMinor={openingCash} onMinorChange={setOpeningCash} /></label><button type="submit" disabled={busy || !deviceReady} className="ks-button ks-button--secondary">Открыть смену</button></form>}
    </div>}
    <form onSubmit={submit} className="mt-3 space-y-3">
      {remaining.map(({ item, available, selected }) => <label key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm"><span className="min-w-0">{item.product.name}<small className="ml-2 text-slate-500">Доступно для возврата: {available}</small></span><input aria-label={`Вернуть ${item.product.name}`} type="number" inputMode="numeric" min="0" max={available} step="1" disabled={!available || busy} className="w-20 rounded border border-slate-200 p-2 text-right" value={selected} onChange={event => setQuantities(current => ({ ...current, [item.id]: Number(event.target.value) }))} /></label>)}
      <label className="block text-sm font-medium text-slate-700">Причина возврата<textarea required minLength={5} maxLength={500} className="mt-1 block w-full rounded border border-slate-200 p-2" rows={2} value={reason} onChange={event => setReason(event.target.value)} placeholder="Например, товар не подошёл покупателю" /></label>
      <div className="flex flex-wrap items-center justify-between gap-3"><strong className="text-sm">К выдаче: {money(amount)}</strong><button type="submit" disabled={busy || !validSelection || reason.trim().length < 5 || !returnShiftId || loadingShifts || !!shiftError} className="ks-button ks-button--primary">{busy ? 'Оформляем…' : 'Оформить возврат'}</button></div>
    </form>
    {error && <p role="alert" className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    {success && <p role="status" className="mt-3 rounded bg-emerald-50 p-2 text-sm text-emerald-700">{success}</p>}
  </div>;
}
