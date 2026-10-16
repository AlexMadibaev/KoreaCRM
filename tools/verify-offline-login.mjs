const phase = process.argv[2];
if (!['prepare', 'offline', 'wrong-password', 'reconnect', 'cash-prepare', 'cash-offline', 'cash-resume', 'cash-reconnect', 'conflict-prepare', 'conflict-retry'].includes(phase)) throw Error('phase required');
const apiUrl = process.env.TEST_API_URL ?? 'http://127.0.0.1:3002';
const targets = await fetch('http://127.0.0.1:9223/json').then(response => response.json());
const target = targets.find(item => item.url === 'http://tauri.localhost/');
if (!target) throw Error('POS WebView not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression, awaitPromise = false) { const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (answer.exceptionDetails) throw Error(answer.exceptionDetails.text); return answer.result.value; }
async function waitFor(expression, timeout = 30000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 250)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(0,1200)')}`); }
function input(selector, value) { return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw Error('Missing input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles:true })); })()`; }
async function login(password) {
  await waitFor('!!document.querySelector(".login-form")');
  await evaluate(input('.login-form input[type=url]', apiUrl));
  await evaluate(input('.login-form input[autocomplete=username]', 'demo'));
  await evaluate(input('.login-form input[type=password]', password));
  await evaluate('document.querySelector(".login-form").requestSubmit()');
}
try {
  await call('Runtime.enable');
  if (phase === 'prepare' || phase === 'cash-prepare' || phase === 'conflict-prepare') {
    await login('demo1234');
    await waitFor('!!document.querySelector(".pos")');
    await evaluate('document.querySelector(".topbar button:not(.quiet)")?.click()');
    await waitFor('document.querySelector(".connection-pill")?.textContent.includes("подключена")');
    await waitFor('document.querySelector(".cache-status")?.textContent.includes("Локально:")');
    if (phase === 'cash-prepare') {
      await evaluate(input('.shift form input', '50000'));
      await evaluate('document.querySelector(".shift form").requestSubmit()');
      await waitFor('document.querySelector(".shift")?.textContent.includes("500,00")');
    }
    const session = await evaluate(`window.__TAURI_INTERNALS__.invoke('read_offline_session',{deviceId:localStorage.getItem('koreacrm-pos-device-v1'),apiUrl:${JSON.stringify(apiUrl)},login:'demo'}).then(value=>value&&({userId:value.userId,storeId:value.storeId,shiftId:value.shiftJson&&JSON.parse(value.shiftJson).id}))`, true);
    if (!session) throw Error('Offline verifier missing');
    if (phase === 'cash-prepare' && !session.shiftId) throw Error('Cash shift not cached');
    if (phase === 'conflict-prepare') {
      await evaluate('document.querySelector(".results button").click()');
      await waitFor('!!document.querySelector(".cart li")');
      await evaluate(`(() => { const select = document.querySelector('.payment select'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'demo-card'); select.dispatchEvent(new Event('change', { bubbles:true })); })()`);
      await evaluate('document.querySelector(".fill-total").click()');
      await waitFor('!document.querySelector(".columns form .primary").disabled');
      await evaluate('document.querySelector(".columns form .primary").click()');
      await waitFor('!!document.querySelector(".sync-conflict") && !document.querySelector(".cart li")');
      const conflict = await evaluate(`window.__TAURI_INTERNALS__.invoke('list_sync_queue',{userId:'demo-user',storeId:'demo-store'}).then(rows=>rows.find(row=>row.status==='CONFLICT')&&({status:'CONFLICT',operationId:rows.find(row=>row.status==='CONFLICT').operationId}))`, true);
      if (!conflict || !await evaluate('document.querySelector(".sync-conflict [role=alert]")?.textContent.includes("Тестовый отказ")')) throw Error('Conflict details missing');
      console.log(JSON.stringify({ phase, conflict, cartCleared: true }));
    } else console.log(JSON.stringify({ phase, session }));
  } else if (phase === 'conflict-retry') {
    await waitFor('!!document.querySelector(".sync-conflict button")');
    await evaluate('document.querySelector(".sync-conflict button").click()');
    await waitFor('!document.querySelector(".sync-conflict") && document.querySelector(".sync-center")?.textContent.includes("Ожидают: 0")', 30000);
    const summary = await evaluate(`window.__TAURI_INTERNALS__.invoke('sync_queue_summary',{userId:'demo-user',storeId:'demo-store'})`, true);
    const finance = await fetch(`${apiUrl}/finance/summary`, { headers: { Authorization: 'Bearer demo-local-token' } }).then(response => response.json());
    if (summary.conflicts || summary.pending || finance.revenueMinor !== '129000') throw Error(JSON.stringify({ summary, finance }));
    console.log(JSON.stringify({ phase, summary, revenueMinor: finance.revenueMinor }));
  } else if (phase === 'wrong-password') {
    await login('wrong-password');
    await waitFor('!!document.querySelector(".login-form [role=alert]")');
    if (await evaluate('!!document.querySelector(".pos")')) throw Error('Wrong password accepted');
    console.log(JSON.stringify({ phase, rejected: true }));
  } else if (phase === 'cash-resume') {
    await login('demo1234');
    await waitFor('document.querySelector(".connection-pill")?.textContent.includes("офлайн")');
    await waitFor('document.querySelector(".shift")?.textContent.includes("локально ожидают отправки")');
    if (!await evaluate('document.querySelector(".shift form button")?.disabled')) throw Error('Closing shift with pending cash sale is enabled');
    console.log(JSON.stringify({ phase, shift: await evaluate('document.querySelector(".shift")?.textContent') }));
  } else if (phase === 'offline' || phase === 'cash-offline') {
    await login('demo1234');
    await waitFor('document.querySelector(".connection-pill")?.textContent.includes("офлайн")');
    await waitFor('document.querySelectorAll(".results li").length > 0');
    await evaluate('document.querySelector(".results button").click()');
    await waitFor('!!document.querySelector(".cart li")');
    if (phase === 'offline') await evaluate(`(() => { const select = document.querySelector('.payment select'); const card = [...select.options].find(option => option.value === 'demo-card'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, card.value); select.dispatchEvent(new Event('change', { bubbles:true })); })()`);
    await evaluate('document.querySelector(".fill-total").click()');
    await waitFor('!document.querySelector(".columns form .primary").disabled');
    await evaluate('document.querySelector(".columns form .primary").click()');
    await waitFor('!document.querySelector(".cart li") && document.querySelector(".sync-center")?.textContent.includes("Ожидают: 1")');
    const queue = await evaluate(`window.__TAURI_INTERNALS__.invoke('list_sync_queue',{userId:'demo-user',storeId:'demo-store'}).then(rows=>rows.map(row=>({status:row.status,operationId:row.operationId})))`, true);
    if (queue.length !== 1 || queue[0].status !== 'PENDING') throw Error(JSON.stringify(queue));
    if (phase === 'cash-offline' && !await evaluate('document.querySelector(".shift")?.textContent.includes("локально ожидают отправки")')) throw Error('Cash projection missing');
    console.log(JSON.stringify({ phase, queue }));
  } else {
    await waitFor('document.querySelector(".connection-pill")?.textContent.includes("подключена")', 45000);
    await waitFor('document.querySelector(".sync-center")?.textContent.includes("Ожидают: 0")', 45000);
    const summary = await evaluate(`window.__TAURI_INTERNALS__.invoke('sync_queue_summary',{userId:'demo-user',storeId:'demo-store'})`, true);
    if (summary.pending || summary.errors || summary.conflicts || summary.synced < 1) throw Error(JSON.stringify(summary));
    if (phase === 'cash-reconnect') {
      await waitFor('document.querySelector(".shift")?.textContent.includes("1 790,00") && !document.querySelector(".shift")?.textContent.includes("локально ожидают")');
      const shifts = await fetch(`${apiUrl}/stores/demo-store/finance/cash-shifts`, { headers: { Authorization: 'Bearer demo-local-token' } }).then(response => response.json());
      if (shifts.items?.[0]?.expectedCashMinor !== '179000') throw Error(JSON.stringify(shifts));
    }
    console.log(JSON.stringify({ phase, summary, center: await evaluate('document.querySelector(".sync-center").textContent') }));
  }
} finally { socket.close(); }
