'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CatalogShell } from '../../components/catalog-shell';
import { DocumentCard, StatusIcon, dayFormat, documentName, kindTitle, outgoing, timeFormat, type DocumentJournal as Journal, type DocumentRow as Row } from '../../components/document-card';
import { FilterChip, dushanbeDay } from '../../components/filter-chip';
import { amount } from '../../components/shift-card';
import { api, queryString } from '../../lib/api';

type Store = { id: string; name: string };
const PAGE_SIZE = 50;

function DocumentJournal() {
  const [stores, setStores] = useState<Store[]>([]);
  const [from, setFrom] = useState(dushanbeDay(-6));
  const [to, setTo] = useState(dushanbeDay());
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [storeId, setStoreId] = useState('');
  const [kind, setKind] = useState('');
  const [paid, setPaid] = useState('');
  const [page, setPage] = useState(1);
  const [journal, setJournal] = useState<Journal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const version = useRef(0);

  useEffect(() => { api<Store[]>('/stores').then(setStores).catch(() => setStores([])); }, []);
  useEffect(() => { const timer = window.setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [search]);
  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true); setError('');
    try {
      const result = await api<Journal>(`/documents?${queryString({ from, to, storeId, kind, paid, q, page, limit: PAGE_SIZE })}`);
      if (current === version.current) setJournal(result);
    } catch (caught) { if (current === version.current) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить документы'); }
    finally { if (current === version.current) setLoading(false); }
  }, [from, to, storeId, kind, paid, q, page]);
  useEffect(() => { if (from && to && from <= to) void load(); }, [load, from, to]);

  const groups = useMemo(() => (journal?.items ?? []).reduce<{ day: string; rows: Row[] }[]>((result, item) => {
    const day = dayFormat.format(new Date(item.occurredAt));
    const last = result[result.length - 1];
    if (last?.day === day) last.rows.push(item); else result.push({ day, rows: [item] });
    return result;
  }, []), [journal]);
  const change = (apply: () => void) => { apply(); setPage(1); };
  const pages = journal ? Math.max(1, Math.ceil(journal.total / journal.limit)) : 1;

  return <div className="crm-shifts">
    <div className="crm-shifts-toolbar">
      <div className="crm-chips" role="group" aria-label="Фильтры документов">
        <FilterChip label="поиск" wide onClear={search ? () => setSearch('') : undefined}><input type="search" aria-label="Поиск по номеру или комментарию" placeholder="поиск по номеру или комментарию" value={search} onChange={event => setSearch(event.target.value)} /></FilterChip>
        <FilterChip label="дата">
          <input type="date" aria-label="Дата с" value={from} max={to} onChange={event => change(() => setFrom(event.target.value))} /><span aria-hidden>—</span>
          <input type="date" aria-label="Дата по" value={to} min={from} onChange={event => change(() => setTo(event.target.value))} />
        </FilterChip>
        <FilterChip label="магазин" onClear={storeId ? () => change(() => setStoreId('')) : undefined}><select aria-label="Магазин" value={storeId} onChange={event => change(() => setStoreId(event.target.value))}><option value="">все</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></FilterChip>
        <FilterChip label="оплата" onClear={paid ? () => change(() => setPaid('')) : undefined}><select aria-label="Оплата" value={paid} onChange={event => change(() => setPaid(event.target.value))}><option value="">выберите</option><option value="PAID">оплачен</option><option value="UNPAID">не оплачен</option></select></FilterChip>
        <FilterChip label="тип" onClear={kind ? () => change(() => setKind('')) : undefined}><select aria-label="Тип документа" value={kind} onChange={event => change(() => setKind(event.target.value))}><option value="">все</option>{(journal?.kinds ?? []).map(item => <option key={item} value={item}>{kindTitle[item]}</option>)}</select></FilterChip>
      </div>
    </div>
    {from > to && <p role="alert" className="crm-alert">Дата начала должна быть не позже даты окончания.</p>}
    {error && <p role="alert" className="crm-alert">{error}</p>}
    <div className="crm-shifts-table-wrap" aria-busy={loading}>
      <table className="crm-shifts-table crm-journal-table">
        <thead><tr><th scope="col">Статус</th><th scope="col">Документ</th><th scope="col">Время</th><th scope="col" className="num">Позиций</th><th scope="col" className="num">Сумма</th><th scope="col" className="num">Оплаченные</th><th scope="col">Отправитель</th><th scope="col">Получатель</th><th scope="col">Автор</th></tr></thead>
        {groups.map(group => <tbody key={group.day}>
          <tr className="crm-journal-day"><th scope="rowgroup" colSpan={9}>{group.day}</th></tr>
          {group.rows.map(row => <tr key={`${row.kind}:${row.id}`} className={`${outgoing.has(row.kind) ? 'is-out' : 'is-in'}${selected?.id === row.id ? ' selected' : ''}`}>
            <td><StatusIcon status={row.status} /></td>
            <td><button type="button" className="ks-button ks-button--ghost ks-button--sm crm-link-button" onClick={() => setSelected(row)}>{documentName(row.kind, row.number)}</button></td>
            <td>{timeFormat.format(new Date(row.occurredAt))}</td>
            <td className="num">{row.positions}</td>
            <td className="num">{row.amountMinor === null ? '' : amount(row.amountMinor)}</td>
            <td className="num">{row.paidMinor === null ? '' : amount(row.paidMinor)}</td>
            <td>{row.sender ?? ''}</td><td>{row.receiver ?? ''}</td><td>{row.author ?? ''}</td>
          </tr>)}
        </tbody>)}
      </table>
      {journal && !journal.items.length && !loading && <div className="crm-shifts-empty"><strong>Документов нет</strong><p>За выбранный период и с этими фильтрами документов не найдено. Расширьте период или сбросьте фильтры.</p></div>}
      {!journal && loading && <p role="status" className="crm-shifts-empty">Загружаем документы…</p>}
    </div>
    {journal && journal.total > journal.limit && <div className="crm-shifts-pages"><span>Показано {journal.items.length} из {journal.total}</span><button type="button" className="ks-button ks-button--secondary crm-outline-button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Назад</button><span>{page} / {pages}</span><button type="button" className="ks-button ks-button--secondary crm-outline-button" disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)}>Вперёд</button></div>}
    {selected && <DocumentCard key={`${selected.kind}:${selected.id}`} kind={selected.kind} id={selected.id} onClose={() => setSelected(null)} onOpen={(nextKind, nextId) => setSelected({ ...selected, kind: nextKind, id: nextId })} />}
  </div>;
}

export default function JournalPage() {
  return <CatalogShell><DocumentJournal /></CatalogShell>;
}
