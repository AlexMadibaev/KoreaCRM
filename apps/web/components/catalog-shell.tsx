'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { firstCabinetPath, routePermission } from '../lib/access';
import { accessToken, ensureAccessToken } from '../lib/session';

type Me = { name: string; login: string; role: string; permissions: string[] };
const groups: { title: string; links: [string, string][] }[] = [
  { title: 'Рабочее пространство', links: [['/dashboard', 'Обзор'], ['/products', 'Товары'], ['/stock', 'Остатки'], ['/sales', 'Продажи'], ['/customers', 'Клиенты'], ['/notifications', 'Уведомления']] },
  { title: 'Управление', links: [['/brands', 'Бренды'], ['/categories', 'Категории'], ['/suppliers', 'Поставщики'], ['/purchases', 'Закупки'], ['/transfers', 'Перемещения'], ['/inventories', 'Инвентаризация'], ['/loyalty', 'Лояльность'], ['/employees', 'Сотрудники и роли']] },
  { title: 'Аналитика', links: [['/finance', 'Финансы'], ['/finance/categories', 'Категории расходов']] },
];
const navIcons: Record<string, ReactNode> = {
  '/dashboard': <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  '/products': <><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9M7.5 5.25l9 4.5"/></>,
  '/stock': <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18M9 15h6M7 2h10"/></>,
  '/sales': <><path d="M6 3h12a2 2 0 0 1 2 2v16l-3-2-3 2-3-2-3 2-3-2V5a2 2 0 0 1 2-2Z"/><path d="M9 8h7M9 12h7M9 16h3"/></>,
  '/customers': <><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M17 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1"/></>,
  '/notifications': <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/><circle cx="18" cy="5" r="2" fill="currentColor" stroke="none"/></>,
  '/brands': <><path d="M3 11V5a2 2 0 0 1 2-2h6l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1.2"/></>,
  '/categories': <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="m17.5 13.5 4 4-4 4-4-4z"/></>,
  '/suppliers': <><path d="M3 7h11v11H3zM14 10h4l3 4v4h-7M3 18h2M12 18h3"/><circle cx="8" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 10h5M6 13h4"/></>,
  '/purchases': <><path d="M4 8h16l-1 13H5L4 8ZM8 9V6a4 4 0 0 1 8 0v3"/><path d="M12 12v6m-2-2 2 2 2-2"/></>,
  '/transfers': <><path d="M4 7h15l-3-3M19 7l-3 3M20 17H5l3-3M5 17l3 3"/><path d="M4 11v2M20 11v2"/></>,
  '/inventories': <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h3"/><path d="m6.5 10 .7.7 1.3-1.4"/></>,
  '/loyalty': <><path d="M4 7h16v4c-2 0-2 2 0 2v4H4v-4c2 0 2-2 0-2V7Z"/><path d="m10 10 4 4m0-4-4 4"/></>,
  '/employees': <><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 8-5.66"/><circle cx="17" cy="16" r="4"/><path d="M17 14v4M15 16h4"/></>,
  '/finance': <><path d="M3 19h18M5 16V9M10 16V5M15 16v-4M20 16V7"/><path d="m4 7 6-4 5 6 5-4"/></>,
  '/finance/categories': <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M7 15h4M16 14h2M17 13v4"/></>,
};

// Every page mounts its own shell; reusing the last profile for the same token avoids an access-check screen on each navigation.
let cachedProfile: { token: string; me: Me } | null = null;
const cachedMe = () => { const token = typeof window === 'undefined' ? null : accessToken(); return token && cachedProfile?.token === token ? cachedProfile.me : null; };

