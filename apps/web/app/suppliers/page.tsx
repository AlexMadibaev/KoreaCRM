'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { CatalogShell } from '../../components/catalog-shell';
import { CabinetDrawer } from '../../components/cabinet-drawer';
import { amount } from '../../components/shift-card';
import { api, type Page } from '../../lib/api';
import { writeTableXlsx } from '../../lib/xlsx';

type Supplier = { id: string; name: string; contactPerson: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null; status: string; balanceMinor: string; createdAt: string };
const empty = { name: '', contactPerson: '', phone: '', email: '', address: '', notes: '', status: 'ACTIVE' };
const fieldLabels = { name: 'Название', contactPerson: 'Контактное лицо', phone: 'Телефон', email: 'Email', address: 'Адрес', notes: 'Описание' } as const;
const created = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Dushanbe' });

/** Supplier directory laid out like CloudShop "Поставщики": dense table, total, Excel export and a side form. */
export default function SuppliersPage() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all: Supplier[] = [];
      for (let page = 1; ; page++) { const result = await api<Page<Supplier>>(`/suppliers?limit=100&page=${page}`); all.push(...result.items); if (all.length >= result.total || !result.items.length) break; }
      setItems(all);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка загрузки'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); api<{ permissions: string[] }>('/auth/me').then(me => setCanEdit(me.permissions.includes('suppliers.create') || me.permissions.includes('suppliers.edit'))).catch(() => undefined); }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(editing && editing !== 'new' ? `/suppliers/${editing}` : '/suppliers', { method: editing && editing !== 'new' ? 'PATCH' : 'POST', body: JSON.stringify(Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value || (key === 'name' || key === 'status' ? value : null)]))) });
      setEditing(null); setForm(empty); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка сохранения'); } finally { setBusy(false); }
  }
  const visible = items.filter(item => !search || `${item.name} ${item.contactPerson ?? ''} ${item.phone ?? ''} ${item.email ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  async function exportExcel() {
    const buffer = await writeTableXlsx('Поставщики', ['Поставщик', 'Контактное лицо', 'Телефон', 'Email', 'Описание', 'Адрес', 'Долг, смн.', 'Статус', 'Создан'],
      visible.map(item => [item.name, item.contactPerson, item.phone, item.email, item.notes, item.address, Number(item.balanceMinor) / 100, item.status === 'ACTIVE' ? 'Активен' : 'Неактивен', created.format(new Date(item.createdAt))]),
      [null, null, null, null, null, null, '#,##0.00', null, null]);
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a'); link.href = url; link.download = 'Поставщики.xlsx'; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const open = (item: Supplier) => { setEditing(item.id); setForm({ name: item.name, contactPerson: item.contactPerson ?? '', phone: item.phone ?? '', email: item.email ?? '', address: item.address ?? '', notes: item.notes ?? '', status: item.status }); };

  return <CatalogShell><div className="crm-shifts">
    <div className="crm-shifts-toolbar">
      <div className="crm-chips"><div className="crm-chip is-wide"><span className="crm-chip-label">поиск</span><div className="crm-chip-value"><input type="search" aria-label="Поиск поставщиков" placeholder="название, контакт или телефон" value={search} onChange={event => setSearch(event.target.value)} /></div></div></div>
      <div className="crm-shifts-tools">
        <span className="crm-list-total">Итог {visible.length}</span>
        <button type="button" className="crm-outline-button" disabled={!visible.length} onClick={() => void exportExcel()}>Скачать в Excel</button>
        {canEdit && <button type="button" className="crm-primary-button" onClick={() => { setEditing('new'); setForm(empty); }}><Plus size={14} aria-hidden /> Создать</button>}
      </div>
    </div>
    {error && !editing && <p role="alert" className="crm-alert">{error}</p>}
    <div className="crm-shifts-table-wrap" aria-busy={loading}>
      <table className="crm-shifts-table"><thead><tr><th scope="col">Поставщик</th><th scope="col">Контактное лицо</th><th scope="col">Телефон</th><th scope="col">Email</th><th scope="col">Описание</th><th scope="col">Адрес</th><th scope="col" className="num">Долг, смн.</th><th scope="col">Статус</th><th scope="col">Создан</th></tr></thead>
        <tbody>{visible.map(item => <tr key={item.id}>
          <td>{canEdit ? <button type="button" className="crm-link-button" onClick={() => open(item)}>{item.name}</button> : item.name}</td>
          <td>{item.contactPerson ?? ''}</td><td>{item.phone ? <a href={`tel:${item.phone}`}>{item.phone}</a> : ''}</td><td>{item.email ?? ''}</td>
          <td className="crm-cell-clip">{item.notes ?? ''}</td><td className="crm-cell-clip">{item.address ?? ''}</td>
          <td className="num">{item.balanceMinor !== '0' ? amount(item.balanceMinor) : ''}</td><td>{item.status === 'ACTIVE' ? 'Активен' : 'Неактивен'}</td><td>{created.format(new Date(item.createdAt))}</td>
        </tr>)}</tbody>
      </table>
      {loading && !items.length && <p role="status" className="crm-shifts-empty">Загрузка…</p>}
      {!loading && !visible.length && <div className="crm-shifts-empty"><strong>{items.length ? 'Ничего не найдено' : 'Поставщиков пока нет'}</strong><p>{items.length ? 'Измените поиск.' : 'Добавьте первого поставщика, чтобы оформлять закупки.'}</p></div>}
    </div>
    {editing && <CabinetDrawer title={editing === 'new' ? 'Новый поставщик' : form.name || 'Поставщик'} onClose={() => { setEditing(null); setError(''); }}>
      <form className="crm-shift-open crm-supplier-form" onSubmit={save}>
        {(Object.keys(fieldLabels) as (keyof typeof fieldLabels)[]).map(field => <label key={field}>{fieldLabels[field]}<input type={field === 'phone' ? 'tel' : field === 'email' ? 'email' : 'text'} required={field === 'name'} value={form[field]} onChange={event => setForm({ ...form, [field]: event.target.value })} /></label>)}
        <label>Статус<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option value="ACTIVE">Активен</option><option value="INACTIVE">Неактивен</option></select></label>
        {error && <p role="alert" className="crm-alert">{error}</p>}
        <button type="submit" disabled={busy} className="crm-primary-button">{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      </form>
    </CabinetDrawer>}
  </div></CatalogShell>;
}
