'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Download, FileSpreadsheet } from 'lucide-react';
import { formatCurrencyMinor } from '@koreacrm/ui';
import { api, queryString, type Page } from '../lib/api';
import { serializeCsv } from '../lib/csv';
import { writeTableXlsx, type SheetCell } from '../lib/xlsx';
import { SearchCaption } from "./search-caption";

export type ReportFilter = 'store' | 'employee' | 'category' | 'q' | 'lowOnly';
export type ReportInfo = { key: string; title: string; description: string; group: string; period: boolean; filters: ReportFilter[]; available: boolean };
type ColumnType = 'text' | 'date' | 'datetime' | 'money' | 'quantity' | 'count' | 'percent';
type Column = { key: string; label: string; type: ColumnType };
type Value = string | number | null;
export type ReportResult = {
  key: string; title: string; from: string | null; to: string | null; columns: Column[]; rows: Record<string, Value>[]; totals: Record<string, Value>;
  total: number; page: number; limit: number; sort: string; dir: 'asc' | 'desc'; truncated: boolean; timeZone: string;
};
type Option = { id: string; name: string };
type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

const PAGE_SIZE = 50;
const numeric: ColumnType[] = ['money', 'quantity', 'count', 'percent'];
/** Calendar day in Dushanbe (UTC+5), the same day boundaries the API uses. */
function dushanbeDay(offsetDays = 0) { return new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10); }
function periodRange(period: Period, custom: { from: string; to: string }) {
  if (period === 'today') return { from: dushanbeDay(), to: dushanbeDay() };
  if (period === 'yesterday') return { from: dushanbeDay(-1), to: dushanbeDay(-1) };
  if (period === 'week') return { from: dushanbeDay(-6), to: dushanbeDay() };
  if (period === 'month') return { from: dushanbeDay(-29), to: dushanbeDay() };
  return custom;
}
const integer = new Intl.NumberFormat('ru-RU');
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' });

