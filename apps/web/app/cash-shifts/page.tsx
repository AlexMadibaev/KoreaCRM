'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, LockOpen, Plus, Settings2 } from 'lucide-react';
import { MoneyInput } from '@koreacrm/ui';
import { CatalogShell } from '../../components/catalog-shell';
import { FilterChip, dushanbeDay as day } from '../../components/filter-chip';
import { CabinetDrawer } from '../../components/cabinet-drawer';
import { ShiftCard, amount, shiftMoment, type ShiftRow } from '../../components/shift-card';
import { api, queryString, withDiscrepancyComment } from '../../lib/api';
import { shortDeviceCode } from '../../lib/device-kind';

type Store = { id: string; name: string };
type Journal = { items: ShiftRow[]; total: number; page: number; limit: number; filters: { cashiers: { id: string; name: string }[]; devices: { deviceId: string; storeId: string | null }[] } };
type ColumnKey = keyof typeof columnLabels;

const columnLabels = {
  openedAt: 'Открыта', closedAt: 'Закрыта', cashier: 'Кассир', device: 'Касса', store: 'Магазин', revenueMinor: 'Выручка, смн.', salesCount: 'Продажи',
  salesMinor: 'Сумма продаж', cashMinor: 'Наличные', noncashMinor: 'Безналичные', returnsCount: 'Возвраты', returnsMinor: 'Сумма возврата',
  openingCashMinor: 'Начало смены, смн.', depositsMinor: 'Сумма всех взносов', outflowsMinor: 'Сумма расходов', closingCashMinor: 'Конец смены, смн.',
} as const;
const columns = Object.keys(columnLabels) as ColumnKey[];
const numericColumns = new Set<ColumnKey>(['revenueMinor', 'salesCount', 'salesMinor', 'cashMinor', 'noncashMinor', 'returnsCount', 'returnsMinor', 'openingCashMinor', 'depositsMinor', 'outflowsMinor', 'closingCashMinor']);
const COLUMNS_KEY = 'koreacrm.cash-shifts.columns';
const PAGE_SIZE = 50;
const chipDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function cell(row: ShiftRow, key: ColumnKey) {
  switch (key) {
    case 'openedAt': return shiftMoment(row.openedAt);
    case 'closedAt': return row.closedAt ? shiftMoment(row.closedAt) : '-';
    case 'cashier': return row.cashier;
    case 'device': return `Касса ${shortDeviceCode(row.deviceId)}`;
    case 'store': return row.store;
    case 'salesCount': case 'returnsCount': return String(row[key]);
    case 'closingCashMinor': return row.status === 'OPEN' ? '' : amount(row.closingCashMinor);
    default: return amount(row[key]);
  }
}


