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
