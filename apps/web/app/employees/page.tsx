'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CatalogShell } from '../../components/catalog-shell';
import { EmployeeActivity } from '../../components/employee-activity';
import { api, queryString, type Page } from '../../lib/api';

type Me = { userId: string; permissions: string[]; allStores: boolean; storeIds: string[] };
type Store = { id: string; name: string; code: string };
type Role = { id: string; code: string; name: string; system: boolean; permissions: { permission: { code: string } }[] };
type Employee = { id: string; name: string; login: string; active: boolean; allStores: boolean; createdAt: string; roleId: string; role: Role; stores: { storeId: string }[] };
type EmployeeDraft = { id?: string; name: string; login: string; password: string; pin: string; roleId: string; allStores: boolean; storeIds: string[]; active: boolean };
type RoleDraft = { id?: string; code: string; name: string; permissions: string[] };
const roleLabel: Record<string, string> = { OWNER: 'Владелец', DIRECTOR: 'Директор', MANAGER: 'Менеджер', ADMIN: 'Администратор', ACCOUNTANT: 'Бухгалтер', WAREHOUSE: 'Кладовщик', CASHIER: 'Кассир', SELLER: 'Продавец' };
const emptyEmployee = (roleId = '', storeId = ''): EmployeeDraft => ({ name: '', login: '', password: '', pin: '', roleId, allStores: false, storeIds: storeId ? [storeId] : [], active: true });
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие';
const roleCodes = (role: Role) => role.permissions.map(item => item.permission.code);

