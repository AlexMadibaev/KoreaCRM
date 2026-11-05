import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { createApiClient } from '@koreacrm/api-client';
import { MoneyInput } from '@koreacrm/ui';
import type { PosCustomer, PosMethodTotal, PosPage, PosPaymentMethod, PosSale, PosShift, PosShiftReport } from '@koreacrm/types';
import { formatMinor } from './calculations';
import { Icon, Kbd, Modal, Stepper, useOverlayKeys } from './cloud-ui';
import { buildEscPosShiftReport } from './escpos';
import { fullyReturned, refundInstruction, refundPreview, returnAmount, returnedQuantity } from './return-calculations';
import { printRows, textRows } from './print-layout';
import { cashVariance, shiftReportLines, varianceLabel } from './shift-report';

type Client = ReturnType<typeof createApiClient>;
type ShiftRow = PosShift & { openedAt: string; closedAt: string | null };
const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), 0n);
const dateTime = (value: string) => new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
// Older receipts carry an operation code instead of a store sequence number.
const shortNumber = (number: string) => /^\d+$/.test(number) ? number : number.replace(/^S-/, '').slice(0, 8).toUpperCase();
const methodIcon = (kind?: string) => kind === 'CASH' ? 'cash' : kind === 'DEBT' ? 'handshake' : 'card';
const initials = (name: string) => name.split(/\s+/).map(part => part[0] ?? '').join('').slice(0, 2).toUpperCase();

function Rows({ rows }: { rows: [string, string][] }) {
  return <div className="cs-kv">{rows.map(([label, value]) => <div key={label}><span>{label}</span><span>{formatMinor(value)}смн.</span></div>)}</div>;
}
const byKind = (rows: PosMethodTotal[]) => rows.map(row => [row.name, row.amountMinor] as [string, string]);

