const target = (await fetch('http://127.0.0.1:9223/json').then(response => response.json())).find(item => item.url === 'http://tauri.localhost/');
if (!target) throw new Error('Desktop POS WebView not found');
const apiUrl = process.env.TEST_API_URL ?? 'http://127.0.0.1:3001';
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const tasks = new Map();
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(new Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression, awaitPromise = false) { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; }
async function waitFor(expression, timeout = 15000) { const started = Date.now(); while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(0, 800)')}`); }
const input = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`;
try {
  await call('Runtime.enable');
  await waitFor('!!document.querySelector(".login-form")');
  const expectedCount = Number(process.env.EXPECTED_QUEUE_COUNT ?? 1);
  const expectedSynced = Number(process.env.EXPECTED_SYNCED_TOTAL ?? 4);
  const expectNegative = process.env.EXPECT_NEGATIVE_STOCK === '1';
  const queued = await evaluate(`window.__TAURI_INTERNALS__.invoke('list_sync_queue', {userId:'demo-user',storeId:'demo-store'})`, true);
  if (queued.length !== expectedCount || queued.some(entry => entry.status !== 'ERROR') || new Set(queued.map(entry => entry.operationId)).size !== expectedCount) throw new Error(`Queue after restart: ${JSON.stringify(queued)}`);
  const stock = async () => (await fetch(`${apiUrl}/stores/demo-store/stock`, { headers: { Authorization: 'Bearer demo-local-token' } }).then(response => response.json())).items.find(item => item.productId === 'demo-cleanser').quantity;
  const before = expectedCount > 1 || expectNegative ? await stock() : null;
  if (expectNegative) {
    if (before !== 0) throw new Error(`Expected zero server stock before sync, got ${before}`);
    const normal = await fetch(`${apiUrl}/stores/demo-store/sales`, { method: 'POST', headers: { Authorization: 'Bearer demo-local-token', 'Content-Type': 'application/json' }, body: queued[0].payloadJson });
    if (normal.status !== 400) throw new Error(`Normal sale should be rejected, got ${normal.status}`);
  }
  await evaluate(input('.login-form input[autocomplete=username]', 'demo'));
  await evaluate(input('.login-form input[type=password]', 'demo1234'));
  await evaluate('document.querySelector(".login-form").requestSubmit()');
  await waitFor(`document.querySelector(".sync-center")?.textContent.includes("Отправлено: ${expectedSynced}")`, 30000);
  const final = await evaluate(`window.__TAURI_INTERNALS__.invoke('sync_queue_summary', {userId:'demo-user',storeId:'demo-store'})`, true);
  if (final.errors || final.pending || final.syncing || final.synced !== expectedSynced) throw new Error(JSON.stringify(final));
  const after = expectedCount > 1 || expectNegative ? await stock() : null;
  if (before !== null && after !== before - expectedCount) throw new Error(`Server stock changed ${before} -> ${after}; expected ${expectedCount} sales`);
  if (expectedCount > 1 || expectNegative) {
    for (const entry of queued) {
      const response = await fetch(`${apiUrl}/stores/demo-store/sales/sync`, { method: 'POST', headers: { Authorization: 'Bearer demo-local-token', 'Content-Type': 'application/json' }, body: entry.payloadJson });
      if (response.status !== 200) throw new Error(`Duplicate replay returned ${response.status}`);
    }
    if (await stock() !== after) throw new Error('Duplicate replay changed stock');
  }
  console.log(JSON.stringify({ queuedAfterRestart: queued.length, synced: final.synced, serverStockBefore: before, serverStockAfter: after, replayDidNotChangeStock: expectedCount > 1 || expectNegative }));
} finally { socket.close(); }
