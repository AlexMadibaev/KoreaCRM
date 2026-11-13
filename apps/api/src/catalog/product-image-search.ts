import { z } from 'zod';

const httpsUrl = z.url({ protocol: /^https$/ });
const serpApiResponse = z.object({
  images_results: z.array(z.object({ title: z.string(), original: httpsUrl, thumbnail: httpsUrl, link: httpsUrl }).nullable().catch(null)).default([]),
});
const serperResponse = z.object({
  images: z.array(z.object({ title: z.string(), imageUrl: httpsUrl, thumbnailUrl: httpsUrl, link: httpsUrl }).nullable().catch(null)).default([]),
});

export async function searchProductImages(query: string) {
  const serpApiKey = process.env.SERPAPI_API_KEY?.trim();
  const serperKey = process.env.SERPER_API_KEY?.trim();
  if (!serpApiKey && !serperKey) return { status: 'unconfigured', items: [] };

  const providers = [];
  if (serpApiKey) providers.push(async () => {
    const url = new URL('https://serpapi.com/search.json');
    url.search = new URLSearchParams({ engine: 'google_images', q: query, api_key: serpApiKey }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: 'error' });
    if (!response.ok) throw new Error('SerpApi request failed');
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'error' in data) throw new Error('SerpApi returned an error');
    return serpApiResponse.parse(data).images_results.flatMap(item => item ? [{ title: item.title, image: item.original, preview: item.thumbnail, source: item.link }] : []);
  });
  if (serperKey) providers.push(async () => {
    const response = await fetch('https://google.serper.dev/images', {
      method: 'POST', headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query }), signal: AbortSignal.timeout(6000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Serper request failed');
    return serperResponse.parse(await response.json()).images.flatMap(item => item ? [{ title: item.title, image: item.imageUrl, preview: item.thumbnailUrl, source: item.link }] : []);
  });

  let responded = false;
  for (const search of providers) {
    try {
      const items = [...new Map((await search()).map(item => [item.image, item])).values()].slice(0, 8);
      responded = true;
      if (items.length) return { status: 'ok', items };
    } catch {
      // Try the other provider without exposing upstream credentials or response bodies.
    }
  }
  return { status: responded ? 'ok' : 'unavailable', items: [] };
}
