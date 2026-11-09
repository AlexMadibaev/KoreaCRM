'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CatalogShell } from '../../components/catalog-shell';
import { api } from '../../lib/api';

type Kind = 'CASH' | 'CARD' | 'QR' | 'TRANSFER' | 'BONUS' | 'DEBT' | 'CUSTOM';
type Method = { id: string; code: string; name: string; kind: Kind; active: boolean; system: boolean; sortOrder: number };
const kindName: Record<Kind, string> = { CASH: 'Наличные', CARD: 'Банковская карта', QR: 'QR-код', TRANSFER: 'Перевод', BONUS: 'Бонусы клиента', DEBT: 'Долг клиента', CUSTOM: 'Другое' };
const kindHint: Partial<Record<Kind, string>> = { CASH: 'Учитывается в кассовой смене. На кассе виден кассирам с правом просмотра наличных.', BONUS: 'Показывается только в бонусном режиме лояльности.', DEBT: 'Требует выбранного клиента.' };
const creatableKinds: Kind[] = ['CARD', 'QR', 'TRANSFER', 'CASH', 'CUSTOM'];
const errorText = (caught: unknown) => {
  const text = caught instanceof Error ? caught.message : '';
  if (text === 'At least one payment method must stay active') return 'Хотя бы один способ оплаты должен остаться включённым.';
  return text || 'Не удалось выполнить действие.';
};

export default function PaymentMethodsPage() {
  const [methods, setMethods] = useState<Method[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState(''), [editName, setEditName] = useState('');
  const [newName, setNewName] = useState(''), [newKind, setNewKind] = useState<Kind>('CARD');
  const load = useCallback(async () => { setMethods(await api<Method[]>('/sale-payment-methods')); }, []);
  useEffect(() => {
    Promise.all([api<{ permissions: string[] }>('/auth/me'), load()])
      .then(([me]) => setCanEdit(me.permissions.includes('settings.edit')))
      .catch(caught => setError(errorText(caught)))
      .finally(() => setLoading(false));
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); setNotice(`${success} На кассе изменения появятся после повторного входа кассира.`); }
    catch (caught) { setError(errorText(caught)); await load().catch(() => undefined); }
    finally { setBusy(false); }
  }
  const patch = (id: string, body: Partial<Pick<Method, 'name' | 'active' | 'sortOrder'>>) => api<Method>(`/sale-payment-methods/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  function rename(event: FormEvent) {
    event.preventDefault();
    const name = editName.trim(); if (!name) return;
    void run(async () => { await patch(editingId, { name }); setEditingId(''); }, 'Название сохранено.');
  }
  function move(index: number, direction: -1 | 1) {
    const order = [...methods];
    const [moved] = order.splice(index, 1);
    order.splice(index + direction, 0, moved!);
    // Renumber the whole list so methods that shared a position get a stable order.
    void run(() => Promise.all(order.map((method, position) => (position + 1) * 10 === method.sortOrder ? null : patch(method.id, { sortOrder: (position + 1) * 10 }))), 'Порядок сохранён.');
  }
  function create(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim(); if (!name) return;
    void run(async () => { await api('/sale-payment-methods', { method: 'POST', body: JSON.stringify({ name, kind: newKind }) }); setNewName(''); setNewKind('CARD'); }, 'Способ оплаты добавлен.');
  }

  return <CatalogShell><div className="crm-screen crm-workspace-page">
    <header className="crm-page-head"><div><span className="crm-eyebrow">ПРОДАЖИ</span><h1>Способы оплаты</h1><p>Какие кнопки оплаты видит кассир и в каком порядке.</p></div></header>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{notice}</p>}
    {loading ? <p>Загрузка…</p> : <section className="crm-payment-methods rounded-2xl border border-slate-200 bg-white">
      <ul className="divide-y divide-slate-100">{methods.map((method, index) => <li key={method.id} className={`flex flex-wrap items-center gap-3 p-4 ${method.active ? '' : 'bg-slate-50'}`}>
        {canEdit && <span className="flex flex-col"><button type="button" aria-label={`Поднять ${method.name}`} disabled={busy || index === 0} className="ks-button ks-button--ghost ks-button--icon" onClick={() => move(index, -1)}>▲</button><button type="button" aria-label={`Опустить ${method.name}`} disabled={busy || index === methods.length - 1} className="ks-button ks-button--ghost ks-button--icon" onClick={() => move(index, 1)}>▼</button></span>}
        <div className="min-w-0 flex-1">
          {editingId === method.id
            ? <form onSubmit={rename} className="flex flex-wrap gap-2"><input autoFocus required maxLength={100} aria-label="Название способа оплаты" className="rounded-lg border border-slate-200 p-2" value={editName} onChange={event => setEditName(event.target.value)} /><button disabled={busy} className="ks-button ks-button--primary">Сохранить</button><button type="button" className="ks-button ks-button--secondary" onClick={() => setEditingId('')}>Отмена</button></form>
            : <strong className={method.active ? '' : 'text-slate-400'}>{method.name}</strong>}
          <p className="mt-1 text-xs text-slate-500">{kindName[method.kind]}{method.system ? ' · системный' : ''}{kindHint[method.kind] ? ` · ${kindHint[method.kind]}` : ''}</p>
        </div>
        {canEdit && editingId !== method.id && <button type="button" disabled={busy} className="ks-button ks-button--ghost ks-button--sm" onClick={() => { setEditingId(method.id); setEditName(method.name); }}>Переименовать</button>}
        {canEdit
          ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={method.active} disabled={busy} onChange={event => void run(() => patch(method.id, { active: event.target.checked }), event.target.checked ? `«${method.name}» включён.` : `«${method.name}» скрыт с кассы.`)} />{method.active ? 'Включён' : 'Выключен'}</label>
          : <span className="text-sm text-slate-500">{method.active ? 'Включён' : 'Выключен'}</span>}
      </li>)}</ul>
    </section>}
    {canEdit && <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="w-full text-lg font-semibold">Новый способ оплаты</h2>
      <label className="text-sm">Название<input required maxLength={100} className="mt-1 block rounded-lg border border-slate-200 p-2" value={newName} onChange={event => setNewName(event.target.value)} placeholder="Например, Алиф" /></label>
      <label className="text-sm">Тип<select className="mt-1 block rounded-lg border border-slate-200 p-2" value={newKind} onChange={event => setNewKind(event.target.value as Kind)}>{creatableKinds.map(kind => <option key={kind} value={kind}>{kindName[kind]}</option>)}</select></label>
      <button disabled={busy} className="ks-button ks-button--primary">Добавить</button>
      <p className="w-full text-xs text-slate-500">Тип определяет учёт: наличные попадают в кассовую смену, остальные считаются безналичными. Способы, по которым уже были продажи, не удаляются — их можно выключить.</p>
    </form>}
  </div></CatalogShell>;
}
