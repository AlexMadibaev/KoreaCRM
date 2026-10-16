'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCurrencyMinor } from '@koreacrm/ui';
import { api, queryString, type Brand, type Category, type Page, type Product } from '../../lib/api';

type Store = { id: string; name: string };
type Settings = { priceMinor: number | null } | null;

export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [priceError, setPriceError] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [brandId, setBrandId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    Promise.all([api<Page<Brand>>('/brands?limit=100'), api<Page<Category>>('/categories?limit=100')])
      .then(([brandPage, categoryPage]) => { setBrands(brandPage.items); setCategories(categoryPage.items); })
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить фильтры'));
    api<Store[]>('/stores').then(available => { setStores(available); setStoreId(available[0]?.id ?? ''); })
      .catch(caught => setPriceError(caught instanceof Error ? caught.message : 'Не удалось загрузить магазины'));
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await api<Page<Product>>(`/products?${queryString({ page, limit: 20, search: appliedSearch, brandId, categoryId })}`);
      setItems(result.items); setTotal(result.total);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить товары'); }
    finally { setLoading(false); }
  }, [page, appliedSearch, brandId, categoryId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setPrices({}); setPriceError('');
    if (!storeId || !items.length) return;
    let active = true;
    setPricesLoading(true);
    Promise.allSettled(items.map(item => api<Settings>(`/stores/${storeId}/products/${item.id}/settings`)))
      .then(results => {
        if (!active) return;
        const next: Record<string, number | null> = {};
        results.forEach((result, index) => { if (result.status === 'fulfilled') next[items[index]!.id] = result.value?.priceMinor ?? null; });
        setPrices(next);
        if (results.some(result => result.status === 'rejected')) setPriceError('Не удалось загрузить часть цен. Обновите страницу.');
      })
      .finally(() => { if (active) setPricesLoading(false); });
    return () => { active = false; };
  }, [items, storeId]);
  const filtered = Boolean(search || brandId || categoryId);
  return <section className="crm-products-page">
    <div className="crm-page-head"><div><span className="crm-eyebrow">АССОРТИМЕНТ</span><h1>Товары</h1><p>Управляйте каталогом и находите нужные позиции.</p></div><div className="crm-import-actions"><Link className="crm-outline-button" href="/products/import">Импорт / экспорт</Link><Link className="crm-primary-button" href="/products/new">＋ Добавить товар</Link></div></div>
    <div className="crm-products-toolbar"><div className="crm-products-search"><span aria-hidden="true">⌕</span><input aria-label="Поиск товаров" placeholder="Поиск по названию, SKU или штрихкоду" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div><select aria-label="Фильтр по бренду" value={brandId} onChange={event => { setBrandId(event.target.value); setPage(1); }}><option value="">Все бренды</option>{brands.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select aria-label="Фильтр по категории" value={categoryId} onChange={event => { setCategoryId(event.target.value); setPage(1); }}><option value="">Все категории</option>{categories.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select aria-label="Магазин для цен" value={storeId} onChange={event => setStoreId(event.target.value)} disabled={!stores.length}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select>{filtered && <button className="crm-clear-filters" onClick={() => { setSearch(''); setBrandId(''); setCategoryId(''); setPage(1); }}>Сбросить</button>}</div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {priceError && <div className="crm-alert" role="alert">{priceError}</div>}
    <div className="crm-products-card"><div className="crm-products-card-head"><div><h2>Каталог товаров</h2><span>{loading ? 'Загрузка…' : `${total} позиций`}</span></div><Link href="/brands">Бренды →</Link></div>
      <div className="crm-products-table-wrap"><table className="crm-products-table"><thead><tr><th>Товар</th><th>SKU</th><th>Бренд</th><th>Категория</th><th>Цена продажи</th><th>Статус</th><th><span className="sr-only">Открыть</span></th></tr></thead><tbody>{!loading && items.map(item => <tr key={item.id}><td><Link className="crm-product-name" href={`/products/${item.id}`}><span className="crm-product-thumbnail">✦</span><span><strong>{item.name}</strong><small>{item.country || item.unit || 'Товар каталога'}</small></span></Link></td><td className="crm-product-sku">{item.sku}</td><td>{item.brand?.name ?? '—'}</td><td>{item.category?.name ?? '—'}</td><td>{!storeId ? 'Выберите магазин' : pricesLoading ? 'Загрузка…' : Object.hasOwn(prices, item.id) ? prices[item.id] === null ? <Link href={`/products/${item.id}`}>Указать цену</Link> : formatCurrencyMinor(String(prices[item.id])) : '—'}</td><td><span className={`crm-status-pill ${item.status === 'ACTIVE' ? 'on' : 'off'}`}>{item.status === 'ACTIVE' ? 'Активен' : 'Неактивен'}</span></td><td><Link className="crm-product-open" href={`/products/${item.id}`} aria-label={`Открыть ${item.name}`}>›</Link></td></tr>)}</tbody></table></div>
      {loading && <div className="crm-products-empty">Загружаем товары…</div>}
      {!loading && items.length === 0 && <div className="crm-products-empty"><span>⌕</span><strong>Товары не найдены</strong><p>{filtered ? 'Попробуйте изменить запрос или сбросить фильтры.' : 'Добавьте первый товар в каталог.'}</p>{filtered && <button onClick={() => { setSearch(''); setBrandId(''); setCategoryId(''); setPage(1); }}>Сбросить фильтры</button>}</div>}
      <div className="crm-products-footer"><span>{total === 0 ? 'Нет записей' : `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} из ${total}`}</span><div><button disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>← Назад</button><span>Страница {page}</span><button disabled={page * 20 >= total || loading} onClick={() => setPage(value => value + 1)}>Далее →</button></div></div></div>
  </section>;
}
