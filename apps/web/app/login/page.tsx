'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { firstCabinetPath } from '../../lib/access';
import { clearSession, saveSession } from '../../lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const tokens = await api<{ accessToken: string; refreshToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
      saveSession(tokens, remember);
      const me = await api<{ permissions: string[] }>('/auth/me');
      router.push(firstCabinetPath(me.permissions));
    } catch (caught) { clearSession(); setError(caught instanceof Error ? caught.message : 'Не удалось войти'); }
    finally { setLoading(false); }
  }
  return <main className="crm-login-page"><div className="crm-login-art"><div className="crm-login-logo"><span className="crm-brand-mark">K</span> Korea CRM</div><div className="crm-login-art-copy"><span className="crm-eyebrow">ОДНО ПРОСТРАНСТВО ДЛЯ БИЗНЕСА</span><h1>Управлять магазином стало проще.</h1><p>Товары, продажи, остатки и финансы — всё под рукой.</p></div><div className="crm-login-art-bottom">Korea CRM · Управление магазином</div></div><div className="crm-login-form-wrap"><form onSubmit={submit} className="crm-login-form"><span className="crm-eyebrow">ДОБРО ПОЖАЛОВАТЬ</span><h2>Вход в кабинет</h2><p>Введите данные учётной записи, чтобы продолжить.</p><label>Логин<input value={login} onChange={event => setLogin(event.target.value)} required autoComplete="username" placeholder="Ваш логин" /></label><label>Пароль<input value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password" type="password" placeholder="Введите пароль" /></label><label className="crm-remember"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /><span>Оставаться в системе на этом устройстве</span></label>{error && <div className="crm-alert" role="alert">{error}</div>}<button disabled={loading} type="submit">{loading ? 'Входим…' : 'Войти в кабинет →'}</button><small>Доступ предоставляется администратором магазина.</small></form></div></main>;
}
