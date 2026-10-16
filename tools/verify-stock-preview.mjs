import { writeFile } from 'node:fs/promises';

const target = await fetch('http://127.0.0.1:9222/json/new?http://127.0.0.1:3000/login', { method: 'PUT' }).then(response => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0; const pending = new Map();
socket.addEventListener('message', event => { const message = JSON.parse(event.data); const task = pending.get(message.id); if (task) { pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }
async function evaluate(expression) { const result = await call('Runtime.evaluate', { expression, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; }
async function waitFor(expression) { const start = Date.now(); while (Date.now() - start < 15000) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error(`Timeout: ${expression}; page=${await evaluate('document.body.innerText.slice(0, 500)')}`); }
const setInput = (selector, value) => `(() => { const input = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return input.value; })()`;
await call('Page.enable'); await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await waitFor('!!document.querySelector(".crm-login-form")');
await evaluate(setInput('input[autocomplete=username]', 'demo'));
await evaluate(setInput('input[autocomplete=current-password]', 'demo1234'));
await evaluate('document.querySelector(".crm-login-form").requestSubmit()');
await waitFor('location.pathname === "/dashboard"');
await evaluate('document.querySelector(".crm-nav-link[href=\'/stock\']").click()');
await waitFor('location.pathname === "/stock" && document.querySelectorAll("tbody tr").length >= 3');
await evaluate('document.querySelector(".crm-stock-action").click()');
await waitFor('!!document.querySelector("#stock-editor input[type=number]")');
const before = await evaluate('document.querySelector("#stock-editor p")?.textContent');
const inputs = await evaluate('Array.from(document.querySelectorAll("#stock-editor input")).map(input => ({type:input.type,value:input.value}))');
await evaluate(setInput('#stock-editor form:has(button.bg-violet-700) input[type=number]', '29'));
await evaluate(setInput('#stock-editor input[placeholder]', 'Проверка заполнения товара'));
await evaluate('document.querySelector("#stock-editor form:has(button.bg-violet-700)").requestSubmit()');
await waitFor('document.querySelector("#stock-editor p")?.textContent.includes("29 шт.") && document.body.innerText.includes("Проверка заполнения товара")');
const screenshot = await call('Page.captureScreenshot', { format: 'png' });
await writeFile('D:/KoreaCRM/apps/web/preview-stock.png', Buffer.from(screenshot.data, 'base64'));
console.log(JSON.stringify({ before, inputs, after: await evaluate('document.querySelector("#stock-editor p")?.textContent'), history: await evaluate('document.body.innerText.includes("Проверка заполнения товара")'), screenshot: 'apps/web/preview-stock.png' }));
socket.close();