export function formatCell(type: ColumnType, value: Value): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'money') return formatCurrencyMinor(String(value));
  if (type === 'quantity' || type === 'count') return integer.format(Number(value));
  if (type === 'percent') return `${String(value).replace('.', ',')} %`;
  if (type === 'date') return dateFormat.format(new Date(`${value}T00:00:00.000Z`));
  if (type === 'datetime') return dateTimeFormat.format(new Date(String(value)));
  return String(value);
}
/** Value for spreadsheets: money in somoni as a number, dates as text in the local calendar. */
function sheetValue(type: ColumnType, value: Value): SheetCell {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'money') return Number(value) / 100;
  if (type === 'quantity' || type === 'count' || type === 'percent') return Number(value);
  return formatCell(type, value);
}
function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportView({ report }: { report: ReportInfo }) {
  const [period, setPeriod] = useState<Period>('week');
  const [custom, setCustom] = useState({ from: dushanbeDay(-6), to: dushanbeDay() });
  const [storeId, setStoreId] = useState('');
  const [archive, setArchive] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [stores, setStores] = useState<Option[]>([]);
  const [employees, setEmployees] = useState<Option[] | null>(null);
  const [categories, setCategories] = useState<Option[] | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');
  const has = (filter: ReportFilter) => report.filters.includes(filter);
  const range = periodRange(period, custom);
  const rangeError = report.period && (!range.from || !range.to || range.from > range.to) ? 'Дата начала должна быть не позже даты окончания.' : '';

  useEffect(() => {
    let active = true;
    api<Option[]>('/stores').then(value => { if (active) setStores(value); }).catch(() => { if (active) setStores([]); });
    if (has('employee')) api<Page<Option>>('/employees?limit=100').then(value => { if (active) setEmployees(value.items); }).catch(() => { if (active) setEmployees(null); });
    if (has('category')) api<Page<Option>>('/categories?limit=100').then(value => { if (active) setCategories(value.items); }).catch(() => { if (active) setCategories(null); });
    return () => { active = false; };
  }, [report.key]);

  useEffect(() => { const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [search]);

  const params = useMemo(() => ({
    from: report.period ? range.from : undefined, to: report.period ? range.to : undefined,
    storeId: storeId || undefined, scope: !storeId && archive ? 'all' : undefined,
    employeeId: has('employee') ? employeeId || undefined : undefined, categoryId: has('category') ? categoryId || undefined : undefined,
    q: has('q') ? query || undefined : undefined, lowOnly: has('lowOnly') && lowOnly ? '1' : undefined,
    sort: sort?.key, dir: sort?.dir,
  }), [report.key, report.period, range.from, range.to, storeId, archive, employeeId, categoryId, query, lowOnly, sort]);

  useEffect(() => {
    if (rangeError) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError('');
    api<ReportResult>(`/reports/${report.key}?${queryString({ ...params, page, limit: PAGE_SIZE })}`)
      .then(value => { if (active) setResult(value); })
      .catch(caught => { if (active) { setResult(null); setError(caught instanceof Error ? caught.message : 'Не удалось построить отчёт'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [report.key, params, page, rangeError]);

  const change = (apply: () => void) => { apply(); setPage(1); };
  const toggleSort = (key: string) => change(() => setSort(current => current?.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  const pages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;
  const fileName = (extension: string) => `${report.title}${report.period ? ` ${range.from}—${range.to}` : ''}.${extension}`;

  async function exportReport(kind: 'csv' | 'xlsx') {
    setExporting(kind); setError('');
    try {
      const full = await api<ReportResult>(`/reports/${report.key}?${queryString({ ...params, export: '1' })}`);
      const header = full.columns.map(column => column.label);
      const totalsRow = full.columns.map((column, index) => index === 0 ? 'Итого' : numeric.includes(column.type) ? full.totals[column.key] ?? null : null);
      if (kind === 'csv') {
        const lines = [header, ...full.rows.map(row => full.columns.map(column => { const value = sheetValue(column.type, row[column.key] ?? null); return value === null ? '' : typeof value === 'number' ? String(value).replace('.', ',') : value; }))];
        lines.push(full.columns.map((column, index) => { const value = index === 0 ? 'Итого' : sheetValue(column.type, totalsRow[index] as Value); return value === null ? '' : String(value).replace('.', ','); }));
        download(fileName('csv'), new Blob([serializeCsv(lines)], { type: 'text/csv;charset=utf-8' }));
      } else {
        const rows = full.rows.map(row => full.columns.map(column => sheetValue(column.type, row[column.key] ?? null)));
        rows.push(full.columns.map((column, index) => index === 0 ? 'Итого' : sheetValue(column.type, totalsRow[index] as Value)));
        const formats = full.columns.map(column => column.type === 'money' ? '#,##0.00' : column.type === 'percent' ? '0.00' : column.type === 'quantity' || column.type === 'count' ? '#,##0' : null);
        download(fileName('xlsx'), new Blob([await writeTableXlsx(report.title, header, rows, formats)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      }
      if (full.truncated) setError('В файл попали первые 10 000 строк. Сузьте период или фильтры, чтобы выгрузить остальное.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось выгрузить отчёт');
    } finally { setExporting(''); }
  }

  return <div className="crm-report-view">
    <div className="crm-page-head">
      <div>
        <Link href="/reports" className="crm-report-back"><ArrowLeft size={14} aria-hidden /> Все отчёты</Link>
        <h1>{report.title}</h1>
        <p>{report.description}</p>
      </div>
      <div className="crm-page-actions"><div className="crm-report-actions">
        <button type="button" className="ks-button ks-button--secondary crm-outline-button" disabled={!!exporting || !result?.total} onClick={() => exportReport('csv')}><Download size={14} aria-hidden /> {exporting === 'csv' ? 'Готовим…' : 'CSV'}</button>
        <button type="button" className="ks-button ks-button--secondary crm-outline-button" disabled={!!exporting || !result?.total} onClick={() => exportReport('xlsx')}><FileSpreadsheet size={14} aria-hidden /> {exporting === 'xlsx' ? 'Готовим…' : 'Excel'}</button>
      </div></div>
    </div>

    <div className="crm-products-toolbar crm-report-filters" role="group" aria-label="Фильтры отчёта">
      {report.period && <>
        <div className="crm-periods" role="radiogroup" aria-label="Период">
          {([['today', 'Сегодня'], ['yesterday', 'Вчера'], ['week', '7 дней'], ['month', '30 дней'], ['custom', 'Период']] as const).map(([value, label]) =>
            <button key={value} type="button" role="radio" aria-checked={period === value} className={["ks-control", period === value ? 'selected' : ''].filter(Boolean).join(" ")} onClick={() => change(() => { if (value === 'custom') setCustom(range); setPeriod(value); })}>{label}</button>)}
        </div>
        {period === 'custom' && <span className="crm-report-dates">
          <label>С <input type="date" value={custom.from} max={custom.to || undefined} onChange={event => change(() => setCustom(value => ({ ...value, from: event.target.value })))} /></label>
          <label>по <input type="date" value={custom.to} min={custom.from || undefined} onChange={event => change(() => setCustom(value => ({ ...value, to: event.target.value })))} /></label>
        </span>}
      </>}
      {has('store') && <label className="crm-report-field">Магазин
        <select value={storeId} onChange={event => change(() => setStoreId(event.target.value))}>
          <option value="">{archive ? 'Все, включая архив' : 'Все активные'}</option>
          {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
      </label>}
      {has('store') && !storeId && <label className="crm-report-check"><input type="checkbox" checked={archive} onChange={event => change(() => setArchive(event.target.checked))} /> С архивными</label>}
      {has('employee') && employees && <label className="crm-report-field">Сотрудник
        <select value={employeeId} onChange={event => change(() => setEmployeeId(event.target.value))}>
          <option value="">Все</option>
          {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select>
      </label>}
      {has('category') && categories && <label className="crm-report-field">Категория
        <select value={categoryId} onChange={event => change(() => setCategoryId(event.target.value))}>
          <option value="">Все</option>
          {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>}
      {has('q') && <label className="crm-report-field crm-report-search"><SearchCaption text="Поиск" /><input type="search" value={search} placeholder={report.key === 'debts' || report.key === 'customer-activity' ? 'Имя или телефон' : 'Название, артикул, штрихкод'} onChange={event => setSearch(event.target.value)} />
      </label>}
      {has('lowOnly') && <label className="crm-report-check"><input type="checkbox" checked={lowOnly} onChange={event => change(() => setLowOnly(event.target.checked))} /> Только заканчивающиеся</label>}
    </div>

    {(rangeError || error) && <p role="alert" className="crm-alert">{rangeError || error}</p>}

    <section className="crm-products-card crm-report-card-table" aria-busy={loading} aria-label={report.title}>
      <div className="crm-products-card-head">
        <h2>{result ? `Строк: ${integer.format(result.total)}` : 'Отчёт'}</h2>
        {result?.from && <span>{formatCell('date', result.from)} — {formatCell('date', result.to)} · время Душанбе</span>}
      </div>
      {loading && !result && <div className="crm-report-skeleton" role="status" aria-label="Строим отчёт">{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div>}
      {result && result.total === 0 && !loading && <div className="crm-report-empty"><h3>Нет данных</h3><p>За выбранный период и с этими фильтрами операций нет. Измените период или сбросьте фильтры.</p></div>}
      {result && result.total > 0 && <div className="crm-report-scroll">
        <div className="crm-table-region" role="region" aria-label="Таблица данных" tabIndex={0}><table className="crm-products-table crm-report-table">
          <thead><tr>{result.columns.map(column => {
            const active = result.sort === column.key;
            return <th key={column.key} scope="col" className={numeric.includes(column.type) ? 'num' : ''} aria-sort={active ? (result.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button className="ks-button ks-button--secondary" type="button" onClick={() => toggleSort(column.key)}>{column.label}{active && (result.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}</button>
            </th>;
          })}</tr></thead>
          <tbody>{result.rows.map((row, index) => <tr key={index}>{result.columns.map(column => <td key={column.key} className={numeric.includes(column.type) ? 'num' : ''}>{formatCell(column.type, row[column.key] ?? null)}</td>)}</tr>)}</tbody>
          <tfoot><tr>{result.columns.map((column, index) => <td key={column.key} className={numeric.includes(column.type) ? 'num' : ''}>{index === 0 ? 'Итого' : column.key in result.totals ? formatCell(column.type, result.totals[column.key] ?? null) : ''}</td>)}</tr></tfoot>
        </table></div>
      </div>}
      {result && result.total > result.limit && <div className="crm-products-footer crm-report-pages">
        <span>Страница {page} из {pages}</span>
        <button type="button" className="ks-button ks-button--secondary crm-outline-button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Назад</button>
        <button type="button" className="ks-button ks-button--secondary crm-outline-button" disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)}>Вперёд</button>
      </div>}
    </section>
  </div>;
}
