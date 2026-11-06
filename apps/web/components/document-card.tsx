'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Clock3, ExternalLink, Printer, XCircle } from 'lucide-react';
import { CabinetDrawer } from './cabinet-drawer';
import { amount } from './shift-card';
import { queryString, api } from '../lib/api';

export type Kind = 'SALE' | 'SALE_RETURN' | 'RECEIPTLESS_RETURN' | 'PURCHASE' | 'TRANSFER' | 'INVENTORY' | 'WRITE_OFF' | 'ADJUSTMENT';
export type DocumentRow = { kind: Kind; id: string; number: string | null; occurredAt: string; status: string; positions: number; amountMinor: string | null; paidMinor: string | null; sender: string | null; receiver: string | null; author: string | null; comment: string | null };
export type DocumentJournal = { items: DocumentRow[]; total: number; page: number; limit: number; kinds: Kind[] };
type Line = { productId: string; name: string; sku: string; barcode: string | null; quantity: number | null; priceMinor: string | null; discountMinor: string; totalMinor: string | null; profitMinor: string | null; received?: number; expected?: number; before?: number; after?: number };
type Detail = {
  kind: Kind; id: string; number: string | null; occurredAt: string; status: string; storeId: string; comment: string | null;
  fields: [string, string][]; totals: { subtotalMinor?: string; discountMinor?: string; amountMinor?: string; paidMinor?: string; debtMinor?: string };
  payments: { account: string; method: string; amountMinor: string; occurredAt: string }[]; lines: Line[];
  related: { kind: Kind; id: string; title: string; amountMinor: string | null; occurredAt: string | null; note: string | null }[];
};

export const kindTitle: Record<Kind, string> = { SALE: 'Продажа', SALE_RETURN: 'Возврат продажи', RECEIPTLESS_RETURN: 'Возврат без чека', PURCHASE: 'Закупка', TRANSFER: 'Перемещение', INVENTORY: 'Инвентаризация', WRITE_OFF: 'Списание', ADJUSTMENT: 'Корректировка' };
const statusTitle: Record<string, string> = { COMPLETED: 'Документ проведён', VOIDED: 'Аннулирован', DRAFT: 'Черновик', ORDERED: 'Заказан', PARTIALLY_RECEIVED: 'Принят частично', RECEIVED: 'Принят', CANCELLED: 'Отменён', REQUESTED: 'Запрошен', APPROVED: 'Одобрен', IN_TRANSIT: 'В пути', IN_PROGRESS: 'Идёт подсчёт' };
const done = new Set(['COMPLETED', 'RECEIVED']);
const cancelled = new Set(['VOIDED', 'CANCELLED']);
export const outgoing = new Set<Kind>(['SALE_RETURN', 'RECEIPTLESS_RETURN', 'WRITE_OFF']);
export const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Dushanbe' });
export const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' });
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' });

export const docNumber = (number: string | null) => !number ? '' : /^\d+$/.test(number) ? `#${number}` : number;
export const documentName = (kind: Kind, number: string | null) => `${kindTitle[kind]}${number ? ` ${docNumber(number)}` : ''}`;
const sectionHref = (detail: Detail) => detail.kind === 'SALE' ? `/sales?${queryString({ storeId: detail.storeId, saleId: detail.id })}`
  : detail.kind === 'SALE_RETURN' || detail.kind === 'RECEIPTLESS_RETURN' ? `/sales?${queryString({ storeId: detail.storeId })}`
  : detail.kind === 'PURCHASE' ? '/purchases' : detail.kind === 'TRANSFER' ? '/transfers' : detail.kind === 'INVENTORY' ? '/inventories' : '/stock';

export function StatusIcon({ status }: { status: string }) {
  const label = statusTitle[status] ?? status;
  if (done.has(status)) return <CheckCircle2 size={16} className="is-done" aria-label={label} />;
  if (cancelled.has(status)) return <XCircle size={16} className="is-cancelled" aria-label={label} />;
  if (status === 'DRAFT') return <Circle size={16} className="is-draft" aria-label={label} />;
  return <Clock3 size={16} className="is-pending" aria-label={label} />;
}

