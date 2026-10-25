'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';

export type SegmentSettings = {
  NEW: { enabled: boolean; maxOrders: number };
  REGULAR: { enabled: boolean; minOrders: number };
  VIP: { enabled: boolean; minOrders: number; minSpentMinor: string };
  DORMANT: { enabled: boolean; days: number };
  HIGH_CHECK: { enabled: boolean; minAverageMinor: string };
  FREQUENT: { enabled: boolean; minOrders: number; days: number };
};

const somoni = (minor: string) => { const value = BigInt(minor); return `${value / 100n}${value % 100n ? `,${String(value % 100n).padStart(2, '0')}` : ''}`; };
const minor = (value: string) => {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error('Укажите сумму в сомони, например 500000 или 500000,50.');
  const [whole = '0', fraction = ''] = value.trim().replace(',', '.').split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0')).toString();
};
const field = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';

export function SegmentSettingsEditor({ settings, onSaved }: { settings: SegmentSettings; onSaved: (value: SegmentSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [vipSpent, setVipSpent] = useState(() => somoni(settings.VIP.minSpentMinor));
  const [highAverage, setHighAverage] = useState(() => somoni(settings.HIGH_CHECK.minAverageMinor));
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(settings); setVipSpent(somoni(settings.VIP.minSpentMinor)); setHighAverage(somoni(settings.HIGH_CHECK.minAverageMinor)); }, [settings]);
  function toggle(code: keyof SegmentSettings) { setDraft(current => ({ ...current, [code]: { ...current[code], enabled: !current[code].enabled } } as SegmentSettings)); setSaved(false); }
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setSaved(false);
    try {
      const value: SegmentSettings = { ...draft, VIP: { ...draft.VIP, minSpentMinor: minor(vipSpent) }, HIGH_CHECK: { ...draft.HIGH_CHECK, minAverageMinor: minor(highAverage) } };
      const updated = await api<SegmentSettings>('/customers/segment-settings', { method: 'PATCH', body: JSON.stringify(value) });
      onSaved(updated); setSaved(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить правила.'); }
    finally { setSaving(false); }
  }
  const switcher = (code: keyof SegmentSettings, label: string) => <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={draft[code].enabled} onChange={() => toggle(code)} />{label}</label>;
  return <details className="crm-create-details rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">Настроить сегменты клиентов</summary>
    <p className="mt-3 text-sm text-slate-500">Сегменты нужны для анализа и фильтрации. Они не меняют персональную скидку клиента.</p>
    <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div className="rounded-xl border border-slate-200 p-3">{switcher('NEW', 'Новый')}<label className="mt-3 block text-sm">Не более покупок<input className={field} type="number" inputMode="numeric" min="0" max="1000000" required value={draft.NEW.maxOrders} onChange={event => setDraft({ ...draft, NEW: { ...draft.NEW, maxOrders: Number(event.target.value) } })} /></label></div>
      <div className="rounded-xl border border-slate-200 p-3">{switcher('REGULAR', 'Постоянный')}<label className="mt-3 block text-sm">От скольких покупок<input className={field} type="number" inputMode="numeric" min="1" max="1000000" required value={draft.REGULAR.minOrders} onChange={event => setDraft({ ...draft, REGULAR: { ...draft.REGULAR, minOrders: Number(event.target.value) } })} /></label></div>
      <div className="rounded-xl border border-slate-200 p-3">{switcher('VIP', 'VIP')}<div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="block text-sm">От покупок<input className={field} type="number" inputMode="numeric" min="1" max="1000000" required value={draft.VIP.minOrders} onChange={event => setDraft({ ...draft, VIP: { ...draft.VIP, minOrders: Number(event.target.value) } })} /></label><label className="block text-sm">Потрачено от, сомони<input className={field} inputMode="decimal" required value={vipSpent} onChange={event => setVipSpent(event.target.value)} /></label></div></div>
      <div className="rounded-xl border border-slate-200 p-3">{switcher('DORMANT', 'Давно не покупал')}<label className="mt-3 block text-sm">Нет покупок более, дней<input className={field} type="number" inputMode="numeric" min="1" max="3650" required value={draft.DORMANT.days} onChange={event => setDraft({ ...draft, DORMANT: { ...draft.DORMANT, days: Number(event.target.value) } })} /></label></div>
      <div className="rounded-xl border border-slate-200 p-3">{switcher('HIGH_CHECK', 'Высокий средний чек')}<label className="mt-3 block text-sm">Средний чек от, сомони<input className={field} inputMode="decimal" required value={highAverage} onChange={event => setHighAverage(event.target.value)} /></label></div>
      <div className="rounded-xl border border-slate-200 p-3">{switcher('FREQUENT', 'Частые покупки')}<div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="block text-sm">От покупок<input className={field} type="number" inputMode="numeric" min="1" max="1000000" required value={draft.FREQUENT.minOrders} onChange={event => setDraft({ ...draft, FREQUENT: { ...draft.FREQUENT, minOrders: Number(event.target.value) } })} /></label><label className="block text-sm">За последние, дней<input className={field} type="number" inputMode="numeric" min="1" max="3650" required value={draft.FREQUENT.days} onChange={event => setDraft({ ...draft, FREQUENT: { ...draft.FREQUENT, days: Number(event.target.value) } })} /></label></div></div>
      {error && <p role="alert" className="text-sm text-red-700 sm:col-span-2 xl:col-span-3">{error}</p>}
      <div className="flex items-center gap-3 sm:col-span-2 xl:col-span-3"><button type="submit" disabled={saving} className="rounded-lg bg-rose-300 px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50">{saving ? 'Сохраняем…' : 'Сохранить правила'}</button>{saved && <span role="status" className="text-sm text-emerald-700">Правила сохранены</span>}</div>
    </form>
  </details>;
}
