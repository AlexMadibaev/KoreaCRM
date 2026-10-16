import { apiBase } from './api-base';
import { clearSession, ensureAccessToken, refreshAccessToken } from './session';

export { apiBase };

export type Page<T> = { items: T[]; total: number; page: number; limit: number };
export type Brand = { id: string; name: string };
export type Category = { id: string; name: string; parentId: string | null };
export type Product = {
  id: string; name: string; sku: string; status: 'ACTIVE' | 'INACTIVE';
  brandId: string | null; categoryId: string | null; brand?: Brand | null; category?: Category | null;
  description: string | null; country: string | null; unit: string;
  shade: string | null; volume: string | null; weight: string | null; line: string | null;
  collection: string | null; gender: string | null; skinType: string | null; productType: string | null;
  barcodes: { id: string; value: string }[]; images: { id: string; storageKey: string }[];
};

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isAuthRequest = path.startsWith('/auth/login') || path.startsWith('/auth/refresh');
  const token = typeof window === 'undefined' || isAuthRequest ? null : await ensureAccessToken();
  const request = (currentToken: string | null) => fetch(`${apiBase}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}), ...options.headers },
    cache: 'no-store',
  });
  let response = await request(token);
  if (response.status === 401 && !isAuthRequest && typeof window !== 'undefined') {
    const replacement = await refreshAccessToken();
    if (replacement) response = await request(replacement);
    if (response.status === 401) {
      clearSession();
      window.location.href = '/login';
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.message === 'string' ? body.message : `Ошибка API: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}
