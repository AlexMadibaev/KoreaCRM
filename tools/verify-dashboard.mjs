import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client/default.js';

const apiUrl = process.env.KOREACRM_TEST_API_URL ?? 'http://127.0.0.1:3008';
const login = process.env.KOREACRM_TEST_LOGIN;
const password = process.env.KOREACRM_TEST_PASSWORD;
if (!login || !password || !process.env.DATABASE_URL) throw Error('Set test login, password and DATABASE_URL');
const prisma = new PrismaClient();
let token;
async function request(path, body) {
  const response = await fetch(`${apiUrl}${path}`, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Error(`${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function browser(storeId, archivedStoreId) {
  const target = (await fetch('http://127.0.0.1:9226/json').then(response => response.json())).find(item => item.type === 'page');
  assert.ok(target?.webSocketDebuggerUrl);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  const tasks = new Map(); let nextId = 0;
  socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
  function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
  async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
  async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression).catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}`); }
  try {
    await call('Page.enable'); await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
    await call('Page.navigate', { url: 'http://127.0.0.1:3007/login' });
    await waitFor('!!document.querySelector("input[autocomplete=username]")');
    await evaluate(`sessionStorage.clear(); localStorage.clear(); sessionStorage.setItem('accessToken', ${JSON.stringify(token)})`);
    await call('Page.navigate', { url: 'http://127.0.0.1:3007/dashboard' });
    await waitFor('document.querySelectorAll(".crm-dashboard-sales strong").length === 4 && document.querySelector(".crm-dashboard-sales strong").textContent !== "—"');
    await waitFor('document.querySelectorAll(".crm-trend-day").length === 7');
    await waitFor('!!document.querySelector(".crm-top-products-list, .crm-top-products-empty")');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile('tools/pg-test-data/dashboard-mobile.png', Buffer.from(screenshot.data, 'base64'));
    await evaluate(`document.querySelector('.crm-dashboard-archive input').click()`);
    await waitFor(`document.querySelector('.crm-dashboard-archive input').checked && !![...document.querySelectorAll('.crm-dashboard-filters select option')].find(option => option.textContent.includes('(архив)'))`);
    await waitFor('document.querySelectorAll(".crm-trend-day").length === 7');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const archiveScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile('tools/pg-test-data/dashboard-archive-mobile.png', Buffer.from(archiveScreenshot.data, 'base64'));
    if (archivedStoreId) {
      await evaluate(`{ const select=document.querySelector('.crm-dashboard-filters select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(archivedStoreId)}); select.dispatchEvent(new Event('change',{bubbles:true})); }`);
      await waitFor(`document.querySelector('.crm-dashboard-filters select').value === ${JSON.stringify(archivedStoreId)} && document.querySelector('.crm-dashboard-sales strong').textContent !== '—'`);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
      const archivedStoreScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await writeFile('tools/pg-test-data/dashboard-archived-store-mobile.png', Buffer.from(archivedStoreScreenshot.data, 'base64'));
    }
    await evaluate(`document.querySelector('.crm-dashboard-archive input').click()`);
    await waitFor(`!document.querySelector('.crm-dashboard-archive input').checked`);
    await waitFor(`!!document.querySelector('.crm-dashboard-filters select option[value="${storeId}"]')`);
    await evaluate(`{ const select=document.querySelector('.crm-dashboard-filters select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(storeId)}); select.dispatchEvent(new Event('change',{bubbles:true})); }`);
    await waitFor(`document.querySelector('.crm-dashboard-filters select').value === ${JSON.stringify(storeId)} && document.querySelector('.crm-dashboard-sales strong').textContent !== '—'`);
    await waitFor('document.querySelectorAll(".crm-trend-day").length === 7');
    await waitFor('!!document.querySelector(".crm-top-products-list, .crm-top-products-empty")');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const scopedScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile('tools/pg-test-data/dashboard-store-mobile.png', Buffer.from(scopedScreenshot.data, 'base64'));
    await evaluate(`[...document.querySelectorAll('.crm-periods button')].find(button => button.textContent.includes('30 дней')).click()`);
    await waitFor('document.querySelectorAll(".crm-trend-day").length === 30');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const monthScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile('tools/pg-test-data/dashboard-month-mobile.png', Buffer.from(monthScreenshot.data, 'base64'));
  } finally { await call('Emulation.clearDeviceMetricsOverride').catch(() => undefined); socket.close(); }
}

