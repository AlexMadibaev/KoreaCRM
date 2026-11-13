'use client';

import { TypedInput, MoneyInput } from '@koreacrm/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { CatalogShell } from '../../components/catalog-shell';
import { api, type Page } from '../../lib/api';
import { loyaltyEditPermissions, meetsPermission } from '../../lib/access';
import type { LoyaltySettings } from '../../lib/loyalty';

type Kind = 'PRODUCT' | 'BRAND' | 'CATEGORY';
type CatalogItem = { id: string; name: string; sku?: string };
const endpoint: Record<Kind, string> = { PRODUCT: 'products', BRAND: 'brands', CATEGORY: 'categories' };
const label: Record<Kind, string> = { PRODUCT: 'Товар', BRAND: 'Бренд', CATEGORY: 'Категория' };
const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
type Promotion = LoyaltySettings['promotions'][number];
type PromotionTarget = Pick<Promotion, 'id' | 'targetType' | 'targetId'>;
type Campaign = Omit<Promotion, keyof PromotionTarget> & { id: string; targets: PromotionTarget[] };

function groupPromotions(promotions: Promotion[]): Campaign[] {
  const campaigns = new Map<string, Campaign>();
  for (const { id, targetType, targetId, percent, startDate, endDate, daysOfWeek, active } of promotions) {
    const days = [...new Set(daysOfWeek)].sort();
    const key = JSON.stringify([Number(percent), startDate, endDate, days, active]);
    const target = { id, targetType, targetId };
    const campaign = campaigns.get(key);
    if (campaign) campaign.targets.push(target);
    else campaigns.set(key, { id, percent, startDate, endDate, daysOfWeek: days, active, targets: [target] });
  }
  return [...campaigns.values()];
}

const percentPattern = /^\d{1,3}(?:[.,]\d{1,2})?$/;

