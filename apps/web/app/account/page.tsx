'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CatalogShell } from '../../components/catalog-shell';
import { api } from '../../lib/api';
import { logoutSession } from '../../lib/session';

type Me = { userId: string; login: string; name: string; role: string; permissions: string[]; allStores: boolean; storeIds: string[] };
type Store = { id: string; name: string; code: string };
const roleName: Record<string, string> = { OWNER: 'Владелец', ADMIN: 'Администратор', MANAGER: 'Менеджер', CASHIER: 'Кассир' };

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { Promise.all([api<Me>('/auth/me'), api<Store[]>('/stores')]).then(([profile, locations]) => { setMe(profile); setStores(locations); }).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить профиль')); }, []);
  async function logout() { await logoutSession(); router.replace('/login'); }
  return <CatalogShell><div className="crm-page-head"><div><span className="crm-eyebrow">НАСТРОЙКИ АККАУНТА</span><h1>Личный кабинет</h1><p>Ваш профиль и доступ к магазинам.</p></div></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    <div className="crm-profile-grid"><section className="crm-panel crm-profile-card"><div className="crm-profile-banner" /><div className="crm-profile-body"><div className="crm-profile-avatar">{(me?.name || 'П').slice(0, 1).toUpperCase()}</div><span className="crm-role-pill">{me ? (roleName[me.role] || me.role) : 'Загрузка…'}</span><h2>{me?.name || 'Загрузка профиля…'}</h2><p>@{me?.login || '—'}</p><div className="crm-profile-divider" /><div className="crm-profile-stat"><span>Уровень доступа</span><strong>{me?.allStores ? 'Все магазины' : `${me?.storeIds?.length ?? 0} магазинов`}</strong></div><div className="crm-profile-stat"><span>Разрешений</span><strong>{me?.permissions?.length ?? '—'}</strong></div><button className="crm-signout" onClick={logout}>Выйти из аккаунта →</button></div></section><section className="crm-panel crm-account-details"><div className="crm-panel-heading"><div><span className="crm-eyebrow">ВАШИ ДАННЫЕ</span><h2>Информация о профиле</h2></div></div><div className="crm-detail-row"><span>Имя сотрудника</span><strong>{me?.name || '—'}</strong></div><div className="crm-detail-row"><span>Логин</span><strong>{me?.login || '—'}</strong></div><div className="crm-detail-row"><span>Роль</span><strong>{me ? (roleName[me.role] || me.role) : '—'}</strong></div><div className="crm-detail-row"><span>Доступные магазины</span><strong>{me?.allStores ? 'Все магазины' : 'По назначению'}</strong></div><div className="crm-stores-title">Магазины</div><div className="crm-store-list">{stores.length ? stores.map(store => <div className="crm-store-item" key={store.id}><span className="crm-store-icon">⌂</span><span><strong>{store.name}</strong><small>{store.code}</small></span><span className="crm-store-access">Доступен</span></div>) : <p>Магазины не найдены.</p>}</div><p className="crm-panel-note">Изменение роли и доступа выполняется администратором.</p></section></div>
  </CatalogShell>;
}
