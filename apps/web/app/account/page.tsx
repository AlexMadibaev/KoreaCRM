'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CatalogShell } from '../../components/catalog-shell';
import { api } from '../../lib/api';
import { ensureAccessToken, logoutSession, refreshAccessToken } from '../../lib/session';

type Me = { userId: string; login: string; name: string; role: string; permissions: string[]; allStores: boolean; storeIds: string[] };
type Store = { id: string; name: string; code: string };
type BackupStatus = { available: boolean; running: boolean; pending: number; lastCreatedAt: string | null; serverConfigured: boolean };
const roleName: Record<string, string> = { OWNER: 'Владелец', ADMIN: 'Администратор', MANAGER: 'Менеджер', CASHIER: 'Кассир' };

async function localBackup(method: 'GET' | 'POST'): Promise<BackupStatus> {
  const request = (token: string | null) => fetch('/local-backup', {
    method, headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store',
  });
  let response = await request(await ensureAccessToken());
  if (response.status === 401) response = await request(await refreshAccessToken());
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || 'Не удалось получить состояние резервных копий.');
  }
  return response.json() as Promise<BackupStatus>;
}

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [error, setError] = useState('');
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [backupError, setBackupError] = useState('');
  useEffect(() => {
    api<Me>('/auth/me').then(profile => {
      setMe(profile);
      if (profile.role === 'OWNER') localBackup('GET').then(setBackup).catch(() => undefined);
      if (profile.permissions.some(permission => ['inventory.view', 'employees.view', 'sales.view'].includes(permission))) {
        api<Store[]>('/stores').then(setStores).catch(() => setStores([]));
      }
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить профиль'));
  }, []);
  async function logout() { await logoutSession(); router.replace('/login'); }
  async function createBackup() {
    setBackupBusy(true); setBackupMessage(''); setBackupError('');
    try {
      const result = await localBackup('POST');
      setBackup(result);
      setBackupMessage(result.serverConfigured && result.pending === 0
        ? 'Копия отправлена на сервер и проверена. Локальный архив очищен.'
        : 'Копия создана и сохранена на этом компьютере. Она будет отправлена после подключения сервера.');
    } catch (reason) {
      setBackupError(reason instanceof Error ? reason.message : 'Не удалось создать резервную копию.');
      localBackup('GET').then(setBackup).catch(() => undefined);
    } finally { setBackupBusy(false); }
  }
  return <CatalogShell><div className="crm-page-head"><div><span className="crm-eyebrow">НАСТРОЙКИ АККАУНТА</span><h1>Личный кабинет</h1><p>Ваш профиль и доступ к магазинам.</p></div></div>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    <div className="crm-profile-grid"><section className="crm-panel crm-profile-card"><div className="crm-profile-banner" /><div className="crm-profile-body"><div className="crm-profile-avatar">{(me?.name || 'П').slice(0, 1).toUpperCase()}</div><span className="crm-role-pill">{me ? (roleName[me.role] || me.role) : 'Загрузка…'}</span><h2>{me?.name || 'Загрузка профиля…'}</h2><p>@{me?.login || '—'}</p><div className="crm-profile-divider" /><div className="crm-profile-stat"><span>Уровень доступа</span><strong>{me?.allStores ? 'Все магазины' : `${me?.storeIds?.length ?? 0} магазинов`}</strong></div><div className="crm-profile-stat"><span>Разрешений</span><strong>{me?.permissions?.length ?? '—'}</strong></div><button className="crm-signout" onClick={logout}>Выйти из аккаунта →</button></div></section><section className="crm-panel crm-account-details"><div className="crm-panel-heading"><div><span className="crm-eyebrow">ВАШИ ДАННЫЕ</span><h2>Информация о профиле</h2></div></div><div className="crm-detail-row"><span>Имя сотрудника</span><strong>{me?.name || '—'}</strong></div><div className="crm-detail-row"><span>Логин</span><strong>{me?.login || '—'}</strong></div><div className="crm-detail-row"><span>Роль</span><strong>{me ? (roleName[me.role] || me.role) : '—'}</strong></div><div className="crm-detail-row"><span>Доступные магазины</span><strong>{me?.allStores ? 'Все магазины' : 'По назначению'}</strong></div><div className="crm-stores-title">Магазины</div><div className="crm-store-list">{stores.length ? stores.map(store => <div className="crm-store-item" key={store.id}><span className="crm-store-icon">⌂</span><span><strong>{store.name}</strong><small>{store.code}</small></span><span className="crm-store-access">Доступен</span></div>) : <p>Магазины не найдены.</p>}</div><p className="crm-panel-note">Изменение роли и доступа выполняется администратором.</p></section></div>
    {me?.role === 'OWNER' && backup?.available && <section className="crm-panel crm-backup-panel" aria-labelledby="backup-title"><div><span className="crm-eyebrow">СОХРАННОСТЬ ДАННЫХ</span><h2 id="backup-title">Резервные копии</h2><p>Копия создаётся автоматически каждое воскресенье в 23:00. Вы можете запустить её сейчас.</p><p className="crm-backup-state">{backup.serverConfigured ? backup.pending ? `Ожидают отправки: ${backup.pending}` : 'Все созданные копии отправлены' : 'Сервер для копий пока не подключён. Архив сохранится на этом компьютере.'}</p>{backup.lastCreatedAt && <small>Последняя локальная копия: {new Date(backup.lastCreatedAt).toLocaleString('ru-RU')}</small>}</div><div className="crm-backup-action"><button className="crm-primary-button" type="button" onClick={createBackup} disabled={backupBusy || backup.running}>{backupBusy || backup.running ? 'Создаём копию…' : backup.serverConfigured ? 'Создать и отправить' : 'Создать копию сейчас'}</button>{backupMessage && <p role="status">{backupMessage}</p>}{backupError && <p className="crm-backup-error" role="alert">{backupError}</p>}</div></section>}
  </CatalogShell>;
}
