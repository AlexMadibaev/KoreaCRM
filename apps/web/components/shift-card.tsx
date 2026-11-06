'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Calendar, Lock, LockOpen, Monitor, Store as StoreIcon, User } from 'lucide-react';
import { MoneyInput } from '@koreacrm/ui';
import { CabinetDrawer } from './cabinet-drawer';
import { ShiftRewardConfirmation, type ShiftRewardPreview } from './shift-reward-confirmation';
import { api, withDiscrepancyComment } from '../lib/api';
import { shortDeviceCode } from '../lib/device-kind';

export type ShiftRow = {
  id: string; number: number; storeId: string; store: string; deviceId: string; status: 'OPEN' | 'CLOSED'; openedAt: string; closedAt: string | null; cashier: string;
  salesCount: number; returnsCount: number; revenueMinor: string; salesMinor: string; cashMinor: string; noncashMinor: string; returnsMinor: string;
  openingCashMinor: string; depositsMinor: string; outflowsMinor: string; closingCashMinor: string | null; expectedCashMinor: string;
};
type Method = { kind: string; amountMinor: string };
type Report = ShiftRewardPreview & {
  shift: { openedBy: string; closedBy: string | null; openingComment: string | null; closingComment: string | null; closingVarianceMinor: string; actualCashMinor: string | null };
  returns: { byMethod: Method[] };
  sales: { discountMinor: string; debtMinor: string };
};
type Document = { kind: 'SALE' | 'RETURN' | 'RECEIPTLESS_RETURN'; id: string; number: string | null; createdAt: string; status: string; amountMinor: string; discountMinor: string; debtMinor: string; customer: string; employee: string; positions: number; reason: string | null };
type MoneyEntry = { direction: 'IN' | 'OUT'; category: string; createdAt: string; amountMinor: string; account: string; accountKind: string; counterparty: string | null; document: string | null; employee: string };
type ProductLine = { productId: string; product: string; sku: string; quantity: string; amountMinor: string; profitMinor?: string | null };
type Activity = { number: number | null; documents: Document[]; money: MoneyEntry[]; products: { sold: ProductLine[]; returned: ProductLine[] }; canSeeProfit: boolean };

/** CloudShop writes amounts as "245.00 смн." without thousands separators; we keep the same reading order. */
export function amount(minor: string | null | undefined) {
  if (minor === null || minor === undefined || minor === '') return '—';
  const value = BigInt(minor);
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  return `${sign}${(abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${(abs % 100n).toString().padStart(2, '0')}`;
}
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Dushanbe' });
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' });
export const shiftMoment = (iso: string | null) => iso ? `${dayFormat.format(new Date(iso))} ${timeFormat.format(new Date(iso))}` : '—';
const sumKinds = (methods: Method[], cash: boolean) => methods.filter(method => (method.kind === 'CASH') === cash && !['BONUS', 'DEBT'].includes(method.kind)).reduce((total, method) => total + BigInt(method.amountMinor), 0n).toString();
const groupByDay = <T extends { createdAt: string }>(items: T[]) => items.reduce<{ day: string; items: T[] }[]>((groups, item) => {
  const day = dayFormat.format(new Date(item.createdAt));
  const last = groups[groups.length - 1];
  if (last?.day === day) last.items.push(item); else groups.push({ day, items: [item] });
  return groups;
}, []);
const docNumber = (number: string | null) => number && /^\d+$/.test(number) ? `#${number}` : number ?? '';
const documentTitle = (document: Document) => document.kind === 'SALE' ? `Продажа ${docNumber(document.number)}` : document.kind === 'RETURN' ? `Возврат продажи ${docNumber(document.number)}` : 'Возврат без чека';

function Pair({ label, value }: { label: string; value: string }) {
  return <div className="crm-shift-pair"><span>{label}</span><strong>{value}</strong></div>;
}