function CashShifts() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [from, setFrom] = useState(day(-6));
  const [to, setTo] = useState(day());
  const [employeeId, setEmployeeId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [journal, setJournal] = useState<Journal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ShiftRow | null>(null);
  const [hidden, setHidden] = useState<ColumnKey[]>([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const version = useRef(0);
  const can = (permission: string) => permissions.includes(permission);

  useEffect(() => {
    try { const saved = JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? '[]'); if (Array.isArray(saved)) setHidden(saved.filter((key): key is ColumnKey => columns.includes(key))); } catch { /* per-viewer setting only */ }
    Promise.all([api<{ permissions: string[] }>('/auth/me'), api<Store[]>('/finance/stores')])
      .then(([me, available]) => { setPermissions(me.permissions); setStores(available); })
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить данные'));
  }, []);

  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true); setError('');
    try {
      const result = await api<Journal>(`/cash-shifts?${queryString({ from, to, storeId, employeeId, deviceId, status, page, limit: PAGE_SIZE })}`);
      if (current !== version.current) return;
      setJournal(result);
      setSelected(previous => previous ? result.items.find(item => item.id === previous.id) ?? previous : previous);
    } catch (caught) { if (current === version.current) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить смены'); }
    finally { if (current === version.current) setLoading(false); }
  }, [from, to, storeId, employeeId, deviceId, status, page]);
  useEffect(() => { if (from && to && from <= to) void load(); }, [load, from, to]);

  const visible = columns.filter(key => !hidden.includes(key));
  const toggleColumn = (key: ColumnKey) => setHidden(current => {
    const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key];
    try { window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const devices = useMemo(() => (journal?.filters.devices ?? []).filter(device => !storeId || device.storeId === storeId), [journal, storeId]);
  const pages = journal ? Math.max(1, Math.ceil(journal.total / journal.limit)) : 1;
  const change = (apply: () => void) => { apply(); setPage(1); };

  return <div className="crm-shifts">
    <div className="crm-shifts-toolbar">
      <div className="crm-chips" role="group" aria-label="Фильтры смен">
        <FilterChip label="дата открытия">
          <label className="crm-chip-dates"><span className="sr-only">С</span><input type="date" value={from} max={to} onChange={event => change(() => setFrom(event.target.value))} /></label>
          <span aria-hidden>—</span>
          <label className="crm-chip-dates"><span className="sr-only">По</span><input type="date" value={to} min={from} onChange={event => change(() => setTo(event.target.value))} /></label>
          <span className="sr-only">{from && chipDate.format(new Date(from))} — {to && chipDate.format(new Date(to))}</span>
        </FilterChip>
        <FilterChip label="кассир" onClear={employeeId ? () => change(() => setEmployeeId('')) : undefined}>
          <select aria-label="Кассир" value={employeeId} onChange={event => change(() => setEmployeeId(event.target.value))}><option value="">введите</option>{journal?.filters.cashiers.map(cashier => <option key={cashier.id} value={cashier.id}>{cashier.name}</option>)}</select>
        </FilterChip>
        <FilterChip label="магазин" onClear={storeId ? () => change(() => { setStoreId(''); setDeviceId(''); }) : undefined}>
          <select aria-label="Магазин" value={storeId} onChange={event => change(() => { setStoreId(event.target.value); setDeviceId(''); })}><option value="">введите</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
        </FilterChip>
        <FilterChip label="касса" onClear={deviceId ? () => change(() => setDeviceId('')) : undefined}>
          <select aria-label="Касса" value={deviceId} onChange={event => change(() => setDeviceId(event.target.value))}><option value="">введите</option>{devices.map(device => <option key={device.deviceId} value={device.deviceId}>Касса {shortDeviceCode(device.deviceId)}</option>)}</select>
        </FilterChip>
        <FilterChip label="статус" onClear={status ? () => change(() => setStatus('')) : undefined}>
          <select aria-label="Статус" value={status} onChange={event => change(() => setStatus(event.target.value))}><option value="">все</option><option value="OPEN">открытые</option><option value="CLOSED">закрытые</option></select>
        </FilterChip>
      </div>
      <div className="crm-shifts-tools">
        {can('finance.cash') && <button type="button" className="crm-primary-button" onClick={() => setOpening(true)}><Plus size={14} aria-hidden /> Открыть смену</button>}
        <div className="crm-columns-menu">
          <button type="button" className="crm-icon-button" aria-label="Настроить колонки" title="Настроить колонки" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(value => !value)}><Settings2 size={18} aria-hidden /></button>
          {columnsOpen && <div className="crm-columns-popover" role="group" aria-label="Колонки таблицы">
            {columns.map(key => <label key={key}><input type="checkbox" checked={!hidden.includes(key)} onChange={() => toggleColumn(key)} /> {columnLabels[key]}</label>)}
          </div>}
        </div>
      </div>
    </div>

    {from > to && <p role="alert" className="crm-alert">Дата начала должна быть не позже даты окончания.</p>}
    {error && <p role="alert" className="crm-alert">{error}</p>}

    <div className="crm-shifts-table-wrap" aria-busy={loading}>
      <table className="crm-shifts-table">
        <thead><tr>
          <th scope="col" className="sticky-status">Статус</th>
          <th scope="col" className="sticky-number">Номер</th>
          {visible.map(key => <th key={key} scope="col" className={numericColumns.has(key) ? 'num' : ''}>{columnLabels[key]}</th>)}
        </tr></thead>
        <tbody>
          {journal?.items.map(row => <tr key={row.id} className={selected?.id === row.id ? 'selected' : ''}>
            <td className="sticky-status">{row.status === 'OPEN' ? <LockOpen size={15} className="is-open" aria-label="Открыта" /> : <Lock size={15} className="is-closed" aria-label="Закрыта" />}</td>
            <td className="sticky-number"><button type="button" className="crm-link-button" onClick={() => setSelected(row)}>Смена #{row.number}</button></td>
            {visible.map(key => <td key={key} className={numericColumns.has(key) ? 'num' : ''}>{cell(row, key)}</td>)}
          </tr>)}
        </tbody>
      </table>
      {journal && !journal.items.length && !loading && <div className="crm-shifts-empty"><strong>Смен не найдено</strong><p>За выбранные даты и с этими фильтрами смены не открывались. Расширьте период или сбросьте фильтры.</p></div>}
      {!journal && loading && <p role="status" className="crm-shifts-empty">Загружаем смены…</p>}
    </div>

    {journal && journal.total > journal.limit && <div className="crm-shifts-pages">
      <span>Показано {journal.items.length} из {journal.total}</span>
      <button type="button" className="crm-outline-button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Назад</button>
      <span>{page} / {pages}</span>
      <button type="button" className="crm-outline-button" disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)}>Вперёд</button>
    </div>}

    {selected && <ShiftCard key={selected.id} row={selected} canManage={can('finance.cash')} onClose={() => setSelected(null)} onChanged={() => void load()} />}
    {opening && <OpenShiftDrawer stores={stores} onClose={() => setOpening(false)} onOpened={() => { setOpening(false); void load(); }} />}
  </div>;
}

