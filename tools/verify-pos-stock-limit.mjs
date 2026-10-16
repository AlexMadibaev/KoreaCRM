import { writeFile } from 'node:fs/promises';

const target = await fetch('http://127.0.0.1:9222/json/new?http://127.0.0.1:5173/', { method: 'PUT' }).then(response => response.json());
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
await waitFor('!!document.querySelector(".login-form")');
await evaluate(setInput('.login-form input[type=url]', 'http://127.0.0.1:3001'));
await evaluate(setInput('.login-form input[autocomplete=username]', 'demo'));
await evaluate(setInput('.login-form input[type=password]', 'demo1234'));
await evaluate('document.querySelector(".login-form").requestSubmit()');
await waitFor('!!document.querySelector(".pos") && !!document.querySelector(".results button")');
await evaluate('document.querySelector(".results button").click()');
await waitFor('!!document.querySelector(".cart li input[type=number]")');
const available = await evaluate('Number(document.querySelector(".cart li input[type=number]").max)');
await evaluate(setInput('.cart li input[type=number]', String(available + 100)));
await waitFor(`document.querySelector(".cart li input[type=number]")?.value === "${available}" && document.querySelector(".stock-notice")?.textContent.includes("${available}")`);
const screenshot = await call('Page.captureScreenshot', { format: 'png' });
await writeFile('D:/KoreaCRM/apps/pos/preview-stock-limit.png', Buffer.from(screenshot.data, 'base64'));
console.log(JSON.stringify({ available, quantity: await evaluate('Number(document.querySelector(".cart li input[type=number]").value)'), notice: await evaluate('document.querySelector(".stock-notice")?.textContent'), screenshot: 'apps/pos/preview-stock-limit.png' }));
socket.close();
