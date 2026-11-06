'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { CatalogShell } from '../../components/catalog-shell';
import { CabinetDrawer } from '../../components/cabinet-drawer';
import { DocumentCard, dayFormat, timeFormat, type Kind } from '../../components/document-card';
import { FilterChip, dushanbeDay } from '../../components/filter-chip';
import { amount } from '../../components/shift-card';
import { api, queryString } from '../../lib/api';

type Store = { id: string; name: string };
type Entry = { id: string; source: string; number: number; direction: 'IN' | 'OUT'; occurredAt: string; amountMinor: string; account: string; accountKind: string; counterparty: string | null; category: string; author: string | null; comment: string | null; store: string; document: { kind: Kind; id: string; title: string } | null };
type Journal = { items: Entry[]; total: number; page: number; limit: number; totals: { inMinor: string; outMinor: string } };
const PAGE_SIZE = 50;
const fullDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' });
const title = (entry: Entry) => `${entry.direction === 'IN' ? 'Приход' : 'Расход'} #${entry.number}`;

function MoneyJournal() {
  const [stores, setStores] = useState<Store[]>([]);
  const [from, setFrom] = useState(dushanbeDay(-6));
  const [to, setTo] = useState(dushanbeDay());
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [storeId, setStoreId] = useState('');
  const [direction, setDirection] = useState('');
  const [page, setPage] = useState(1);
  const [journal, setJournal] = useState<Journal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Entry | null>(null);
  const [document, setDocument] = useState<{ kind: Kind; id: string } | null>(null);
  const version = useRef(0);

  useEffect(() => { api<Store[]>('/finance/stores').then(setStores).catch(() => setStores([])); }, []);
  useEffect(() => { const timer = window.setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [search]);
  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true); setError('');
    try { const result = await api<Journal>(`/money?${queryString({ from, to, storeId, direction, q, page, limit: PAGE_SIZE })}`); if (current === version.current) setJournal(result); }
    catch (caught) { if (current === version.current) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить операции'); }
    finally { if (current === version.current) setLoading(false); }
  }, [from, to, storeId, direction, q, page]);
  useEffect(() => { if (from && to && from <= to) void load(); }, [load, from, to]);
  const groups = useMemo(() => (journal?.items ?? []).reduce<{ day: string; rows: Entry[] }[]>((result, item) => {
    const day = dayFormat.format(new Date(item.occurredAt));
    const last = result[result.length - 1];
    if (last?.day === day) last.rows.push(item); else result.push({ day, rows: [item] });
    return result;
  }, []), [journal]);
  const change = (apply: () => void) => { apply(); setPage(1); };
  const pages = journal ? Math.max(1, Math.ceil(journal.total / journal.limit)) : 1;
  const balance = journal ? (BigInt(journal.totals.inMinor) - BigInt(journal.totals.outMinor)).toString() : '0';

  return <div className="crm-shifts">
    <div className="crm-shifts-toolbar">
      <div className="crm-chips" role="group" aria-label="Фильтры операций">
        <FilterChip label="поиск" wide onClear={search ? () => setSearch('') : undefined}><input type="search" aria-label="Поиск по номеру или комментарию" placeholder="поиск по номеру или комментарию" value={search} onChange={event => setSearch(event.target.value)} /></FilterChip>
        <FilterChip label="дата"><input type="date" aria-label="Дата с" value={from} max={to} onChange={event => change(() => setFrom(event.target.value))} /><span aria-hidden>—</span><input type="date" aria-label="Дата по" value={to} min={from} onChange={event => change(() => setTo(event.target.value))} /></FilterChip>
        <FilterChip label="магазин" onClear={storeId ? () => change(() => setStoreId('')) : undefined}><select aria-label="Магазин" value={storeId} onChange={event => change(() => setStoreId(event.target.value))}><option value="">все</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></FilterChip>
        <FilterChip label="тип" onClear={direction ? () => change(() => setDirection('')) : undefined}><select aria-label="Тип операции" value={direction} onChange={event => change(() => setDirection(event.target.value))}><option value="">выберите</option><option value="IN">приход</option><option value="OUT">расход</option></select></FilterChip>
      </div>
    </div>
    {journal && <div className="crm-money-totals" aria-live="polite"><span>Приход <strong>{amount(journal.totals.inMinor)} смн.</strong></span><span>Расход <strong>{amount(journal.totals.outMinor)} смн.</strong></span><span>Итого <strong>{amount(balance)} смн.</strong></span></div>}
    {from > to && <p role="alert" className="crm-alert">Дата начала должна быть не позже даты окончания.</p>}
    {error && <p role="alert" className="crm-alert">{error}</p>}
    <div className="crm-shifts-table-wrap" aria-busy={loading}>
      <table className="crm-shifts-table crm-journal-table">
        <thead><tr><th scope="col">Статус</th><th scope="col">Заказ</th><th scope="col">Время</th><th scope="col" className="num">Приход, смн</th><th scope="col" className="num">Расход, смн</th><th scope="col">Контрагент</th><th scope="col">Счёт</th><th scope="col">Категория платежа</th><th scope="col">Автор</th></tr></thead>
        {groups.map(group => <tbody key={group.day}>
          <tr className="crm-journal-day"><th scope="rowgroup" colSpan={9}>{group.day}</th></tr>
          {group.rows.map(entry => <tr key={entry.id} className={`${entry.direction === 'OUT' ? 'is-out' : 'is-in'}${selected?.id === entry.id ? ' selected' : ''}`}>
            <td><CheckCircle2 size={16} className="is-done" aria-label="Проведён" /></td>
            <td><button type="button" className="crm-link-button" onClick={() => setSelected(entry)}>{title(entry)}</button></td>
            <td>{timeFormat.format(new Date(entry.occurredAt))}</td>
            <td className="num">{entry.direction === 'IN' ? amount(entry.amountMinor) : ''}</td>
            <td className="num">{entry.direction === 'OUT' ? amount(entry.amountMinor) : ''}</td>
            <td>{entry.counterparty ?? ''}</td><td>{entry.account}</td><td>{entry.category}</td><td>{entry.author ?? ''}</td>
          </tr>)}
        </tbody>)}
      </table>
      {journal && !journal.items.length && !loading && <div className="crm-shifts-empty"><strong>Операций нет</strong><p>За выбранный период денег не поступало и не выплачивалось. Расширьте период или сбросьте фильтры.</p></div>}
      {!journal && loading && <p role="status" className="crm-shifts-empty">Загружаем операции…</p>}
    </div>
    {journal && journal.total > journal.limit && <div className="crm-shifts-pages"><span>Показано {journal.items.length} из {journal.total}</span><button type="button" className="crm-outline-button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Назад</button><span>{page} / {pages}</span><button type="button" className="crm-outline-button" disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)}>Вперёд</button></div>}
    {selected && !document && <CabinetDrawer title={title(selected)} onClose={() => setSelected(null)}>
      <div className="crm-doc-card">
        <div className="crm-doc-toolbar"><span className="crm-doc-created">Создан {fullDate.format(new Date(selected.occurredAt))}</span><span className="crm-doc-status is-done"><CheckCircle2 size={14} aria-hidden /> Проведён</span></div>
        <div className="crm-doc-fields">
          <dl>
            <div><dt>Магазин</dt><dd>{selected.store}</dd></div>
            <div><dt>Счёт</dt><dd>{selected.account}</dd></div>
            <div><dt>Контрагент</dt><dd>{selected.counterparty ?? '—'}</dd></div>
            <div><dt>Категория</dt><dd>{selected.category}</dd></div>
            <div><dt>Автор</dt><dd>{selected.author ?? '—'}</dd></div>
          </dl>
          <dl><div><dt>{selected.direction === 'IN' ? 'Приход' : 'Расход'}</dt><dd className={selected.direction === 'IN' ? 'crm-money-in' : 'crm-money-out'}>{selected.direction === 'IN' ? '+' : '−'}{amount(selected.amountMinor)} смн.</dd></div>{selected.comment && <div><dt>Комментарий</dt><dd>{selected.comment}</dd></div>}</dl>
        </div>
        {selected.document && <><h3 className="crm-shift-section">Документ-основание</h3><button type="button" className="crm-link-button" onClick={() => setDocument({ kind: selected.document!.kind, id: selected.document!.id })}>{selected.document.title.replace(/ (\d+)$/, ' #$1')}</button></>}
      </div>
    </CabinetDrawer>}
    {document && <DocumentCard kind={document.kind} id={document.id} onClose={() => { setDocument(null); setSelected(null); }} onOpen={(kind, id) => setDocument({ kind, id })} />}
  </div>;
}

export default function MoneyPage() {
  return <CatalogShell><MoneyJournal /></CatalogShell>;
}
