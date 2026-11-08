import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function expectedWebAssets(manifest) {
  const layout = manifest.pages?.['/layout'] ?? [];
  const purchase = (manifest.pages?.['/purchases/page'] ?? []).filter((file) =>
    /static\/chunks\/app\/purchases\/page-/.test(file),
  );
  const assets = [...new Set([...layout, ...purchase])];
  if (!layout.length || !purchase.length)
    throw new Error('Web build manifest has no layout or purchases entry.');
  return assets;
}

/** Read-only: detect both stale route JS and stale shared styles before declaring MVP ready. */
export async function verifyWebBuild({ manifest, baseUrl, fetcher = fetch }) {
  const assets = expectedWebAssets(manifest);
  const response = await fetcher(new URL('/purchases', baseUrl));
  if (!response.ok)
    throw new Error(`Purchase page returned HTTP ${response.status}.`);
  const html = await response.text();
  const missing = assets.filter((asset) => !html.includes('/_next/' + asset));
  if (missing.length)
    throw new Error(
      `The local web server is serving an older build (${missing.length} assets differ). Restart that web process or use a free WebPort with the same WebDistDir.`,
    );
  for (const asset of assets) {
    const result = await fetcher(new URL('/_next/' + asset, baseUrl));
    if (!result.ok)
      throw new Error(
        `Current web asset returned HTTP ${result.status}: ${asset}`,
      );
    const type = result.headers.get('content-type') ?? '';
    if (
      (asset.endsWith('.css') && !type.includes('text/css')) ||
      (asset.endsWith('.js') && !type.includes('javascript'))
    )
      throw new Error(`Wrong response type for web asset: ${asset}`);
  }
  return { assetsVerified: assets.length };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const repositoryRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
    );
    const buildDirectory = resolve(
      repositoryRoot,
      process.argv[2] ?? 'apps/web/.next-mvp',
    );
    const baseUrl = process.argv[3] ?? 'http://127.0.0.1:3010';
    const manifest = JSON.parse(
      readFileSync(resolve(buildDirectory, 'app-build-manifest.json'), 'utf8'),
    );
    const result = await verifyWebBuild({ manifest, baseUrl });
    console.log(
      `Web build verified: ${result.assetsVerified} current JS/CSS assets.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Web build verification failed.',
    );
    process.exitCode = 1;
  }
}
