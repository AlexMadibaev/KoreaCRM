export function productImageUrls(apiUrl: string, storageKey: string): string[] {
  const base = apiUrl.trim().replace(/\/+$/, '');
  const path = `/product-images/${encodeURIComponent(storageKey)}`;
  const url = new URL(base);
  const primary = `${base}${path}`;
  return url.pathname.replace(/\/+$/, '') === '/api' ? [primary, `${url.origin}${path}`] : [primary];
}

export async function fetchProductImage(apiUrl: string, storageKey: string, request: typeof fetch = fetch, signal?: AbortSignal): Promise<Blob> {
  for (const url of productImageUrls(apiUrl, storageKey)) {
    try {
      const response = await request(url, { mode: 'cors', signal });
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/')) continue;
      return await response.blob();
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  throw new Error('Product image is unavailable');
}
