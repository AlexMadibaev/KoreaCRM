import { apiBase } from './api-base';

type Tokens = { accessToken: string; refreshToken: string };
const refreshKey = 'koreacrm.refreshToken';
let pendingRefresh: Promise<string | null> | null = null;

function refreshStorage() {
  if (localStorage.getItem(refreshKey)) return localStorage;
  return sessionStorage;
}

export function saveSession(tokens: Tokens, remember: boolean) {
  sessionStorage.setItem('accessToken', tokens.accessToken);
  localStorage.removeItem(refreshKey);
  sessionStorage.removeItem(refreshKey);
  (remember ? localStorage : sessionStorage).setItem(refreshKey, tokens.refreshToken);
}

export function clearSession() {
  sessionStorage.removeItem('accessToken');
  sessionStorage.removeItem(refreshKey);
  localStorage.removeItem(refreshKey);
}

export function getRefreshToken() {
  return localStorage.getItem(refreshKey) ?? sessionStorage.getItem(refreshKey);
}

export function accessToken() {
  return sessionStorage.getItem('accessToken');
}

export async function refreshAccessToken(): Promise<string | null> {
  if (pendingRefresh) return pendingRefresh;
  const oldToken = getRefreshToken();
  if (!oldToken) return null;
  pendingRefresh = (async () => {
    const storage = refreshStorage();
    const response = await fetch(`${apiBase}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: oldToken }),
      cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 401) clearSession();
      if (response.status === 401) return null;
      throw new Error(`Не удалось восстановить вход: ${response.status}`);
    }
    const tokens = await response.json() as Tokens;
    sessionStorage.setItem('accessToken', tokens.accessToken);
    storage.setItem(refreshKey, tokens.refreshToken);
    return tokens.accessToken;
  })().finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}

export async function ensureAccessToken() {
  return accessToken() ?? refreshAccessToken();
}

export async function logoutSession() {
  const refreshToken = getRefreshToken();
  clearSession();
  if (!refreshToken) return;
  await fetch(`${apiBase}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  }).catch(() => undefined);
}
