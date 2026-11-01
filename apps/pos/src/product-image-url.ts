export function productImageUrls(apiUrl: string, storageKey: string): string[] {
  const base = apiUrl.trim().replace(/\/+$/, '');
  const path = `/product-images/${encodeURIComponent(storageKey)}`;
  const url = new URL(base);
  const primary = `${base}${path}`;
  return url.pathname.replace(/\/+$/, '') === '/api' ? [primary, `${url.origin}${path}`] : [primary];
}
