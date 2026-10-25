'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CatalogShell } from '../../../components/catalog-shell';
import { api } from '../../../lib/api';
import { revealSection } from '../../../lib/reveal';

type Category = { id: string; name: string };
export default function ExpenseCategoriesPage() {
  const [items, setItems] = useState<Category[]>([]), [name, setName] = useState(''), [selectedId, setSelectedId] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const load = useCallback(async () => { setLoading(true); try { setItems(await api<Category[]>('/expense-categories')); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка загрузки'); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); api<{ permissions: string[] }>('/auth/me').then((me) => setCanEdit(me.permissions.includes('finance.edit'))).catch(() => undefined); }, [load]);
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await api(selectedId ? `/expense-categories/${selectedId}` : '/expense-categories', { method: selectedId ? 'PATCH' : 'POST', body: JSON.stringify({ name }) }); setName(''); setSelectedId(null); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка сохранения'); } finally { setBusy(false); } }
  async function remove(id: string) { setBusy(true); setError(''); try { await api(`/expense-categories/${id}`, { method: 'DELETE' }); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Ошибка удаления'); } finally { setBusy(false); } }
  return <CatalogShell><main className="space-y-5"><div className="crm-page-head"><div><span className="crm-eyebrow">ФИНАНСЫ</span><h1>Категории расходов</h1><p>Группируйте расходы для понятных отчётов.</p></div></div>{error && <p role="alert" className="text-red-700">{error}</p>}{canEdit && <form id="expense-category-form" onSubmit={save} className="flex flex-wrap items-end gap-3 rounded border bg-white p-4"><label>Название<input required className="mt-1 block rounded border p-2" value={name} onChange={(event) => setName(event.target.value)} /></label><button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-white">{selectedId ? 'Сохранить' : 'Добавить'}</button>{selectedId && <button type="button" className="rounded border px-4 py-2" onClick={() => { setSelectedId(null); setName(''); }}>Отмена</button>}</form>}{loading ? <p>Загрузка…</p> : <ul className="divide-y rounded border bg-white">{items.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><span className="min-w-0">{item.name}</span>{canEdit && <span className="flex gap-3"><button disabled={busy} className="underline" onClick={() => { setSelectedId(item.id); setName(item.name); revealSection('expense-category-form'); }}>Изменить</button><button disabled={busy} className="text-red-700 underline" onClick={() => void remove(item.id)}>Удалить</button></span>}</li>)}</ul>}</main></CatalogShell>;
}
