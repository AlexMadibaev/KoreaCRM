'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Plus, Settings2, Upload } from 'lucide-react';
import { CategoryAutoAssign } from '../../components/category-auto-assign';
import { FilterChip } from '../../components/filter-chip';
import { amount } from '../../components/shift-card';
import { api, queryString, type Brand, type Category, type Page } from '../../lib/api';

type Store = { id: string; name: string };
type Row = {
  id: string; name: string; sku: string; unit: string; country: string | null; status: string; brand: string | null; category: string | null; barcode: string | null;
  createdAt: string; supplier: string | null; priceMinor: string | null; minStock: number | null; costMinor: string | null; purchasePriceMinor: string | null;
  marginPercent: string | null; markupPercent: string | null; stock: Record<string, number>;
};
type Overview = { stores: Store[]; priceStoreId: string | null; canSeeCost: boolean; total: number; page: number; limit: number; items: Row[] };
const columnLabels = {
  barcode: 'Штрих-код', sku: 'Артикул', unit: 'Ед. изм.', category: 'Категория', brand: 'Бренд', country: 'Страна', supplier: 'Поставщик',
  priceMinor: 'Цена продажи', costMinor: 'Себестоимость', purchasePriceMinor: 'Цена закупки', marginPercent: 'Маржинальность', markupPercent: 'Наценка',
  createdAt: 'Создан', minStock: 'Мин. ост.', status: 'Статус',
} as const;
type ColumnKey = keyof typeof columnLabels;
const allColumns = Object.keys(columnLabels) as ColumnKey[];
const costColumns = new Set<ColumnKey>(['costMinor', 'purchasePriceMinor', 'marginPercent', 'markupPercent']);
const numeric = new Set<ColumnKey>(['priceMinor', 'costMinor', 'purchasePriceMinor', 'marginPercent', 'markupPercent', 'minStock']);
const unitTitle: Record<string, string> = { pcs: 'шт.', kg: 'кг', g: 'г', l: 'л', ml: 'мл', m: 'м' };
const created = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Dushanbe' });
const COLUMNS_KEY = 'koreacrm.products.columns';
const PAGE_SIZE = 50;

function cell(row: Row, key: ColumnKey) {
  switch (key) {
    case 'priceMinor': case 'costMinor': case 'purchasePriceMinor': return row[key] === null ? '—' : amount(row[key]);
    case 'marginPercent': case 'markupPercent': return row[key] === null ? '—' : `${row[key]!.replace('.', ',')} %`;
    case 'createdAt': return created.format(new Date(row.createdAt));
    case 'unit': return unitTitle[row.unit] ?? row.unit;
    case 'status': return <span className={`crm-status-pill ${row.status === 'ACTIVE' ? 'on' : 'off'}`}>{row.status === 'ACTIVE' ? 'Активен' : 'Неактивен'}</span>;
    case 'minStock': return row.minStock ?? '—';
    default: return row[key] ?? '';
  }
}

