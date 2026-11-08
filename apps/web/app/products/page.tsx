'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  Package,
  Plus,
  Search,
  Settings2,
  Upload,
  X,
} from 'lucide-react';
import { CategoryAutoAssign } from '../../components/category-auto-assign';
import { amount } from '../../components/shift-card';
import {
  api,
  queryString,
  type Brand,
  type Category,
  type Page,
} from '../../lib/api';

type Store = { id: string; name: string };
type Row = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  country: string | null;
  status: string;
  brand: string | null;
  category: string | null;
  barcode: string | null;
  createdAt: string;
  supplier: string | null;
  priceMinor: string | null;
  minStock: number | null;
  costMinor: string | null;
  purchasePriceMinor: string | null;
  marginPercent: string | null;
  markupPercent: string | null;
  stock: Record<string, number>;
};
type Overview = {
  stores: Store[];
  priceStoreId: string | null;
  canSeeCost: boolean;
  total: number;
  page: number;
  limit: number;
  items: Row[];
};
const columnLabels = {
  barcode: 'Штрихкод',
  sku: 'Артикул',
  unit: 'Ед. изм.',
  category: 'Категория',
  brand: 'Бренд',
  country: 'Страна',
  supplier: 'Поставщик',
  priceMinor: 'Цена продажи',
  costMinor: 'Себестоимость',
  purchasePriceMinor: 'Цена закупки',
  marginPercent: 'Маржинальность',
  markupPercent: 'Наценка',
  createdAt: 'Создан',
  minStock: 'Мин. остаток',
  status: 'Статус',
} as const;
type ColumnKey = keyof typeof columnLabels;
const allColumns = Object.keys(columnLabels) as ColumnKey[];
const defaultHidden = allColumns.filter(
  (key) => !['priceMinor', 'costMinor', 'status'].includes(key),
);
const costColumns = new Set<ColumnKey>([
  'costMinor',
  'purchasePriceMinor',
  'marginPercent',
  'markupPercent',
]);
const numeric = new Set<ColumnKey>([
  'priceMinor',
  'costMinor',
  'purchasePriceMinor',
  'marginPercent',
  'markupPercent',
  'minStock',
]);
const unitTitle: Record<string, string> = {
  pcs: 'шт.',
  kg: 'кг',
  g: 'г',
  l: 'л',
  ml: 'мл',
  m: 'м',
};
const created = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Dushanbe',
});
const COLUMNS_KEY = 'koreacrm.products.columns.v2';
const PAGE_SIZE = 50;
function cell(row: Row, key: ColumnKey) {
  switch (key) {
    case 'priceMinor':
    case 'costMinor':
    case 'purchasePriceMinor':
      return row[key] === null ? '—' : amount(row[key]);
    case 'marginPercent':
    case 'markupPercent':
      return row[key] === null ? '—' : `${row[key]!.replace('.', ',')} %`;
    case 'createdAt':
      return created.format(new Date(row.createdAt));
    case 'unit':
      return unitTitle[row.unit] ?? row.unit;
    case 'status':
      return (
        <span
          className={`crm-status-pill ${row.status === 'ACTIVE' ? 'on' : 'off'}`}
        >
          {row.status === 'ACTIVE' ? 'Активен' : 'Неактивен'}
        </span>
      );
    case 'minStock':
      return row.minStock ?? '—';
    default:
      return row[key] ?? '—';
  }
}
export default function ProductsPage() {
  const [brands, setBrands] = useState<Brand[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState(''),
    [search, setSearch] = useState(''),
    [appliedSearch, setAppliedSearch] = useState('');
  const [brandId, setBrandId] = useState(''),
    [categoryId, setCategoryId] = useState(''),
    [status, setStatus] = useState('');
  const [page, setPage] = useState(1),
    [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [hidden, setHidden] = useState<ColumnKey[]>(defaultHidden),
    [columnsOpen, setColumnsOpen] = useState(false),
    [allStocks, setAllStocks] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]),
    [filtersRevision, setFiltersRevision] = useState(0);
  const version = useRef(0),
    columnsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(COLUMNS_KEY) ?? 'null',
      );
      if (Array.isArray(saved))
        setHidden(
          saved.filter((key): key is ColumnKey => allColumns.includes(key)),
        );
    } catch {
      /* Optional preference. */
    }
    void api<Store[]>('/stores')
      .then(setStores)
      .catch(() => setStores([]));
    void api<{ permissions: string[] }>('/auth/me')
      .then((me) => setPermissions(me.permissions))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    Promise.all([
      api<Page<Brand>>('/brands?limit=100'),
      api<Page<Category>>('/categories?limit=100'),
    ])
      .then(([b, c]) => {
        setBrands(b.items);
        setCategories(c.items);
      })
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : 'Не удалось загрузить фильтры',
        ),
      );
  }, [filtersRevision]);
  useEffect(() => {
    if (!columnsOpen) return;
    const outside = (event: PointerEvent) => {
      if (!columnsRef.current?.contains(event.target as Node))
        setColumnsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setColumnsOpen(false);
        columnsRef.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [columnsOpen]);
  const load = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<Overview>(
        `/products-overview?${queryString({ page, limit: PAGE_SIZE, search: appliedSearch, brandId, categoryId, status, storeId })}`,
      );
      if (current === version.current) setData(result);
    } catch (reason) {
      if (current === version.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Не удалось загрузить товары',
        );
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [page, appliedSearch, brandId, categoryId, status, storeId]);
  useEffect(() => {
    void load();
    return () => {
      version.current++;
    };
  }, [load]);
  function saveColumns(next: ColumnKey[]) {
    setHidden(next);
    try {
      window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {
      /* Optional preference. */
    }
  }
  const change = (apply: () => void) => {
    apply();
    setPage(1);
  };
  const filtered = Boolean(search || brandId || categoryId || status);
  const clearFilters = () => {
    setSearch('');
    setAppliedSearch('');
    setBrandId('');
    setCategoryId('');
    setStatus('');
    setPage(1);
  };
  const visible = allColumns.filter(
    (key) =>
      !hidden.includes(key) && (!costColumns.has(key) || data?.canSeeCost),
  );
  const stockStores =
    data?.stores.filter(
      (store) => allStocks || store.id === (storeId || data.priceStoreId),
    ) ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <section className="crm-products-overview crm-workspace-page">
      <header className="crm-workspace-heading">
        <div>
          <h1>Товары</h1>
          <p>Каталог, цены и остатки по магазинам.</p>
        </div>
        <div className="crm-workspace-actions">
          {permissions.includes('products.create') && (
            <>
              <Link className="ks-button ks-button--secondary crm-outline-button" href="/products/import">
                <Upload size={16} aria-hidden />
                Импорт товаров
              </Link>
              <Link className="ks-button ks-button--primary crm-primary-button" href="/products/new">
                <Plus size={17} aria-hidden />
                Создать товар
              </Link>
            </>
          )}
        </div>
      </header>
      <div className="crm-catalog-filters">
        <label className="crm-catalog-search">
          <span>Поиск</span>
          <div>
            <Search size={18} aria-hidden />
            <input
              type="search"
              aria-label="Поиск товаров"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Название, артикул или штрихкод"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </label>
        <label>
          Категория
          <select
            value={categoryId}
            onChange={(event) =>
              change(() => setCategoryId(event.target.value))
            }
          >
            <option value="">Все категории</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Бренд
          <select
            value={brandId}
            onChange={(event) => change(() => setBrandId(event.target.value))}
          >
            <option value="">Все бренды</option>
            {brands.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Статус
          <select
            value={status}
            onChange={(event) => change(() => setStatus(event.target.value))}
          >
            <option value="">Все статусы</option>
            <option value="ACTIVE">Активные</option>
            <option value="INACTIVE">Неактивные</option>
          </select>
        </label>
        <label>
          Магазин
          <select
            value={storeId || data?.priceStoreId || ''}
            onChange={(event) => change(() => setStoreId(event.target.value))}
            disabled={!stores.length}
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button
            type="button"
            className="ks-button ks-button--ghost ks-button--sm crm-text-action crm-filter-reset"
            onClick={clearFilters}
          >
            <X size={14} aria-hidden />
            Сбросить фильтры
          </button>
        )}
      </div>
      {error && (
        <div className="crm-alert" role="alert">
          {error}
          <button className="ks-button ks-button--ghost ks-button--sm crm-text-action" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      )}
      <div className="crm-list-panel">
        <div className="crm-list-panel-heading">
          <div>
            <h2>
              Каталог <span>{data?.total ?? '—'}</span>
            </h2>
            <p>
              {loading
                ? 'Обновляем список…'
                : 'Цены в сомони · остатки в выбранном магазине'}
            </p>
          </div>
          <div className="crm-columns-menu" ref={columnsRef}>
            <button
              type="button"
              className="ks-button ks-button--secondary crm-outline-button"
              aria-expanded={columnsOpen}
              aria-controls="product-columns"
              onClick={() => setColumnsOpen((value) => !value)}
            >
              <Settings2 size={16} aria-hidden />
              Колонки
              <ChevronDown size={14} aria-hidden />
            </button>
            {columnsOpen && (
              <div
                id="product-columns"
                className="crm-columns-popover"
                role="group"
                aria-label="Колонки таблицы"
              >
                <strong>Показывать в таблице</strong>
                {allColumns
                  .filter((key) => !costColumns.has(key) || data?.canSeeCost)
                  .map((key) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={!hidden.includes(key)}
                        onChange={() =>
                          saveColumns(
                            hidden.includes(key)
                              ? hidden.filter((item) => item !== key)
                              : [...hidden, key],
                          )
                        }
                      />
                      {columnLabels[key]}
                    </label>
                  ))}
                <label>
                  <input
                    type="checkbox"
                    checked={allStocks}
                    onChange={(event) => setAllStocks(event.target.checked)}
                  />
                  Остатки всех магазинов
                </label>
                <button
                  className="ks-button ks-button--ghost ks-button--sm crm-text-action"
                  onClick={() => {
                    saveColumns(defaultHidden);
                    setAllStocks(false);
                  }}
                >
                  Вернуть компактный вид
                </button>
              </div>
            )}
          </div>
        </div>
        {visible.length + stockStores.length > 6 && (
          <p className="crm-table-hint">
            Дополнительные колонки доступны при прокрутке вправо. Закреплённое
            название поможет не потерять товар.
          </p>
        )}
        <div
          className="crm-catalog-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Таблица товаров"
          aria-busy={loading}
        >
          <table className="crm-shifts-table crm-products-wide crm-mobile-cards">
            <thead>
              <tr>
                <th scope="col" className="sticky-name">
                  Товар
                </th>
                {visible.map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className={numeric.has(key) ? 'num' : ''}
                  >
                    {columnLabels[key]}
                  </th>
                ))}
                {stockStores.map((store) => (
                  <th key={store.id} scope="col" className="num">
                    {allStocks ? `${store.name} · остаток` : 'Остаток'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((row) => (
                <tr key={row.id}>
                  <td className="sticky-name">
                    <Link
                      className="crm-catalog-item"
                      href={`/products/${row.id}`}
                    >
                      <strong>{row.name}</strong>
                      <span>
                        {[row.sku && `Арт. ${row.sku}`, row.category, row.brand]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {row.barcode && <small>{row.barcode}</small>}
                    </Link>
                  </td>
                  {visible.map((key) => (
                    <td
                      key={key}
                      data-label={columnLabels[key]}
                      className={numeric.has(key) ? 'num' : ''}
                    >
                      {key === 'priceMinor' && row.priceMinor === null ? (
                        <Link href={`/products/${row.id}`}>Указать цену</Link>
                      ) : (
                        cell(row, key)
                      )}
                    </td>
                  ))}
                  {stockStores.map((store) => (
                    <td
                      key={store.id}
                      data-label={
                        allStocks ? `${store.name} · остаток` : 'Остаток'
                      }
                      className={`num${(row.stock[store.id] ?? 0) <= 0 ? ' crm-stock-zero' : ''}`}
                    >
                      <strong>{row.stock[store.id] ?? 0}</strong>
                      <small className="crm-stock-unit">
                        {unitTitle[row.unit] ?? row.unit}
                      </small>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {loading && !data && (
            <div className="crm-workspace-empty" role="status">
              Загружаем каталог…
            </div>
          )}
          {data && !data.items.length && !loading && (
            <div className="crm-workspace-empty">
              <Package size={32} aria-hidden />
              <h3>
                {filtered
                  ? 'По вашему запросу товаров нет'
                  : 'Каталог пока пуст'}
              </h3>
              <p>
                {filtered
                  ? 'Попробуйте другое название или сбросьте фильтры.'
                  : 'Создайте товар вручную или загрузите готовый каталог.'}
              </p>
              {filtered ? (
                <button className="ks-button ks-button--secondary crm-outline-button" onClick={clearFilters}>
                  Сбросить фильтры
                </button>
              ) : (
                permissions.includes('products.create') && (
                  <Link className="ks-button ks-button--primary crm-primary-button" href="/products/new">
                    Создать первый товар
                  </Link>
                )
              )}
            </div>
          )}
        </div>
        <footer className="crm-list-footer">
          <span>
            {data?.total
              ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, data.total)} из ${data.total}`
              : '0 товаров'}
          </span>
          {pages > 1 && (
            <div>
              <button
                className="ks-button ks-button--secondary crm-outline-button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((value) => value - 1)}
              >
                Назад
              </button>
              <span>
                {page} / {pages}
              </span>
              <button
                className="ks-button ks-button--secondary crm-outline-button"
                disabled={page >= pages || loading}
                onClick={() => setPage((value) => value + 1)}
              >
                Далее
              </button>
            </div>
          )}
        </footer>
      </div>
      {permissions.includes('products.edit') && (
        <details className="crm-catalog-additional">
          <summary>Дополнительные действия</summary>
          <CategoryAutoAssign
            onApplied={() => {
              setFiltersRevision((value) => value + 1);
              void load();
            }}
          />
        </details>
      )}
    </section>
  );
}
