'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, queryString, type Page } from '../../lib/api';

type Comment = { id: string; text: string; createdAt: string; author: { id: string; name: string; login: string } };

export function CustomerComments({ customerId, canComment }: { customerId: string; canComment: boolean }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Page<Comment> | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    setLoading(true);
    api<Page<Comment>>(`/customers/${customerId}/comments?${queryString({ page, limit: 10 })}`)
      .then(value => { if (current) { setResult(value); setError(''); } })
      .catch(caught => { if (current) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить комментарии'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [customerId, page, revision]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError('');
    try {
      await api(`/customers/${customerId}/comments`, { method: 'POST', body: JSON.stringify({ text: text.trim() }) });
      setText(''); setPage(1); setRevision(value => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось сохранить комментарий'); }
    finally { setBusy(false); }
  }

  return <div className="mt-3 space-y-3">
    {canComment && <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-3">
      <label htmlFor="customer-comment" className="block text-sm font-medium">Новый комментарий</label>
      <textarea id="customer-comment" required maxLength={2000} rows={3} value={text} onChange={event => setText(event.target.value)} placeholder="Например, что клиент попросил подобрать или сообщить" className="mt-2 w-full rounded border border-slate-300 p-2" />
      <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-slate-500">{text.length} / 2000</span><button disabled={busy || !text.trim()} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">Добавить комментарий</button></div>
    </form>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {loading ? <p className="text-sm text-slate-500">Загрузка комментариев…</p> : <>
      <ul className="space-y-2">{result?.items.map(comment => <li key={comment.id} className="rounded-lg border border-slate-200 bg-white p-3"><p className="whitespace-pre-wrap text-sm text-slate-800">{comment.text}</p><p className="mt-2 text-xs text-slate-500">{comment.author.name} · {new Date(comment.createdAt).toLocaleString('ru-RU')}</p></li>)}{result?.items.length === 0 && <li className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500">Комментариев пока нет</li>}</ul>
      {(result?.total ?? 0) > 10 && <div className="flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border bg-white px-3 py-1 disabled:opacity-50">Назад</button><span>{page} / {Math.ceil((result?.total ?? 0) / 10)}</span><button type="button" disabled={page * 10 >= (result?.total ?? 0)} onClick={() => setPage(page + 1)} className="rounded border bg-white px-3 py-1 disabled:opacity-50">Далее</button></div>}
    </>}
  </div>;
}
