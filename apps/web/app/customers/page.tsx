'use client';

import { todayDateInput, TypedInput } from '@koreacrm/ui';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CabinetDrawer } from '../../components/cabinet-drawer';
import { CatalogShell } from '../../components/catalog-shell';
import { CustomerHistory } from './customer-history';
import { CustomerOverview } from './customer-overview';
import { SegmentSettingsEditor, type SegmentSettings } from './segment-settings';
import { api, queryString, type Page } from '../../lib/api';
import { writeTableXlsx } from '../../lib/xlsx';
import { SearchCaption } from "../../components/search-caption";

const createdFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Dushanbe' });
const birthdayText = (value: string | null) => value ? createdFormat.format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : '-';

type Customer = { id: string; createdAt: string; firstName: string; lastName: string | null; phone: string; email: string | null; birthday: string | null; gender: string | null; address: string | null; notes: string | null; discountPercent: string; bonusBalanceMinor: string; debtBalanceMinor: string; totalSpentMinor: string; averageCheckMinor: string; ordersCount: number };
type Store = { id: string; name: string };
type Method = { id: string; name: string; kind: string; active: boolean };
type Shift = { id: string; deviceId: string; status: string };
type CustomerPayment = { id: string; amountMinor: string; createdAt: string; paymentMethod: Method };
const money = (minor: string) => { const value = BigInt(minor); const absolute = value < 0n ? -value : value; return `${value < 0n ? '-' : ''}${new Intl.NumberFormat('ru-RU').format(absolute / 100n)},${String(absolute % 100n).padStart(2, '0')}`; };
const toMinor = (value: string) => { const [whole = '0', fraction = ''] = value.replace(',', '.').split('.'); return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0')).toString(); };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить операцию';

export default function CustomersPage() {
  const [exporting, setExporting] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [stores, setStores] = useState<Store[]>([]), [storeId, setStoreId] = useState('');
  const [methods, setMethods] = useState<Method[]>([]), [shifts, setShifts] = useState<Shift[]>([]);
  const [items, setItems] = useState<Customer[]>([]), [selected, setSelected] = useState<Customer | null>(null), [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [search, setSearch] = useState(''), [appliedSearch, setAppliedSearch] = useState(''), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [segment, setSegment] = useState('');
  const [discountRevision, setDiscountRevision] = useState(0);
  const [segmentSettings, setSegmentSettings] = useState<SegmentSettings | null>(null), [segmentRevision, setSegmentRevision] = useState(0);
  const [firstName, setFirstName] = useState(''), [lastName, setLastName] = useState(''), [phone, setPhone] = useState(''), [email, setEmail] = useState(''), [newDiscount, setNewDiscount] = useState('0'), [newBirthday, setNewBirthday] = useState(''), [newGender, setNewGender] = useState(''), [newAddress, setNewAddress] = useState('');
  const [editFirstName, setEditFirstName] = useState(''), [editLastName, setEditLastName] = useState(''), [editPhone, setEditPhone] = useState(''), [editEmail, setEditEmail] = useState(''), [editNotes, setEditNotes] = useState(''), [editDiscount, setEditDiscount] = useState('0'), [editBirthday, setEditBirthday] = useState(''), [editGender, setEditGender] = useState(''), [editAddress, setEditAddress] = useState(''), [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(''), [methodId, setMethodId] = useState(''), [shiftId, setShiftId] = useState(''), [operationId, setOperationId] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const can = (permission: string) => permissions.includes(permission);

  useEffect(() => { Promise.all([api<{ permissions: string[] }>('/auth/me'), api<Store[]>('/stores'), api<Method[]>('/sale-payment-methods')]).then(([me, available, paymentMethods]) => { setPermissions(me.permissions); setStores(available); setStoreId(available[0]?.id ?? ''); setMethods(paymentMethods.filter(method => method.active && method.kind !== 'DEBT' && method.kind !== 'BONUS')); setMethodId(paymentMethods.find(method => method.active && method.kind !== 'DEBT' && method.kind !== 'BONUS')?.id ?? ''); setOperationId(crypto.randomUUID()); }).catch(caught => { setError(errorMessage(caught)); setLoading(false); }); }, []);
  useEffect(() => { const timer = window.setTimeout(() => { setPage(1); setAppliedSearch(search); }, 300); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => { if (!permissions.includes('customers.view')) return; api<SegmentSettings>('/customers/segment-settings').then(setSegmentSettings).catch(caught => setError(errorMessage(caught))); }, [permissions]);
  const load = useCallback(async () => {
    if (!permissions.includes('customers.view')) { setLoading(false); return; }
    setLoading(true);
    try { const result = await api<Page<Customer>>(`/customers?${queryString({ page, limit: 50, search: appliedSearch, segment })}`); setItems(result.items); setTotal(result.total); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); }
  }, [permissions, page, appliedSearch, segment, segmentRevision]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!storeId || !can('finance.customer_pay')) return; api<Page<Shift>>(`/stores/${storeId}/finance/cash-shifts?limit=100`).then(result => setShifts(result.items.filter(shift => shift.status === 'OPEN'))).catch(caught => setError(errorMessage(caught))); }, [storeId, permissions]);
  useEffect(() => { if (!selected || !storeId) { setPayments([]); return; } let current = true; setPayments([]); api<CustomerPayment[]>(`/stores/${storeId}/customers/${selected.id}/payments`).then(result => { if (current) setPayments(result); }).catch(caught => { if (current) setError(errorMessage(caught)); }); return () => { current = false; }; }, [selected?.id, storeId]);

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/customers', { method: 'POST', body: JSON.stringify({ firstName, lastName: lastName || null, phone, email: email || null, birthday: newBirthday ? `${newBirthday}T00:00:00.000Z` : null, gender: newGender || null, address: newAddress || null, ...(can('customers.discount.edit') ? { discountPercent: newDiscount.replace(',', '.') } : {}) }) }); setFirstName(''); setLastName(''); setPhone(''); setEmail(''); setNewDiscount('0'); setNewBirthday(''); setNewGender(''); setNewAddress(''); await load(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  function openCustomer(customer: Customer) { setSelected(customer); setEditing(false); setEditFirstName(customer.firstName); setEditLastName(customer.lastName ?? ''); setEditPhone(customer.phone); setEditEmail(customer.email ?? ''); setEditNotes(customer.notes ?? ''); setEditDiscount(customer.discountPercent); setEditBirthday(customer.birthday?.slice(0, 10) ?? ''); setEditGender(customer.gender ?? ''); setEditAddress(customer.address ?? ''); }
  async function saveCustomer(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError('');
    try { const updated = await api<Customer>(`/customers/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ firstName: editFirstName, lastName: editLastName || null, phone: editPhone, email: editEmail || null, birthday: editBirthday ? `${editBirthday}T00:00:00.000Z` : null, gender: editGender || null, address: editAddress || null, notes: editNotes || null, ...(can('customers.discount.edit') ? { discountPercent: editDiscount.replace(',', '.') } : {}) }) }); setSelected(updated); setEditing(false); await load(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  async function savePersonalDiscount(event: FormEvent) {
    event.preventDefault(); if (!selected || !can('customers.discount.edit')) return;
    setBusy(true); setError('');
    try {
      const updated = await api<Customer>(`/customers/${selected.id}/discount`, { method: 'PATCH', body: JSON.stringify({ discountPercent: editDiscount.replace(',', '.') }) });
      setSelected(updated); setDiscountRevision(value => value + 1); await load();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  async function deleteCustomer() {
    if (!selected) return;
    setBusy(true); setError('');
    try { await api(`/customers/${selected.id}`, { method: 'DELETE' }); setSelected(null); await load(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  async function pay(event: FormEvent) {
    event.preventDefault(); if (!selected || !storeId) return;
    setBusy(true); setError('');
    try {
      const method = methods.find(value => value.id === methodId);
      await api(`/stores/${storeId}/customers/${selected.id}/payments`, { method: 'POST', body: JSON.stringify({ operationId, paymentMethodId: methodId, amountMinor: toMinor(amount), ...(method?.kind === 'CASH' ? { cashShiftId: shiftId } : {}) }) });
      setOperationId(crypto.randomUUID()); setAmount('');
      const fresh = await api<Customer>(`/customers/${selected.id}`); setSelected(fresh);
      setPayments(await api<CustomerPayment[]>(`/stores/${storeId}/customers/${selected.id}/payments`));
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  async function refreshSelectedCustomer() {
    if (!selected) return;
    setSelected(await api<Customer>(`/customers/${selected.id}`));
    await load();
  }
  async function exportCustomers() {
    setExporting(true); setError('');
    try {
      const rows: Customer[] = [];
      for (let next = 1; ; next++) { const result = await api<Page<Customer>>(`/customers?${queryString({ page: next, limit: 100, search: appliedSearch, segment })}`); rows.push(...result.items); if (rows.length >= result.total || !result.items.length) break; }
      const header = ['Клиент', 'Телефон', 'Email', 'День рождения', 'Пол', 'Описание', 'Адрес', 'Покупок', 'Сумма покупок', 'Бонусы', 'Долг', 'Скидка, %', 'Создан'];
      const data = rows.map(customer => [`${customer.firstName} ${customer.lastName ?? ''}`.trim(), customer.phone, customer.email, customer.birthday ? birthdayText(customer.birthday) : null, customer.gender, customer.notes, customer.address, customer.ordersCount, Number(customer.totalSpentMinor) / 100, Number(customer.bonusBalanceMinor) / 100, Number(customer.debtBalanceMinor) / 100, Number(customer.discountPercent), createdFormat.format(new Date(customer.createdAt))]);
      const buffer = await writeTableXlsx('Клиенты', header, data, [null, null, null, null, null, null, null, '#,##0', '#,##0.00', '#,##0.00', '#,##0.00', '0.00', null]);
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = 'Клиенты.xlsx'; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) { setError(errorMessage(caught)); } finally { setExporting(false); }
  }
  return <CatalogShell><div className="crm-screen crm-workspace-page crm-customers-page"><div className="crm-page-head"><div><span className="crm-eyebrow">ПОКУПАТЕЛИ</span><h1>Клиенты</h1><p>Контакты, история покупок и работа с задолженностью.</p></div><div className="crm-page-actions">{can('customers.create') && <Link className="ks-button ks-button--secondary crm-outline-button" href="/customers/import">Импорт клиентов</Link>}</div></div>{error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
    {can('settings.edit') && segmentSettings && <SegmentSettingsEditor settings={segmentSettings} onSaved={updated => { setSegmentSettings(updated); if (segment && !updated[segment as keyof SegmentSettings].enabled) { setSegment(''); setPage(1); } setSegmentRevision(value => value + 1); }} />}
    {can('customers.create') && <details className="crm-create-details rounded border bg-white p-4"><summary className="cursor-pointer font-semibold">Добавить клиента</summary><form onSubmit={create} className="mt-4 grid gap-3 sm:grid-cols-2"><h2 className="font-semibold sm:col-span-2">Новый клиент</h2><label>Имя<input required maxLength={100} className="mt-1 w-full rounded border p-2" value={firstName} onChange={event => setFirstName(event.target.value)} /></label><label>Фамилия<input className="mt-1 w-full rounded border p-2" value={lastName} onChange={event => setLastName(event.target.value)} /></label><label>Телефон в формате +998901234567<TypedInput required type="tel" pattern="\+[1-9][0-9]{7,14}" className="mt-1 w-full rounded border p-2" value={phone} onChange={event => setPhone(event.target.value)} /></label><label>Email<input type="email" className="mt-1 w-full rounded border p-2" value={email} onChange={event => setEmail(event.target.value)} /></label>{can('customers.discount.edit') && <label>Персональная скидка, %<TypedInput required inputMode="decimal" pattern="[0-9]{1,3}([.,][0-9]{1,2})?" className="mt-1 w-full rounded border p-2" value={newDiscount} onChange={event => setNewDiscount(event.target.value)} /></label>}<label>Дата рождения<input type="date" max={todayDateInput()} className="mt-1 w-full rounded border p-2" value={newBirthday} onChange={event => setNewBirthday(event.target.value)} /></label><label>Пол<select className="mt-1 w-full rounded border p-2" value={newGender} onChange={event => setNewGender(event.target.value)}><option value="">Не указан</option><option value="Женский">Женский</option><option value="Мужской">Мужской</option><option value="Другой">Другой</option></select></label><label className="sm:col-span-2">Адрес<input maxLength={500} className="mt-1 w-full rounded border p-2" value={newAddress} onChange={event => setNewAddress(event.target.value)} /></label><button disabled={busy} className="ks-button ks-button--primary sm:col-span-2">Создать</button></form></details>}
    <section className="crm-list-card crm-customers-list" aria-label="Список клиентов"><div className="crm-shifts-toolbar crm-customers-toolbar"><div className="crm-chips"><div className="crm-chip is-wide"><span className="crm-chip-label"><SearchCaption text="поиск" /></span><div className="crm-chip-value"><input aria-label="Поиск клиентов" type="search" enterKeyHint="search" placeholder="имя, телефон или ID" value={search} onChange={event => setSearch(event.target.value)} /></div></div><div className="crm-chip"><span className="crm-chip-label">сегмент</span><div className="crm-chip-value"><select aria-label="Сегмент клиентов" value={segment} onChange={event => { setSegment(event.target.value); setPage(1); setSelected(null); }}><option value="">все</option>{(!segmentSettings || segmentSettings.NEW.enabled) && <option value="NEW">Новые</option>}{(!segmentSettings || segmentSettings.REGULAR.enabled) && <option value="REGULAR">Постоянные</option>}{(!segmentSettings || segmentSettings.VIP.enabled) && <option value="VIP">VIP</option>}{(!segmentSettings || segmentSettings.DORMANT.enabled) && <option value="DORMANT">Давно не покупали</option>}{(!segmentSettings || segmentSettings.HIGH_CHECK.enabled) && <option value="HIGH_CHECK">Высокий средний чек</option>}{(!segmentSettings || segmentSettings.FREQUENT.enabled) && <option value="FREQUENT">Частые покупки</option>}</select></div></div></div><div className="crm-shifts-tools"><span className="crm-list-total">Итог {total}</span><button type="button" className="ks-button ks-button--secondary crm-outline-button" disabled={exporting || !total} onClick={() => void exportCustomers()}>{exporting ? 'Готовим…' : 'Скачать в Excel'}</button></div></div>
      <div className="crm-shifts-table-wrap" aria-busy={loading}><table className="crm-shifts-table"><thead><tr><th scope="col">Клиент</th><th scope="col">Телефон</th><th scope="col">Email</th><th scope="col">День рождения</th><th scope="col">Пол</th><th scope="col">Описание</th><th scope="col">Адрес</th><th scope="col" className="num">Покупок</th><th scope="col" className="num">Сумма покупок</th><th scope="col" className="num">Бонусы</th><th scope="col" className="num">Долг</th><th scope="col">Создан</th></tr></thead>
      <tbody>{items.map(customer => <tr key={customer.id} className={selected?.id === customer.id ? 'selected' : ''}><td><button type="button" className="ks-button ks-button--ghost ks-button--sm crm-link-button" onClick={() => openCustomer(customer)}>{customer.firstName} {customer.lastName ?? ''}</button></td><td>{customer.phone}</td><td>{customer.email ?? ''}</td><td>{birthdayText(customer.birthday)}</td><td>{customer.gender ?? ''}</td><td className="crm-cell-clip">{customer.notes ?? ''}</td><td className="crm-cell-clip">{customer.address ?? ''}</td><td className="num">{customer.ordersCount}</td><td className="num">{money(customer.totalSpentMinor)}</td><td className="num">{money(customer.bonusBalanceMinor)}</td><td className="num">{customer.debtBalanceMinor !== '0' ? money(customer.debtBalanceMinor) : ''}</td><td>{createdFormat.format(new Date(customer.createdAt))}</td></tr>)}</tbody></table>
      {loading && !items.length && <p role="status" className="crm-shifts-empty">Загрузка…</p>}{!loading && items.length === 0 && <div className="crm-shifts-empty"><strong>Клиентов не найдено</strong><p>Измените поиск или сегмент либо добавьте клиента.</p></div>}</div>
      {total > 50 && <div className="crm-shifts-pages"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="ks-button ks-button--secondary crm-outline-button">Назад</button><span>{page} / {Math.ceil(total / 50)}</span><button type="button" disabled={page * 50 >= total} onClick={() => setPage(page + 1)} className="ks-button ks-button--secondary crm-outline-button">Далее</button></div>}</section>
    {selected && <CabinetDrawer title={`${selected.firstName} ${selected.lastName ?? ''}`} onClose={() => setSelected(null)}><div id="customer-detail" className="space-y-4">{error && <p role="alert" className="crm-alert">{error}</p>}<CustomerOverview key={`overview-${selected.id}-${segmentRevision}`} customer={selected} />{can('customers.discount.edit') && <form onSubmit={savePersonalDiscount} className="flex flex-wrap items-end gap-3 rounded-xl border border-rose-100 bg-rose-50/50 p-4"><label className="text-sm font-medium">Персональная скидка, %<TypedInput required inputMode="decimal" pattern="[0-9]{1,3}([.,][0-9]{1,2})?" className="mt-1 block w-32 rounded-lg border border-slate-200 bg-white p-2" value={editDiscount} onChange={event => setEditDiscount(event.target.value)} /></label><button disabled={busy || editDiscount.replace(',', '.') === selected.discountPercent} className="ks-button ks-button--primary">Сохранить скидку</button><span className="text-sm text-slate-500">Изменение сохранится в истории клиента.</span></form>}{can('customers.edit') && <div><button className="ks-button ks-button--secondary" onClick={() => setEditing(!editing)}>{editing ? 'Отмена' : 'Редактировать'}</button>{editing && <form onSubmit={saveCustomer} className="mt-3 grid gap-3 sm:grid-cols-2"><label>Имя<input required className="mt-1 w-full rounded border p-2" value={editFirstName} onChange={event => setEditFirstName(event.target.value)} /></label><label>Фамилия<input className="mt-1 w-full rounded border p-2" value={editLastName} onChange={event => setEditLastName(event.target.value)} /></label><label>Телефон<TypedInput required type="tel" pattern="\+[1-9][0-9]{7,14}" className="mt-1 w-full rounded border p-2" value={editPhone} onChange={event => setEditPhone(event.target.value)} /></label><label>Email<input type="email" className="mt-1 w-full rounded border p-2" value={editEmail} onChange={event => setEditEmail(event.target.value)} /></label>{can('customers.discount.edit') && <label>Персональная скидка, %<TypedInput required inputMode="decimal" pattern="[0-9]{1,3}([.,][0-9]{1,2})?" className="mt-1 w-full rounded border p-2" value={editDiscount} onChange={event => setEditDiscount(event.target.value)} /></label>}<label>Дата рождения<input type="date" max={todayDateInput()} className="mt-1 w-full rounded border p-2" value={editBirthday} onChange={event => setEditBirthday(event.target.value)} /></label><label>Пол<select className="mt-1 w-full rounded border p-2" value={editGender} onChange={event => setEditGender(event.target.value)}><option value="">Не указан</option><option value="Женский">Женский</option><option value="Мужской">Мужской</option><option value="Другой">Другой</option></select></label><label className="sm:col-span-2">Адрес<input maxLength={500} className="mt-1 w-full rounded border p-2" value={editAddress} onChange={event => setEditAddress(event.target.value)} /></label><label className="sm:col-span-2">Заметки о клиенте<textarea maxLength={2000} rows={3} className="mt-1 w-full rounded border p-2" value={editNotes} onChange={event => setEditNotes(event.target.value)} /></label><button disabled={busy} className="ks-button ks-button--primary sm:col-span-2">Сохранить</button></form>}</div>}{selected.notes && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><strong>Заметки:</strong> {selected.notes}</p>}<CustomerHistory key={`history-${selected.id}-${discountRevision}`} customerId={selected.id} debtBalanceMinor={selected.debtBalanceMinor} canComment={can('customers.edit')} canCorrectBonus={can('settings.edit')} onBonusChanged={refreshSelectedCustomer} />{can('finance.customer_pay') && <form onSubmit={pay} className="flex flex-wrap items-end gap-3"><label>Магазин<select className="mt-1 block rounded border p-2" value={storeId} onChange={event => setStoreId(event.target.value)}>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label>Сумма, сомони<TypedInput required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" className="mt-1 block rounded border p-2" value={amount} onChange={event => setAmount(event.target.value)} /></label><label>Оплата<select required className="mt-1 block rounded border p-2" value={methodId} onChange={event => { setMethodId(event.target.value); setShiftId(''); }}>{methods.map(method => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>{methods.find(method => method.id === methodId)?.kind === 'CASH' && <label>Кассовая смена<select required className="mt-1 block rounded border p-2" value={shiftId} onChange={event => setShiftId(event.target.value)}><option value="">Выберите смену</option>{shifts.map(shift => <option key={shift.id} value={shift.id}>{shift.deviceId}</option>)}</select></label>}<button disabled={busy || !storeId || selected.debtBalanceMinor === '0'} className="ks-button ks-button--primary">Погасить долг</button></form>}<h3 className="font-medium">Погашения в выбранном магазине</h3><ul className="divide-y">{payments.map(payment => <li key={payment.id} className="py-2">{new Date(payment.createdAt).toLocaleString('ru-RU')} · {money(payment.amountMinor)} · {payment.paymentMethod.name}</li>)}{payments.length === 0 && <li className="py-2 text-slate-500">Погашений нет</li>}</ul>{can('customers.delete') && selected.debtBalanceMinor === '0' && <button disabled={busy} onClick={() => void deleteCustomer()} className="ks-button ks-button--ghost ks-button--sm ks-button--danger-text">Удалить карточку</button>}</div></CabinetDrawer>}
  </div></CatalogShell>;
}
