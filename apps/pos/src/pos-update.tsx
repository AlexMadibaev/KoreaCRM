import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { hasDesktopCache } from './local-cache';

const checkInterval = 15 * 60 * 1000;

export function usePosUpdate(blocked: boolean) {
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const installStarted = useRef(false);
  const pendingCheck = useRef<Promise<string | null> | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<'current' | 'failed' | null>(null);
  const available = hasDesktopCache();

  const check = useCallback(async (manual = false) => {
    if (!available || installStarted.current) return;
    if (manual) {
      setChecking(true);
      setCheckResult(null);
      setError('');
    }
    pendingCheck.current ??= invoke<string | null>('check_pos_update').finally(() => { pendingCheck.current = null; });
    try {
      const result = await pendingCheck.current;
      if (!installStarted.current) setVersion(result);
      if (manual) setCheckResult(result ? null : 'current');
    } catch {
      if (manual) setCheckResult('failed');
    } finally {
      if (manual) setChecking(false);
    }
  }, [available]);

  useEffect(() => {
    if (!available) return;
    const backgroundCheck = () => void check();
    backgroundCheck();
    const timer = window.setInterval(backgroundCheck, checkInterval);
    window.addEventListener('online', backgroundCheck);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', backgroundCheck);
    };
  }, [available, check]);

  async function install() {
    if (!version || blocked || installStarted.current) return;
    installStarted.current = true;
    setInstalling(true);
    setError('');
    try {
      await invoke('install_pos_update', { version });
    } catch {
      installStarted.current = false;
      setInstalling(false);
      setError('Не удалось установить обновление. Проверьте подключение и попробуйте ещё раз.');
    }
  }

  const notification = version && version !== dismissed && (
    <section className="pos-update-toast" aria-label="Обновление кассы">
      <div role="status">
        <strong>Доступна новая версия кассы {version}</strong>
        <div>{installing ? 'Скачиваем обновление. Касса закроется для установки.' : blocked ? 'Завершите текущую операцию, чтобы обновить кассу.' : 'Касса закроется на время установки.'}</div>
      </div>
      {error && <div role="alert">{error}</div>}
      <div className="pos-update-actions">
        <button type="button" disabled={blocked || installing} onClick={() => void install()}>Обновить</button>
        <button type="button" disabled={installing} onClick={() => { setDismissed(version); setError(''); }}>Закрыть</button>
      </div>
    </section>
  );

  return { available, blocked, checking, check, checkResult, error, install, installing, notification, version };
}
