'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, BarChart3, Package, ReceiptText, Users, Wallet } from 'lucide-react';
import { CatalogShell } from '../../components/catalog-shell';
import { api } from '../../lib/api';

const reports = [
  { href: '/dashboard#sales-trend', name: 'Продажи по дням', description: 'Выручка и возвраты за выбранный период и магазин.', permission: 'finance.view', icon: BarChart3 },
  { href: '/dashboard#top-products', name: 'Продажи по товарам', description: 'Топ товаров по количеству после возвратов.', permission: 'finance.view', icon: Package },
  { href: '/finance', name: 'Финансовая сводка', description: 'Себестоимость, валовая прибыль, расходы и задолженность.', permission: 'finance.view', icon: Wallet },
  { href: '/finance#cash-shifts', name: 'Кассовые смены', description: 'Открытые смены, сверка наличных и отчёты X/Z.', permission: 'finance.cash_view', icon: ReceiptText },
  { href: '/stock', name: 'Остатки товаров', description: 'Наличие, резерв и товары с низким остатком по магазинам.', permission: 'inventory.view', icon: Package },
  { href: '/customers', name: 'Клиенты и долги', description: 'История покупок, сегменты и взаиморасчёты.', permission: 'customers.view', icon: Users },
];

export default function ReportsPage() {
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<{ permissions: string[] }>('/auth/me').then(me => { if (active) setPermissions(me.permissions); }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить отчёты'); });
    return () => { active = false; };
  }, []);
  return <CatalogShell>
    <div className="crm-page-head"><div><h1>Отчёты</h1><p>Выберите отчёт. Период и магазин задаются на экране отчёта.</p></div></div>
    {error && <p role="alert" className="crm-alert">{error}</p>}
    {!permissions && !error && <p role="status">Загружаем доступные отчёты…</p>}
    <div className="crm-report-grid">{reports.filter(report => permissions?.includes(report.permission)).map(report => <Link key={report.href} href={report.href} className="crm-report-card"><report.icon size={30} aria-hidden /><h2>{report.name}</h2><p>{report.description}</p><span>Открыть отчёт <ArrowRight size={15} aria-hidden /></span></Link>)}</div>
    {permissions && !reports.some(report => permissions.includes(report.permission)) && <p>Нет доступных отчётов. Обратитесь к администратору.</p>}
  </CatalogShell>;
}