/** Product list laid out like CloudShop "Товары и услуги": wide configurable table with prices, cost and stock per store. */
export default function ProductsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [brandId, setBrandId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState<ColumnKey[]>(['country', 'unit', 'createdAt']);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filtersRevision, setFiltersRevision] = useState(0);
  const version = useRef(0);

  useEffect(() => { const timer = window.setTimeout(() => { setAppliedSearch(search.trim()); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    try { const saved = JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? 'null'); if (Array.isArray(saved)) setHidden(saved.filter((key): key is ColumnKey => allColumns.includes(key))); } catch { /* per-viewer setting */ }
    api<Store[]>('/stores').then(setStores).catch(() => setStores([]));
  }, []);
  useEffect(() => {
    Promise.all([api<Page<Brand>>('/brands?limit=100'), api<Page<Category>>('/categories?limit=100')])
      .then(([brandPage, categoryPage]) => { setBrands(brandPage.items); setCategories(categoryPage.items); })
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить фильтры'));
  }, [filtersRevision]);
  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true); setError('');
    try {
      const result = await api<Overview>(`/products-overview?${queryString({ page, limit: PAGE_SIZE, search: appliedSearch, brandId, categoryId, status, storeId })}`);
      if (current === version.current) setData(result);
    } catch (caught) { if (current === version.current) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить товары'); }
    finally { if (current === version.current) setLoading(false); }
  }, [page, appliedSearch, brandId, categoryId, status, storeId]);
  useEffect(() => { void load(); }, [load]);

  const toggleColumn = (key: ColumnKey) => setHidden(current => {
    const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key];
    try { window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const visible = allColumns.filter(key => !hidden.includes(key) && (!costColumns.has(key) || data?.canSeeCost));
  const change = (apply: () => void) => { apply(); setPage(1); };
  const filtered = Boolean(search || brandId || categoryId || status);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return <section className="crm-shifts crm-products-overview">
    <div className="crm-shifts-toolbar">
      <div className="crm-chips" role="group" aria-label="Фильтры товаров">
        <FilterChip label="поиск" wide onClear={search ? () => setSearch('') : undefined}><input type="search" aria-label="Поиск товаров" enterKeyHint="search" autoComplete="off" placeholder="наименование, артикул или штрихкод" value={search} onChange={event => setSearch(event.target.value)} /></FilterChip>
        <FilterChip label="категория" onClear={categoryId ? () => change(() => setCategoryId('')) : undefined}><select aria-label="Категория" value={categoryId} onChange={event => change(() => setCategoryId(event.target.value))}><option value="">все</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FilterChip>
        <FilterChip label="бренд" onClear={brandId ? () => change(() => setBrandId('')) : undefined}><select aria-label="Бренд" value={brandId} onChange={event => change(() => setBrandId(event.target.value))}><option value="">все</option>{brands.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FilterChip>
        <FilterChip label="статус" onClear={status ? () => change(() => setStatus('')) : undefined}><select aria-label="Статус" value={status} onChange={event => change(() => setStatus(event.target.value))}><option value="">все</option><option value="ACTIVE">активные</option><option value="INACTIVE">неактивные</option></select></FilterChip>
        <FilterChip label="цены магазина"><select aria-label="Магазин для цен" value={storeId || data?.priceStoreId || ''} onChange={event => setStoreId(event.target.value)} disabled={!stores.length}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></FilterChip>
      </div>
      <div className="crm-shifts-tools">
        <span className="crm-list-total">{loading && !data ? 'Загрузка…' : `Загружено ${data?.items.length ?? 0} из ${data?.total ?? 0}`}</span>
        <Link className="crm-outline-button" href="/products/import"><Upload size={14} aria-hidden /> Импорт товаров</Link>
        <Link className="crm-primary-button" href="/products/new"><Plus size={14} aria-hidden /> Создать товар</Link>
        <div className="crm-columns-menu">
          <button type="button" className="crm-icon-button" aria-label="Настроить колонки" title="Настроить колонки" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(value => !value)}><Settings2 size={18} aria-hidden /></button>
          {columnsOpen && <div className="crm-columns-popover" role="group" aria-label="Колонки таблицы">{allColumns.filter(key => !costColumns.has(key) || data?.canSeeCost).map(key => <label key={key}><input type="checkbox" checked={!hidden.includes(key)} onChange={() => toggleColumn(key)} /> {columnLabels[key]}</label>)}</div>}
        </div>
      </div>
    </div>
    <CategoryAutoAssign onApplied={() => { setFiltersRevision(value => value + 1); void load(); }} />
    {error && <p className="crm-alert" role="alert">{error}</p>}
    <div className="crm-shifts-table-wrap" aria-busy={loading}>
      <table className="crm-shifts-table crm-products-wide">
        <thead><tr>
          <th scope="col" className="sticky-name">Наименование</th>
          {visible.map(key => <th key={key} scope="col" className={numeric.has(key) ? 'num' : ''}>{columnLabels[key]}</th>)}
          {data?.stores.map(store => <th key={store.id} scope="col" className="num">{store.name} остатки</th>)}
        </tr></thead>
        <tbody>{data?.items.map(row => <tr key={row.id}>
          <td className="sticky-name"><Link className="crm-link-button" href={`/products/${row.id}`}>{row.name}</Link></td>
          {visible.map(key => <td key={key} className={numeric.has(key) ? 'num' : ''}>{key === 'priceMinor' && row.priceMinor === null ? <Link href={`/products/${row.id}`}>Указать цену</Link> : cell(row, key)}</td>)}
          {data.stores.map(store => { const quantity = row.stock[store.id]; return <td key={store.id} className={`num${quantity !== undefined && quantity <= 0 ? ' crm-stock-zero' : ''}`}>{quantity ?? 0}</td>; })}
        </tr>)}</tbody>
      </table>
      {loading && !data && <p role="status" className="crm-shifts-empty">Загружаем товары…</p>}
      {data && !data.items.length && !loading && <div className="crm-shifts-empty"><strong>Товары не найдены</strong><p>{filtered ? 'Измените запрос или сбросьте фильтры.' : 'Создайте первый товар или импортируйте каталог.'}</p>{filtered && <button type="button" className="crm-outline-button" onClick={() => { setSearch(''); setBrandId(''); setCategoryId(''); setStatus(''); setPage(1); }}>Сбросить фильтры</button>}</div>}
    </div>
    {data && data.total > data.limit && <div className="crm-shifts-pages"><span>Страницы</span><button type="button" className="crm-outline-button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Назад</button><span>{page} / {pages}</span><button type="button" className="crm-outline-button" disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)}>Вперёд</button></div>}
  </section>;
}
