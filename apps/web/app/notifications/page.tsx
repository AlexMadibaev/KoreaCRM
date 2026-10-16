'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CatalogShell } from '../../components/catalog-shell';
import { api, queryString } from '../../lib/api';

type Notification = {
  id: string;
  sourceKey: string;
  type: string;
  title: string;
  message: string;
  storeId: string | null;
  store: { name: string } | null;
  readAt: string | null;
  createdAt: string;
};
type NotificationPage = { items: Notification[]; total: number; unreadCount: number; page: number; limit: number };

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++loadSequence.current;
    setLoading(true); setError('');
    try {
      const result = await api<NotificationPage>(`/notifications?${queryString({ page, limit: 20, unread: String(unreadOnly) })}`);
      if (requestId !== loadSequence.current) return;
      setItems(result.items); setTotal(result.total); setUnreadCount(result.unreadCount);
    } catch (caught) { if (requestId === loadSequence.current) setError(caught instanceof Error ? caught.message : 'Не удалось загрузить уведомления'); }
    finally { if (requestId === loadSequence.current) setLoading(false); }
  }, [page, unreadOnly]);
  useEffect(() => { void load(); }, [load]);

  async function markRead(id: string) {
    setBusy(true); setError('');
    try { await api(`/notifications/${id}/read`, { method: 'PATCH' }); await load(); window.dispatchEvent(new Event('koreacrm:notifications-changed')); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось отметить уведомление'); }
    finally { setBusy(false); }
  }
  async function markAllRead() {
    setBusy(true); setError('');
    try { await api('/notifications/read-all', { method: 'POST' }); setPage(1); if (page === 1) await load(); window.dispatchEvent(new Event('koreacrm:notifications-changed')); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось отметить уведомления'); }
    finally { setBusy(false); }
  }

  return <CatalogShell><section className="crm-notifications-page">
    <div className="crm-page-head"><div><span className="crm-eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</span><h1>Уведомления</h1><p>Важные изменения по вашим магазинам.</p></div>{unreadCount > 0 && <button className="crm-outline-button" disabled={busy} onClick={markAllRead}>Прочитать все</button>}</div>
    <div className="crm-notification-tabs" role="group" aria-label="Фильтр уведомлений"><button className={!unreadOnly ? 'active' : ''} onClick={() => { setPage(1); setUnreadOnly(false); }}>Все</button><button className={unreadOnly ? 'active' : ''} onClick={() => { setPage(1); setUnreadOnly(true); }}>Непрочитанные {unreadCount > 0 ? `· ${unreadCount}` : ''}</button></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {loading ? <p className="crm-notification-empty">Загрузка уведомлений…</p> : items.length ? <div className="crm-notification-list">{items.map(item => <article key={item.id} className={`crm-notification-card ${item.readAt ? '' : 'unread'}`}><span className="crm-notification-icon" aria-hidden="true">{item.type === 'TRANSFER' ? '↔' : item.type === 'LARGE_RETURN' ? '↩' : item.type === 'LARGE_DISCOUNT' ? '%' : item.type === 'OUT_OF_STOCK' ? '0' : item.type === 'NEGATIVE_STOCK' ? '!' : '↓'}</span><div className="crm-notification-body"><div className="crm-notification-meta"><span>{item.store?.name ?? 'Магазин'}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })}</time></div><h2>{item.title}</h2><p>{item.message}</p><div className="crm-notification-actions">{item.type === 'TRANSFER' ? <Link href={`/transfers?id=${encodeURIComponent(item.sourceKey.split(':')[1] ?? '')}`}>Открыть перемещение →</Link> : item.type === 'LARGE_RETURN' && item.storeId ? <Link href={`/sales?storeId=${encodeURIComponent(item.storeId)}&saleId=${encodeURIComponent(item.sourceKey.split(':')[3] ?? '')}`}>Открыть чек →</Link> : item.type === 'LARGE_DISCOUNT' && item.storeId ? <Link href={`/sales?storeId=${encodeURIComponent(item.storeId)}&saleId=${encodeURIComponent(item.sourceKey.split(':')[1] ?? '')}`}>Открыть чек →</Link> : item.storeId && <Link href={`/stock?filter=low&storeId=${encodeURIComponent(item.storeId)}`}>Открыть остатки →</Link>}{!item.readAt && <button disabled={busy} onClick={() => markRead(item.id)}>Отметить прочитанным</button>}</div></div>{!item.readAt && <span className="crm-notification-unread" aria-label="Не прочитано" />}</article>)}</div> : <div className="crm-notification-empty">{unreadOnly ? 'Все уведомления прочитаны.' : 'Пока нет уведомлений. Когда изменятся остатки, статус перемещения или появится крупная скидка или возврат, сообщение появится здесь.'}</div>}
    {total > 20 && <div className="crm-products-footer"><span>Показано {items.length} из {total}</span><div><button disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Назад</button><span>Страница {page}</span><button disabled={page * 20 >= total || loading} onClick={() => setPage(value => value + 1)}>Далее</button></div></div>}
  </section></CatalogShell>;
}
