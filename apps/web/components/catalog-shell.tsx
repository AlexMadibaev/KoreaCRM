'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { firstCabinetPath, routePermission } from '../lib/access';
import { accessToken, ensureAccessToken } from '../lib/session';

type Me = { name: string; login: string; role: string; permissions: string[] };
const groups: { title: string; links: [string, string][] }[] = [
  { title: 'Рабочее пространство', links: [['/dashboard', 'Обзор'], ['/products', 'Товары'], ['/stock', 'Остатки'], ['/sales', 'Продажи'], ['/customers', 'Клиенты'], ['/notifications', 'Уведомления']] },
  { title: 'Управление', links: [['/brands', 'Бренды'], ['/categories', 'Категории'], ['/suppliers', 'Поставщики'], ['/purchases', 'Закупки'], ['/transfers', 'Перемещения'], ['/inventories', 'Инвентаризация'], ['/employees', 'Сотрудники и роли']] },
  { title: 'Аналитика', links: [['/finance', 'Финансы'], ['/finance/categories', 'Категории расходов']] },
];

export function CatalogShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    ensureAccessToken().then(token => {
      if (!token) { router.replace('/login'); return; }
      return api<Me>('/auth/me').then(profile => { setMe(profile); setReady(true); });
    }).catch(() => { router.replace(accessToken() ? '/offline' : '/login'); });
  }, [router]);
  useEffect(() => {
    if (!(me?.permissions.includes('inventory.view') || me?.permissions.includes('sales.view'))) return;
    const refresh = () => { api<{ unreadCount: number }>('/notifications/summary').then(result => setUnreadCount(result.unreadCount)).catch(() => undefined); };
    refresh();
    window.addEventListener('koreacrm:notifications-changed', refresh);
    return () => window.removeEventListener('koreacrm:notifications-changed', refresh);
  }, [me]);
  if (!ready) return <div className="crm-loading">Проверка доступа…</div>;
  const current = [...groups.flatMap(group => group.links), ['/account', 'Личный кабинет']].find(([href]) => pathname === href)?.[1] ?? 'Korea CRM';
  return <div className="crm-shell">
    <aside className={`crm-sidebar ${menuOpen ? 'crm-sidebar-open' : ''}`}>
      <Link href={firstCabinetPath(me?.permissions ?? [])} className="crm-brand" onClick={() => setMenuOpen(false)}><span className="crm-brand-mark">K</span><span><strong>Korea CRM</strong><small>Управление магазином</small></span></Link>
      <div className="crm-workspace"><span className="crm-workspace-icon">✦</span><span><strong>Мой магазин</strong><small>Рабочее пространство</small></span></div>
      <nav aria-label="Основная навигация">{groups.map(group => { const links = group.links.filter(([href]) => { if (href === '/notifications') return me?.permissions.includes('inventory.view') || me?.permissions.includes('sales.view'); const required = routePermission[href]; return required && me?.permissions.includes(required); }); return links.length ? <div className="crm-nav-group" key={group.title}><div className="crm-nav-title">{group.title}</div>{links.map(([href, label]) => <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={`crm-nav-link ${pathname === href ? 'active' : ''}`}>{label}</Link>)}</div> : null; })}</nav>
      <Link href="/account" className={`crm-sidebar-account ${pathname === '/account' ? 'active' : ''}`} onClick={() => setMenuOpen(false)}><span className="crm-avatar">{(me?.name || 'П').slice(0, 1).toUpperCase()}</span><span><strong>{me?.name || 'Профиль'}</strong><small>Личный кабинет</small></span><span aria-hidden="true">›</span></Link>
    </aside>
    {menuOpen && <button className="crm-backdrop" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />}
    <div className="crm-content"><header className="crm-topbar"><button className="crm-menu-button" aria-label="Открыть меню" onClick={() => setMenuOpen(true)}>☰</button><div><small>Рабочее пространство /</small><strong>{current}</strong></div><div className="crm-topbar-actions"><span className="crm-online-dot" /> <span className="crm-status">Система работает</span>{(me?.permissions.includes('inventory.view') || me?.permissions.includes('sales.view')) && <Link href="/notifications" className="crm-notification-link" aria-label={`Уведомления${unreadCount ? `, непрочитанных: ${unreadCount}` : ''}`}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>{unreadCount > 0 && <span>{unreadCount > 9 ? '9+' : unreadCount}</span>}</Link>}<Link href="/account" className="crm-topbar-avatar" aria-label="Личный кабинет">{(me?.name || 'П').slice(0, 1).toUpperCase()}</Link></div></header><main className="crm-main">{children}</main></div>
  </div>;
}
