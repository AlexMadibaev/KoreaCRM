import { useEffect, useState, type FormEvent } from 'react';
import type { createApiClient } from '@koreacrm/api-client';
import type { PosPage, PosSale, PosShift } from '@koreacrm/types';
import { formatMinor } from './calculations';
import { fullyReturned, returnAmount, returnedQuantity } from './return-calculations';

type Client = ReturnType<typeof createApiClient>;
type ReturnItem = { saleItemId: string; quantity: number };
type PendingReturn = { storeId: string; saleId: string; operationId: string; deviceId: string; cashShiftId: string; reason: string; items: ReturnItem[] };
const pendingReturnKey = 'koreacrm-pos-pending-return-v1';
const readPending = (): PendingReturn | null => { try { const raw = localStorage.getItem(pendingReturnKey); return raw ? JSON.parse(raw) as PendingReturn : null; } catch { return null; } };
const defaultQuantities = (sale: PosSale) => Object.fromEntries(sale.items.map(item => [item.id, item.quantity - returnedQuantity(sale, item.id)]));
const saleStatus = (sale: PosSale) => sale.status === 'VOIDED' ? 'Аннулирована' : fullyReturned(sale) && sale.returns?.length ? 'Возвращена полностью' : sale.returns?.length ? 'Частичный возврат' : 'Завершена';

