'use client';

import { useEffect, useState } from 'react';
import { api, type Page } from '../lib/api';
import { formatCurrencyMinor as money } from '@koreacrm/ui';

type Metrics = {
  salesMinor: string;
  returnsMinor: string;
  netMinor: string;
  saleCount: number;
  averageCheckMinor: string;
  closedShiftCount: number;
};
type Performance = { day: Metrics; month: Metrics; quarter: Metrics };
type Sale = {
  id: string;
  number: string;
  totalMinor: string;
  createdAt: string;
  store: { name: string };
  items: { quantity: number; product: { name: string; sku: string } }[];
  returns: { amountMinor: string }[];
};
export function ConsultantPerformance() {
  const [performance, setPerformance] = useState<Performance | null>(null),
    [sales, setSales] = useState<Page<Sale> | null>(null);
  const [period, setPeriod] = useState<'day' | 'month' | 'quarter'>('month'),
    [page, setPage] = useState(1);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    api<Performance>('/employees/me/performance')
      .then((value) => {
        if (active) setPerformance(value);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Не удалось загрузить показатели',
          );
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSales(null);
    api<Page<Sale>>(`/employees/me/sales?page=${page}&limit=20`)
      .then((value) => {
        if (active) setSales(value);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Не удалось загрузить продажи',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page]);
  const metrics = performance?.[period];
  return (
    <section className="crm-panel mt-6 space-y-4 p-5">
      <div className="crm-panel-heading">
        <div>
          <span className="crm-eyebrow">МОИ РЕЗУЛЬТАТЫ</span>
          <h2>Продажи консультанта</h2>
        </div>
        <label>
          Период
          <select
            className="ml-2 rounded border p-2"
            value={period}
            onChange={(event) => setPeriod(event.target.value as typeof period)}
          >
            <option value="day">Сегодня</option>
            <option value="month">Текущий месяц</option>
            <option value="quarter">Текущий квартал</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="crm-alert">
          {error}
        </p>
      )}
      {metrics ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            [
              'Выручка за вычетом возвратов',
              `${money(metrics.netMinor)} сомони`,
            ],
            ['Чеков', metrics.saleCount],
            [
              'Средний чек до возвратов',
              `${money(metrics.averageCheckMinor)} сомони`,
            ],
            ['Продажи', `${money(metrics.salesMinor)} сомони`],
            ['Возвращено за период', `${money(metrics.returnsMinor)} сомони`],
            ['Завершённых смен', metrics.closedShiftCount],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-rose-50 p-4">
              <span>{label}</span>
              <strong className="mt-1 block text-xl">{value}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p>Загружаем показатели…</p>
      )}
      <p className="text-sm text-slate-500">
        Периоды считаются по времени Душанбе. Учитываются продажи, где вы
        указаны консультантом; для старых чеков без консультанта — кассиром.
        Завершённые смены: открытые вами или с вашими продажами. Правило
        назначения планов ожидает согласования.
      </p>
      <h3 className="font-semibold">История моих продаж</h3>
      {loading && <p role="status">Загрузка…</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>Дата / чек</th>
              <th>Магазин</th>
              <th>Товары</th>
              <th>Сумма, сомони</th>
              <th>Возвращено, сомони</th>
            </tr>
          </thead>
          <tbody>
            {sales?.items.map((sale) => (
              <tr key={sale.id} className="border-t">
                <td className="py-3">
                  {new Date(sale.createdAt).toLocaleString('ru-RU', {
                    timeZone: 'Asia/Dushanbe',
                  })}
                  <strong className="block">{sale.number}</strong>
                </td>
                <td>{sale.store.name}</td>
                <td>
                  {sale.items.map((item, index) => (
                    <div key={index}>
                      {item.product.name} × {item.quantity}
                    </div>
                  ))}
                </td>
                <td>{money(sale.totalMinor)}</td>
                <td>
                  {money(
                    sale.returns
                      .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n)
                      .toString(),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sales && !sales.items.length && <p>Продаж пока нет.</p>}
      <div className="flex items-center gap-3">
        <button
          disabled={loading || page <= 1}
          className="ks-button ks-button--secondary crm-outline-button"
          onClick={() => setPage((value) => value - 1)}
        >
          Назад
        </button>
        <span>
          Страница {page} · чеков: {sales?.total ?? '—'}
        </span>
        <button
          disabled={loading || !sales || page * sales.limit >= sales.total}
          className="ks-button ks-button--secondary crm-outline-button"
          onClick={() => setPage((value) => value + 1)}
        >
          Далее
        </button>
      </div>
    </section>
  );
}
