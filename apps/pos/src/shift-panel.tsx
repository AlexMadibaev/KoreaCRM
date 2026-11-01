import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { createApiClient } from '@koreacrm/api-client';
import { MoneyInput } from '@koreacrm/ui';
import type { PosLastClosedShift, PosMethodTotal, PosShift, PosShiftReport } from '@koreacrm/types';
import { formatMinor } from './calculations';
import { buildEscPosShiftReport } from './escpos';
import { cashOperationLabels, cashVariance, varianceLabel } from './shift-report';

type Client = ReturnType<typeof createApiClient>;
type Props = {
  client: Client; storeId: string; deviceId: string; shift: PosShift | null;
  expectedCashMinor: string | null; queuedCashMinor: bigint;
  canManage: boolean; canView: boolean; disabled: boolean; offline: boolean; printerHost: string;
  errorText: (caught: unknown) => string;
  onOpened: (shift: PosShift) => Promise<void> | void; onClosed: () => Promise<void> | void; onCashChanged: () => Promise<void> | void;
};
type CashDraft = { operationId: string; type: 'DEPOSIT' | 'WITHDRAWAL'; amountMinor: string; comment: string };
const newCashDraft = (type: CashDraft['type'] = 'DEPOSIT'): CashDraft => ({ operationId: crypto.randomUUID(), type, amountMinor: '0', comment: '' });

function MethodList({ rows }: { rows: PosMethodTotal[] }) {
  return rows.length ? <ul className="shift-report-methods">{rows.map(row => <li key={row.paymentMethodId}><span>{row.name}</span><strong>{formatMinor(row.amountMinor)}</strong></li>)}</ul> : null;
}