/** Shift list with a card per shift: totals, cash movement, deposits/withdrawals and closing. */
export function ShiftsScreen({ client, storeId, deviceId, current, canManage, queuedCashMinor, hasQueuedSales = false, printerHost, errorText, onClosed, onCashChanged }: { client: Client; storeId: string; deviceId: string; current: PosShift | null; canManage: boolean; queuedCashMinor: bigint; hasQueuedSales?: boolean; printerHost: string; errorText: (caught: unknown) => string; onClosed: () => void; onCashChanged: () => void }) {
  const [list, setList] = useState<{ items: ShiftRow[]; total: number } | null>(null);
  const [selected, setSelected] = useState(current?.id ?? '');
  const [report, setReport] = useState<PosShiftReport | null>(null);
  const [dialog, setDialog] = useState<null | 'DEPOSIT' | 'WITHDRAWAL' | 'close'>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const page = await client.get<PosPage<ShiftRow>>(`/stores/${storeId}/finance/cash-shifts?limit=50`);
    setList({ items: page.items, total: page.total });
    setSelected(value => value || page.items[0]?.id || '');
  }, [client, storeId]);
  useEffect(() => { load().catch(caught => setError(errorText(caught))); }, [load, errorText]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    client.get<PosShiftReport>(`/stores/${storeId}/finance/cash-shifts/${selected}/report`).then(value => { if (active) setReport(value); }).catch(caught => setError(errorText(caught)));
    return () => { active = false; };
  }, [client, storeId, selected, current?.expectedCashMinor, errorText]);
  const index = list?.items.findIndex(item => item.id === selected) ?? -1;
  const number = list && index >= 0 ? list.total - index : 0;
  const open = report?.shift.status === 'OPEN';
  const mine = open && report?.shift.deviceId === deviceId && current?.id === report.shift.id;
  const cash = report?.cash;
  const income = cash ? sum([cash.salesMinor, cash.customerPaymentsMinor, cash.depositsMinor]) + (BigInt(cash.correctionsMinor) > 0n ? BigInt(cash.correctionsMinor) : 0n) : 0n;
  const outcome = cash ? -sum([cash.refundsMinor, cash.withdrawalsMinor, cash.expensesMinor]) - (BigInt(cash.correctionsMinor) < 0n ? BigInt(cash.correctionsMinor) : 0n) : 0n;
  async function print() {
    if (!report) return;
    if (!printerHost.trim()) { printRows(textRows(['KOREA CRM', ...shiftReportLines(report)])); return; }
    try { await invoke('print_escpos', { host: printerHost.trim(), bytes: buildEscPosShiftReport(report) }); } catch (caught) { setError(errorText(caught)); }
  }
  const refresh = async () => { await load(); onCashChanged(); };
  const beginClose = async () => {
    if (!report) return;
    try { const fresh = await client.get<PosShiftReport>(`/stores/${storeId}/finance/cash-shifts/${report.shift.id}/report`); setReport(fresh); setDialog('close'); }
    catch (caught) { setError(errorText(caught)); }
  };
  let lastDay = '';
  return <div className="cs-shifts">
    <aside className="cs-shift-list">{list?.items.map((item, position) => {
      const day = new Date(item.openedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      const header = day !== lastDay ? (lastDay = day, <p className="cs-shift-day"><Icon name="calendar" size={18} />{day}</p>) : null;
      return <div key={item.id}>{header}<button type="button" className={item.id === selected ? 'is-on' : ''} onClick={() => setSelected(item.id)}><span><strong>Смена #{list.total - position}</strong><small>{item.status === 'OPEN' ? `Открыта в ${new Date(item.openedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : `Закрыта ${new Date(item.closedAt ?? item.openedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`}</small></span><em>{formatMinor(item.expectedCashMinor)}</em></button></div>;
    })}</aside>
    <section className="cs-shift-main">
      {error && <p className="cs-notice is-error">{error}</p>}
      {report && <>
        <header className="cs-shift-head"><div><h2>Смена #{number}</h2><p>{report.shift.openedBy} • {dateTime(report.shift.openedAt)}{report.shift.closedAt ? ` — ${dateTime(report.shift.closedAt)}` : ''}</p>{mine && canManage && <button type="button" className="cs-danger-soft" onClick={() => void beginClose()}>ЗАКРЫТЬ СМЕНУ</button>}</div><button type="button" className="cs-text-button is-accent" onClick={() => void print()}><Icon name="print" size={20} /> ПЕЧАТЬ</button></header>
        <div className="cs-shift-card">
          {mine && canManage && <div className="cs-shift-ops"><p>Финансовые операции</p><button type="button" onClick={() => setDialog('WITHDRAWAL')}><Icon name="chevronUp" size={18} /> ВЫДАЧА</button><button type="button" onClick={() => setDialog('DEPOSIT')}><Icon name="chevronDown" size={18} /> ПРИЁМ</button></div>}
          <div className="cs-shift-info"><span><Icon name="layout" size={20} /><span><strong>{report.shift.store.name}</strong><small>Магазин</small></span></span><span><Icon name="terminal" size={20} /><span><strong>{report.shift.deviceId.slice(0, 18)}</strong><small>Касса</small></span></span></div>
          <div className="cs-shift-grid">
            <section><header><h3>Продажи</h3><strong>{report.sales.count}</strong></header><Rows rows={[...byKind(report.sales.byMethod), ['Сумма продаж', report.sales.totalMinor]]} /></section>
            <section><header><h3>Возвраты</h3><strong>{report.returns.count}</strong></header><Rows rows={[...byKind(report.returns.byMethod), ['Сумма возвратов продаж', report.returns.amountMinor]]} /></section>
            <section className="is-wide"><header><h3>Касса</h3></header><Rows rows={[['Сумма на начало смены', report.cash.openingMinor], ['Сумма всех взносов', income.toString()], ['Сумма всех выносов', outcome.toString()], [open ? 'Сумма на текущий момент' : 'Сумма на конец смены', report.cash.expectedMinor]]} /></section>
            <section className="is-wide"><header><h3>Долги</h3></header><Rows rows={[['Выдано в долг', report.sales.debtMinor], ['Погашено долгов', report.customerPayments.amountMinor]]} /></section>
          </div>
          <p className="cs-shift-revenue">Выручка с учетом возвратов <strong>{formatMinor(BigInt(report.sales.totalMinor) - BigInt(report.returns.amountMinor))}смн.</strong></p>
          {report.reward && <div className="cs-note"><strong>Вознаграждение: {report.reward.employeeName}</strong><Rows rows={[
            ['Начислено по чекам этой смены с учётом возвратов', report.reward.earnedMinor],
            [open ? 'К выплате при закрытии' : 'Выплачено из кассы', open ? report.reward.payableMinor : report.reward.paidMinor],
            ...(!open ? [['Осталось наличных для следующей смены', report.shift.closingCashMinor ?? report.cash.expectedMinor] as [string, string]] : []),
          ]} />{!open && BigInt(report.reward.paidMinor) > 0n && <p>К выдаче сотруднику: {formatMinor(report.reward.paidMinor)} смн. Эта сумма уже вычтена из кассы.</p>}</div>}
          {(report.shift.openingVarianceMinor !== '0' || report.shift.closedAt) && <div className="cs-note">{report.shift.openingVarianceMinor !== '0' && <p>При открытии: {varianceLabel(BigInt(report.shift.openingVarianceMinor))}{report.shift.openingComment ? ` · ${report.shift.openingComment}` : ''}</p>}{report.shift.closedAt && <p>Пересчёт при закрытии: {formatMinor(report.shift.actualCashMinor ?? '0')}смн. · {varianceLabel(BigInt(report.shift.closingVarianceMinor))}{report.shift.closingComment ? ` · ${report.shift.closingComment}` : ''}</p>}</div>}
        </div>
        {report.operations.length > 0 && <div className="cs-shift-card"><h3 className="cs-shift-sub">Движение денег</h3>{report.operations.map(operation => <article key={operation.id} className="cs-money-row"><div><strong>{operation.sourceType === 'SHIFT_CLOSE_VARIANCE' ? 'Расхождение' : operation.type === 'DEPOSIT' ? 'Приём' : operation.type === 'WITHDRAWAL' ? 'Выдача' : operation.type === 'EXPENSE' ? 'Расход' : 'Корректировка'}</strong><small><Icon name="calendar" size={14} /> {dateTime(operation.createdAt)} · {operation.employee}{operation.comment ? ` · ${operation.comment}` : ''}</small></div><span className={BigInt(operation.amountMinor) < 0n ? 'is-minus' : ''}>{formatMinor(operation.amountMinor)}смн.</span></article>)}</div>}
      </>}
    </section>
    {(dialog === 'DEPOSIT' || dialog === 'WITHDRAWAL') && report && <CashOperationModal client={client} storeId={storeId} shiftId={report.shift.id} type={dialog} expectedMinor={report.cash.expectedMinor} errorText={errorText} onDone={() => { setDialog(null); void refresh(); }} onClose={() => setDialog(null)} />}
    {dialog === 'close' && report && <CloseShiftModal client={client} storeId={storeId} shiftId={report.shift.id} expectedMinor={report.cash.expectedMinor} reward={report.reward} hasQueuedSales={hasQueuedSales} queuedCashMinor={queuedCashMinor} errorText={errorText} onClosed={() => { setDialog(null); onClosed(); void load(); void client.get<PosShiftReport>(`/stores/${storeId}/finance/cash-shifts/${report.shift.id}/report`).then(setReport).catch(caught => setError(errorText(caught))); }} onClose={() => setDialog(null)} />}
  </div>;
}