function NavIcon({ href }: { href: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">{navIcons[href]}</svg>;
}

export function CatalogShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // The cache is empty on a full page load, so the server render and hydration still agree.
  const [me, setMe] = useState<Me | null>(cachedMe);
  const [ready, setReady] = useState(() => cachedMe() !== null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    ensureAccessToken().then(token => {
      if (!token) { cachedProfile = null; router.replace('/login'); return; }
      return api<Me>('/auth/me').then(profile => { cachedProfile = { token: accessToken() ?? token, me: profile }; setMe(profile); setReady(true); });
    }).catch(() => { cachedProfile = null; router.replace(accessToken() ? '/offline' : '/login'); });
  }, [router]);
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!(me?.permissions.includes('inventory.view') || me?.permissions.includes('sales.view'))) return;
    const refresh = () => { api<{ unreadCount: number }>('/notifications/summary').then(result => setUnreadCount(result.unreadCount)).catch(() => undefined); };
    refresh();
    window.addEventListener('koreacrm:notifications-changed', refresh);
    return () => window.removeEventListener('koreacrm:notifications-changed', refresh);
  }, [me]);
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.querySelector<HTMLAnchorElement>('#crm-navigation a')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);
  if (!ready) return <div className="crm-loading">Проверка доступа…</div>;
  const current = pathname.startsWith('/products/') ? 'Товары' : [...groups.flatMap(group => group.links), ['/account', 'Личный кабинет']].find(([href]) => pathname === href)?.[1] ?? 'Korea CRM';
  return <div className="crm-shell">
    <aside id="crm-navigation" className={`crm-sidebar ${menuOpen ? 'crm-sidebar-open' : ''}`}>
      <Link href={firstCabinetPath(me?.permissions ?? [])} className="crm-brand" onClick={() => setMenuOpen(false)}><span><Image className="crm-brand-logo" src="/koreacrm-logo.svg" alt="Korea CRM" width={163} height={26} /><small>Управление магазином</small></span></Link>
      <nav aria-label="Основная навигация">{groups.map(group => { const links = group.links.filter(([href]) => { if (href === '/notifications') return me?.permissions.includes('inventory.view') || me?.permissions.includes('sales.view'); const required = routePermission[href]; return required && me?.permissions.includes(required); }); return links.length ? <div className="crm-nav-group" key={group.title}><div className="crm-nav-title">{group.title}</div>{links.map(([href, label]) => <Link key={href} href={href} onClick={() => setMenuOpen(false)} aria-current={pathname === href ? 'page' : undefined} className={`crm-nav-link ${pathname === href ? 'active' : ''}`}><span className="crm-nav-icon"><NavIcon href={href} /></span>{label}</Link>)}</div> : null; })}</nav>
      <Link href="/account" className={`crm-sidebar-account ${pathname === '/account' ? 'active' : ''}`} onClick={() => setMenuOpen(false)}><span className="crm-avatar">{(me?.name || 'П').slice(0, 1).toUpperCase()}</span><span><strong>{me?.name || 'Профиль'}</strong><small>Личный кабинет</small></span><span aria-hidden="true">›</span></Link>
    </aside>
    {menuOpen && <button className="crm-backdrop" aria-label="Закрыть меню" onClick={() => { setMenuOpen(false); menuButtonRef.current?.focus(); }} />}
    <div className="crm-content"><header className="crm-topbar"><button ref={menuButtonRef} type="button" className="crm-menu-button" aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={menuOpen} aria-controls="crm-navigation" onClick={() => setMenuOpen(value => !value)}>☰</button><div><small>Рабочее пространство /</small><strong>{current}</strong></div><div className="crm-topbar-actions"><span className="crm-online-dot" /> <span className="crm-status">Система работает</span>{(me?.permissions.includes('inventory.view') || me?.permissions.includes('sales.view')) && <Link href="/notifications" className="crm-notification-link" aria-label={`Уведомления${unreadCount ? `, непрочитанных: ${unreadCount}` : ''}`}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>{unreadCount > 0 && <span>{unreadCount > 9 ? '9+' : unreadCount}</span>}</Link>}<Link href="/account" className="crm-topbar-avatar" aria-label="Личный кабинет">{(me?.name || 'П').slice(0, 1).toUpperCase()}</Link></div></header><main className="crm-main">{children}</main></div>
  </div>;
}
