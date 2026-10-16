const targets = await fetch('http://127.0.0.1:9223/json').then(response => response.json());
const target = targets.find(item => item.url === 'http://tauri.localhost/');
if (!target) throw Error('POS WebView not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0; const tasks = new Map();
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const answer = await call('Runtime.evaluate', { expression, returnByValue: true }); if (answer.exceptionDetails) throw Error(answer.exceptionDetails.text); return answer.result.value; }
async function waitFor(expression, timeout = 30000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 250)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(0,1400)')}`); }
function setInput(selector, value) { return `(() => { const element=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('input',{bubbles:true})); })()`; }
function setSelect(selector, value) { return `(() => { const element=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event('change',{bubbles:true})); })()`; }
try {
  await call('Runtime.enable');
  await waitFor('!!document.querySelector(".login-form")');
  await evaluate(setInput('.login-form input[type=url]', 'http://127.0.0.1:3002'));
  await evaluate(setInput('.login-form input[autocomplete=username]', 'demo'));
  await evaluate(setInput('.login-form input[type=password]', 'demo1234'));
  await evaluate('document.querySelector(".login-form").requestSubmit()');
  await waitFor('!!document.querySelector(".pos")');
  await evaluate('document.querySelector(".topbar button:not(.quiet)")?.click()');
  await waitFor('document.querySelector(".connection-pill")?.textContent.includes("подключена")');
  await waitFor('document.querySelectorAll(".results button").length > 0');
  await evaluate('document.querySelector(".results button").click()');
  await waitFor('!!document.querySelector(".cart li")');
  await evaluate(setSelect('.columns form label select', 'demo-customer-1'));
  await evaluate(setSelect('.payment select', 'demo-card'));
  await evaluate('document.querySelector(".fill-total").click()');
  await waitFor('!document.querySelector(".columns form .primary").disabled');
  await evaluate('document.querySelector(".columns form .primary").click()');
  await waitFor('document.querySelector(".receipt h2")?.textContent.includes("DEMO-0001")');
  await waitFor('document.querySelector(".sales-history-list")?.textContent.includes("DEMO-0001")');
  await evaluate(setInput('.sales-history input', 'DEMO-0001'));
  await waitFor('document.querySelector(".sales-history-count")?.textContent.includes("Найдено: 1")');
  await evaluate('document.querySelector(".sales-history-list button").click()');
  await waitFor('document.querySelector(".sales-history-detail")?.textContent.includes("Анна")');
  await evaluate(setInput('.sales-history input', '+998901234567'));
  await waitFor('document.querySelector(".sales-history-count")?.textContent.includes("Найдено: 1")');
  await evaluate('document.querySelector(".sales-history-list button").click()');
  await waitFor('document.querySelector(".sales-history-detail")?.textContent.includes("Крем для лица")');
  await evaluate('document.querySelector(".sales-history-detail button").click()');
  await waitFor('document.querySelector("#receipt h2")?.textContent.includes("DEMO-0001")');
  console.log(JSON.stringify({ sale: 'DEMO-0001', searchByNumber: true, searchByPhone: true, printPreview: true }));
} finally { socket.close(); }
