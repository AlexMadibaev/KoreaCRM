import { useState, type FormEvent } from 'react';
import type { createApiClient } from '@koreacrm/api-client';
import { MoneyInput } from '@koreacrm/ui';
import type { PosProduct, PosSettings, PosShift } from '@koreacrm/types';
import { formatMinor } from './calculations';
import { lookupBarcode } from './barcode-lookup';

type Client = ReturnType<typeof createApiClient>;
type Found = { product: PosProduct; priceMinor: number };
type Draft = { operationId: string; quantity: number; amountMinor: string; reason: string };
const newDraft = (priceMinor = 0): Draft => ({ operationId: crypto.randomUUID(), quantity: 1, amountMinor: String(priceMinor), reason: '' });

// Returns without the original receipt are allowed only to staff with a separate permission and always pay out cash.
export function ReceiptlessReturn({ client, storeId, deviceId, shift, errorText, onReturned }: { client: Client; storeId: string; deviceId: string; shift: PosShift | null; errorText: (caught: unknown) => string; onReturned: () => void }) {
  const [open, setOpen] = useState(false), [code, setCode] = useState('');
  const [found, setFound] = useState<Found | null>(null), [draft, setDraft] = useState<Draft>(newDraft);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');

  async function lookup(event: FormEvent) {
    event.preventDefault();
    const value = code.trim(); if (!value) return;
    setBusy(true); setError(''); setNotice(''); setFound(null);
    try {
      const product = await lookupBarcode(client, value);
      if (!product) throw new Error('Штрихкод не найден.');
      const settings = await client.get<PosSettings>(`/stores/${storeId}/products/${product.id}/settings`);
      if (!settings || settings.priceMinor === null) throw new Error('У товара нет цены в этом магазине.');
      setFound({ product, priceMinor: settings.priceMinor }); setDraft(newDraft(settings.priceMinor));
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  const maxAmount = found ? BigInt(found.priceMinor) * BigInt(draft.quantity) : 0n;
  const amount = /^\d+$/.test(draft.amountMinor) ? BigInt(draft.amountMinor) : 0n;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!found || !shift) return;
    if (draft.reason.trim().length < 5) { setError('Укажите причину возврата: минимум 5 символов.'); return; }
    if (amount <= 0n || amount > maxAmount) { setError(`Сумма должна быть от 0,01 до ${formatMinor(maxAmount)}.`); return; }
    if (amount > BigInt(shift.expectedCashMinor)) { setError('В кассе недостаточно наличных для возврата.'); return; }
    setBusy(true); setError('');
    try {
      await client.post(`/stores/${storeId}/sales/returns/no-receipt`, { operationId: draft.operationId, deviceId, cashShiftId: shift.id, productId: found.product.id, quantity: draft.quantity, amountMinor: draft.amountMinor, reason: draft.reason.trim() });
      setNotice(`Возврат без чека оформлен: ${found.product.name} × ${draft.quantity}. Выдайте ${formatMinor(amount)} наличными.`);
      setFound(null); setCode(''); setDraft(newDraft());
      onReturned();
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }

  if (!open) return <button type="button" className="receiptless-toggle" onClick={() => setOpen(true)}>Возврат без чека</button>;
  return <div className="sales-history-detail receiptless-return">
    <div className="sales-history-detail-heading"><div><span className="eyebrow">ВОЗВРАТ БЕЗ ЧЕКА</span><h3>Товар без чека</h3><p className="muted">Деньги выдаются только наличными. Операция попадёт в отчёт смены и журнал действий.</p></div><button type="button" onClick={() => setOpen(false)}>Скрыть</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="sales-return-notice">{notice}</p>}
    {!shift ? <p className="muted">Для возврата откройте кассовую смену.</p> : <>
      <form className="receiptless-lookup" onSubmit={lookup}><label>Штрихкод или артикул<input value={code} onChange={event => setCode(event.target.value)} placeholder="Сканируйте товар" disabled={busy} /></label><button type="submit" disabled={busy || !code.trim()}>Найти</button></form>
      {found && <form className="sales-return-form" onSubmit={submit}>
        <p><strong>{found.product.name}</strong> · {found.product.sku} · цена {formatMinor(found.priceMinor)}</p>
        <label>Количество<input type="number" min="1" max="1000" step="1" value={draft.quantity} disabled={busy} onChange={event => { const quantity = Math.max(1, Math.min(1000, Math.trunc(Number(event.target.value) || 1))); setDraft(current => ({ ...current, quantity, amountMinor: String(found.priceMinor * quantity) })); }} /></label>
        <label>Сумма к выдаче, сомони<MoneyInput required valueMinor={draft.amountMinor} onMinorChange={amountMinor => setDraft(current => ({ ...current, amountMinor }))} disabled={busy} /></label>
        <label>Причина возврата<input required minLength={5} maxLength={500} value={draft.reason} onChange={event => setDraft(current => ({ ...current, reason: event.target.value }))} placeholder="Например, брак, покупатель потерял чек" disabled={busy} /></label>
        <button type="submit" disabled={busy || amount <= 0n || amount > maxAmount}>{busy ? 'Оформляем…' : `Вернуть ${formatMinor(amount)} наличными`}</button>
      </form>}
    </>}
  </div>;
}
