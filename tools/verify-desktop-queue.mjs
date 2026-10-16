const targets = await fetch('http://127.0.0.1:9223/json').then(response => response.json());
const target = targets.find(item => item.url === 'http://tauri.localhost/');
if (!target) throw new Error('Desktop POS WebView not found');
const apiUrl = process.env.TEST_API_URL ?? 'http://127.0.0.1:3001';
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const tasks = new Map();
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(new Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression, awaitPromise = false) { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; }
async function waitFor(expression, timeout = 15000) { const started = Date.now(); while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(0, 1000)')}`); }
const input = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`;
try {
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.reload', { ignoreCache: true });
  await waitFor('!!document.querySelector(".login-form")');
  await evaluate(input('.login-form input[type=url]', apiUrl));
  await evaluate(input('.login-form input[autocomplete=username]', 'demo'));
  await evaluate(input('.login-form input[type=password]', 'demo1234'));
  await evaluate('document.querySelector(".login-form").requestSubmit()');
  await waitFor('!!document.querySelector(".pos")');
  await evaluate('document.querySelector(".topbar button:not(.quiet)")?.click()');
  await waitFor('document.querySelector(".connection-pill")?.textContent.includes("подключена")');
  await waitFor('document.querySelector(".cache-status")?.textContent.includes("Локально:")', 30000);
  await waitFor('document.querySelector(".sync-center")?.textContent.includes("Ожидают: 0")');
  const syncedBefore = await evaluate('Number(document.querySelector(".sync-center")?.textContent.match(/Отправлено: (\\d+)/)?.[1] ?? 0)');
  const offlineCatalog = process.env.OFFLINE_CATALOG_TEST === '1';
  const saleCount = Number(process.env.SALE_COUNT ?? 1);
  if (!Number.isInteger(saleCount) || saleCount < 1 || saleCount > 20) throw new Error('SALE_COUNT must be 1..20');
  const before = offlineCatalog ? await evaluate(`window.__TAURI_INTERNALS__.invoke('cached_products', {userId:'demo-user',storeId:'demo-store'}).then(items => items.find(item => item.id === 'demo-cleanser')?.availableQuantity)`, true) : null;
  if (offlineCatalog && before < saleCount) throw new Error(`Only ${before} cached units available`);
  if (offlineCatalog) await evaluate(`(() => { const original = window.fetch.bind(window); window.fetch = (resource, options) => String(resource instanceof Request ? resource.url : resource).startsWith(${JSON.stringify(`${apiUrl}/`)}) ? Promise.reject(new TypeError('Проверочный обрыв связи')) : original(resource, options); })()`);
  for (let index = 0; index < saleCount; index += 1) {
    await evaluate(input('.columns input[placeholder^="Сканируйте"]', offlineCatalog ? 'пенка' : 'крем'));
    await waitFor(`document.querySelector(".results li:first-child span")?.textContent.includes("${offlineCatalog ? 'Очищающая пенка' : 'Крем для лица'}")`);
    await evaluate('document.querySelector(".results button").click()');
    await waitFor('!!document.querySelector(".cart li")');
    await evaluate(`(() => { const select = document.querySelector('.payment select'); const card = [...select.options].find(option => option.textContent.includes('Карта')); if (!card) throw Error('Card method missing'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, card.value); select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await evaluate('document.querySelector(".fill-total").click()');
    await waitFor('!document.querySelector(".columns form .primary").disabled');
    if (!offlineCatalog && index === 0) await evaluate(`(() => { const original = window.fetch.bind(window); window.fetch = (resource, options) => { const url = String(resource instanceof Request ? resource.url : resource); if (url.includes('/stores/') && url.endsWith('/sales') && options?.method === 'POST') return Promise.reject(new TypeError('Проверочный обрыв связи')); return original(resource, options); }; })()`);
    await evaluate('document.querySelector(".columns form .primary").click()');
    await waitFor(`document.querySelector(".sync-center")?.textContent.includes("Ожидают: ${index + 1}") && !document.querySelector(".cart li")`);
  }
  const queue = await evaluate(`window.__TAURI_INTERNALS__.invoke('list_sync_queue', {userId:'demo-user',storeId:'demo-store'})`, true).catch(() => null);
  const page = await evaluate('({notice:document.querySelector(".stock-notice")?.textContent,center:document.querySelector(".sync-center")?.textContent,receipt:!!document.querySelector(".receipt"),cartItems:document.querySelectorAll(".cart li").length})');
  if (!page.center?.includes(`Ожидают: ${saleCount}`) || page.receipt || page.cartItems || queue.length !== saleCount || new Set(queue.map(entry => entry.operationId)).size !== saleCount) throw new Error(JSON.stringify({ page, queue }));
  if (queue.some(entry => JSON.parse(entry.payloadJson).items[0].priceMinor !== (offlineCatalog ? '95000' : '129000'))) throw new Error('Queued sale lost its quoted unit price');
  const after = offlineCatalog ? await evaluate(`window.__TAURI_INTERNALS__.invoke('cached_products', {userId:'demo-user',storeId:'demo-store'}).then(items => items.find(item => item.id === 'demo-cleanser')?.availableQuantity)`, true) : null;
  if (offlineCatalog && after !== before - saleCount) throw new Error(`Local stock projection: ${before} -> ${after}`);
  console.log(JSON.stringify({ stage: 'offline', sales: queue.length, operationIds: queue.map(entry => entry.operationId), statuses: [...new Set(queue.map(entry => entry.status))], center: page.center, before, after }));
  if (process.env.STOP_AFTER_QUEUE !== '1') {
    await call('Page.reload', { ignoreCache: true });
    await waitFor('!!document.querySelector(".login-form")');
    await evaluate(input('.login-form input[autocomplete=username]', 'demo'));
    await evaluate(input('.login-form input[type=password]', 'demo1234'));
    await evaluate('document.querySelector(".login-form").requestSubmit()');
    await waitFor('!!document.querySelector(".pos")');
    await waitFor(`document.querySelector(".sync-center")?.textContent.includes("Отправлено: ${syncedBefore + saleCount}")`, 30000);
    const synced = await evaluate('({center:document.querySelector(".sync-center")?.textContent,notice:document.querySelector(".stock-notice")?.textContent})');
    console.log(JSON.stringify({ stage: 'reconnected', synced }));
  }
} finally { socket.close(); }