export function DocumentCard({ kind, id, onClose, onOpen }: { kind: Kind; id: string; onClose: () => void; onOpen?: (kind: Kind, id: string) => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  useEffect(() => { api<Detail>(`/documents/${kind}/${id}`).then(setDetail).catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось открыть документ')); }, [kind, id]);
  const lines = (detail?.lines ?? []).filter(line => !filter || `${line.name} ${line.sku} ${line.barcode ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  const extra = detail?.lines.some(line => line.received !== undefined) ? 'received' : detail?.lines.some(line => line.expected !== undefined) ? 'expected' : detail?.lines.some(line => line.before !== undefined) ? 'after' : null;
  const sum = (key: 'quantity' | 'discountMinor' | 'totalMinor') => lines.reduce((total, line) => total + BigInt(line[key] ?? 0), 0n).toString();
  const totals = detail?.totals ?? {};
  return <CabinetDrawer title={detail ? documentName(detail.kind, detail.number) : kindTitle[kind]} onClose={onClose}>
    {error && <p role="alert" className="crm-alert">{error}</p>}
    {!detail && !error && <p role="status" className="crm-shift-empty">Загружаем документ…</p>}
    {detail && <div className="crm-doc-card">
      <div className="crm-doc-toolbar">
        <span className="crm-doc-created">Создан {dateTimeFormat.format(new Date(detail.occurredAt))}</span>
        <span className={`crm-doc-status ${done.has(detail.status) ? 'is-done' : cancelled.has(detail.status) ? 'is-cancelled' : 'is-pending'}`}><StatusIcon status={detail.status} /> {statusTitle[detail.status] ?? detail.status}</span>
        <span className="crm-doc-actions">
          <button type="button" className="crm-icon-button" aria-label="Печать" title="Печать" onClick={() => window.print()}><Printer size={16} aria-hidden /></button>
          <Link className="crm-outline-button" href={sectionHref(detail)}><ExternalLink size={14} aria-hidden /> Открыть в разделе</Link>
        </span>
      </div>
      <div className="crm-doc-fields">
        <dl>{detail.fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{/^\d{4}-\d{2}-\d{2}T/.test(value) ? dateTimeFormat.format(new Date(value)) : value}</dd></div>)}</dl>
        <dl>
          {totals.discountMinor && totals.discountMinor !== '0' && <div><dt>Скидка</dt><dd>{amount(totals.discountMinor)} смн.</dd></div>}
          {totals.amountMinor && <div><dt>Сумма</dt><dd>{amount(totals.amountMinor)} смн.</dd></div>}
          {totals.paidMinor && <div><dt>Оплаченные</dt><dd>{amount(totals.paidMinor)} смн.</dd></div>}
          {totals.debtMinor && totals.debtMinor !== '0' && <div><dt>Долг</dt><dd>{amount(totals.debtMinor)} смн.</dd></div>}
        </dl>
      </div>
      {detail.payments.length > 0 && <>
        <h3 className="crm-shift-section">Оплата</h3>
        <table className="crm-shift-table"><thead><tr><th scope="col">#</th><th scope="col">Счёт</th><th scope="col">Способ</th><th scope="col">Дата</th><th scope="col" className="num">Сумма</th></tr></thead>
          <tbody>{detail.payments.map((payment, index) => <tr key={index}><td>{index + 1}</td><td>{payment.account}</td><td>{payment.method}</td><td>{dateTimeFormat.format(new Date(payment.occurredAt))}</td><td className="num">{amount(payment.amountMinor)} смн.</td></tr>)}</tbody></table>
      </>}
      <h3 className="crm-shift-section">Товары</h3>
      <label className="crm-doc-search"><span className="sr-only">Поиск товаров</span><input type="search" placeholder="Поиск товаров" value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <div className="crm-report-scroll"><table className="crm-shift-table">
        <thead><tr><th scope="col">Наименование</th><th scope="col">Штрих-код</th><th scope="col">Артикул</th><th scope="col" className="num">Количество</th>{extra === 'received' && <th scope="col" className="num">Принято</th>}{extra === 'expected' && <th scope="col" className="num">Ожидалось</th>}{extra === 'after' && <th scope="col" className="num">Остаток после</th>}<th scope="col" className="num">Цена</th><th scope="col" className="num">Скидка</th><th scope="col" className="num">Итог</th></tr></thead>
        <tbody>{lines.map((line, index) => <tr key={`${line.productId}-${index}`}><td>{line.name}</td><td>{line.barcode ?? ''}</td><td>{line.sku}</td><td className="num">{line.quantity ?? '—'}</td>{extra === 'received' && <td className="num">{line.received}</td>}{extra === 'expected' && <td className="num">{line.expected}</td>}{extra === 'after' && <td className="num">{line.after}</td>}<td className="num">{line.priceMinor ? amount(line.priceMinor) : '—'}</td><td className="num">{line.discountMinor !== '0' ? amount(line.discountMinor) : ''}</td><td className="num">{line.totalMinor ? amount(line.totalMinor) : '—'}</td></tr>)}</tbody>
        <tfoot><tr><td>Итог</td><td /><td /><td className="num">{sum('quantity')}</td>{extra && <td />}<td className="num">-</td><td className="num">{sum('discountMinor') !== '0' ? amount(sum('discountMinor')) : ''}</td><td className="num">{lines.some(line => line.totalMinor) ? amount(sum('totalMinor')) : ''}</td></tr></tfoot>
      </table></div>
      {detail.comment && <p className="crm-doc-comment">Комментарий: {detail.comment}</p>}
      {detail.related.length > 0 && <>
        <h3 className="crm-shift-section">Связанные документы</h3>
        <ul className="crm-doc-related">{detail.related.map(item => <li key={item.id}><button type="button" className="crm-link-button" onClick={() => onOpen?.(item.kind, item.id)}>{item.title}</button>{item.amountMinor && <span>{amount(item.amountMinor)} смн.</span>}{item.occurredAt && <span>{dateTimeFormat.format(new Date(item.occurredAt))}</span>}{item.note && <span>{item.note}</span>}</li>)}</ul>
      </>}
    </div>}
  </CabinetDrawer>;
}