function CashOperationModal({ client, storeId, shiftId, type, expectedMinor, errorText, onDone, onClose }: { client: Client; storeId: string; shiftId: string; type: 'DEPOSIT' | 'WITHDRAWAL'; expectedMinor: string; errorText: (caught: unknown) => string; onDone: () => void; onClose: () => void }) {
  const [operationId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(''), [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const value = /^\d+$/.test(amount) ? BigInt(amount) : 0n;
  const valid = value > 0n && comment.trim().length > 0 && (type === 'DEPOSIT' || value <= BigInt(expectedMinor));
  async function submit() {
    if (!valid) { setError(type === 'WITHDRAWAL' && value > BigInt(expectedMinor) ? 'В кассе нет такой суммы.' : 'Укажите сумму и комментарий.'); return; }
    setBusy(true); setError('');
    try { await client.post(`/stores/${storeId}/finance/cash-shifts/${shiftId}/operations`, { operationId, type, amountMinor: amount, comment: comment.trim() }); onDone(); }
    catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  return <Modal title={type === 'DEPOSIT' ? 'Приём' : 'Выдача'} onClose={onClose} action={{ label: 'СОЗДАТЬ', tone: 'accent', disabled: busy || !valid, onClick: () => void submit() }}>
    <label className="cs-outlined"><span>Сумма *</span><MoneyInput autoFocus valueMinor={amount || '0'} onMinorChange={setAmount} /><em>смн.</em></label>
    <label className="cs-outlined is-area"><span>Комментарий *</span><textarea value={comment} onChange={event => setComment(event.target.value)} maxLength={1000} placeholder={type === 'DEPOSIT' ? 'Например, размен' : 'Например, инкассация, аренда'} /></label>
    {error && <p className="cs-error">{error}</p>}
  </Modal>;
}

function CloseShiftModal({ client, storeId, shiftId, expectedMinor, reward, hasQueuedSales, queuedCashMinor, errorText, onClosed, onClose }: { client: Client; storeId: string; shiftId: string; expectedMinor: string; reward: PosShiftReport['reward']; hasQueuedSales: boolean; queuedCashMinor: bigint; errorText: (caught: unknown) => string; onClosed: () => void; onClose: () => void }) {
  const [counted, setCounted] = useState(expectedMinor), [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const variance = cashVariance(counted || '0', expectedMinor) ?? 0n;
  const [confirmed, setConfirmed] = useState(false);
  const payout = BigInt(reward?.payableMinor ?? '0');
  const remaining = BigInt(counted || '0') - payout;
  async function close() {
    if (hasQueuedSales || queuedCashMinor > 0n) { setError('Сначала отправьте все сохранённые продажи, включая безналичные.'); return; }
    if (!reward || !confirmed || remaining < 0n) return;
    if (variance !== 0n && !comment.trim()) { setError('Есть расхождение. Укажите причину.'); return; }
    setBusy(true); setError('');
    try { await client.post(`/stores/${storeId}/finance/cash-shifts/${shiftId}/close`, { actualCashMinor: counted || '0', rewardPayoutMinor: payout.toString(), ...(comment.trim() ? { comment: comment.trim() } : {}) }); onClosed(); }
    catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  return <Modal title="Сверка и закрытие смены" onClose={onClose} action={{ label: 'ПОДТВЕРДИТЬ И ЗАКРЫТЬ', tone: 'danger', disabled: busy || !reward || !confirmed || remaining < 0n || hasQueuedSales || queuedCashMinor > 0n, onClick: () => void close() }}>
    <p className="cs-caption">Пересчитайте наличные в кассе. Расхождение будет проведено в этой смене.</p>
    <div className="cs-field"><span>Расчётная сумма</span><strong>{formatMinor(expectedMinor)}смн.</strong></div>
    <label className="cs-outlined"><span>Пересчитанные наличные до выплаты %</span><MoneyInput autoFocus valueMinor={counted} onMinorChange={value => { setCounted(value); setConfirmed(false); }} /><em>смн.</em></label>
    <p className={variance === 0n ? 'cs-ok' : 'cs-error'}>{varianceLabel(variance)}</p>
    {variance !== 0n && <label className="cs-outlined is-area is-required"><span>Причина расхождения *</span><textarea value={comment} onChange={event => setComment(event.target.value)} maxLength={1000} /></label>}
    {reward ? <><p>Вознаграждение сотруднику <strong>{reward.employeeName}</strong>: <strong>{formatMinor(payout)} смн.</strong></p><p>Останется для следующей смены: <strong>{formatMinor(remaining)} смн.</strong></p>{remaining < 0n && <p className="cs-error">Наличных недостаточно для выплаты. Пополните кассу перед закрытием.</p>}<label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Наличные пересчитаны, выплату и остаток подтверждаю.</label><p className="cs-caption">Заберите вознаграждение после успешного закрытия. Повторно выплата не проводится.</p></> : <p className="cs-error">Обновите сервер для расчёта вознаграждения при закрытии.</p>}
    {(hasQueuedSales || queuedCashMinor > 0n) && <p className="cs-error">Перед закрытием отправьте все сохранённые чеки.</p>}
    {error && <p className="cs-error">{error}</p>}
  </Modal>;
}

/** Receipt journal: search, payment and item details, printing and returns. */
export function JournalModal({ client, storeId, deviceId, shift, canReturn, printerHost, errorText, onPrint, onReturned, onClose }: { client: Client; storeId: string; deviceId: string; shift: PosShift | null; canReturn: boolean; printerHost: string; errorText: (caught: unknown) => string; onPrint: (sale: PosSale) => void; onReturned: () => void; onClose: () => void }) {
  const [search, setSearch] = useState(''), [day, setDay] = useState('');
  const [pages, setPages] = useState<{ items: PosSale[]; total: number; page: number }>({ items: [], total: 0, page: 1 });
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, 'pay' | 'items' | undefined>>({});
  const [returning, setReturning] = useState<PosSale | null>(null);
  const [revision, setRevision] = useState(0);
  const load = useCallback(async (page: number, query: string, date: string) => {
    setLoading(true);
    // The day is taken in the till's local time zone.
    const range = date ? `&from=${encodeURIComponent(new Date(`${date}T00:00:00`).toISOString())}&to=${encodeURIComponent(new Date(new Date(`${date}T00:00:00`).getTime() + 86_400_000).toISOString())}` : '';
    try {
      const data = await client.get<PosPage<PosSale>>(`/stores/${storeId}/sales?limit=10&page=${page}${query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''}${range}`);
      setPages(current => ({ items: page === 1 ? data.items : [...current.items, ...data.items], total: data.total, page }));
    } catch (caught) { setError(errorText(caught)); }
    finally { setLoading(false); }
  }, [client, storeId, errorText]);
  useEffect(() => { const timer = window.setTimeout(() => void load(1, search, day), search ? 300 : 0); return () => window.clearTimeout(timer); }, [load, search, day, revision]);
  useOverlayKeys({ escape: () => { if (!returning) onClose(); } });
  const toggle = (id: string, part: 'pay' | 'items') => setOpen(current => ({ ...current, [id]: current[id] === part ? undefined : part }));
  return <div className="cs-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="cs-modal cs-journal" role="dialog" aria-modal="true" aria-label="Журнал чеков">
      <header className="cs-modal-head"><h2>Журнал чеков</h2><button type="button" className="cs-text-button" onClick={onClose}>ЗАКРЫТЬ <Kbd>ESC</Kbd></button></header>
      <div className="cs-journal-body">
        <aside className="cs-journal-filter"><p><Icon name="search" size={16} /> Фильтр{day && <span className="cs-filter-day"><Icon name="calendar" size={16} /> {new Date(`${day}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}</p><label className="cs-date-button"><Icon name="calendar" size={18} /><span>{day ? 'ДРУГАЯ ДАТА' : 'ВЫБЕРИТЕ ДАТУ'}</span><input type="date" value={day} onClick={event => event.currentTarget.showPicker?.()} onChange={event => setDay(event.target.value)} /></label>{day && <button type="button" className="cs-text-button" onClick={() => setDay('')}>ВСЕ ДАТЫ</button>}<label className="cs-outlined"><span>Номер чека или телефон</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="# Введите номер" /></label></aside>
        <div className="cs-journal-list">
          {error && <p className="cs-notice is-error">{error}</p>}
          {!loading && !pages.items.length && <p className="cs-caption">Чеков не найдено.</p>}
          {pages.items.map(sale => {
            const debt = BigInt((sale as PosSale & { debtMinor?: string }).debtMinor ?? '0');
            const returned = (sale.returns ?? []).reduce((total, record) => total + BigInt(record.amountMinor), 0n);
            const status = sale.status === 'VOIDED' ? 'Аннулирован' : fullyReturned(sale) && sale.returns?.length ? 'Возвращён полностью' : sale.returns?.length ? `Возвращён частично · ${formatMinor(returned)}смн.` : debt > 0n ? `Долг ${formatMinor(debt)}смн.` : 'Оплачен';
            const returnable = canReturn && sale.status !== 'VOIDED' && !fullyReturned(sale) && Boolean(shift);
            return <article key={sale.id} className="cs-receipt-card">
              <header><h3>Продажа #{shortNumber(sale.number)}</h3><button type="button" className="cs-chip-button" onClick={() => onPrint(sale)}><Icon name="print" size={16} /> ПЕЧАТЬ</button>{returnable && <button type="button" className="cs-chip-button" onClick={() => setReturning(sale)}>ВОЗВРАТ</button>}<strong>{formatMinor(sale.totalMinor)}смн.</strong></header>
              <p><Icon name="calendar" size={14} /> {dateTime(sale.createdAt)} · {sale.employee.name}{sale.seller ? ` · продавец ${sale.seller.name}` : ''}</p>
              <p><Icon name="layout" size={14} /> {sale.store.name} · <Icon name="person" size={14} /> {sale.customer ? `${sale.customer.firstName} ${sale.customer.lastName ?? ''}` : 'Розничный покупатель'}</p>
              {sale.comment && <p className="cs-caption">«{sale.comment}»</p>}
              <button type="button" className="cs-receipt-toggle" onClick={() => toggle(sale.id, 'pay')}><Icon name={debt > 0n && !sale.returns?.length ? 'clock' : 'receipt'} size={18} /><span className={debt > 0n ? 'cs-orange' : ''}>{status}</span><Icon name={open[sale.id] === 'pay' ? 'chevronUp' : 'chevronDown'} size={18} /></button>
              {open[sale.id] === 'pay' && <table className="cs-receipt-table"><thead><tr><th /><th>Способ</th><th>Сумма</th></tr></thead><tbody>{sale.payments.map(part => <tr key={part.id}><td><Icon name={methodIcon(part.paymentMethod.kind)} size={18} /></td><td>{part.paymentMethod.name}</td><td>{formatMinor(part.amountMinor)}</td></tr>)}{(sale.returns ?? []).flatMap(record => (record.payments ?? []).map(part => <tr key={part.id} className="is-minus"><td><Icon name="undo" size={18} /></td><td>Возврат · {part.paymentMethod.name}</td><td>-{formatMinor(part.amountMinor)}</td></tr>))}</tbody></table>}
              <button type="button" className="cs-receipt-toggle" onClick={() => toggle(sale.id, 'items')}><Icon name="tiles" size={18} /><span>Список товаров <em>{sale.items.length} поз.</em></span><Icon name={open[sale.id] === 'items' ? 'chevronUp' : 'chevronDown'} size={18} /></button>
              {open[sale.id] === 'items' && <table className="cs-receipt-table"><tbody>{sale.items.map(item => <tr key={item.id}><td /><td>{item.product.name}{returnedQuantity(sale, item.id) ? <small> · возвращено {returnedQuantity(sale, item.id)}</small> : null}</td><td>{item.quantity} × {formatMinor(item.priceMinor)}</td><td>{formatMinor(item.totalMinor)}</td></tr>)}</tbody></table>}
            </article>;
          })}
          {pages.items.length < pages.total && <button type="button" className="cs-more" disabled={loading} onClick={() => void load(pages.page + 1, search, day)}>{loading ? 'ЗАГРУЗКА…' : 'ЗАГРУЗИТЬ ЕЩЁ'}</button>}
        </div>
      </div>
    </section>
    {returning && shift && <ReturnModal client={client} storeId={storeId} deviceId={deviceId} shift={shift} sale={returning} printerHost={printerHost} errorText={errorText} onDone={() => { setReturning(null); setRevision(value => value + 1); onReturned(); }} onClose={() => setReturning(null)} />}
  </div>;
}

function ReturnModal({ client, storeId, deviceId, shift, sale, errorText, onDone, onClose }: { client: Client; storeId: string; deviceId: string; shift: PosShift; sale: PosSale; printerHost: string; errorText: (caught: unknown) => string; onDone: () => void; onClose: () => void }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState(''), [reason, setReason] = useState('');
  const [operationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState<PosSale | null>(null);
  let amount = 0n;
  try { amount = returnAmount(sale, quantities); } catch { /* The steppers keep quantities in range. */ }
  const plan = amount > 0n ? refundPreview(sale, amount) : [];
  const cashOut = plan.filter(part => part.kind === 'CASH').reduce((total, part) => total + part.amountMinor, 0n);
  const nonCash = amount - cashOut;
  async function submit() {
    if (amount <= 0n) { setError('Выберите товары для возврата.'); return; }
    if (reason.trim().length < 5) { setError('Укажите причину возврата: минимум 5 символов.'); return; }
    if (cashOut > BigInt(shift.expectedCashMinor)) { setError('В кассе недостаточно наличных.'); return; }
    setBusy(true); setError('');
    try {
      const items = Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
      setDone(await client.post<PosSale>(`/stores/${storeId}/sales/${sale.id}/return`, { operationId, deviceId, cashShiftId: shift.id, reason: reason.trim(), items }));
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  if (done) {
    const record = done.returns?.find(item => item.operationId === operationId);
    return <Modal title="Возврат успешно создан" onClose={onDone} action={{ label: 'ЗАКРЫТЬ', tone: 'primary', onClick: onDone }}>
      {(record?.payments ?? []).map(part => <div className="cs-field" key={part.id}><span>{part.paymentMethod.name} — {refundInstruction(part.paymentMethod.kind)}</span><strong>{formatMinor(part.amountMinor)}смн.</strong></div>)}
      <div className="cs-line-total"><span>Итог</span><strong>{formatMinor(record?.amountMinor ?? amount)}смн.</strong></div>
    </Modal>;
  }
  const visible = sale.items.filter(item => item.product.name.toLocaleLowerCase('ru').includes(filter.trim().toLocaleLowerCase('ru')));
  return <Modal title="Возврат продажи" width={640} className="cs-return-modal" onClose={onClose} action={{ label: `СОЗДАТЬ ВОЗВРАТ НА СУММУ ${formatMinor(amount)}СМН.`, tone: 'accent', disabled: busy || amount <= 0n, onClick: () => void submit() }}>
    <p className="cs-return-title">ПРОДАЖА #{shortNumber(sale.number)} <small>от {new Date(sale.createdAt).toLocaleString('ru-RU')}</small></p>
    <div className="cs-two"><label className="cs-outlined is-static"><span>Наличные</span><Icon name="cash" size={20} /><input readOnly value={formatMinor(cashOut)} /></label><label className="cs-outlined is-static"><span>Безналичные и долг</span><Icon name="card" size={20} /><input readOnly value={formatMinor(nonCash)} /></label></div>
    {plan.length > 0 && <p className="cs-caption">{plan.map(part => `${part.name}: ${formatMinor(part.amountMinor)} — ${refundInstruction(part.kind)}`).join(' · ')}</p>}
    <label className="cs-outlined"><Icon name="search" size={20} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Поиск по наименованию" /></label>
    <table className="cs-return-table"><thead><tr><th>Наименование</th><th>Цена</th><th>Количество</th><th>Сумма</th></tr></thead><tbody>{visible.map(item => {
      const available = item.quantity - returnedQuantity(sale, item.id);
      const quantity = quantities[item.id] ?? 0;
      let lineSum = 0n;
      try { lineSum = returnAmount(sale, { [item.id]: quantity }); } catch { /* Out of range is prevented by the stepper. */ }
      return <tr key={item.id}><td><strong>{item.product.name}</strong><small>Доступно для возврата: {available}</small>{item.discountMinor !== '0' && <small>Скидка: {formatMinor(item.discountMinor)}смн.</small>}</td><td>{formatMinor(item.priceMinor)}</td><td><Stepper value={quantity} min={0} max={available} onChange={value => setQuantities(current => ({ ...current, [item.id]: value }))} /></td><td>{formatMinor(lineSum)}</td></tr>;
    })}</tbody></table>
    <label className="cs-outlined is-area"><span>Причина возврата *</span><textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Например, товар не подошёл" /></label>
    {error && <p className="cs-error">{error}</p>}
  </Modal>;
}

type DebtEntry = { id: string; createdAt: string; type: 'SALE' | 'PAYMENT' | 'RETURN'; amountMinor: string; sale: { number: string } | null; customerPayment: { paymentMethod: { name: string } } | null };

/** Debtors list → customer card → repayment, as in the cloud POS. */
export function DebtsModal({ client, storeId, shift, methods, canPay, errorText, onPaid, onClose }: { client: Client; storeId: string; shift: PosShift | null; methods: PosPaymentMethod[]; canPay: boolean; errorText: (caught: unknown) => string; onPaid: (cash: boolean) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [debtors, setDebtors] = useState<PosCustomer[]>([]);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [entries, setEntries] = useState<DebtEntry[]>([]);
  const [paying, setPaying] = useState<bigint | null>(null);
  const [revision, setRevision] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => {
      client.get<PosPage<PosCustomer>>(`/customers?debtors=1&limit=100${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`).then(page => { setDebtors(page.items); setCustomer(current => current ? page.items.find(item => item.id === current.id) ?? null : null); }).catch(caught => setError(errorText(caught)));
    }, search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [client, search, revision, errorText]);
  useEffect(() => {
    if (!customer) { setEntries([]); return; }
    client.get<PosPage<DebtEntry>>(`/customers/${customer.id}/history?kind=debts&limit=50`).then(page => setEntries(page.items)).catch(caught => setError(errorText(caught)));
  }, [client, customer, revision, errorText]);
  const name = (value: PosCustomer) => `${value.firstName} ${value.lastName ?? ''}`.trim();
  const debt = BigInt(customer?.debtBalanceMinor ?? '0');
  if (paying !== null && customer) return <DebtPayModal client={client} storeId={storeId} shift={shift} customer={customer} methods={methods} defaultMinor={paying} canPay={canPay} errorText={errorText} onPaid={cash => { setPaying(null); setRevision(value => value + 1); onPaid(cash); }} onClose={() => setPaying(null)} />;
  if (customer) return <Modal title={<span className="cs-debtor-head"><span className="cs-avatar is-cyan is-big">{initials(name(customer))}</span><strong>{name(customer)}</strong><small className="cs-orange">Долг {formatMinor(debt)}смн.</small></span>} className="cs-debtor-card" width={400} onClose={() => setCustomer(null)}>
    <ul className="cs-debt-list">{entries.filter(entry => entry.type === 'SALE').map(entry => <li key={entry.id}><button type="button" onClick={() => setPaying(BigInt(entry.amountMinor) < debt ? BigInt(entry.amountMinor) : debt)} disabled={debt <= 0n}><span className="cs-round-icon"><Icon name="chevronUp" size={18} /></span><span><strong>Продажа #{entry.sale ? shortNumber(entry.sale.number) : ''}</strong><small>{new Date(entry.createdAt).toLocaleString('ru-RU')}</small></span><span><strong>{formatMinor(entry.amountMinor)}смн.</strong><small>К оплате</small></span></button></li>)}</ul>
    {debt > 0n && <button type="button" className="cs-action is-accent" onClick={() => setPaying(debt)}>ПОГАСИТЬ ВЕСЬ ДОЛГ {formatMinor(debt)}СМН.</button>}
  </Modal>;
  return <Modal title="Список должников" width={500} onClose={onClose}>
    <label className="cs-outlined"><Icon name="search" size={20} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Введите текст для поиска" /></label>
    {error && <p className="cs-error">{error}</p>}
    <p className="cs-caption">Найдено {debtors.length}</p>
    <ul className="cs-debtors">{debtors.map(item => <li key={item.id}><button type="button" onClick={() => setCustomer(item)}><span className="cs-avatar is-cyan is-square">{initials(name(item))}</span><strong>{name(item)}</strong><span>{formatMinor(item.debtBalanceMinor ?? '0')}смн.</span></button></li>)}</ul>
  </Modal>;
}

function DebtPayModal({ client, storeId, shift, customer, methods, defaultMinor, canPay, errorText, onPaid, onClose }: { client: Client; storeId: string; shift: PosShift | null; customer: PosCustomer; methods: PosPaymentMethod[]; defaultMinor: bigint; canPay: boolean; errorText: (caught: unknown) => string; onPaid: (cash: boolean) => void; onClose: () => void }) {
  const options = methods.filter(method => method.kind !== 'DEBT' && method.kind !== 'BONUS');
  const [methodId, setMethodId] = useState(options[0]?.id ?? '');
  const [amount, setAmount] = useState(defaultMinor.toString());
  const [operationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const debt = BigInt(customer.debtBalanceMinor ?? '0');
  const value = /^\d+$/.test(amount) ? BigInt(amount) : 0n;
  const method = options.find(item => item.id === methodId);
  async function pay() {
    if (!method || value <= 0n || value > debt) { setError(`Сумма от 0,01 до ${formatMinor(debt)}.`); return; }
    if (method.kind === 'CASH' && !shift) { setError('Для наличных откройте смену.'); return; }
    setBusy(true); setError('');
    try { await client.post(`/stores/${storeId}/customers/${customer.id}/payments`, { operationId, paymentMethodId: method.id, amountMinor: amount, ...(shift ? { cashShiftId: shift.id } : {}) }); onPaid(method.kind === 'CASH'); }
    catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  return <Modal title={`${customer.firstName} ${customer.lastName ?? ''}`.trim()} width={400} onClose={onClose} action={{ label: `ЗАКРЫТЬ ДОЛГ НА СУММУ ${formatMinor(value)}СМН.`, tone: 'accent', disabled: busy || !canPay || value <= 0n || value > debt, onClick: () => void pay() }}>
    <div className="cs-methods is-two">{options.map(item => <button type="button" key={item.id} className={item.id === methodId ? 'is-on' : ''} onClick={() => setMethodId(item.id)}><span className="cs-method-tile"><Icon name={methodIcon(item.kind)} size={28} /></span><small>{item.name}</small></button>)}</div>
    <label className="cs-outlined"><span>К оплате</span><MoneyInput autoFocus valueMinor={amount} onMinorChange={setAmount} /></label>
    <div className="cs-debt-box"><span>Общий долг составит:</span><strong>{formatMinor(debt - (value > debt ? debt : value))}смн.</strong></div>
    {!canPay && <p className="cs-caption">Нет права принимать оплату долга.</p>}
    {error && <p className="cs-error">{error}</p>}
  </Modal>;
}
