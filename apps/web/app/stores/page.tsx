'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { StoreDevices, type StoreDevice } from '../../components/store-devices';
import { deviceKind } from '../../lib/device-kind';
import { CatalogShell } from '../../components/catalog-shell';
import { api, type Page } from '../../lib/api';

type Me = { permissions: string[]; allStores: boolean };
type Store = { id: string; name: string; code: string; address: string | null; phone: string | null; status: string; managerId: string | null; manager: { id: string; name: string } | null; _count: { users: number; posDevices: number } };
type Employee = { id: string; name: string; login: string; role: { name: string }; primaryStoreId: string | null; allStores: boolean };
type Detail = Store & { employees: Employee[]; devices: StoreDevice[]; summary: { salesCount30Days: number; salesTotalMinor30Days: string; lowStockCount: number } };
type Draft = { name: string; code: string; address: string; phone: string; managerId: string; status: string };
const initialDraft: Draft = { name: '', code: '', address: '', phone: '', managerId: '', status: 'ACTIVE' };
const statusName: Record<string, string> = { ACTIVE: 'Работает', PAUSED: 'Приостановлен', ARCHIVED: 'Архив' };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие';
const money = (value: string) => `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) / 100)} сомони`;

export default function StoresPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [assignId, setAssignId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const can = (code: string) => me?.permissions.includes(code) ?? false;
  const refresh = useCallback(async (preferred?: string) => {
    const list = await api<Store[]>('/store-management');
    setStores(list);
    setSelectedId(current => preferred ?? (list.some(store => store.id === current) ? current : list[0]?.id ?? ''));
  }, []);
  useEffect(() => {
    Promise.all([api<Me>('/auth/me'), api<Page<Employee>>('/employees?limit=100').catch(() => null), refresh()])
      .then(([profile, people]) => { setMe(profile); setEmployees(people?.items ?? []); })
      .catch(caught => setError(errorText(caught)));
  }, [refresh]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    api<Detail>(`/store-management/${selectedId}`).then(setDetail).catch(caught => setError(errorText(caught)));
  }, [selectedId, stores]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const body = detail && draft.code === detail.code
        ? { name: draft.name, address: draft.address || null, phone: draft.phone || null, managerId: draft.managerId || null, status: draft.status }
        : { name: draft.name, code: draft.code.trim().toUpperCase(), address: draft.address || null, phone: draft.phone || null };
      const result = await api<Detail>(detail && draft.code === detail.code ? `/store-management/${detail.id}` : '/store-management', { method: detail && draft.code === detail.code ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setDraft(null); setDetail(result); await refresh(result.id); setNotice('Карточка магазина сохранена');
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  async function changeTeam(userId: string, assigned: boolean) {
    if (!detail) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await api<Detail>(`/store-management/${detail.id}/team/${userId}`, { method: assigned ? 'DELETE' : 'POST' });
      setDetail(updated); await refresh(detail.id); setNotice(assigned ? 'Сотрудник снят с магазина' : 'Сотрудник добавлен в магазин');
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  async function unbindDevice(deviceId: string) {
    if (!detail) return;
    const kind = deviceKind(deviceId);
    const confirmation = kind === 'pos' ? 'Отвязать кассу POS от магазина? Перед отвязкой отправьте все сохранённые продажи и закройте смену.' : kind === 'web' ? 'Убрать привязку этого браузера к магазину? Сначала закройте его кассовую смену, если она открыта. Это не завершит вход пользователя в ЛК.' : 'Отвязать устройство от магазина? Сначала закройте его смену и отправьте сохранённые продажи.';
    if (!window.confirm(confirmation)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/stores/${detail.id}/pos-devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
      setDetail(await api<Detail>(`/store-management/${detail.id}`)); await refresh(detail.id); setNotice(kind === 'pos' ? 'Касса POS отвязана. Выберите нужный магазин в программе и повторите подключение.' : 'Привязка устройства к магазину удалена. Вход пользователя в ЛК не завершён.');
    } catch (caught) { setError(caught instanceof Error && caught.message === 'Close the open cash shift on this device first' ? 'Для этого устройства открыта кассовая смена. Сначала закройте её.' : errorText(caught)); } finally { setBusy(false); }
  }
  const available = employees.filter(person => !detail?.employees.some(member => member.id === person.id));
  return <CatalogShell><div className="space-y-5">
    <div className="crm-page-head"><div><span className="crm-eyebrow">УПРАВЛЕНИЕ СЕТЬЮ</span><h1>Магазины</h1><p>Контакты, команда и состояние каждой точки в одной карточке.</p></div>{can('stores.create') && me?.allStores && <button className="crm-primary-button" type="button" onClick={() => { setDetail(null); setDraft(initialDraft); }}>+ Добавить магазин</button>}</div>
    {error && <p className="crm-alert" role="alert">{error}</p>}{notice && <p className="crm-panel p-3 text-sm" role="status">{notice}</p>}
    <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
      <section className="crm-panel h-fit p-4"><h2 className="mb-3 font-semibold">Торговые точки</h2><div className="space-y-2">{stores.map(store => <button key={store.id} type="button" className={`w-full rounded-xl border p-4 text-left ${selectedId === store.id && !draft ? 'border-rose-300 bg-rose-50' : 'border-slate-100 hover:bg-slate-50'}`} onClick={() => { setDraft(null); setSelectedId(store.id); }}><strong className="block">{store.name}</strong><span className="text-xs text-slate-500">{store.code} · {statusName[store.status] ?? store.status}</span><span className="mt-2 block text-sm text-slate-600">{store.address || 'Адрес не указан'}</span></button>)}{!stores.length && <p className="text-sm text-slate-500">Магазинов пока нет</p>}</div></section>
      {draft ? <section className="crm-panel p-6"><h2 className="text-xl font-semibold">{detail ? 'Редактировать магазин' : 'Новый магазин'}</h2><form onSubmit={save} className="mt-5 grid gap-4 md:grid-cols-2"><label className="text-sm">Название<input required minLength={2} maxLength={120} className="mt-1 block w-full rounded-lg border p-3" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label className="text-sm">Код магазина<input required disabled={Boolean(detail)} pattern="[A-Za-z][A-Za-z0-9_-]{1,39}" className="mt-1 block w-full rounded-lg border p-3 disabled:bg-slate-50" value={draft.code} onChange={event => setDraft({ ...draft, code: event.target.value.toUpperCase() })} /></label><label className="text-sm md:col-span-2">Адрес<input maxLength={500} className="mt-1 block w-full rounded-lg border p-3" value={draft.address} onChange={event => setDraft({ ...draft, address: event.target.value })} /></label><label className="text-sm">Телефон<input type="tel" maxLength={40} className="mt-1 block w-full rounded-lg border p-3" value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label>{detail && <><label className="text-sm">Ответственный<select className="mt-1 block w-full rounded-lg border p-3" value={draft.managerId} onChange={event => setDraft({ ...draft, managerId: event.target.value })}><option value="">Не назначен</option>{detail.employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label><label className="text-sm">Состояние<select className="mt-1 block w-full rounded-lg border p-3" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="ACTIVE">Работает</option><option value="PAUSED">Приостановлен</option>{can('stores.archive') && <option value="ARCHIVED">Архив</option>}</select></label></>}<div className="flex gap-2 md:col-span-2"><button disabled={busy} className="crm-primary-button" type="submit">{busy ? 'Сохраняем…' : 'Сохранить'}</button><button className="rounded-lg border px-5 py-2" type="button" onClick={() => { setDraft(null); void refresh(selectedId); }}>Отмена</button></div></form></section>
      : detail ? <div className="space-y-5"><section className="crm-panel p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><span className="crm-eyebrow">{detail.code}</span><h2 className="mt-1 text-2xl font-bold">{detail.name}</h2><p className="mt-2 text-sm text-slate-600">{statusName[detail.status] ?? detail.status}</p></div>{can('stores.edit') && <button className="rounded-lg border px-4 py-2 text-sm font-semibold" type="button" onClick={() => setDraft({ name: detail.name, code: detail.code, address: detail.address ?? '', phone: detail.phone ?? '', managerId: detail.managerId ?? '', status: detail.status })}>Редактировать</button>}</div><div className="mt-5 grid gap-4 border-t pt-5 text-sm sm:grid-cols-2"><div><small className="text-slate-500">Адрес</small><p>{detail.address || 'Не указан'}</p></div><div><small className="text-slate-500">Телефон</small><p>{detail.phone || 'Не указан'}</p></div><div><small className="text-slate-500">Ответственный</small><p>{detail.manager?.name || 'Не назначен'}</p></div><div><small className="text-slate-500">Кассы POS / подключения ЛК</small><p>{detail.devices.filter(device => deviceKind(device.deviceId) === 'pos').length} / {detail.devices.filter(device => deviceKind(device.deviceId) === 'web').length}</p></div></div></section><section className="crm-panel p-6"><h3 className="font-semibold">Код подключения кассы</h3><p className="mt-2 text-sm text-slate-500">Введите этот ID-код один раз при первой настройке программы POS. Он закрепляет кассу за магазином, но не заменяет личный вход сотрудника.</p><div className="mt-4 flex flex-wrap items-center gap-4"><code className="rounded border bg-slate-50 px-4 py-3 text-xl font-semibold tracking-widest">{detail.code}</code><button type="button" className="crm-outline-button" onClick={() => { void navigator.clipboard.writeText(detail.code).then(() => setNotice('Код точки скопирован')).catch(() => setError('Не удалось скопировать код. Выделите и скопируйте его вручную.')); }}>Скопировать код</button></div></section><div className="grid gap-4 sm:grid-cols-3"><section className="crm-panel p-5"><small>Продажи за 30 дней</small><strong className="mt-2 block text-2xl">{detail.summary.salesCount30Days}</strong><span className="text-sm text-slate-500">{money(detail.summary.salesTotalMinor30Days)}</span></section><section className="crm-panel p-5"><small>Низкий остаток</small><strong className="mt-2 block text-2xl">{detail.summary.lowStockCount}</strong><span className="text-sm text-slate-500">позиций</span></section><section className="crm-panel p-5"><small>Сотрудники</small><strong className="mt-2 block text-2xl">{detail.employees.length}</strong><span className="text-sm text-slate-500">работают в магазине</span></section></div><section className="crm-panel p-6"><h3 className="font-semibold">Команда магазина</h3><p className="mt-2 text-sm text-slate-500">В кассы этой точки входят назначенные сюда сотрудники с правом продаж. Чтобы перевести сотрудника, сначала добавьте его в новую точку, затем снимите со старой. Пользователи с доступом ко всей сети могут работать во всех точках.</p><div className="mt-4 divide-y">{detail.employees.map(employee => <div key={employee.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><strong>{employee.name}</strong><span className="ml-2 text-slate-500">{employee.role.name}{employee.primaryStoreId === detail.id ? ' · основной магазин' : ''}</span></div>{can('employees.edit') && !employee.allStores && <button disabled={busy} type="button" className="text-rose-600" onClick={() => void changeTeam(employee.id, true)}>Снять</button>}</div>)}</div>{can('employees.edit') && available.length > 0 && <div className="mt-4 flex flex-wrap gap-2"><select aria-label="Добавить сотрудника" className="rounded-lg border p-2 text-sm" value={assignId} onChange={event => setAssignId(event.target.value)}><option value="">Выберите сотрудника</option>{available.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><button disabled={!assignId || busy} type="button" className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40" onClick={() => { void changeTeam(assignId, false); setAssignId(''); }}>Добавить в команду</button></div>}</section><StoreDevices devices={detail.devices} busy={busy} canUnbind={can('settings.edit')} onUnbind={deviceId => void unbindDevice(deviceId)} /></div> : <section className="crm-panel p-6 text-sm text-slate-500">Выберите магазин слева.</section>}
    </div>
  </div></CatalogShell>;
}
