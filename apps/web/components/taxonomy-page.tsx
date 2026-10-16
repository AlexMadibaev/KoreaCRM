'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, queryString, type Brand, type Category, type Page } from '../lib/api';
import { CatalogShell } from './catalog-shell';

type Item = Brand | Category;

export function TaxonomyPage({ kind }: { kind: 'brands' | 'categories' }) {
  const categoryMode = kind === 'categories';
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await api<Page<Item>>(`/${kind}?${queryString({ page, limit: 20, search: appliedSearch })}`);
      setItems(result.items); setTotal(result.total);
      if (categoryMode) setAllCategories((await api<Page<Category>>('/categories?limit=100')).items);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось загрузить данные'); }
    finally { setLoading(false); }
  }, [kind, page, appliedSearch, categoryMode]);
  useEffect(() => { void load(); }, [load]);

  function reset() { setName(''); setParentId(''); setEditingId(null); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api(`/${kind}${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PATCH' : 'POST',
        body: JSON.stringify(categoryMode ? { name, parentId: parentId || null } : { name }),
      });
      reset(); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить'); }
    finally { setSaving(false); }
  }
  async function remove(item: Item) {
    if (!window.confirm(`Удалить «${item.name}»?`)) return;
    setError('');
    try { await api(`/${kind}/${item.id}`, { method: 'DELETE' }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось удалить'); }
  }

  return <CatalogShell><section className="space-y-6">
    <h1 className="text-2xl font-semibold">{categoryMode ? 'Категории' : 'Бренды'}</h1>
    <form onSubmit={submit} className="grid gap-3 rounded-lg border bg-white p-5 md:grid-cols-3">
      <label className="text-sm">Название<input className="mt-1 w-full rounded border p-2" value={name} onChange={(event) => setName(event.target.value)} required /></label>
      {categoryMode && <label className="text-sm">Родительская категория<select className="mt-1 w-full rounded border p-2" value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Нет</option>{allCategories.filter((item) => item.id !== editingId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <div className="flex items-end gap-2"><button disabled={saving} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Сохранение…' : editingId ? 'Сохранить' : 'Добавить'}</button>{editingId && <button type="button" className="rounded border px-4 py-2" onClick={reset}>Отмена</button>}</div>
    </form>
    <label className="block max-w-sm text-sm">Поиск<input className="mt-1 w-full rounded border p-2" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {loading ? <p>Загрузка…</p> : <div className="rounded-lg border bg-white"><ul>{items.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-b-0"><div><span className="font-medium">{item.name}</span>{'parentId' in item && item.parentId && <span className="ml-2 text-sm text-slate-500">в {allCategories.find((parent) => parent.id === item.parentId)?.name ?? 'категории'}</span>}</div><div className="flex gap-3 text-sm"><button className="underline" onClick={() => { setEditingId(item.id); setName(item.name); setParentId('parentId' in item ? item.parentId ?? '' : ''); }}>Изменить</button><button className="text-red-700 underline" onClick={() => void remove(item)}>Удалить</button></div></li>)}</ul>{items.length === 0 && <p className="p-5 text-slate-500">Нет записей</p>}</div>}
    <div className="flex items-center gap-3"><button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page === 1} onClick={() => setPage(page - 1)}>Назад</button><span>Страница {page} · всего {total}</span><button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Далее</button></div>
  </section></CatalogShell>;
}
