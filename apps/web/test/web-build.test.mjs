import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expectedWebAssets,
  verifyWebBuild,
} from '../../../tools/verify-web-build.mjs';

const manifest = {
  pages: {
    '/layout': [
      'static/css/current.css',
      'static/chunks/app/layout-current.js',
    ],
    '/purchases/page': ['static/chunks/app/purchases/page-current.js'],
  },
};
const html = expectedWebAssets(manifest)
  .map((asset) => `/_next/${asset}`)
  .join(' ');
const response = (body, type = 'text/html', status = 200) =>
  new Response(body, { status, headers: { 'content-type': type } });

test('startup refuses stale CSS even when the page and its route JS respond successfully', async () => {
  const fetcher = async () => response(html.replace('current.css', 'old.css'));
  await assert.rejects(
    verifyWebBuild({ manifest, baseUrl: 'http://localhost', fetcher }),
    /older build/,
  );
});

test('startup refuses a missing JavaScript asset instead of reporting MVP ready', async () => {
  const fetcher = async (url) =>
    url.pathname === '/purchases'
      ? response(html)
      : response('missing', 'text/plain', 400);
  await assert.rejects(
    verifyWebBuild({ manifest, baseUrl: 'http://localhost', fetcher }),
    /HTTP 400/,
  );
});

test('startup accepts matching page, shared CSS and current JavaScript assets', async () => {
  const fetcher = async (url) =>
    url.pathname === '/purchases'
      ? response(html)
      : response(
          '',
          url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript',
        );
  assert.deepEqual(
    await verifyWebBuild({ manifest, baseUrl: 'http://localhost', fetcher }),
    { assetsVerified: 3 },
  );
});
