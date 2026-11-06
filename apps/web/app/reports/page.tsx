'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, BarChart3, Boxes, Lock, ReceiptText, Users, Wallet } from 'lucide-react';
import { CatalogShell } from '../../components/catalog-shell';
import { ReportView, type ReportInfo } from '../../components/report-view';
import { api } from '../../lib/api';

const groups = [
  { name: 'Продажи', icon: BarChart3 },
  { name: 'Прибыль', icon: Wallet },
  { name: 'Склад', icon: Boxes },
  { name: 'Деньги', icon: ReceiptText },
  { name: 'Клиенты', icon: Users },
];

function Reports() {
  const key = useSearchParams().get('key');
  const [catalog, setCatalog] = useState<ReportInfo[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<ReportInfo[]>('/reports').then(value => { if (active) setCatalog(value); }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить отчёты'); });
    return () => { active = false; };
  }, []);

  const selected = key ? catalog?.find(report => report.key === key) : undefined;
  if (selected?.available) return <ReportView key={selected.key} report={selected} />;

  return <>
    <div className="crm-page-head"><div><h1>Отчёты</h1><p>Все показатели считаются по проведённым документам. Период, магазин и другие фильтры задаются внутри отчёта, таблицу можно выгрузить в CSV или Excel.</p></div></div>
    {error && <p role="alert" className="crm-alert">{error}</p>}
    {key && catalog && !selected?.available && <p role="alert" className="crm-alert">Этот отчёт недоступен: нет прав или отчёт не найден. Выберите другой отчёт из списка.</p>}
    {!catalog && !error && <p role="status">Загружаем доступные отчёты…</p>}
    {catalog && groups.map(group => {
      const reports = catalog.filter(report => report.group === group.name);
      if (!reports.length) return null;
      return <section key={group.name} className="crm-report-group" aria-labelledby={`report-group-${group.name}`}>
        <h2 id={`report-group-${group.name}`}><group.icon size={16} aria-hidden /> {group.name}</h2>
        <div className="crm-report-grid">
          {reports.map(report => report.available
            ? <Link key={report.key} href={`/reports?key=${report.key}`} className="crm-report-card"><h3>{report.title}</h3><p>{report.description}</p><span>Открыть отчёт <ArrowRight size={15} aria-hidden /></span></Link>
            : <div key={report.key} className="crm-report-card is-locked" aria-disabled="true"><h3>{report.title}</h3><p>{report.description}</p><span><Lock size={13} aria-hidden /> Нет доступа — обратитесь к владельцу</span></div>)}
        </div>
      </section>;
    })}
  </>;
}

export default function ReportsPage() {
  return <CatalogShell><Suspense fallback={<p role="status">Загружаем отчёты…</p>}><Reports /></Suspense></CatalogShell>;
}