function OpenShiftDrawer({ stores, onClose, onOpened }: { stores: Store[]; onClose: () => void; onOpened: () => void }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [deviceId, setDeviceId] = useState('MAIN');
  const [openingCash, setOpeningCash] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!storeId || !deviceId) return;
    let active = true;
    const timer = setTimeout(() => { void api<{ closingCashMinor: string } | null>(`/stores/${storeId}/finance/cash-shifts/last-closed?deviceId=${encodeURIComponent(deviceId)}`).then(previous => { if (active) setOpeningCash(previous?.closingCashMinor ?? '0'); }).catch(() => undefined); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [storeId, deviceId]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await withDiscrepancyComment(comment => api(`/stores/${storeId}/finance/cash-shifts`, { method: 'POST', body: JSON.stringify({ deviceId, openingCashMinor: openingCash, comment }) })); onOpened(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось открыть смену'); }
    finally { setBusy(false); }
  }
  return <CabinetDrawer title="Открытие смены" onClose={onClose}>
    <form className="crm-shift-open" onSubmit={submit}>
      <p>Обычно смену открывает кассир в кассе. Здесь — для кассы, которая работает из кабинета.</p>
      <label>Магазин<select required value={storeId} onChange={event => setStoreId(event.target.value)}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
      <label>Касса (код устройства)<input required value={deviceId} onChange={event => setDeviceId(event.target.value)} /></label>
      <label>Наличные на начало смены, смн.<MoneyInput required valueMinor={openingCash} onMinorChange={setOpeningCash} /></label>
      {error && <p role="alert" className="crm-alert">{error}</p>}
      <button type="submit" className="crm-primary-button" disabled={busy || !storeId}>{busy ? 'Открываем…' : 'Открыть смену'}</button>
    </form>
  </CabinetDrawer>;
}

export default function CashShiftsPage() {
  return <CatalogShell><CashShifts /></CatalogShell>;
}
