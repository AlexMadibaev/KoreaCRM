import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ExcelJS from '../apps/web/node_modules/exceljs/excel.js';
import { readXlsx } from '../apps/web/lib/xlsx.ts';

const apiUrl = process.env.KOREACRM_TEST_API_URL ?? 'http://127.0.0.1:3008';
const webUrl = process.env.KOREACRM_TEST_WEB_URL ?? 'http://127.0.0.1:3007';
const login = process.env.KOREACRM_TEST_LOGIN;
const password = process.env.KOREACRM_TEST_PASSWORD;
const format = process.env.KOREACRM_TEST_FORMAT === 'xlsx' ? 'xlsx' : 'csv';
if (!login || !password) throw new Error('Set KOREACRM_TEST_LOGIN and KOREACRM_TEST_PASSWORD');
const authResponse = await fetch(`${apiUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
assert.equal(authResponse.status, 201);
const { accessToken } = await authResponse.json();
const target = (await fetch('http://127.0.0.1:9225/json').then((response) => response.json()))[0];
assert.ok(target?.webSocketDebuggerUrl, 'Open an Edge tab with CDP on port 9225');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen) => socket.addEventListener('open', resolveOpen, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', (event) => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveCall, reject) => tasks.set(id, { resolve: resolveCall, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise((done) => setTimeout(done, 200)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-800)')}`); }
async function upload(filePath) {
  const { root } = await call('DOM.getDocument');
  const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  assert.ok(nodeId);
  await call('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  await waitFor('document.body.innerText.includes("Сопоставьте колонки")');
  await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent.includes("Проверить файл")).click()');
  await waitFor('document.body.innerText.includes("Предпросмотр")');
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
}
const suffix = randomUUID().slice(0, 8);
const sku = `${format.toUpperCase()}-${suffix}`;
const filePath = resolve(`tools/pg-test-data/product-import-test.${format}`);
async function writeImportFile(name) {
  if (format === 'csv') return writeFile(filePath, `SKU;Название;Штрихкод\n${sku};${name};${suffix}\n`, 'utf8');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Товары');
  sheet.addRow(['SKU', 'Название', 'Штрихкод']);
  sheet.addRow([sku, name, suffix]);
  await writeFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()));
}
try {
  await call('Page.enable'); await call('Runtime.enable'); await call('DOM.enable');
  await call('Page.navigate', { url: `${webUrl}/login` });
  await waitFor('!!document.querySelector("input[autocomplete=username]")');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(accessToken)})`);
  await call('Page.navigate', { url: `${webUrl}/products/import` });
  await waitFor('!!document.querySelector("input[type=file]")');
  await writeImportFile('Тест импорта файла');
  await upload(filePath);
  assert.ok(await evaluate('document.body.innerText.includes("Новых: 1")'));
  await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent.includes("Подтвердить 1 товаров")).click()');
  await waitFor('document.body.innerText.includes("Сохранено: 1")');
  let result = await fetch(`${apiUrl}/products/lookup/sku/${sku}`, { headers: { Authorization: `Bearer ${accessToken}` } }).then((response) => response.json());
  assert.equal(result.items[0]?.name, 'Тест импорта файла');

  await call('Page.reload', { ignoreCache: true });
  await waitFor('!!document.querySelector("input[type=file]")');
  await writeImportFile('Тест импорта обновлён');
  await upload(filePath);
  assert.ok(await evaluate('document.body.innerText.includes("Обновлений: 1")'));
  await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent.includes("Подтвердить 1 товаров")).click()');
  await waitFor('document.body.innerText.includes("Сохранено: 1")');
  result = await fetch(`${apiUrl}/products/lookup/sku/${sku}`, { headers: { Authorization: `Bearer ${accessToken}` } }).then((response) => response.json());
  assert.equal(result.items[0]?.name, 'Тест импорта обновлён');
  assert.equal(result.total, 1);
  if (format === 'xlsx') {
    await evaluate(`(() => { const original = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { window.__exportBlob = blob; return original(blob); }; })()`);
    await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent.includes("Выгрузить XLSX")).click()');
    await waitFor('!!window.__exportBlob');
    const data = await call('Runtime.evaluate', { expression: '(async () => Array.from(new Uint8Array(await window.__exportBlob.arrayBuffer())))()', awaitPromise: true, returnByValue: true });
    const exported = await readXlsx(Uint8Array.from(data.result.value).buffer);
    assert.ok(exported.some((row) => row[0] === sku && row[1] === 'Тест импорта обновлён'));
  }
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(resolve('tools/pg-test-data/product-import-preview.png'), Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ result: 'ok', format, sku, created: true, updated: true, duplicate: false, exportVerified: format === 'xlsx' }));
} finally { socket.close(); }
