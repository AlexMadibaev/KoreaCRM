const target = await fetch('http://127.0.0.1:9222/json/new?http://127.0.0.1:5173/', { method: 'PUT' }).then(response => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = pending.get(reply.id); if (task) { pending.delete(reply.id); reply.error ? task.reject(new Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }
async function evaluate(expression) { const result = await call('Runtime.evaluate', { expression, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; }
async function waitFor(expression) { const start = Date.now(); while (Date.now() - start < 15000) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error(`Timeout: ${expression}; ${await evaluate('document.body.innerText.slice(0, 700)')}`); }
const input = (selector, value) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`;
try {
  await call('Page.enable'); await call('Runtime.enable');
  await waitFor('!!document.querySelector(".login-form")');
  await evaluate(input('.login-form input[type=url]', 'http://127.0.0.1:3001'));
  await evaluate(input('.login-form input[autocomplete=username]', 'demo'));
  await evaluate(input('.login-form input[type=password]', 'demo1234'));
  await evaluate('document.querySelector(".login-form").requestSubmit()');
  await waitFor('!!document.querySelector(".pos")');
  await evaluate('document.querySelector(".topbar button:not(.quiet)")?.click()');
  await waitFor('document.querySelector(".connection-pill")?.textContent.includes("подключена")');
  await evaluate(input('.columns input[placeholder^="Сканируйте"]', 'крем'));
  await waitFor('!!document.querySelector(".results button")');
  await evaluate('document.querySelector(".results button").click()');
  await waitFor('!!document.querySelector(".cart li")');
  await evaluate('if (!document.querySelector(".shift > p")?.textContent.includes("Открыта")) document.querySelector(".shift form")?.requestSubmit()');
  await waitFor('document.querySelector(".shift > p")?.textContent.includes("Открыта")');
  await evaluate('document.querySelector(".fill-total").click()');
  await waitFor('!document.querySelector(".columns form .primary").disabled');
  if (process.env.SIMULATE_SHIFT_REFRESH_FAILURE === '1') {
    await evaluate(`(() => { const original = window.fetch.bind(window); window.fetch = (input, init) => { const url = String(input instanceof Request ? input.url : input); if (url.includes('/finance/cash-shifts?') && (!init?.method || init.method === 'GET')) return Promise.reject(new Error('Проверочная ошибка обновления смены')); return original(input, init); }; })()`);
  }
  await evaluate('document.querySelector(".columns form .primary").click()');
  await waitFor('!!document.querySelector(".receipt") || !!document.querySelector("[role=alert]")');
  const outcome = await evaluate('({receipt:document.querySelector(".receipt h2")?.textContent,error:document.querySelector("[role=alert]")?.textContent,notice:document.querySelector(".stock-notice")?.textContent,cartItems:document.querySelectorAll(".cart li").length,pending:!!document.querySelector(".pending")})');
  if (!outcome.receipt || outcome.error || outcome.cartItems || outcome.pending) throw new Error(JSON.stringify(outcome));
  if (process.env.SIMULATE_SHIFT_REFRESH_FAILURE === '1' && !outcome.notice?.includes('Чек принят, но данные смены не обновились')) throw new Error(JSON.stringify(outcome));
  console.log(JSON.stringify(outcome));
} finally { socket.close(); }