export default function EmployeesPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionCodes, setPermissionCodes] = useState<string[]>([]);
  const [employees, setEmployees] = useState<Page<Employee> | null>(null);
  const [tab, setTab] = useState<'employees' | 'roles'>('employees');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [employeeDraft, setEmployeeDraft] = useState<EmployeeDraft | null>(null);
  const [activityEmployee, setActivityEmployee] = useState<{ id: string; name: string } | null>(null);
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const can = (permission: string) => me?.permissions.includes(permission) ?? false;
  const assignableRoles = roles.filter(role => roleCodes(role).every(code => me?.permissions.includes(code)));

  const refreshOptions = useCallback(async () => {
    const [profile, locations, availableRoles, availablePermissions] = await Promise.all([
      api<Me>('/auth/me'), api<Store[]>('/stores'), api<Role[]>('/roles'), api<{ code: string }[]>('/roles/permissions'),
    ]);
    setMe(profile); setStores(locations); setRoles(availableRoles); setPermissionCodes(availablePermissions.map(item => item.code));
  }, []);
  useEffect(() => { refreshOptions().catch(caught => setError(errorText(caught))); }, [refreshOptions]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      api<Page<Employee>>(`/employees?${queryString({ search: search.trim(), page, limit: 20 })}`).then(result => { if (active) setEmployees(result); }).catch(caught => { if (active) setError(errorText(caught)); }).finally(() => { if (active) setLoading(false); });
    }, search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, page, notice]);

  const editEmployee = (employee: Employee) => { setError(''); setActivityEmployee(null); setEmployeeDraft({ id: employee.id, name: employee.name, login: employee.login, password: '', pin: '', roleId: employee.roleId, allStores: employee.allStores, storeIds: employee.stores.map(item => item.storeId), active: employee.active }); setTab('employees'); };
  const toggleStore = (id: string) => setEmployeeDraft(current => current ? { ...current, storeIds: current.storeIds.includes(id) ? current.storeIds.filter(value => value !== id) : [...current.storeIds, id] } : current);
  async function saveEmployee(event: FormEvent) {
    event.preventDefault();
    if (!employeeDraft) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      const { id, ...draft } = employeeDraft;
      const body = { name: draft.name.trim(), login: draft.login.trim(), roleId: draft.roleId, allStores: draft.allStores, storeIds: draft.allStores ? [] : draft.storeIds, ...(draft.password ? { password: draft.password } : {}), ...(draft.pin ? { pin: draft.pin } : {}), ...(id ? { active: draft.active } : {}) };
      await api<Employee>(id ? `/employees/${id}` : '/employees', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setEmployeeDraft(null); setNotice(id ? 'Данные сотрудника сохранены' : 'Сотрудник создан'); setPage(1);
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }
  async function saveRole(event: FormEvent) {
    event.preventDefault();
    if (!roleDraft) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      const { id, ...draft } = roleDraft;
      await api<Role>(id ? `/roles/${id}` : '/roles', { method: id ? 'PATCH' : 'POST', body: JSON.stringify({ ...draft, code: draft.code.trim().toUpperCase(), name: draft.name.trim() }) });
      await refreshOptions(); setRoleDraft(null); setNotice(id ? 'Роль сохранена' : 'Роль создана');
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  }

  return <CatalogShell><div className="space-y-5">
    <div className="crm-page-head"><div><span className="crm-eyebrow">КОМАНДА И ДОСТУП</span><h1>Сотрудники и роли</h1><p>Управляйте учётными записями, магазинами и правами команды.</p></div>{tab === 'employees' && can('employees.create') && <button type="button" className="crm-primary-button" onClick={() => { setError(''); setActivityEmployee(null); setEmployeeDraft(emptyEmployee(assignableRoles[0]?.id, stores[0]?.id)); }}>+ Добавить сотрудника</button>}{tab === 'roles' && can('settings.edit') && <button type="button" className="crm-primary-button" onClick={() => { setError(''); setRoleDraft({ code: '', name: '', permissions: [] }); }}>+ Создать роль</button>}</div>
    {error && <p role="alert" className="crm-alert">{error}</p>}{notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div className="flex gap-2 border-b border-slate-200"><button type="button" className={`px-4 py-3 text-sm font-semibold ${tab === 'employees' ? 'border-b-2 border-violet-600 text-violet-700' : 'text-slate-500'}`} aria-pressed={tab === 'employees'} onClick={() => setTab('employees')}>Сотрудники</button><button type="button" className={`px-4 py-3 text-sm font-semibold ${tab === 'roles' ? 'border-b-2 border-violet-600 text-violet-700' : 'text-slate-500'}`} aria-pressed={tab === 'roles'} onClick={() => setTab('roles')}>Роли и права</button></div>
    {tab === 'employees' && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
      <section className="crm-panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="font-semibold">Команда</h2><p className="mt-1 text-xs text-slate-500">{employees?.total ?? 0} сотрудников в доступной области</p></div><label className="text-xs text-slate-600">Поиск по имени или логину<input className="mt-1 block w-full rounded-lg border border-slate-200 p-2 text-sm" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Введите имя или логин" /></label></div>
        {loading ? <p className="p-6 text-sm text-slate-500">Загружаем сотрудников…</p> : <div className="divide-y divide-slate-100">{employees?.items.map(employee => <article key={employee.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-100 font-bold text-violet-700">{employee.name.slice(0, 1).toUpperCase()}</span><div><strong className="text-sm text-slate-800">{employee.name}</strong><p className="mt-1 text-xs text-slate-500">@{employee.login} · {roleLabel[employee.role.code] ?? employee.role.name}</p><p className="mt-1 text-xs text-slate-500">{employee.allStores ? 'Все магазины' : `${employee.stores.length} магазинов`}</p></div></div><div className="flex items-center gap-3"><span className={`rounded-full px-2 py-1 text-xs ${employee.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{employee.active ? 'Активен' : 'Отключён'}</span>{(me?.allStores || !employee.allStores && employee.stores.every(item => me?.storeIds.includes(item.storeId))) && <button type="button" className="text-xs font-semibold text-violet-700 underline" onClick={() => { setEmployeeDraft(null); setActivityEmployee({ id: employee.id, name: employee.name }); }}>История</button>}{can('employees.edit') && employee.id !== me?.userId && <button type="button" className="text-xs font-semibold text-violet-700 underline" onClick={() => editEmployee(employee)}>Изменить</button>}</div></article>)}{!employees?.items.length && <p className="p-8 text-center text-sm text-slate-500">Сотрудники не найдены</p>}</div>}
        {employees && employees.total > 20 && <div className="flex items-center justify-between border-t border-slate-100 p-4 text-xs text-slate-500"><button disabled={page === 1} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => setPage(value => value - 1)}>Назад</button><span>Страница {page} из {Math.ceil(employees.total / 20)}</span><button disabled={page * 20 >= employees.total} className="rounded border px-3 py-2 disabled:opacity-40" onClick={() => setPage(value => value + 1)}>Далее</button></div>}
      </section>
      {employeeDraft && <section className="crm-panel p-5" aria-label="Редактор сотрудника"><div className="flex items-center justify-between"><h2 className="font-semibold">{employeeDraft.id ? 'Изменить сотрудника' : 'Новый сотрудник'}</h2><button type="button" aria-label="Закрыть редактор" onClick={() => setEmployeeDraft(null)}>✕</button></div><form onSubmit={saveEmployee} className="mt-4 space-y-3 text-sm"><label className="block">ФИО<input required minLength={2} maxLength={150} className="mt-1 block w-full rounded-lg border p-2" value={employeeDraft.name} onChange={event => setEmployeeDraft({ ...employeeDraft, name: event.target.value })} /></label><label className="block">Логин<input required minLength={3} maxLength={60} pattern="[a-zA-Z0-9._-]+" className="mt-1 block w-full rounded-lg border p-2" value={employeeDraft.login} onChange={event => setEmployeeDraft({ ...employeeDraft, login: event.target.value })} /></label><label className="block">Пароль {employeeDraft.id && <small className="text-slate-500">(оставьте пустым, чтобы сохранить)</small>}<input required={!employeeDraft.id} minLength={12} type="password" autoComplete="new-password" className="mt-1 block w-full rounded-lg border p-2" value={employeeDraft.password} onChange={event => setEmployeeDraft({ ...employeeDraft, password: event.target.value })} /></label><label className="block">PIN <small className="text-slate-500">(необязательно, 4–8 цифр)</small><input pattern="[0-9]{4,8}" type="password" inputMode="numeric" className="mt-1 block w-full rounded-lg border p-2" value={employeeDraft.pin} onChange={event => setEmployeeDraft({ ...employeeDraft, pin: event.target.value })} /></label><label className="block">Роль<select required className="mt-1 block w-full rounded-lg border p-2" value={employeeDraft.roleId} onChange={event => setEmployeeDraft({ ...employeeDraft, roleId: event.target.value })}><option value="">Выберите роль</option>{assignableRoles.map(role => <option key={role.id} value={role.id}>{roleLabel[role.code] ?? role.name}</option>)}</select></label><div><span className="font-medium">Доступ к магазинам</span>{me?.allStores && <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={employeeDraft.allStores} onChange={event => setEmployeeDraft({ ...employeeDraft, allStores: event.target.checked })} /> Все магазины</label>}{!employeeDraft.allStores && <div className="mt-2 max-h-32 space-y-2 overflow-y-auto rounded-lg border p-3">{stores.map(store => <label key={store.id} className="flex items-center gap-2"><input type="checkbox" checked={employeeDraft.storeIds.includes(store.id)} onChange={() => toggleStore(store.id)} />{store.name}</label>)}</div>}</div>{employeeDraft.id && <label className="flex items-center gap-2"><input type="checkbox" checked={employeeDraft.active} onChange={event => setEmployeeDraft({ ...employeeDraft, active: event.target.checked })} />Учётная запись активна</label>}<button type="submit" disabled={busy || !employeeDraft.roleId || (!employeeDraft.allStores && !employeeDraft.storeIds.length)} className="w-full rounded-lg bg-violet-700 px-4 py-3 font-semibold text-white disabled:opacity-40">{busy ? 'Сохраняем…' : employeeDraft.id ? 'Сохранить изменения' : 'Создать сотрудника'}</button></form></section>}
      {!employeeDraft && activityEmployee && <EmployeeActivity key={activityEmployee.id} employee={activityEmployee} onClose={() => setActivityEmployee(null)} />}
      {!employeeDraft && !activityEmployee && <aside className="crm-panel h-fit p-5"><h2 className="font-semibold">Права доступа</h2><p className="mt-2 text-sm leading-6 text-slate-600">Сотрудник видит только назначенные магазины. Роль определяет, какие разделы и действия ему доступны.</p></aside>}
    </div>}
    {tab === 'roles' && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_370px]"><section className="crm-panel divide-y divide-slate-100 overflow-hidden"><div className="p-5"><h2 className="font-semibold">Доступные роли</h2><p className="mt-1 text-xs text-slate-500">Системные роли и роли вашей компании</p></div>{roles.map(role => <article key={role.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><strong className="text-sm text-slate-800">{roleLabel[role.code] ?? role.name}</strong><p className="mt-1 text-xs text-slate-500">{role.code} · {role.permissions.length} прав · {role.system ? 'Системная' : 'Своя роль'}</p></div>{!role.system && can('settings.edit') && <button type="button" className="text-xs font-semibold text-violet-700 underline" onClick={() => { setError(''); setRoleDraft({ id: role.id, code: role.code, name: role.name, permissions: roleCodes(role) }); }}>Изменить</button>}</article>)}</section>
      {roleDraft ? <section className="crm-panel h-fit p-5" aria-label="Редактор роли"><div className="flex items-center justify-between"><h2 className="font-semibold">{roleDraft.id ? 'Изменить роль' : 'Новая роль'}</h2><button type="button" aria-label="Закрыть редактор роли" onClick={() => setRoleDraft(null)}>✕</button></div><form onSubmit={saveRole} className="mt-4 space-y-3 text-sm"><label className="block">Название<input required minLength={2} maxLength={100} className="mt-1 block w-full rounded-lg border p-2" value={roleDraft.name} onChange={event => setRoleDraft({ ...roleDraft, name: event.target.value })} /></label><label className="block">Код роли<input required disabled={Boolean(roleDraft.id)} pattern="[A-Z][A-Z0-9_]{2,39}" className="mt-1 block w-full rounded-lg border p-2 uppercase disabled:bg-slate-50" value={roleDraft.code} onChange={event => setRoleDraft({ ...roleDraft, code: event.target.value.toUpperCase() })} placeholder="STORE_MANAGER" /></label><div><strong>Разрешения</strong><p className="mt-1 text-xs text-slate-500">Можно выдавать только свои права.</p><div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">{permissionCodes.filter(code => me?.permissions.includes(code)).map(code => <label key={code} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={roleDraft.permissions.includes(code)} onChange={() => setRoleDraft(current => current ? { ...current, permissions: current.permissions.includes(code) ? current.permissions.filter(value => value !== code) : [...current.permissions, code] } : current)} />{code}</label>)}</div></div><button type="submit" disabled={busy || !roleDraft.name.trim() || !roleDraft.code.trim()} className="w-full rounded-lg bg-violet-700 px-4 py-3 font-semibold text-white disabled:opacity-40">{busy ? 'Сохраняем…' : 'Сохранить роль'}</button></form></section> : <aside className="crm-panel h-fit p-5"><h2 className="font-semibold">Свои роли</h2><p className="mt-2 text-sm leading-6 text-slate-600">Создайте роль под должность и отметьте нужные действия. Системные роли сохраняют исходные права.</p></aside>}
    </div>}
  </div></CatalogShell>;
}
