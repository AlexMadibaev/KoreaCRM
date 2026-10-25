'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { SegmentSettings } from './segment-settings';

type Segment = { code: string; label: string; description: string };

type CustomerOverviewData = {
  id: string;
  phone: string;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  address: string | null;
  discountPercent: string;
  bonusBalanceMinor: string;
  debtBalanceMinor: string;
  totalSpentMinor: string;
  averageCheckMinor: string;
  ordersCount: number;
};

const money = (minor: string) => { const value = BigInt(minor); const absolute = value < 0n ? -value : value; return `${value < 0n ? '−' : ''}${new Intl.NumberFormat('ru-RU').format(absolute / 100n)},${String(absolute % 100n).padStart(2, '0')} сомони`; };
const birthday = (value: string) => new Date(value).toLocaleDateString('ru-RU', { timeZone: 'UTC' });

export function CustomerOverview({ customer }: { customer: CustomerOverviewData }) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [settings, setSettings] = useState<SegmentSettings | null>(null);
  const [segmentsError, setSegmentsError] = useState('');
  useEffect(() => {
    let current = true;
    setSegments([]);
    setSettings(null);
    setSegmentsError('');
    api<{ items: Segment[]; settings: SegmentSettings }>(`/customers/${customer.id}/segments`)
      .then(value => { if (current) { setSegments(value.items); setSettings(value.settings); setSegmentsError(''); } })
      .catch(() => { if (current) setSegmentsError('Не удалось загрузить сегменты'); });
    return () => { current = false; };
  }, [customer.id, customer.ordersCount, customer.totalSpentMinor, customer.averageCheckMinor]);
  const statistics = [
    { label: 'Покупок', value: String(customer.ordersCount) },
    { label: 'Потрачено', value: money(customer.totalSpentMinor) },
    { label: 'Средний чек', value: money(customer.averageCheckMinor) },
    { label: 'Долг', value: money(customer.debtBalanceMinor) },
  ];
  const segmentRules = settings ? [
    settings.NEW.enabled && `Новый: до ${settings.NEW.maxOrders} покупок`,
    settings.REGULAR.enabled && `Постоянный: от ${settings.REGULAR.minOrders} покупок`,
    settings.VIP.enabled && `VIP: от ${settings.VIP.minOrders} покупок и ${money(settings.VIP.minSpentMinor)}`,
    settings.DORMANT.enabled && `Давно не покупал: более ${settings.DORMANT.days} дней`,
    settings.HIGH_CHECK.enabled && `Высокий средний чек: от ${money(settings.HIGH_CHECK.minAverageMinor)}`,
    settings.FREQUENT.enabled && `Частые покупки: от ${settings.FREQUENT.minOrders} за ${settings.FREQUENT.days} дней`,
  ].filter(Boolean).join(' · ') : '';
  return <div className="space-y-4">
    <h3 className="font-semibold">Общее</h3>
    <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center gap-2"><strong className="mr-1 text-sm">Сегменты</strong>{segments.map(segment => <span key={segment.code} title={segment.description} className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800">{segment.label}</span>)}{segments.length === 0 && !segmentsError && <span className="text-xs text-slate-500">Подбираем по покупкам</span>}</div>{segmentsError && <p role="alert" className="mt-1 text-xs text-red-700">{segmentsError}</p>}<details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Как определяются сегменты</summary><p className="mt-1">{segmentRules}</p></details></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{statistics.map(statistic => <div key={statistic.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">{statistic.label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{statistic.value}</p></div>)}</div>
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <div><dt className="text-slate-500">Телефон</dt><dd>{customer.phone}</dd></div>
      <div><dt className="text-slate-500">Email</dt><dd>{customer.email || 'Не указан'}</dd></div>
      <div><dt className="text-slate-500">Дата рождения</dt><dd>{customer.birthday ? birthday(customer.birthday) : 'Не указана'}</dd></div>
      <div><dt className="text-slate-500">Пол</dt><dd>{customer.gender || 'Не указан'}</dd></div>
      <div><dt className="text-slate-500">Адрес</dt><dd>{customer.address || 'Не указан'}</dd></div>
      <div><dt className="text-slate-500">Персональная скидка</dt><dd>{customer.discountPercent}%</dd></div>
    </dl>
    <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">Бонусный баланс: <strong className="text-slate-900">{money(customer.bonusBalanceMinor)}</strong>. Автоматическое начисление и оплата бонусами пока не включены.</p>
  </div>;
}
