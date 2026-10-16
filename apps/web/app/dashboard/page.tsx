'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CatalogShell } from '../../components/catalog-shell';
import { api } from '../../lib/api';
import { formatCurrencyMinor as money } from '@koreacrm/ui';
import { SalesTrend, type SalesTrendData } from '../../components/sales-trend';
import { TopProducts, type TopProductsData } from '../../components/top-products';

type Summary = {
  revenueMinor: string; grossProfitMinor: string; expensesMinor: string; operationalResultMinor: string;
  customerDebtMinor: string | null; supplierDebtMinor: string; checksCount: number;
  averageCheckMinor: string; discountsMinor: string; returnsCount: number; returnsMinor: string;
};
type Store = { id: string; name: string; status?: string; deletedAt?: string | null };
type LowStockItem = { productId: string; name: string; sku: string; quantity: number; minStock: number };
type StockAttention = { visible: boolean; total: number; items: Array<LowStockItem & { storeId: string; storeName: string }>; error?: string };
const date = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const count = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

export default function DashboardPage() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('week');
  const [storeId, setStoreId] = useState('');
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [stores, setStores] = useState<Store[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<SalesTrendData | null>(null);
  const [trendError, setTrendError] = useState('');
  const [topProducts, setTopProducts] = useState<TopProductsData | null>(null);
  const [topProductsError, setTopProductsError] = useState('');
  const [error, setError] = useState('');
  const [stockAttention, setStockAttention] = useState<StockAttention | null>(null);

  useEffect(() => {
    let active = true;
    api<Store[]>(`/finance/stores?scope=${scope}`).then(value => { if (active) setStores(value); }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить магазины');
    });
    return () => { active = false; };
  }, [scope]);

  useEffect(() => {
    const to = new Date(); const from = new Date(to);
    if (period === 'week') from.setDate(to.getDate() - 6);
    if (period === 'month') from.setDate(to.getDate() - 29);
    const params = new URLSearchParams({ from: date(from), to: date(to) });
    params.set('scope', scope);
    if (storeId) params.set('storeId', storeId);
    let active = true;
    setSummary(null);
    setTrend(null);
    setTrendError('');
    setTopProducts(null);
    setTopProductsError('');
    api<Summary>(`/finance/summary?${params}`).then(value => { if (active) { setSummary(value); setError(''); } }).catch(reason => {
      if (active) { setSummary(null); setError(reason instanceof Error ? reason.message : 'Не удалось загрузить данные'); }
    });
    api<SalesTrendData>(`/finance/sales-trend?${params}`).then(value => { if (active) setTrend(value); }).catch(reason => {
      if (active) setTrendError(reason instanceof Error ? reason.message : 'Не удалось загрузить график');
    });
    api<TopProductsData>(`/finance/top-products?${params}`).then(value => { if (active) setTopProducts(value); }).catch(reason => {
      if (active) setTopProductsError(reason instanceof Error ? reason.message : 'Не удалось загрузить рейтинг товаров');
    });
    return () => { active = false; };
  }, [period, storeId, scope]);

  useEffect(() => {
    let active = true;
    async function loadLowStock() {
      try {
        if (scope === 'all') { if (active) setStockAttention({ visible: false, total: 0, items: [] }); return; }
        const me = await api<{ permissions: string[] }>('/auth/me');
        if (!me.permissions.includes('inventory.view')) { if (active) setStockAttention({ visible: false, total: 0, items: [] }); return; }
        const allStores = await api<Store[]>('/stores');
        const selectedStores = storeId ? allStores.filter(store => store.id === storeId) : allStores;
        const results = await Promise.all(selectedStores.map(async store => {
          const result = await api<{ items: LowStockItem[]; total: number }>(`/stores/${store.id}/stock?filter=low&page=1&limit=3`);
          return { total: result.total, items: result.items.map(item => ({ ...item, storeId: store.id, storeName: store.name })) };
        }));
        if (active) setStockAttention({ visible: true, total: results.reduce((sum, result) => sum + result.total, 0), items: results.flatMap(result => result.items).slice(0, 5) });
      } catch (caught) {
        if (active) setStockAttention({ visible: true, total: 0, items: [], error: caught instanceof Error ? caught.message : 'Не удалось проверить остатки' });
      }
    }
    void loadLowStock();
    return () => { active = false; };
  }, [storeId, scope]);

  const metrics = [
    ['Выручка', summary?.revenueMinor, '↗', 'green'],
    ['Валовая прибыль', summary?.grossProfitMinor, '◈', 'purple'],
    ['Расходы', summary?.expensesMinor, '↘', 'orange'],
    ['Операционный результат', summary?.operationalResultMinor, '◎', 'blue'],
  ];
  const stockHref = `/stock?filter=low${storeId ? `&storeId=${encodeURIComponent(storeId)}` : ''}`;

  return <CatalogShell>
    <div className="crm-page-head"><div><span className="crm-eyebrow">ПАНЕЛЬ УПРАВЛЕНИЯ</span><h1>Обзор бизнеса</h1><p>Ключевые показатели и быстрый доступ к работе магазина.</p></div><Link href="/account" className="crm-outline-button">Мой профиль <span>↗</span></Link></div>
    <div className="crm-dashboard-filters">
      <div className="crm-periods" role="group" aria-label="Период отчёта">{([['today', 'Сегодня'], ['week', '7 дней'], ['month', '30 дней']] as const).map(([key, label]) => <button key={key} className={period === key ? 'selected' : ''} onClick={() => setPeriod(key)}>{label}</button>)}</div>
      <label>Магазин<select value={storeId} onChange={event => setStoreId(event.target.value)}><option value="">{scope === 'all' ? 'Вся история сети' : 'Все действующие магазины'}</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}{store.deletedAt || store.status && store.status !== 'ACTIVE' ? ' (архив)' : ''}</option>)}</select></label>
    </div>
    <label className="crm-dashboard-archive"><input type="checkbox" checked={scope === 'all'} onChange={event => { setScope(event.target.checked ? 'all' : 'active'); setStoreId(''); }} /> Включить архивные магазины в отчёт</label>
    {error && <div className="crm-alert" role="alert">Не удалось получить показатели: {error}</div>}
    <div className="crm-metrics">{metrics.map(([label, value, icon, tone]) => <div className="crm-metric" key={label}><div className="crm-metric-top"><span>{label}</span><span className={`crm-metric-icon ${tone}`}>{icon}</span></div><strong>{summary ? money(value) : '—'}</strong><small>За выбранный период</small></div>)}</div>
    <section className="crm-dashboard-sales" aria-label="Продажи за период">
      <div><span>Чеков</span><strong>{summary ? count(summary.checksCount) : '—'}</strong></div>
      <div><span>Средний чек</span><strong>{summary ? money(summary.averageCheckMinor) : '—'}</strong><small>По оформленным продажам</small></div>
      <div><span>Скидки</span><strong>{summary ? money(summary.discountsMinor) : '—'}</strong></div>
      <div><span>Возвраты</span><strong>{summary ? money(summary.returnsMinor) : '—'}</strong><small>{summary ? `${count(summary.returnsCount)} операций` : ''}</small></div>
    </section>
    {trendError && <div className="crm-alert" role="alert">{trendError}</div>}
    {trend && <SalesTrend data={trend} />}
    {topProductsError && <div className="crm-alert" role="alert">{topProductsError}</div>}
    {topProducts && <TopProducts data={topProducts} />}
    <div className="crm-dashboard-grid"><section className="crm-panel"><div className="crm-panel-heading"><div><span className="crm-eyebrow">ДЕЙСТВИЯ</span><h2>Продолжить работу</h2></div></div><div className="crm-shortcuts"><Link href="/products"><span className="crm-shortcut-icon purple">◫</span><span><strong>Каталог товаров</strong><small>Товары, цены и ассортимент</small></span><b>→</b></Link><Link href="/sales"><span className="crm-shortcut-icon green">▤</span><span><strong>Продажи</strong><small>История чеков и операций</small></span><b>→</b></Link><Link href="/stock"><span className="crm-shortcut-icon orange">▦</span><span><strong>Остатки</strong><small>Наличие по магазинам</small></span><b>→</b></Link></div></section><section className="crm-panel"><div className="crm-panel-heading"><div><span className="crm-eyebrow">РАСЧЁТЫ</span><h2>Задолженности</h2></div><Link href="/finance">Подробнее →</Link></div><div className="crm-debt"><span>Долг клиентов</span><strong>{summary ? money(summary.customerDebtMinor) : '—'}</strong></div><div className="crm-debt"><span>Долг поставщикам</span><strong>{summary ? money(summary.supplierDebtMinor) : '—'}</strong></div><p className="crm-panel-note">Долг клиентов по отдельному магазину пока недоступен.</p></section></div>
    {stockAttention?.visible && <section className="crm-panel crm-stock-attention"><div className="crm-panel-heading"><div><span className="crm-eyebrow">КОНТРОЛЬ ОСТАТКОВ</span><h2>Товары с низким остатком</h2></div><Link href={stockHref}>Все остатки →</Link></div>{stockAttention.error ? <p role="alert" className="crm-stock-attention-note">{stockAttention.error}</p> : stockAttention.total === 0 ? <p className="crm-stock-attention-note">Сейчас нет товаров на уровне минимума или ниже.</p> : <><p className="crm-stock-attention-note">Требуют внимания: {stockAttention.total}</p><div className="crm-stock-attention-list">{stockAttention.items.map(item => <Link key={`${item.storeId}:${item.productId}`} href={`/stock?filter=low&storeId=${encodeURIComponent(item.storeId)}`}><span><strong>{item.name}</strong><small>{item.storeName} · {item.sku}</small></span><span className="crm-stock-attention-count">{item.quantity} / мин. {item.minStock}</span></Link>)}</div></>}</section>}
  </CatalogShell>;
}
