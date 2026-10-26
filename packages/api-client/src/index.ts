import type { HealthStatus } from '@koreacrm/types';

function endpoint(baseUrl: string, path: string): URL {
  return new URL(`${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
}

export async function getHealth(baseUrl: string): Promise<HealthStatus> {
  const response = await fetch(endpoint(baseUrl, '/health'));
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return (await response.json()) as HealthStatus;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function createApiClient(baseUrl: string, deviceId: string) {
  let accessToken = '';
  let refreshToken = '';
  let refreshing: Promise<void> | null = null;
  async function raw<T>(path: string, body?: unknown, method = 'GET', authorized = true): Promise<T> {
    const response = await fetch(endpoint(baseUrl, path), { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(authorized && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
      const result: unknown = await response.json().catch(() => null);
      const message = result && typeof result === 'object' && 'message' in result && typeof result.message === 'string' ? result.message : `API returned ${response.status}`;
      throw new ApiError(response.status, message);
    }
    return response.json() as Promise<T>;
  }
  async function refresh() {
    if (!refreshToken) throw new ApiError(401, 'Session expired');
    refreshing ??= raw<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken, deviceId }, 'POST', false).then(tokens => { accessToken = tokens.accessToken; refreshToken = tokens.refreshToken; }).finally(() => { refreshing = null; });
    return refreshing;
  }
  return {
    async login(login: string, password: string) { const tokens = await raw<{ accessToken: string; refreshToken: string }>('/auth/login', { login, password, deviceId }, 'POST', false); accessToken = tokens.accessToken; refreshToken = tokens.refreshToken; },
    async loginWithPosCode(code: string) { const result = await raw<{ accessToken: string; refreshToken: string; login: string }>('/auth/pos-code', { code, deviceId }, 'POST', false); accessToken = result.accessToken; refreshToken = result.refreshToken; return result.login; },
    async get<T>(path: string): Promise<T> { try { return await raw<T>(path); } catch (error) { if (error instanceof ApiError && error.status === 401 && refreshToken) { await refresh(); return raw<T>(path); } throw error; } },
    async post<T>(path: string, body: unknown): Promise<T> { try { return await raw<T>(path, body, 'POST'); } catch (error) { if (error instanceof ApiError && error.status === 401 && refreshToken) { await refresh(); return raw<T>(path, body, 'POST'); } throw error; } },
    async patch<T>(path: string, body: unknown): Promise<T> { try { return await raw<T>(path, body, 'PATCH'); } catch (error) { if (error instanceof ApiError && error.status === 401 && refreshToken) { await refresh(); return raw<T>(path, body, 'PATCH'); } throw error; } },
    async logout() { const token = refreshToken; accessToken = ''; refreshToken = ''; if (token) await raw('/auth/logout', { refreshToken: token }, 'POST', false); },
  };
}
