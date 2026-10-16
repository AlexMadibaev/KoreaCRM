import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const webUrl = process.env.KOREACRM_TEST_WEB_URL ?? 'http://127.0.0.1:3007';
const login = process.env.KOREACRM_TEST_LOGIN;
const password = process.env.KOREACRM_TEST_PASSWORD;
if (!login || !password) throw new Error('Set KOREACRM_TEST_LOGIN and KOREACRM_TEST_PASSWORD');

const manifest = await fetch(`${webUrl}/manifest.webmanifest`).then(response => response.json());
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
assert.equal((await fetch(`${webUrl}/sw.js`)).status, 200);
assert.equal((await fetch(`${webUrl}/offline`)).status, 200);

const cdpPort = Number(process.env.KOREACRM_TEST_CDP_PORT ?? 9225);
const target = (await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json())).find(item => item.type === 'page');
assert.ok(target?.webSocketDebuggerUrl, `Open an Edge tab with CDP on port ${cdpPort}`);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => {
  const reply = JSON.parse(event.data);
  const task = tasks.get(reply.id);
  if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); }
});
function call(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => tasks.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const reply = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text);
  return reply.result.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression).catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-400)')}`);
}
try {
  await call('Page.enable'); await call('Runtime.enable');
  if (process.env.KOREACRM_TEST_MOBILE === '1') {
    await call('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
  }
  await call('Page.navigate', { url: `${webUrl}/login` });
  await waitFor('!!document.querySelector("input[autocomplete=username]")');
  if (process.env.KOREACRM_TEST_MOBILE === '1') {
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const loginScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile('tools/pg-test-data/pwa-login-360.png', Buffer.from(loginScreenshot.data, 'base64'));
  }
  await evaluate('sessionStorage.clear(); localStorage.clear()');
  assert.equal(await evaluate('document.querySelector(".crm-remember input").checked'), true);
  await evaluate('document.querySelector("input[autocomplete=username]").focus()');
  await call('Input.insertText', { text: login });
  await evaluate('document.querySelector("input[autocomplete=current-password]").focus()');
  await call('Input.insertText', { text: password });
  await evaluate('document.querySelector(".crm-login-form button[type=submit]").click()');
  await waitFor('location.pathname !== "/login" && !!sessionStorage.getItem("accessToken")');
  assert.ok(await evaluate('!!localStorage.getItem("koreacrm.refreshToken")'));
  await evaluate('sessionStorage.clear()');
  await call('Page.navigate', { url: `${webUrl}/` });
  await waitFor('location.pathname !== "/" && location.pathname !== "/login" && !!sessionStorage.getItem("accessToken")');
  await waitFor('!!document.querySelector(".crm-sidebar-account strong") && !document.body.innerText.includes("Проверка доступа")');
  await waitFor('!!navigator.serviceWorker.controller');
  assert.ok(await evaluate('!!document.querySelector(".crm-menu-button")'));
  if (process.env.KOREACRM_TEST_MOBILE === '1') {
    assert.equal(await evaluate('innerWidth'), 360);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  }
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('tools/pg-test-data/pwa-mobile.png', Buffer.from(screenshot.data, 'base64'));

  await call('Network.enable');
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await call('Page.navigate', { url: `${webUrl}/products` });
  await waitFor('document.body.innerText.includes("Нет подключения к серверу")');
  assert.ok(await evaluate('document.body.innerText.includes("Продажи и изменения остатков")'));
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await call('Page.navigate', { url: `${webUrl}/account` });
  await waitFor('!!document.querySelector(".crm-signout")');
  await evaluate('document.querySelector(".crm-signout").click()');
  await waitFor('location.pathname === "/login"');
  assert.equal(await evaluate('localStorage.getItem("koreacrm.refreshToken")'), null);
  console.log(JSON.stringify({ result: 'ok', standaloneManifest: true, savedLogin: true, offlineShell: true, logoutClearsSession: true, mobileWidth: process.env.KOREACRM_TEST_MOBILE === '1' ? 360 : undefined }));
} finally {
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => undefined);
  if (process.env.KOREACRM_TEST_MOBILE === '1') await call('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
  socket.close();
}