export function ShiftCard({ row, canManage, onClose, onChanged }: { row: ShiftRow; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [tab, setTab] = useState<'documents' | 'money' | 'products'>('documents');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [operation, setOperation] = useState({ type: 'DEPOSIT' as 'DEPOSIT' | 'WITHDRAWAL' | 'CORRECTION', amountMinor: '', comment: '', operationId: crypto.randomUUID() });
  const [actualMinor, setActualMinor] = useState('');
  const [closing, setClosing] = useState<Report | null>(null);
  const base = `/stores/${row.storeId}/finance/cash-shifts/${row.id}`;

  const load = useCallback(async () => {
    setError('');
    try {
      const [nextReport, nextActivity] = await Promise.all([api<Report>(`${base}/report`), api<Activity>(`${base}/activity`)]);
      setReport(nextReport); setActivity(nextActivity);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить смену'); }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); await load(); onChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Операция не выполнена'); }
    finally { setBusy(false); }
  }
  async function addOperation(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api(`${base}/operations`, { method: 'POST', body: JSON.stringify({ operationId: operation.operationId, type: operation.type, amountMinor: operation.amountMinor, comment: operation.comment }) });
      setOperation(current => ({ ...current, amountMinor: '', comment: '', operationId: crypto.randomUUID() }));
      setNotice('Операция проведена.');
    });
  }
  async function prepareClose(event: FormEvent) {
    event.preventDefault();
    await run(async () => setClosing(await api<Report>(`${base}/report`)));
  }
  async function confirmClose() {
    if (!closing) return;
    await run(async () => {
      const closed = await withDiscrepancyComment(comment => api<{ closingCashMinor: string }>(`${base}/close`, { method: 'POST', body: JSON.stringify({ actualCashMinor: actualMinor, rewardPayoutMinor: closing.reward?.payableMinor, comment }) }));
      setNotice(`Смена закрыта. Остаток в кассе: ${amount(closed.closingCashMinor)} смн.`);
      setClosing(null); setActualMinor('');
    });
  }

  const number = activity?.number ?? row.number;
  const open = row.status === 'OPEN';
  return <CabinetDrawer title={`Смена #${number}`} onClose={onClose}>
    <div className="crm-shift-card">
      <p className="crm-shift-created">Создан {dayFormat.format(new Date(row.openedAt))} · {open ? 'смена открыта' : 'смена закрыта'}</p>
      <div className="crm-shift-meta">
        <ul>
          <li><Calendar size={14} aria-hidden /> Открыта {shiftMoment(row.openedAt)}</li>
          <li><Calendar size={14} aria-hidden /> {row.closedAt ? `Закрыта ${shiftMoment(row.closedAt)}` : 'Ещё не закрыта'}</li>
          <li><StoreIcon size={14} aria-hidden /> Магазин «{row.store}»</li>
          <li><Monitor size={14} aria-hidden /> Касса «{shortDeviceCode(row.deviceId)}»</li>
        </ul>
        <ul>
          <li><User size={14} aria-hidden /> {row.cashier}</li>
          {report?.shift.closedBy && <li>{open ? <LockOpen size={14} aria-hidden /> : <Lock size={14} aria-hidden />} Закрыл: {report.shift.closedBy}</li>}
          {report?.shift.openingComment && <li>Комментарий при открытии: {report.shift.openingComment}</li>}
          {report?.shift.closingComment && <li>Комментарий при закрытии: {report.shift.closingComment}</li>}
        </ul>
      </div>

      {error && <p role="alert" className="crm-alert">{error}</p>}
      {notice && <p role="status" className="crm-shift-notice">{notice}</p>}

      <h3 className="crm-shift-section">Выручка</h3>
      <div className="crm-shift-grid">
        <Pair label="Кол-во продаж" value={String(row.salesCount)} />
        <Pair label="Наличные" value={`${amount(row.cashMinor)} смн.`} />
        <Pair label="Сумма продаж" value={`${amount(row.salesMinor)} смн.`} />
        <Pair label="Безналичные" value={`${amount(row.noncashMinor)} смн.`} />
        {report && report.sales.discountMinor !== '0' && <Pair label="Скидки" value={`${amount(report.sales.discountMinor)} смн.`} />}
        {report && report.sales.debtMinor !== '0' && <Pair label="В долг" value={`${amount(report.sales.debtMinor)} смн.`} />}
      </div>

      <h3 className="crm-shift-section">Возвраты</h3>
      <div className="crm-shift-grid">
        <Pair label="Количество возвратов продаж" value={String(row.returnsCount)} />
        <Pair label="Наличные" value={report ? `${amount(sumKinds(report.returns.byMethod, true))} смн.` : '…'} />
        <Pair label="Сумма возвратов продаж" value={`${amount(row.returnsMinor)} смн.`} />
        <Pair label="Безналичные" value={report ? `${amount(sumKinds(report.returns.byMethod, false))} смн.` : '…'} />
      </div>

      <h3 className="crm-shift-section">Касса</h3>
      <div className="crm-shift-grid">
        <Pair label="Сумма на начало смены" value={`${amount(row.openingCashMinor)} смн.`} />
        <Pair label="Сумма всех взносов" value={`${amount(row.depositsMinor)} смн.`} />
        <Pair label={open ? 'Ожидается в кассе' : 'Сумма на конец смены'} value={`${amount(open ? row.expectedCashMinor : row.closingCashMinor)} смн.`} />
        <Pair label="Сумма расходов" value={`${amount(row.outflowsMinor)} смн.`} />
      </div>

      <div className="crm-shift-total"><span>Выручка</span><strong>{amount(row.revenueMinor)} смн.</strong></div>

      {open && canManage && <section className="crm-shift-actions" aria-label="Действия со сменой">
        <form onSubmit={addOperation}>
          <h4>Операция с наличными</h4>
          <label>Тип<select value={operation.type} onChange={event => setOperation(current => ({ ...current, type: event.target.value as typeof current.type, operationId: crypto.randomUUID() }))}><option value="DEPOSIT">Внесение</option><option value="WITHDRAWAL">Изъятие</option><option value="CORRECTION">Корректировка</option></select></label>
          <label>Сумма, смн.<MoneyInput required allowNegative={operation.type === 'CORRECTION'} valueMinor={operation.amountMinor} onMinorChange={minor => setOperation(current => ({ ...current, amountMinor: minor, operationId: crypto.randomUUID() }))} /></label>
          <label>Комментарий<input required value={operation.comment} onChange={event => setOperation(current => ({ ...current, comment: event.target.value, operationId: crypto.randomUUID() }))} /></label>
          <button type="submit" className="crm-outline-button" disabled={busy || !operation.amountMinor}>Провести операцию</button>
        </form>
        <form onSubmit={prepareClose}>
          <h4>Закрытие смены</h4>
          <label>Пересчитано наличных, смн.<MoneyInput required valueMinor={actualMinor} onMinorChange={setActualMinor} /></label>
          <p>Ожидается: {amount(row.expectedCashMinor)} смн.</p>
          <button type="submit" className="crm-primary-button" disabled={busy || !actualMinor}>Закрыть смену</button>
        </form>
      </section>}

      <h3 className="crm-shift-section">Последние операции</h3>
      <div className="crm-shift-tabs" role="tablist" aria-label="Операции смены">
        {([['documents', 'Движение товара'], ['money', 'Движение денег'], ['products', 'Список товаров']] as const).map(([key, label]) =>
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      {!activity && !error && <p role="status" className="crm-shift-empty">Загружаем операции…</p>}
      {activity && tab === 'documents' && (activity.documents.length ? groupByDay(activity.documents).map(group => <div key={group.day} className="crm-shift-day"><h4>{group.day}</h4>
        {group.items.map(document => <article key={document.id} className={`crm-shift-doc ${document.kind === 'SALE' ? 'is-sale' : 'is-return'}`}>
          <div><strong>{documentTitle(document)}</strong><p>Магазин {row.store} · клиент {document.customer}</p><p>{document.employee} · {timeFormat.format(new Date(document.createdAt))}{document.reason ? ` · ${document.reason}` : ''}</p></div>
          <div className="crm-shift-doc-sum"><strong>{amount(document.amountMinor)} смн.</strong>{document.kind === 'SALE' && document.discountMinor !== '0' && <span>скидка {amount(document.discountMinor)}</span>}<span>{document.kind === 'SALE' && document.debtMinor !== '0' ? `в долг ${amount(document.debtMinor)} смн.` : 'Документ оплачен'}</span><span>{document.positions} поз.</span></div>
        </article>)}</div>) : <p className="crm-shift-empty">В смене нет продаж и возвратов.</p>)}
      {activity && tab === 'money' && (activity.money.length ? groupByDay(activity.money).map(group => <div key={group.day} className="crm-shift-day"><h4>{group.day}</h4>
        {group.items.map((entry, index) => <article key={`${entry.createdAt}-${index}`} className={`crm-shift-money ${entry.direction === 'IN' ? 'is-in' : 'is-out'}`}>
          <div><strong>{entry.direction === 'IN' ? <ArrowDownLeft size={14} aria-hidden /> : <ArrowUpRight size={14} aria-hidden />} {entry.direction === 'IN' ? 'Приход' : 'Расход'}</strong>
            {entry.counterparty && <p>Контрагент: {entry.counterparty}</p>}<p>Счёт: {entry.accountKind === 'CASH' ? 'Касса' : entry.account}</p><span className="crm-shift-tag">{entry.category}</span>{entry.document && <p>{entry.document}</p>}<p>{entry.employee} · {timeFormat.format(new Date(entry.createdAt))}</p></div>
          <strong className="crm-shift-money-sum">{entry.direction === 'IN' ? '+' : '-'}{amount(entry.amountMinor)} смн.</strong>
        </article>)}</div>) : <p className="crm-shift-empty">Денежных операций в смене нет.</p>)}
      {activity && tab === 'products' && <div className="crm-shift-products">
        <h4>Продажа товара</h4>
        <ProductTable lines={activity.products.sold} profit={activity.canSeeProfit} amountLabel="Сумма продаж" />
        <h4>Возврат товара</h4>
        <ProductTable lines={activity.products.returned} profit={false} amountLabel="Сумма возврата" />
      </div>}
    </div>
    {closing && <ShiftRewardConfirmation preview={closing} actualMinor={actualMinor} busy={busy} onClose={() => setClosing(null)} onConfirm={() => void confirmClose()} />}
  </CabinetDrawer>;
}

function ProductTable({ lines, profit, amountLabel }: { lines: ProductLine[]; profit: boolean; amountLabel: string }) {
  if (!lines.length) return <p className="crm-shift-empty">Нет позиций.</p>;
  const sum = (key: 'quantity' | 'amountMinor' | 'profitMinor') => lines.reduce((total, line) => total + Number(line[key] ?? 0), 0);
  return <table className="crm-shift-table">
    <thead><tr><th scope="col">Товар</th><th scope="col" className="num">Кол-во товара</th><th scope="col" className="num">{amountLabel}</th>{profit && <th scope="col" className="num">Прибыль</th>}</tr></thead>
    <tbody>{lines.map(line => <tr key={line.productId}><td>{line.product}<small>{line.sku}</small></td><td className="num">{Number(line.quantity)}</td><td className="num">{amount(line.amountMinor)}</td>{profit && <td className="num">{amount(line.profitMinor ?? '0')}</td>}</tr>)}</tbody>
    <tfoot><tr><td>Итог</td><td className="num">{sum('quantity')}</td><td className="num">{amount(String(sum('amountMinor')))}</td>{profit && <td className="num">{amount(String(sum('profitMinor')))}</td>}</tr></tfoot>
  </table>;
}
