'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '../../lib/api';
import { firstCabinetPath } from '../../lib/access';
import { clearSession, saveSession } from '../../lib/session';

const studioUrl = 'https://www.madibaevstudio.online/';

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);
  const [showSignup, setShowSignup] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setPasswordVisible(false); setLoading(true); setError('');
    try {
      const tokens = await api<{ accessToken: string; refreshToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
      saveSession(tokens, remember);
      const me = await api<{ permissions: string[] }>('/auth/me');
      router.push(firstCabinetPath(me.permissions));
    } catch (caught) { clearSession(); setError(caught instanceof Error ? caught.message : 'Не удалось войти'); }
    finally { setLoading(false); }
  }

  return <main className="crm-login-page">
    <div className="crm-login-art">
      <div className="crm-login-logo"><Image src="/icons/app-icon.svg" alt="" width={56} height={56} /></div>
      <div className="crm-login-art-copy">
        <span className="crm-eyebrow">KOREA CRM</span>
        <h1>Магазин под контролем.</h1>
      </div>
      <div className="crm-login-illustration"><Image src="/login-boutique-v2.png" alt="Продавец за кассой магазина" width={640} height={427} priority /></div>
    </div>
    <div className="crm-login-form-wrap">
      <div className="crm-login-card">
        <div className="crm-login-card-head">
          <Image className="crm-login-form-logo" src="/koreacrm-logo.svg" alt="Korea Secret" width={171} height={33} />
          <span className="crm-login-welcome">Добро пожаловать</span>
          <h2>{showSignup ? 'Начните с нами' : 'Вход в кабинет'}</h2>
          <p>{showSignup ? 'Чтобы подключить магазин, оставьте заявку на сайте Madibaev Studio.' : 'Введите данные своей учётной записи, чтобы продолжить работу.'}</p>
        </div>
        {showSignup ? <div className="crm-signup-offer">
          <div className="crm-signup-offer-icon"><Image src="/icons/app-icon.svg" alt="" width={58} height={58} /></div>
          <h3>Хотите подключить Korea CRM?</h3>
          <p>Перейдите на сайт Madibaev Studio. Там вы сможете связаться с нами и обсудить подключение.</p>
          <a href={studioUrl} target="_blank" rel="noopener noreferrer" className="crm-login-submit">Перейти на сайт <span aria-hidden="true">↗</span></a>
          <button type="button" className="ks-button ks-button--ghost ks-button--sm crm-login-back" onClick={() => setShowSignup(false)}>Вернуться ко входу</button>
        </div> : <form onSubmit={submit} className="crm-login-form">
          <label>Логин<input value={login} onChange={event => setLogin(event.target.value)} required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" placeholder="Ваш логин" /></label>
          <div>
            <label htmlFor="crm-login-password">Пароль</label>
            <div className="crm-login-password-field">
              <input id="crm-login-password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password" autoCapitalize="none" spellCheck={false} type={passwordVisible ? 'text' : 'password'} enterKeyHint="go" placeholder="Введите пароль" />
              <button className="ks-control" type="button" aria-controls="crm-login-password" aria-label={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'} onClick={() => setPasswordVisible(visible => !visible)}>
                {passwordVisible ? <EyeOff size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
              </button>
            </div>
          </div>
          <label className="crm-remember"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /><span>Оставаться в системе на этом устройстве</span></label>
          {error && <div className="crm-alert" role="alert">{error}</div>}
          <button disabled={loading} type="submit" className="ks-button ks-button--primary crm-login-submit">{loading ? 'Входим…' : 'Войти в кабинет'} <span aria-hidden="true">→</span></button>
        </form>}
        {showSignup
          ? <div className="crm-login-switch">Уже есть аккаунт? <button className="ks-button ks-button--secondary" type="button" onClick={() => setShowSignup(false)}>Войти</button></div>
          : <button type="button" className="ks-button ks-button--secondary crm-login-signup-button" onClick={() => { setShowSignup(true); setPasswordVisible(false); setError(''); }}>Sign up <span>Подключить магазин ↗</span></button>}
      </div>
    </div>
  </main>;
}
