'use client';

import { useEffect, useState } from 'react';
import { CatalogShell } from '../../components/catalog-shell';
import { api, queryString, type Page } from '../../lib/api';

type Entry = { id: string; action: string; entityType: string; entityId: string; oldValue: unknown; newValue: unknown; ip: string | null; deviceId: string | null; createdAt: string; user: { id: string; name: string; login: string } | null };
type Me = { role: string };
const actionLabel: Record<string, string> = { STORE_CREATED: 'Магазин создан', STORE_UPDATED: 'Магазин изменён', STORE_EMPLOYEE_ASSIGNED: 'Сотрудник добавлен в магазин', STORE_EMPLOYEE_UNASSIGNED: 'Сотрудник снят с магазина', ROLE_UPDATED: 'Роль изменена', EMPLOYEE_CREATED: 'Сотрудник создан', EMPLOYEE_UPDATED: 'Сотрудник изменён', EMPLOYEE_DELETED: 'Сотрудник удалён' };

export default function AuditPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [records, setRecords] = useState<Page<Entry> | null>(null);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api<Me>('/auth/me').then(setMe).catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось проверить доступ')); }, []);
  useEffect(() => {
    if (me?.role !== 'SUPERUSER') return;
    const timer = window.setTimeout(() => api<Page<Entry>>(`/audit?${queryString({ page, limit: 30, search, from, to })}`).then(setRecords).catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить журнал')), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [me, page, search, from, to]);
  return <CatalogShell><div className="space-y-5"><div className="crm-page-head"><div><span className="crm-eyebrow">КОНТРОЛЬ ДОСТУПА</span><h1>Журнал действий</h1><p>Изменения в системе с указанием сотрудника и времени. Доступен только суперпользователю.</p></div></div>
    {error && <p role="alert" className="crm-alert">{error}</p>}
    {me && me.role !== 'SUPERUSER' ? <section className="crm-panel p-6">У вас нет доступа к журналу действий.</section> : <section className="crm-panel overflow-hidden"><div className="grid gap-3 border-b p-5 md:grid-cols-[minmax(0,1fr)_180px_180px]"><label className="text-sm">Поиск<input className="mt-1 block w-full rounded-lg border p-2" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Действие или сотрудник" /></label><label className="text-sm">С даты<input type="date" className="mt-1 block w-full rounded-lg border p-2" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label><label className="text-sm">По дату<input type="date" className="mt-1 block w-full rounded-lg border p-2" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} /></label></div><div className="divide-y">{records?.items.map(entry => <article key={entry.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><strong>{actionLabel[entry.action] ?? entry.action}</strong><p className="mt-1 text-sm text-slate-600">{entry.user ? `${entry.user.name} · @${entry.user.login}` : 'Система'} · {entry.entityType}</p></div><time className="text-sm text-slate-500">{new Date(entry.createdAt).toLocaleString('ru-RU')}</time></div><button className="mt-2 text-xs font-semibold text-rose-700" type="button" aria-expanded={openId === entry.id} onClick={() => setOpenId(current => current === entry.id ? '' : entry.id)}>{openId === entry.id ? 'Скрыть детали' : 'Показать детали'}</button>{openId === entry.id && <div className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-4 text-xs md:grid-cols-2"><div><strong>До</strong><pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify(entry.oldValue, null, 2) ?? '—'}</pre></div><div><strong>После</strong><pre className="mt-2 whitespace-pre-wrap break-all">{JSON.stringify(entry.newValue, null, 2) ?? '—'}</pre></div><p className="md:col-span-2">Запись: {entry.entityId} · IP: {entry.ip || '—'} · Устройство: {entry.deviceId || '—'}</p></div>}</article>)}{records && !records.items.length && <p className="p-8 text-center text-sm text-slate-500">Записей не найдено</p>}</div>{records && records.total > 30 && <div className="flex items-center justify-between border-t p-4 text-sm"><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Назад</button><span>{page} / {Math.ceil(records.total / 30)}</span><button type="button" disabled={page * 30 >= records.total} onClick={() => setPage(page + 1)}>Далее</button></div>}</section>}
  </div></CatalogShell>;
}
