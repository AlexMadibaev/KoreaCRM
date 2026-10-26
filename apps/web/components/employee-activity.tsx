'use client';

import { useEffect, useState } from 'react';
import { api, queryString, type Page } from '../lib/api';

type Activity = { id: string; action: string; entityType: string; entityId: string | null; createdAt: string; ip: string | null; deviceId: string | null; user: { id: string; name: string; login: string } | null };
type Rewards = { balanceMinor: string; saleCount: number; salesTotalMinor: string; transactions: { id: string; reason: string; deltaMinor: string; createdAt: string }[] };
const money = (minor: string) => { const amount = BigInt(minor), absolute = amount < 0n ? -amount : amount; return `${amount < 0n ? '-' : ''}${new Intl.NumberFormat('ru-RU').format(absolute / 100n)},${String(absolute % 100n).padStart(2, '0')}`; };
const labels: Record<string, string> = {
  LOGIN: 'Вход в систему', LOGOUT: 'Выход из системы', TOKEN_REFRESHED: 'Продление сеанса',
  EMPLOYEE_CREATED: 'Учётная запись создана', EMPLOYEE_UPDATED: 'Данные сотрудника изменены',
  ROLE_CREATED: 'Роль создана', ROLE_UPDATED: 'Роль изменена',
  SALE_CREATED: 'Продажа оформлена', SALE_RETURNED: 'Возврат оформлен',
  CASH_SHIFT_OPENED: 'Кассовая смена открыта', CASH_SHIFT_CLOSED: 'Кассовая смена закрыта',
  PRODUCT_CREATED: 'Товар создан', PRODUCT_UPDATED: 'Товар изменён',
  EXPENSE_CREATED: 'Расход записан', STOCK_ADJUSTED: 'Остаток скорректирован',
};

export function EmployeeActivity({ employee, onClose }: { employee: { id: string; name: string }; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<Page<Activity> | null>(null);
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api<Page<Activity>>(`/employees/${employee.id}/activity?${queryString({ page, limit: 10 })}`).then(result => { if (active) setHistory(result); }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить историю'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employee.id, page]);
  useEffect(() => { let active = true; api<Rewards>(`/employees/${employee.id}/rewards`).then(result => { if (active) setRewards(result); }).catch(() => undefined); return () => { active = false; }; }, [employee.id]);

  return <section id="employee-activity" className="crm-panel h-fit p-5" aria-label={`История действий ${employee.name}`}>
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">История действий</h2><p className="mt-1 text-xs text-slate-500">{employee.name}</p></div><button type="button" aria-label="Закрыть историю" onClick={onClose}>✕</button></div>
    {rewards && <div className="mt-4 rounded-xl bg-rose-50 p-4"><strong>Продажи и вознаграждение</strong><p className="mt-2 text-sm">Чеков: {rewards.saleCount} · Продажи: {money(rewards.salesTotalMinor)} сомони · Начислено: {money(rewards.balanceMinor)} сомони</p><details className="mt-3 text-sm"><summary className="cursor-pointer">История начислений</summary><ul className="mt-2 divide-y divide-rose-100">{rewards.transactions.map(row => <li key={row.id} className="flex justify-between gap-2 py-2"><span>{new Date(row.createdAt).toLocaleString('ru-RU')} · {row.reason}</span><strong>{money(row.deltaMinor)}</strong></li>)}{!rewards.transactions.length && <li className="py-2 text-slate-500">Начислений пока нет</li>}</ul></details></div>}
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <p role="status" className="mt-5 text-sm text-slate-500">Загружаем историю…</p> : <div className="mt-5 space-y-0 border-l-2 border-violet-100 pl-4">{history?.items.map(record => <article key={record.id} className="relative border-b border-slate-100 py-3 last:border-0"><span className="absolute -left-[22px] top-5 h-3 w-3 rounded-full border-2 border-violet-500 bg-white" /><strong className="text-sm text-slate-800">{labels[record.action] ?? record.action.replaceAll('_', ' ')}</strong><p className="mt-1 text-xs text-slate-500">{new Date(record.createdAt).toLocaleString('ru-RU')}</p>{record.entityType === 'User' && record.entityId === employee.id && record.user?.id !== employee.id && <p className="mt-1 text-xs text-slate-500">Изменил: {record.user?.name ?? 'Система'}</p>}{record.deviceId && <p className="mt-1 text-xs text-slate-500">Устройство: {record.deviceId}</p>}</article>)}{!history?.items.length && <p className="py-5 text-sm text-slate-500">Действий пока нет</p>}</div>}
    {history && history.total > 10 && <div className="mt-4 flex items-center justify-between text-xs text-slate-500"><button type="button" disabled={page === 1} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => setPage(value => value - 1)}>Назад</button><span>{page} / {Math.ceil(history.total / 10)}</span><button type="button" disabled={page * 10 >= history.total} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => setPage(value => value + 1)}>Далее</button></div>}
  </section>;
}