export function ShiftReportView({ report }: { report: PosShiftReport }) {
  const { shift, sales, returns, customerPayments, cash } = report;
  const closed = shift.status === 'CLOSED';
  const row = (label: string, value: string, sign = '') => <div className="shift-report-row"><span>{label}</span><strong>{sign}{formatMinor(value)}</strong></div>;
  return <div className="shift-report-body">
    <p className="muted">{shift.store.name} · касса {shift.deviceId} · открыл {shift.openedBy} {new Date(shift.openedAt).toLocaleString('ru-RU')}{closed && shift.closedAt ? ` · закрыл ${shift.closedBy ?? ''} ${new Date(shift.closedAt).toLocaleString('ru-RU')}` : ''}</p>
    <div className="shift-report-grid">
      <section><h4>Продажи · {sales.count}</h4>{row('Сумма продаж', sales.totalMinor)}{row('Скидки', sales.discountMinor)}<MethodList rows={sales.byMethod} />{sales.debtMinor !== '0' && row('Выдано в долг', sales.debtMinor)}</section>
      <section><h4>Возвраты · {returns.count}</h4>{row('Сумма возвратов', returns.amountMinor)}{returns.receiptlessCount ? row(`в т.ч. без чека (${returns.receiptlessCount})`, returns.receiptlessMinor ?? '0') : null}<MethodList rows={returns.byMethod} /></section>
      <section><h4>Погашение долгов · {customerPayments.count}</h4>{row('Получено', customerPayments.amountMinor)}<MethodList rows={customerPayments.byMethod} /></section>
      <section><h4>Наличные в кассе</h4>
        {row('На начало смены', cash.openingMinor)}{row('Продажи', cash.salesMinor, '+')}{row('Погашение долгов', cash.customerPaymentsMinor, '+')}{row('Возвраты', cash.refundsMinor)}{row('Внесения', cash.depositsMinor, '+')}{row('Изъятия', cash.withdrawalsMinor)}
        {cash.expensesMinor !== '0' && row('Расходы', cash.expensesMinor)}{cash.correctionsMinor !== '0' && row('Корректировки', cash.correctionsMinor)}
        <div className="shift-report-row is-total"><span>{closed ? 'Итого на конец' : 'Сейчас в кассе'}</span><strong>{formatMinor(cash.expectedMinor)}</strong></div>
      </section>
    </div>
    {shift.openingVarianceMinor !== '0' && <p className="shift-variance">При открытии: {varianceLabel(BigInt(shift.openingVarianceMinor))}{shift.openingComment ? ` · ${shift.openingComment}` : ''}</p>}
    {closed && <p className="shift-variance">Пересчёт при закрытии: {formatMinor(shift.actualCashMinor ?? '0')} · {varianceLabel(BigInt(shift.closingVarianceMinor))}{shift.closingComment ? ` · ${shift.closingComment}` : ''}</p>}
    {report.operations.length > 0 && <><h4>Движение денег</h4><ul className="shift-report-operations">{report.operations.map(operation => <li key={operation.id}><span>{new Date(operation.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · {operation.sourceType === 'SHIFT_CLOSE_VARIANCE' ? 'Расхождение при закрытии' : cashOperationLabels[operation.type] ?? operation.type}{operation.comment ? ` · ${operation.comment}` : ''} · {operation.employee}</span><strong>{formatMinor(operation.amountMinor)}</strong></li>)}</ul></>}
  </div>;
}

export function ShiftPanel({ client, storeId, deviceId, shift, expectedCashMinor, queuedCashMinor, canManage, canView, disabled, offline, printerHost, errorText, onOpened, onClosed, onCashChanged }: Props) {
  const [lastClosed, setLastClosed] = useState<PosLastClosedShift | undefined>(undefined);
  const [openingCash, setOpeningCash] = useState('0'), [openingComment, setOpeningComment] = useState('');
  const [countedCash, setCountedCash] = useState(''), [closingComment, setClosingComment] = useState(''), [confirmClose, setConfirmClose] = useState(false);
  const [cashDraft, setCashDraft] = useState<CashDraft>(newCashDraft);
  const [report, setReport] = useState<PosShiftReport | null>(null), [finalReport, setFinalReport] = useState<PosShiftReport | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');

  useEffect(() => {
    if (shift || !storeId || !deviceId || !canView || offline) return;
    let active = true;
    client.get<PosLastClosedShift>(`/stores/${storeId}/finance/cash-shifts/last-closed?deviceId=${encodeURIComponent(deviceId)}`)
      .then(previous => { if (!active) return; setLastClosed(previous); setOpeningCash(previous?.closingCashMinor ?? '0'); })
      .catch(() => { if (active) setLastClosed(null); });
    return () => { active = false; };
  }, [client, storeId, deviceId, shift, canView, offline]);

  const loadReport = useCallback(async (shiftId: string) => {
    const loaded = await client.get<PosShiftReport>(`/stores/${storeId}/finance/cash-shifts/${shiftId}/report`);
    setReport(loaded);
    return loaded;
  }, [client, storeId]);
  useEffect(() => {
    if (!shift || !canView || offline) { setReport(null); return; }
    loadReport(shift.id).catch(caught => setError(`Отчёт смены не загрузился: ${errorText(caught)}`));
  }, [shift?.id, shift?.expectedCashMinor, canView, offline, loadReport, errorText]);

  const openingVariance = lastClosed ? cashVariance(openingCash, lastClosed.closingCashMinor) : 0n;
  const closingVariance = expectedCashMinor !== null && countedCash !== '' ? cashVariance(countedCash, expectedCashMinor) : null;

  async function openShift(event: FormEvent) {
    event.preventDefault();
    if (openingVariance && !openingComment.trim()) { setError('Сумма отличается от остатка прошлой смены. Укажите причину.'); return; }
    setBusy(true); setError(''); setNotice(''); setFinalReport(null);
    try {
      const opened = await client.post<PosShift>(`/stores/${storeId}/finance/cash-shifts`, { deviceId, openingCashMinor: openingCash, ...(openingComment.trim() ? { comment: openingComment.trim() } : {}) });
      setOpeningComment('');
      await onOpened(opened);
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  async function closeShift(event: FormEvent) {
    event.preventDefault();
    if (!shift) return;
    if (countedCash === '') { setError('Пересчитайте наличные и введите сумму.'); return; }
    if (closingVariance && !closingComment.trim()) { setError('Есть расхождение. Укажите причину перед закрытием.'); return; }
    if (!confirmClose) { setConfirmClose(true); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await client.post(`/stores/${storeId}/finance/cash-shifts/${shift.id}/close`, { actualCashMinor: countedCash, ...(closingComment.trim() ? { comment: closingComment.trim() } : {}) });
      const closedId = shift.id;
      setCountedCash(''); setClosingComment(''); setConfirmClose(false);
      await onClosed();
      if (canView) setFinalReport(await loadReport(closedId).catch(() => null));
      setNotice('Смена закрыта. Z-отчёт ниже.');
    } catch (caught) { setError(errorText(caught)); setConfirmClose(false); }
    finally { setBusy(false); }
  }
  async function submitCash(event: FormEvent) {
    event.preventDefault();
    if (!shift) return;
    if (!/^[1-9]\d*$/.test(cashDraft.amountMinor)) { setError('Укажите сумму больше нуля.'); return; }
    if (!cashDraft.comment.trim()) { setError('Укажите комментарий: кто и зачем вносит или забирает деньги.'); return; }
    if (cashDraft.type === 'WITHDRAWAL' && expectedCashMinor !== null && BigInt(cashDraft.amountMinor) > BigInt(expectedCashMinor)) { setError('В кассе нет такой суммы наличных.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await client.post(`/stores/${storeId}/finance/cash-shifts/${shift.id}/operations`, { operationId: cashDraft.operationId, type: cashDraft.type, amountMinor: cashDraft.amountMinor, comment: cashDraft.comment.trim() });
      setNotice(`${cashOperationLabels[cashDraft.type]} ${formatMinor(cashDraft.amountMinor)} сомони проведено.`);
      setCashDraft(newCashDraft(cashDraft.type));
      await onCashChanged();
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  async function printReport(value: PosShiftReport) {
    if (!printerHost.trim()) { window.print(); return; }
    setBusy(true); setError('');
    try { await invoke('print_escpos', { host: printerHost.trim(), bytes: buildEscPosShiftReport(value) }); }
    catch (caught) { setError(`Принтер не ответил: ${errorText(caught)}`); }
    finally { setBusy(false); }
  }

  const locked = disabled || busy;
  const shownReport = shift ? report : finalReport;
  return <section id="shift" className="panel shift-screen">
    <div className="screen-heading"><p className="eyebrow">УПРАВЛЕНИЕ</p><h2>Кассовая смена</h2><p>Сверка денег при открытии, внесение и изъятие, отчёт и закрытие с пересчётом.</p></div>
    <div className="shift-state"><span>Статус смены</span><strong>{shift ? 'Открыта' : 'Не открыта'}</strong></div>
    <p className="shift-cash">{shift && expectedCashMinor !== null ? `Ожидаемая наличность: ${formatMinor(expectedCashMinor)} сомони${queuedCashMinor > 0n ? ` · ещё не отправлено: ${formatMinor(queuedCashMinor)} сомони` : ''}` : 'На этой кассе нет открытой смены.'}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="shift-notice">{notice}</p>}
    {!canManage && <p className="muted">У вас нет права открывать или закрывать кассовую смену.</p>}
    {offline && <p className="muted">Для управления сменой нужна связь.</p>}

    {!shift && canManage && <form className="shift-form" onSubmit={openShift}>
      <h3>Открытие смены</h3>
      {lastClosed && <p className="muted">На конец прошлой смены в кассе было {formatMinor(lastClosed.closingCashMinor)} сомони. Пересчитайте деньги.</p>}
      <label>Сумма денег в кассе, сомони<MoneyInput required valueMinor={openingCash} onMinorChange={setOpeningCash} disabled={locked || offline} /></label>
      {openingVariance !== null && openingVariance !== 0n && <><p className="shift-variance is-off">{varianceLabel(openingVariance)} против прошлой смены</p>
        <label>Причина расхождения<textarea required maxLength={1000} value={openingComment} onChange={event => setOpeningComment(event.target.value)} placeholder="Например, забрали на размен" disabled={locked || offline} /></label></>}
      <button className="primary" disabled={locked || offline}>Открыть смену</button>
    </form>}

    {shift && canManage && <div className="shift-actions">
      <form className="shift-form" onSubmit={submitCash}>
        <h3>Внесение и изъятие</h3>
        <div className="shift-cash-type" role="radiogroup" aria-label="Тип операции">{(['DEPOSIT', 'WITHDRAWAL'] as const).map(type => <button type="button" role="radio" key={type} aria-checked={cashDraft.type === type} className={cashDraft.type === type ? 'selected' : ''} disabled={locked || offline} onClick={() => setCashDraft(current => current.type === type ? current : newCashDraft(type))}>{cashOperationLabels[type]}</button>)}</div>
        <label>Сумма, сомони<MoneyInput required valueMinor={cashDraft.amountMinor} onMinorChange={amountMinor => setCashDraft(current => ({ ...current, amountMinor }))} disabled={locked || offline} /></label>
        <label>Комментарий<input required maxLength={1000} value={cashDraft.comment} onChange={event => setCashDraft(current => ({ ...current, comment: event.target.value }))} placeholder={cashDraft.type === 'DEPOSIT' ? 'Например, размен' : 'Например, инкассация'} disabled={locked || offline} /></label>
        <button className="secondary" disabled={locked || offline}>{cashDraft.type === 'DEPOSIT' ? 'Внести' : 'Изъять'}</button>
      </form>
      <form className="shift-form" onSubmit={closeShift}>
        <h3>Закрытие смены</h3>
        <label>Пересчитанные наличные, сомони<MoneyInput required valueMinor={countedCash || '0'} onMinorChange={value => { setCountedCash(value); setConfirmClose(false); }} disabled={locked || offline} /></label>
        {closingVariance !== null && <p className={closingVariance === 0n ? 'shift-variance' : 'shift-variance is-off'}>{varianceLabel(closingVariance)}</p>}
        {closingVariance !== null && closingVariance !== 0n && <label>Причина расхождения<textarea required maxLength={1000} value={closingComment} onChange={event => { setClosingComment(event.target.value); setConfirmClose(false); }} placeholder="Расхождение будет проведено в этой смене" disabled={locked || offline} /></label>}
        {queuedCashMinor > 0n && <p className="muted">Сначала отправьте сохранённые продажи.</p>}
        <button className="primary" disabled={locked || offline || queuedCashMinor > 0n}>{confirmClose ? 'Подтвердить закрытие' : 'Закрыть смену'}</button>
        {confirmClose && <p className="muted">Проверьте сумму. После закрытия продажи наличными будут недоступны до открытия новой смены.</p>}
      </form>
    </div>}

    {shownReport && <div className="shift-report">
      <div className="shift-report-heading"><h3>{shownReport.shift.status === 'CLOSED' ? 'Z-отчёт' : 'X-отчёт'}</h3><div>
        {shift && <button type="button" className="quiet" disabled={busy} onClick={() => void loadReport(shift.id).catch(caught => setError(errorText(caught)))}>Обновить</button>}
        <button type="button" disabled={busy} onClick={() => void printReport(shownReport)}>{printerHost.trim() ? 'На чековый принтер' : 'Печать'}</button>
      </div></div>
      <ShiftReportView report={shownReport} />
    </div>}
  </section>;
}