try {
  token = (await request('/auth/login', { login, password })).accessToken;
  const stores = await request('/finance/stores');
  assert.ok(stores.length, 'At least one active store is required');
  assert.ok(stores.every(store => store.status === 'ACTIVE' && store.deletedAt === null));
  const historicalStores = await request('/finance/stores?scope=all');
  assert.ok(historicalStores.length >= stores.length);
  const archivedStore = historicalStores.find(store => store.deletedAt || store.status !== 'ACTIVE');
  const store = stores[0];
  const now = new Date(); const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now); fromDate.setUTCDate(now.getUTCDate() - 29); const from = fromDate.toISOString().slice(0, 10);
  const report = await request(`/finance/summary?from=${from}&to=${to}&storeId=${store.id}`);
  const start = new Date(`${from}T00:00:00.000Z`), end = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000);
  const [activeSummary, historicalSummary, activeSales, activeReturns, historicalSales, historicalReturns] = await Promise.all([
    request(`/finance/summary?from=${from}&to=${to}`),
    request(`/finance/summary?from=${from}&to=${to}&scope=all`),
    prisma.sale.aggregate({ where: { storeId: { in: stores.map(store => store.id) }, status: 'COMPLETED', createdAt: { gte: start, lt: end } }, _count: { id: true }, _sum: { totalMinor: true } }),
    prisma.saleReturn.aggregate({ where: { storeId: { in: stores.map(store => store.id) }, createdAt: { gte: start, lt: end } }, _sum: { amountMinor: true } }),
    prisma.sale.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: start, lt: end } }, _count: { id: true }, _sum: { totalMinor: true } }),
    prisma.saleReturn.aggregate({ where: { createdAt: { gte: start, lt: end } }, _sum: { amountMinor: true } }),
  ]);
  assert.equal(activeSummary.revenueMinor, (BigInt((activeSales._sum.totalMinor ?? 0).toString()) - BigInt((activeReturns._sum.amountMinor ?? 0).toString())).toString());
  assert.equal(activeSummary.checksCount, activeSales._count.id);
  assert.equal(historicalSummary.revenueMinor, (BigInt((historicalSales._sum.totalMinor ?? 0).toString()) - BigInt((historicalReturns._sum.amountMinor ?? 0).toString())).toString());
  assert.equal(historicalSummary.checksCount, historicalSales._count.id);
  if (archivedStore) {
    const archivedReport = await request(`/finance/summary?from=${from}&to=${to}&scope=all&storeId=${archivedStore.id}`);
    const archivedSales = await prisma.sale.aggregate({ where: { storeId: archivedStore.id, status: 'COMPLETED', createdAt: { gte: start, lt: end } }, _count: { id: true } });
    assert.equal(archivedReport.checksCount, archivedSales._count.id);
  }
  const activeTrend = await request(`/finance/sales-trend?from=${from}&to=${to}`);
  assert.equal(activeTrend.days.reduce((sum, day) => sum + BigInt(day.netMinor), 0n).toString(), activeSummary.revenueMinor);
  const [sales, returns] = await Promise.all([
    prisma.sale.aggregate({ where: { storeId: store.id, status: 'COMPLETED', createdAt: { gte: start, lt: end } }, _count: { id: true }, _sum: { totalMinor: true, discountMinor: true } }),
    prisma.saleReturn.aggregate({ where: { storeId: store.id, createdAt: { gte: start, lt: end } }, _count: { id: true }, _sum: { amountMinor: true } }),
  ]);
  assert.equal(report.checksCount, sales._count.id);
  assert.equal(report.discountsMinor, (sales._sum.discountMinor ?? 0).toString());
  assert.equal(report.returnsCount, returns._count.id);
  assert.equal(report.returnsMinor, (returns._sum.amountMinor ?? 0).toString());
  assert.equal(report.averageCheckMinor, sales._count.id ? sales._sum.totalMinor.div(sales._count.id).toDecimalPlaces(0).toString() : '0');
  const trend = await request(`/finance/sales-trend?from=${from}&to=${to}&storeId=${store.id}`);
  assert.equal(trend.days.length, 30);
  assert.equal(trend.days.reduce((sum, day) => sum + BigInt(day.netMinor), 0n).toString(), report.revenueMinor);
  assert.equal(trend.days.reduce((sum, day) => sum + day.checksCount, 0), report.checksCount);
  const top = await request(`/finance/top-products?from=${from}&to=${to}&storeId=${store.id}`);
  const [saleRows, returnRows] = await Promise.all([
    prisma.sale.findMany({ where: { storeId: store.id, status: 'COMPLETED', createdAt: { gte: start, lt: end } }, include: { items: true } }),
    prisma.saleReturn.findMany({ where: { storeId: store.id, createdAt: { gte: start, lt: end } }, include: { items: { include: { saleItem: true } } } }),
  ]);
  const products = new Map();
  function add(productId, quantity, revenueMinor) {
    const current = products.get(productId) ?? { quantity: 0, revenueMinor: 0n };
    products.set(productId, { quantity: current.quantity + quantity, revenueMinor: current.revenueMinor + revenueMinor });
  }
  for (const sale of saleRows) for (const item of sale.items) add(item.productId, item.quantity, BigInt(item.totalMinor.toString()));
  for (const record of returnRows) for (const item of record.items) add(item.saleItem.productId, -item.quantity, -BigInt(item.amountMinor.toString()));
  const expected = [...products].filter(([, value]) => value.quantity > 0).sort((left, right) => right[1].quantity - left[1].quantity || (right[1].revenueMinor > left[1].revenueMinor ? 1 : right[1].revenueMinor < left[1].revenueMinor ? -1 : left[0].localeCompare(right[0]))).slice(0, 5);
  assert.deepEqual(top.items.map(item => [item.productId, item.quantity, item.revenueMinor]), expected.map(([id, value]) => [id, value.quantity, value.revenueMinor.toString()]));
  if (process.env.KOREACRM_TEST_BROWSER === '1') await browser(store.id, archivedStore?.id);
  console.log(JSON.stringify({ result: 'ok', storeId: store.id, checks: report.checksCount, returns: report.returnsCount }));
} finally { await prisma.$disconnect(); }
