'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, queryString } from '../lib/api';

type Result = { title: string; image: string; preview: string; source: string };
type SearchResponse = { status: 'ok' | 'unconfigured' | 'unavailable'; items: Result[] };
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];

export function ProductImageSearch({ initialQuery, onClose, onSelect }: {
  initialQuery: string;
  onClose: () => void;
  onSelect: (file: File) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [query, setQuery] = useState(initialQuery.slice(0, 255));
  const [result, setResult] = useState<SearchResponse>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const googleUrl = `https://www.google.com/search?${queryString({ udm: 2, q: query.trim() })}`;

  useEffect(() => {
    dialog.current?.showModal();
    return () => request.current?.abort();
  }, []);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (busy || query.trim().length < 2) return;
    setBusy(true);
    setError('');
    setResult(undefined);
    const controller = new AbortController();
    request.current = controller;
    try {
      setResult(await api<SearchResponse>(`/products/image-search?${queryString({ q: query.trim() })}`, { signal: controller.signal }));
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Поиск не удался.');
    } finally {
      setBusy(false);
    }
  }

  async function choose(item: Result) {
    if (busy) return;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    request.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
    try {
      const response = await fetch(item.image, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal });
      const type = response.headers.get('content-type')?.split(';')[0] ?? '';
      if (!response.ok || !response.body || !imageTypes.includes(type)) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 5_000_000) throw new Error();
          chunks.push(new Uint8Array(value));
        }
      } finally {
        void reader.cancel().catch(() => undefined);
      }
      if (!size) throw new Error();
      onSelect(new File(chunks, 'product-photo', { type }));
    } catch {
      if (!controller.signal.aborted) setError('Фото не удалось загрузить напрямую. Откройте источник, сохраните фото и добавьте его файлом.');
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={dialog} aria-labelledby="product-photo-search-title" onCancel={event => { event.preventDefault(); onClose(); }} onPaste={event => {
    const file = Array.from(event.clipboardData.files).find(item => item.type.startsWith('image/'));
    if (!file || busy) return;
    event.preventDefault();
    if (file.size > 5_000_000 || !imageTypes.includes(file.type)) {
      setError('Вставьте фото в формате JPEG, PNG или WebP размером до 5 МБ.');
      return;
    }
    onSelect(file);
  }} className="m-auto max-h-[85vh] w-[min(52rem,95vw)] rounded-2xl border bg-white p-5 shadow-xl backdrop:bg-black/40">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 id="product-photo-search-title" className="text-lg font-semibold">Найти фото товара</h2>
      <button type="button" className="ks-button ks-button--ghost" onClick={onClose}>Закрыть</button>
    </div>
    <form onSubmit={search} className="flex flex-wrap gap-2">
      <input aria-label="Название товара и бренд" value={query} onChange={event => setQuery(event.target.value)} maxLength={255} className="min-w-48 flex-1 rounded border p-2" />
      <button className="ks-button ks-button--primary" disabled={busy || query.trim().length < 2}>Найти</button>
    </form>
    {query.trim().length >= 2 && <p className="mt-3 text-sm">
      <a href={googleUrl} target="_blank" rel="noreferrer" className="underline">Открыть Google Картинки</a>
      {' · Скопируйте изображение и вставьте сюда (Ctrl+V).'}
    </p>}
    {busy && <p role="status" className="mt-3">Загрузка…</p>}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
    {result?.status === 'unconfigured' && <p className="mt-3">Сервис поиска фото ещё не подключён.</p>}
    {result?.status === 'unavailable' && <p className="mt-3">Поиск временно недоступен. Попробуйте позже.</p>}
    {result?.status === 'ok' && !result.items.length && <p className="mt-3">Фото не найдены. Уточните название или бренд.</p>}
    {!!result?.items.length && <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {result.items.map(item => <li key={item.image} className="grid content-start gap-2 rounded border p-2">
        <img src={item.preview} alt={item.title} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full object-contain" />
        <p className="line-clamp-2 text-sm">{item.title}</p>
        <button type="button" disabled={busy} onClick={() => void choose(item)} className="ks-button ks-button--secondary ks-button--sm">Выбрать</button>
        <a href={item.source} target="_blank" rel="noreferrer" className="text-sm underline">Источник</a>
      </li>)}
    </ul>}
  </dialog>;
}
