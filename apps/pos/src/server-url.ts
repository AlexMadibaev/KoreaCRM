export function normalizeServerUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    if (/^\/login\/?$/i.test(url.pathname)) url.pathname = '/api';
    url.search = '';
    url.hash = '';
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new Error('Укажите адрес магазина, который вам дал администратор.');
  }
}

export function isLocalServerUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.local')) return true;
    if (/^10\.|^192\.168\./.test(hostname)) return true;
    const match = /^172\.(\d{1,2})\./.exec(hostname);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  } catch { return false; }
}