function CatalogPicker({ kind, selected, onAdd, onRemove, disabled = false }: { kind: Kind; selected: string[]; onAdd: (id: string) => void; onRemove: (id: string) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!selected.length) return;
    let active = true;
    Promise.all(selected.filter(id => !names[id]).map(async id => {
      try { const item = await api<CatalogItem>(`/${endpoint[kind]}/${id}`); return [id, item.name] as const; }
      catch { return [id, id.slice(0, 8)] as const; }
    })).then(rows => { if (active && rows.length) setNames(previous => ({ ...previous, ...Object.fromEntries(rows) })); });
    return () => { active = false; };
  }, [kind, selected.join(',')]);
  useEffect(() => {
    if (disabled) return;
    let active = true;
    const timer = window.setTimeout(() => { api<Page<CatalogItem>>(`/${endpoint[kind]}?limit=20&search=${encodeURIComponent(query)}`).then(page => { if (active) setResults(page.items); }).catch(() => { if (active) setResults([]); }); }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [kind, query, disabled]);
  return <div className="space-y-2"><div className="flex flex-wrap gap-2">{selected.map(id => <span key={id} className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-sm text-rose-900">{names[id] ?? id.slice(0, 8)}<button disabled={disabled} className="ks-button ks-button--ghost ks-button--icon" type="button" aria-label={`Убрать ${names[id] ?? id}`} onClick={() => onRemove(id)}>×</button></span>)}</div>{!disabled && <><input aria-label={`Найти ${label[kind].toLowerCase()}`} className="w-full rounded-xl border border-slate-200 p-3" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Найти ${label[kind].toLowerCase()}`} /><div className="max-h-36 overflow-y-auto rounded-xl border border-slate-100">{results.filter(item => !selected.includes(item.id)).map(item => <button key={item.id} type="button" className="ks-control block w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-rose-50" onClick={() => { setNames(previous => ({ ...previous, [item.id]: item.name })); onAdd(item.id); setQuery(''); }}>{item.name}{item.sku ? ` · ${item.sku}` : ''}</button>)}{!results.length && <p className="p-3 text-sm text-slate-500">Нет совпадений</p>}</div></>}</div>;
}

export default function LoyaltyPage() {
  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { Promise.all([api<{ permissions: string[] }>('/auth/me'), api<LoyaltySettings>('/loyalty/settings')]).then(([me, rules]) => { setAllowed(meetsPermission(me.permissions, loyaltyEditPermissions)); setSettings(rules); setCampaigns(groupPromotions(rules.promotions)); }).catch(caught => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить настройки.')); }, []);
  function update(changes: Partial<LoyaltySettings>) { setSettings(current => current ? { ...current, ...changes } : current); setNotice(''); }
  function editCampaign(id: string, change: (campaign: Campaign) => Campaign) {
    setCampaigns(current => current.map(campaign => campaign.id === id ? change(campaign) : campaign));
    setNotice('');
  }
  function addCampaign() {
    const id = crypto.randomUUID();
    setCampaigns(current => [...current, { id, targets: [], percent: '0', daysOfWeek: [], startDate: null, endDate: null, active: false }]);
    setExpanded(current => [...current, id]);
    setNotice('');
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!settings || !allowed) return;
    setError(''); setNotice('');
    if (settings.mode === 'BONUS' && Number(settings.bonusEarnPercent) <= 0) { setError('Укажите процент начисления бонусов.'); return; }
    if (settings.tiers.some((tier, index) => !percentPattern.test(tier.percent) || Number(tier.percent.replace(',', '.')) > 100 || index > 0 && BigInt(tier.minimumMinor) <= BigInt(settings.tiers[index - 1]!.minimumMinor))) { setError('Проверьте пороги и проценты: суммы должны возрастать.'); return; }
    if (campaigns.some(({ targets, percent, startDate, endDate }) => !targets.length || !percentPattern.test(percent) || Number(percent.replace(',', '.')) > 100 || Boolean(startDate && endDate && startDate > endDate))) {
      setError('В каждой акции выберите хотя бы один объект и проверьте процент и даты.');
      return;
    }
    const promotions = campaigns.flatMap(({ targets, percent, startDate, endDate, daysOfWeek, active }) => targets.map(target => ({
      ...target, percent: percent.replace(',', '.'), startDate, endDate, daysOfWeek, active,
    })));
    if (promotions.length > 200) { setError('Всего можно выбрать до 200 объектов акций.'); return; }
    const normalized: LoyaltySettings = { ...settings, tiers: settings.tiers.map(tier => ({ ...tier, percent: tier.percent.replace(',', '.') })), bonusEarnPercent: settings.bonusEarnPercent.replace(',', '.'), consultantEarnPercent: settings.consultantEarnPercent.replace(',', '.'), maxManualDiscountPercent: (settings.maxManualDiscountPercent ?? '100').replace(',', '.'), promotions };
    setBusy(true);
    try { setSettings(await api<LoyaltySettings>('/loyalty/settings', { method: 'PATCH', body: JSON.stringify(normalized) })); setNotice('Настройки лояльности сохранены. На кассе они обновятся при следующем входе.'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить настройки.'); }
    finally { setBusy(false); }
  }
  return <CatalogShell><div className="crm-screen crm-workspace-page"><header className="crm-page-head"><div><span className="crm-eyebrow">КЛИЕНТЫ</span><h1>Программа лояльности</h1><p>Правила скидок и бонусов для магазина.</p></div></header>{error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</p>}{notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{notice}</p>}{!settings ? <p>Загрузка настроек…</p> : <form onSubmit={save} className="space-y-5">
    <section className="crm-panel crm-loyalty-system" aria-labelledby="loyalty-system-title">
      <h2 id="loyalty-system-title">Система лояльности</h2>
      <p>Выберите один вариант. Настройка применится после сохранения; история начисленных бонусов сохранится.</p>
      <fieldset className="crm-loyalty-modes">
        <legend className="sr-only">Вид программы лояльности</legend>
        {([
          { mode: 'DISCOUNT', title: 'Скидки при покупке', description: 'Скидка по сумме чека или персональному проценту.' },
          { mode: 'BONUS', title: 'Накопительные бонусы', description: 'Начисление бонусов с оплаченной части чека.' },
        ] as const).map(option => <label key={option.mode} className={`crm-loyalty-option${settings.mode === option.mode ? ' is-selected' : ''}`}>
          <input type="radio" name="loyalty-mode" value={option.mode} checked={settings.mode === option.mode} onChange={() => update({ mode: option.mode })} disabled={!allowed || busy} />
          <span className="crm-loyalty-option-content"><strong>{option.title}</strong><span>{option.description}</span></span>
        </label>)}
      </fieldset>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-semibold">Пороги скидок</h2><p className="mt-1 text-sm text-slate-500">Сумма текущего чека до скидок. Применяется при выбранном клиенте, если ему не задан персональный процент.</p><div className="mt-4 space-y-3">{settings.tiers.map((tier, index) => <div key={index} className="flex flex-wrap items-end gap-3"><label className="text-sm">Чек от, сомони<MoneyInput valueMinor={tier.minimumMinor} onMinorChange={minimumMinor => update({ tiers: settings.tiers.map((item, row) => row === index ? { ...item, minimumMinor } : item) })} className="mt-1 block w-40 rounded-xl border border-slate-200 p-3" disabled={!allowed} /></label><label className="text-sm">Скидка, %<TypedInput className="mt-1 block w-28 rounded-xl border border-slate-200 p-3" inputMode="decimal" value={tier.percent} onChange={event => update({ tiers: settings.tiers.map((item, row) => row === index ? { ...item, percent: event.target.value } : item) })} disabled={!allowed} /></label>{allowed && <button type="button" className="ks-button ks-button--secondary ks-button--danger-text" onClick={() => update({ tiers: settings.tiers.filter((_, row) => row !== index) })}>Убрать</button>}</div>)}</div>{allowed && <button type="button" className="ks-button ks-button--secondary mt-4" onClick={() => update({ tiers: [...settings.tiers, { minimumMinor: String((Number(settings.tiers.at(-1)?.minimumMinor ?? '0') + 10000)), percent: '0' }] })}>Добавить порог</button>}</section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-semibold">Бонусная система</h2><p className="mt-1 text-sm text-slate-500">При включении режима бонусы начисляются с суммы, оплаченной деньгами. 1 бонус = 1 сомони. Оплата бонусами доступна только в бонусном режиме.</p><label className="mt-4 block text-sm">Начисление, %<TypedInput className="mt-1 block w-32 rounded-xl border border-slate-200 p-3" inputMode="decimal" value={settings.bonusEarnPercent} onChange={event => update({ bonusEarnPercent: event.target.value })} disabled={!allowed} /></label></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-semibold">Вознаграждение сотрудников</h2><p className="mt-2 text-sm">Процент задаётся отдельно для каждого сотрудника в разделе <a className="underline" href="/employees">Сотрудники и роли</a>.</p></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-semibold">Лимит ручной скидки</h2><p className="mt-1 text-sm text-slate-500">Сколько процентов от суммы чека кассир может скинуть вручную сверх автоматических скидок. Больше разрешено только ролям с правом «скидка без лимита»: владелец, директор, менеджер. 100 — без ограничения.</p><label className="mt-4 block text-sm">Максимум, %<TypedInput className="mt-1 block w-32 rounded-xl border border-slate-200 p-3" inputMode="decimal" value={settings.maxManualDiscountPercent ?? '100'} onChange={event => update({ maxManualDiscountPercent: event.target.value })} disabled={!allowed} /></label></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-semibold">Исключения из автоматической скидки</h2><p className="mt-1 text-sm text-slate-500">Ручная скидка консультанта остаётся доступной. Акционные правила также не действуют на исключённые позиции.</p><div className="mt-4 grid gap-5 lg:grid-cols-3">{(['PRODUCT', 'BRAND', 'CATEGORY'] as const).map(kind => { const field = kind === 'PRODUCT' ? 'excludedProductIds' : kind === 'BRAND' ? 'excludedBrandIds' : 'excludedCategoryIds'; return <div key={kind}><h3 className="mb-2 font-medium">{kind === 'PRODUCT' ? 'Товары' : kind === 'BRAND' ? 'Бренды' : 'Категории'}</h3><CatalogPicker kind={kind} selected={settings[field]} disabled={!allowed || busy} onAdd={id => update({ [field]: [...settings[field], id] })} onRemove={id => update({ [field]: settings[field].filter(value => value !== id) })} /></div>; })}</div></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-xl font-semibold">Акционные дни</h2>
      <p className="mt-1 text-sm text-slate-500">Одна акция может включать несколько брендов, категорий и товаров. При пересечении действует наибольшая скидка.</p>
      <div className="mt-4 space-y-3">
        {campaigns.map(campaign => {
          const isOpen = expanded.includes(campaign.id);
          const disabled = !allowed || busy;
          const patch = (changes: Partial<Campaign>) => editCampaign(campaign.id, current => ({ ...current, ...changes }));
          const counts = (['BRAND', 'CATEGORY', 'PRODUCT'] as const).map(kind => campaign.targets.filter(target => target.targetType === kind).length);
          const schedule = [campaign.startDate, campaign.endDate].filter(Boolean).join(' – ');
          return <div key={campaign.id} className="rounded-xl border border-slate-200">
            <button type="button" aria-expanded={isOpen} aria-controls={`campaign-${campaign.id}`} className="ks-control flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-4 text-left" onClick={() => setExpanded(current => isOpen ? current.filter(id => id !== campaign.id) : [...current, campaign.id])}>
              <strong>Скидка {campaign.percent || '0'}%</strong>
              <span className="text-sm text-slate-600">{schedule || 'Без ограничения по датам'}{campaign.daysOfWeek.length > 0 && ' · ' + campaign.daysOfWeek.map(day => dayNames[day]).join(', ')} · {campaign.active ? 'Включена' : 'Выключена'}</span>
              <span className="text-sm text-slate-600">{campaign.targets.some(target => target.targetType === 'ALL') ? 'Все товары' : `Бренды ${counts[0]} · Категории ${counts[1]} · Товары ${counts[2]}`}</span>
              <span className="ml-auto text-sm">{isOpen ? 'Свернуть' : 'Открыть'}</span>
            </button>
            <div id={`campaign-${campaign.id}`} hidden={!isOpen} className="border-t border-slate-100 p-4">
              {isOpen && <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm">Скидка, %<TypedInput className="mt-1 block w-28 rounded-xl border border-slate-200 p-3" inputMode="decimal" value={campaign.percent} onChange={event => patch({ percent: event.target.value })} disabled={disabled} /></label>
                  <label className="text-sm">Начало<input type="date" className="mt-1 block rounded-xl border border-slate-200 p-3" value={campaign.startDate ?? ''} onChange={event => patch({ startDate: event.target.value || null })} disabled={disabled} /></label>
                  <label className="text-sm">Окончание<input type="date" className="mt-1 block rounded-xl border border-slate-200 p-3" value={campaign.endDate ?? ''} onChange={event => patch({ endDate: event.target.value || null })} disabled={disabled} /></label>
                  <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" checked={campaign.active} onChange={event => patch({ active: event.target.checked })} disabled={disabled} />Акция включена</label>
                </div>
                <fieldset disabled={disabled} className="flex flex-wrap gap-3">
                  <legend className="mb-2 text-sm">Дни недели · без выбора действует ежедневно</legend>
                  {dayNames.map((name, day) => <label key={name} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={campaign.daysOfWeek.includes(day)} onChange={event => patch({ daysOfWeek: event.target.checked ? [...campaign.daysOfWeek, day].sort() : campaign.daysOfWeek.filter(value => value !== day) })} />{name}</label>)}
                </fieldset>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={campaign.targets.some(target => target.targetType === 'ALL')} onChange={event => {
                  if (event.target.checked) {
                    const id = crypto.randomUUID();
                    patch({ targets: [{ id, targetType: 'ALL', targetId: id }] });
                  } else patch({ targets: [] });
                }} />Все товары</label>
                {!campaign.targets.some(target => target.targetType === 'ALL') && <div className="grid gap-4 lg:grid-cols-3">
                  {(['BRAND', 'CATEGORY', 'PRODUCT'] as const).map(kind => <div key={kind}>
                    <h3 className="mb-2 font-medium">{kind === 'BRAND' ? 'Бренды' : kind === 'CATEGORY' ? 'Категории' : 'Товары'}</h3>
                    <CatalogPicker kind={kind} selected={campaign.targets.filter(target => target.targetType === kind).map(target => target.targetId)} disabled={disabled}
                      onAdd={targetId => editCampaign(campaign.id, current => current.targets.some(target => target.targetType === kind && target.targetId === targetId) ? current : { ...current, targets: [...current.targets, { id: crypto.randomUUID(), targetType: kind, targetId }] })}
                      onRemove={targetId => editCampaign(campaign.id, current => ({ ...current, targets: current.targets.filter(target => target.targetType !== kind || target.targetId !== targetId) }))} />
                  </div>)}
                </div>}
                {allowed && <button type="button" disabled={busy} className="ks-button ks-button--ghost ks-button--danger-text" onClick={() => { setCampaigns(current => current.filter(item => item.id !== campaign.id)); setNotice(''); }}>Удалить акцию</button>}
              </div>}
            </div>
          </div>;
        })}
      </div>
      {allowed && <button type="button" disabled={busy} className="ks-button ks-button--secondary mt-4" onClick={addCampaign}>Добавить акцию</button>}
    </section>
    {allowed && <button disabled={busy} className="ks-button ks-button--primary">{busy ? 'Сохраняем…' : 'Сохранить настройки'}</button>}
  </form>}</div></CatalogShell>;
}