export function SalesHistory({ client, storeId, enabled, revision, onPrint, canReturn, shift, deviceId, onReturned }: { client: Client; storeId: string; enabled: boolean; revision: number; onPrint: (sale: PosSale) => void; canReturn: boolean; shift: PosShift | null; deviceId: string; onReturned: (sale: PosSale) => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PosPage<PosSale> | null>(null);
  const [selected, setSelected] = useState<PosSale | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<PendingReturn | null>(readPending);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [returnBusy, setReturnBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!enabled || !storeId) { setResult(null); setSelected(null); return; }
    let active = true;
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      client.get<PosPage<PosSale>>(`/stores/${storeId}/sales?limit=10&page=${page}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`)
        .then(data => { if (active) {
          setResult(data);
          setSelected(current => current ? data.items.find(item => item.id === current.id) ?? current : null);
          setPending(current => {
            if (current && data.items.some(item => item.id === current.saleId && item.returns?.some(record => record.operationId === current.operationId))) { localStorage.removeItem(pendingReturnKey); return null; }
            return current;
          });
        } })
        .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить чеки'); })
        .finally(() => { if (active) setLoading(false); });
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [client, storeId, enabled, revision, search, page]);

  function openSale(sale: PosSale) {
    setSelected(sale); setQuantities(pending?.saleId === sale.id && pending.items ? Object.fromEntries(pending.items.map(item => [item.saleItemId, item.quantity])) : defaultQuantities(sale));
    setReason(pending?.saleId === sale.id ? pending.reason : ''); setNotice(''); setError('');
  }

  async function submitReturn(event: FormEvent) {
    event.preventDefault();
    if (!selected || !shift || shift.status !== 'OPEN' || !canReturn || returnBusy) return;
    if (pending && (pending.storeId !== storeId || pending.saleId !== selected.id)) { setError('Сначала завершите возврат другого чека'); return; }
    const normalized = reason.trim();
    const items = Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
    if (!pending && normalized.length < 5) { setError('Укажите причину возврата: минимум 5 символов'); return; }
    if (!pending && !items.length) { setError('Выберите хотя бы один товар для возврата'); return; }
    try { if (!pending) returnAmount(selected, quantities); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Некорректное количество'); return; }
    const request = pending ?? { storeId, saleId: selected.id, operationId: crypto.randomUUID(), deviceId, cashShiftId: shift.id, reason: normalized, items };
    localStorage.setItem(pendingReturnKey, JSON.stringify(request)); setPending(request); setReturnBusy(true); setError(''); setNotice('');
    try {
      const returned = await client.post<PosSale>(`/stores/${storeId}/sales/${selected.id}/return`, { operationId: request.operationId, deviceId: request.deviceId, cashShiftId: request.cashShiftId, reason: request.reason, items: request.items });
      localStorage.removeItem(pendingReturnKey); setPending(null); setSelected(returned); setQuantities(defaultQuantities(returned)); setReason('');
      setNotice('Возврат оформлен. Товар вернулся на остаток, деньги списаны из кассы.'); onReturned(returned);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось оформить возврат'); }
    finally { setReturnBusy(false); }
  }

  const cashSale = selected && selected.payments.length > 0 && selected.payments.every(payment => payment.paymentMethod.kind === 'CASH');
  const canSubmit = selected && canReturn && cashSale && selected.status !== 'VOIDED' && !fullyReturned(selected) && shift?.status === 'OPEN';
  let preview = 0n;
  try { if (selected) preview = returnAmount(selected, quantities); } catch { /* Invalid draft is shown by the quantity fields. */ }

  return <section className="panel sales-history" aria-label="История чеков">
    <div className="section-heading"><div><p className="eyebrow">ПРОДАЖИ</p><h2>История чеков</h2><span className="muted">Найдите продажу по номеру чека или телефону клиента</span></div><span className="section-number">03</span></div>
    {enabled ? <>
      <label>Номер чека или телефон<input value={search} onChange={event => { setSearch(event.target.value); setPage(1); setSelected(null); setNotice(''); }} placeholder="Например, DEMO-0001" /></label>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="sales-return-notice">{notice}</p>}
      {pending && pending.storeId === storeId && <p className="muted">Незавершённый запрос возврата сохранён. Откройте его чек и повторите отправку после восстановления связи.</p>}
      {loading && <p className="muted" role="status">Загружаем чеки…</p>}
      {!loading && result && <>
        <p className="sales-history-count">Найдено: {result.total}</p>
        <ul className="sales-history-list">{result.items.map(sale => <li key={sale.id}><div><strong>{sale.number}</strong><span>{new Date(sale.createdAt).toLocaleString('ru-RU')} · {saleStatus(sale)}</span></div><strong>{formatMinor(sale.totalMinor)}</strong><button type="button" onClick={() => openSale(sale)}>Открыть</button></li>)}</ul>
        {result.total > 10 && <div className="sales-history-pages"><button type="button" disabled={page <= 1} onClick={() => { setPage(page - 1); setSelected(null); }}>Назад</button><span>Страница {page} из {Math.ceil(result.total / 10)}</span><button type="button" disabled={page * 10 >= result.total} onClick={() => { setPage(page + 1); setSelected(null); }}>Далее</button></div>}
      </>}
      {selected && <div className="sales-history-detail">
        <div className="sales-history-detail-heading"><div><span className="eyebrow">ЧЕК</span><h3>{selected.number}</h3><p>{saleStatus(selected)} · {new Date(selected.createdAt).toLocaleString('ru-RU')}</p></div><button type="button" onClick={() => onPrint(selected)} disabled={selected.status === 'VOIDED'}>Показать для печати</button></div>
        <p>{selected.customer ? `Клиент: ${selected.customer.firstName} ${selected.customer.lastName ?? ''} · ${selected.customer.phone}` : 'Без клиента'}</p>
        <ul>{selected.items.map(item => <li key={item.id}><span>{item.product.name} · {item.product.sku} × {item.quantity}</span><strong>{formatMinor(item.totalMinor)}</strong></li>)}</ul>
        <p>Скидка: {formatMinor(selected.discountMinor)}</p><p>Оплата: {selected.payments.map(payment => `${payment.paymentMethod.name} ${formatMinor(payment.amountMinor)}`).join(' · ')}</p>
        <p className="sales-history-total">Итого: <strong>{formatMinor(selected.totalMinor)}</strong></p>
        {(selected.returns ?? []).map(record => <div className="sales-return-status" key={record.id}><strong>Возврат {formatMinor(record.amountMinor)}</strong><span>{new Date(record.createdAt).toLocaleString('ru-RU')} · {record.reason}</span><span>{record.items.map(line => `${selected.items.find(item => item.id === line.saleItemId)?.product.name ?? 'Товар'} × ${line.quantity}`).join(' · ')}</span></div>)}
        {canSubmit ? <form className="sales-return-form" onSubmit={submitReturn}>
          <h4>Возврат товаров</h4><p className="muted">Укажите количество для каждой позиции. Ноль означает, что товар останется у покупателя.</p>
          {selected.items.map(item => { const remaining = item.quantity - returnedQuantity(selected, item.id); return remaining > 0 && <label key={item.id}>{item.product.name} · доступно к возврату {remaining}<input aria-label={`Вернуть ${item.product.name}`} type="number" min="0" max={remaining} step="1" value={quantities[item.id] ?? 0} disabled={returnBusy || Boolean(pending?.saleId === selected.id)} onChange={event => { const parsed = Number(event.target.value); setQuantities(current => ({ ...current, [item.id]: Number.isFinite(parsed) ? Math.max(0, Math.min(remaining, Math.trunc(parsed))) : 0 })); }} /></label>; })}
          <label>Причина возврата<input value={pending?.saleId === selected.id ? pending.reason : reason} onChange={event => setReason(event.target.value)} placeholder="Например, товар не подошёл" disabled={Boolean(pending?.saleId === selected.id) || returnBusy} required minLength={5} maxLength={500} /></label>
          <p className="sales-history-total">К возврату: <strong>{formatMinor(preview)}</strong></p>
          <button type="submit" disabled={returnBusy || Boolean(pending && pending.saleId !== selected.id) || !Object.values(quantities).some(quantity => quantity > 0) || BigInt(shift.expectedCashMinor) < preview}>{returnBusy ? 'Оформляем…' : pending?.saleId === selected.id ? 'Повторить возврат' : 'Оформить возврат'}</button>
          {BigInt(shift.expectedCashMinor) < preview && <p role="alert" className="error">В кассе недостаточно наличных для возврата.</p>}
        </form> : canReturn && !cashSale && selected.status !== 'VOIDED' ? <p className="muted">Сейчас доступен возврат только для продажи, оплаченной наличными.</p> : canReturn && cashSale && !shift ? <p className="muted">Для возврата откройте кассовую смену.</p> : null}
      </div>}
    </> : <p className="muted">История чеков появится после подключения кассы к серверу.</p>}
  </section>;
}
