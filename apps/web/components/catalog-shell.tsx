'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { firstCabinetPath } from '../lib/access';
import { accessToken, ensureAccessToken } from '../lib/session';

import { cabinetGroups, cabinetLinkActive, createLinks, visibleCabinetLinks } from '../lib/cabinet-navigation';
import { ArrowLeftRight, Bell, Building2, ChevronDown, Download, LayoutDashboard, Menu, Package, Plus, ReceiptText, Users, Wallet, X } from 'lucide-react';

const groupIcons: Record<string, ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = { overview: LayoutDashboard, catalog: Package, tills: ReceiptText, movement: ArrowLeftRight, money: Wallet, people: Users, company: Building2 };

type Me = { name: string; login: string; role: string; permissions: string[] };
// Every page mounts its own shell; reusing the last profile for the same token avoids an access-check screen on each navigation.
let cachedProfile: { token: string; me: Me } | null = null;
const cachedMe = () => { const token = typeof window === 'undefined' ? null : accessToken(); return token && cachedProfile?.token === token ? cachedProfile.me : null; };

export function CatalogShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // The cache is empty on a full page load, so the server render and hydration still agree.
  const [me, setMe] = useState<Me | null>(cachedMe);
  const [ready, setReady] = useState(() => cachedMe() !== null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hash, setHash] = useState('');
  const createRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update(); window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, [pathname]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && createRef.current?.open) { createRef.current.open = false; createRef.current.querySelector('summary')?.focus(); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
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
      if (event.key === 'Tab') {
        const elements = Array.from(document.querySelectorAll<HTMLElement>('#crm-navigation a, #crm-navigation summary, #crm-navigation button')).filter(element => element.getClientRects().length > 0);
        const first = elements[0]; const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === 'Escape') {
        setMenuOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);
  if (!ready) return <div className="crm-loading">Проверка доступа…</div>;
  const permissions = me?.permissions ?? [];
  const role = me?.role ?? '';
  const visibleGroups = cabinetGroups.map(group => ({ ...group, links: visibleCabinetLinks(group.links, permissions, role) })).filter(group => group.links.length);
  const currentGroup = visibleGroups.find(group => group.links.some(link => cabinetLinkActive(link.href, pathname, hash)));
  const current = currentGroup?.links.find(link => cabinetLinkActive(link.href, pathname, hash))?.label ?? (pathname === '/account' ? 'Личный кабинет' : pathname === '/notifications' ? 'Уведомления' : 'Korea CRM');
  const actions = visibleCabinetLinks(createLinks, permissions, role);
  const followLink = (href: string) => { setMenuOpen(false); setHash(href.includes('#') ? `#${href.split('#')[1]}` : ''); if (createRef.current) createRef.current.open = false; };
  return <div className="crm-shell">
    <a href="#cabinet-content" className="crm-skip-link">Перейти к содержимому</a>
    <aside id="crm-navigation" className={`crm-sidebar ${menuOpen ? 'crm-sidebar-open' : ''}`}>
      <Link href={firstCabinetPath(permissions)} className="crm-brand" onClick={() => setMenuOpen(false)}><Image className="crm-brand-logo" src="/koreacrm-logo.svg" alt="Korea CRM" width={163} height={26} /></Link>
      {actions.length > 0 && <details ref={createRef} className="crm-create-menu"><summary><Plus size={17} aria-hidden />Создать документ<ChevronDown size={14} aria-hidden /></summary><div>{actions.map(action => <Link key={action.href} href={action.href} onClick={() => followLink(action.href)}>{action.label}</Link>)}</div></details>}
      <nav aria-label="Основная навигация">{visibleGroups.map(group => {
        const Icon = groupIcons[group.icon] ?? Package;
        if (group.links.length === 1) { const link = group.links[0]!; const active = cabinetLinkActive(link.href, pathname, hash); return <Link key={group.title} href={link.href} onClick={() => followLink(link.href)} aria-current={active ? 'page' : undefined} className={`crm-nav-link crm-nav-primary ${active ? 'active' : ''}`}><Icon size={18} aria-hidden />{group.title}</Link>; }
        return <details className="crm-nav-section" key={`${group.title}:${pathname}:${hash}`} open={group.links.some(link => cabinetLinkActive(link.href, pathname, hash))}><summary><Icon size={18} aria-hidden /><span>{group.title}</span><ChevronDown size={14} aria-hidden /></summary><div>{group.links.map(link => { const active = cabinetLinkActive(link.href, pathname, hash); return <Link key={link.href} href={link.href} onClick={() => followLink(link.href)} aria-current={active ? 'page' : undefined} className={`crm-nav-link ${active ? 'active' : ''}`}>{link.label}</Link>; })}</div></details>;
      })}</nav>
      <Link href="/account" className={`crm-sidebar-account ${pathname === '/account' ? 'active' : ''}`} onClick={() => setMenuOpen(false)}><span className="crm-avatar">{(me?.name || 'П').slice(0, 1).toUpperCase()}</span><span><strong>{me?.name || 'Профиль'}</strong><small>Личный кабинет</small></span></Link>
    </aside>
    {menuOpen && <button className="crm-backdrop" aria-label="Закрыть меню" onClick={() => { setMenuOpen(false); requestAnimationFrame(() => menuButtonRef.current?.focus()); }} />}
    <div className="crm-content" inert={menuOpen}><header className="crm-topbar"><button ref={menuButtonRef} type="button" className="crm-menu-button" aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menuOpen} aria-controls="crm-navigation" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button><div className="crm-breadcrumb">{currentGroup?.title !== current && <small>{currentGroup?.title ?? 'Korea CRM'} /</small>}<strong>{current}</strong></div><div className="crm-topbar-actions"><a href="https://github.com/AlexMadibaev/KoreaCRM/releases/download/v0.2.6-pos/KoreaCRM-POS-0.2.6-setup.exe" className="crm-pos-download" aria-label="Скачать кассу для Windows"><Download size={16} aria-hidden /><span>Скачать кассу</span></a>{(permissions.includes('inventory.view') || permissions.includes('sales.view')) && <Link href="/notifications" className="crm-notification-link" aria-label={`Уведомления${unreadCount ? `, непрочитанных: ${unreadCount}` : ''}`}><Bell size={19} aria-hidden />{unreadCount > 0 && <span>{unreadCount > 9 ? '9+' : unreadCount}</span>}</Link>}<Link href="/account" className="crm-topbar-avatar" aria-label="Личный кабинет">{(me?.name || 'П').slice(0, 1).toUpperCase()}</Link></div></header><main id="cabinet-content" tabIndex={-1} className="crm-main">{children}</main></div>
  </div>;
}
