import { writeFile } from 'node:fs/promises';

const target = await fetch('http://127.0.0.1:9222/json/new?http://127.0.0.1:3000/login', { method: 'PUT' }).then(response => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', event => { const message = JSON.parse(event.data); const task = pending.get(message.id); if (task) { pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }
async function evaluate(expression) { const result = await call('Runtime.evaluate', { expression, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; }
async function waitFor(expression) { const start = Date.now(); while (Date.now() - start < 15000) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error(`Timeout: ${expression}; page=${await evaluate('document.body.innerText.slice(0, 400)')}`); }
const setInput = (selector, value) => `(() => { const input = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return input.value; })()`;
await call('Page.enable'); await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await waitFor('!!document.querySelector(".crm-login-form")');
await evaluate(setInput('input[autocomplete=username]', 'demo'));
await evaluate(setInput('input[autocomplete=current-password]', 'demo1234'));
await evaluate('document.querySelector(".crm-login-form").requestSubmit()');
await waitFor('location.pathname === "/dashboard" && document.body.innerText.includes("Обзор бизнеса")');
const dashboard = await call('Page.captureScreenshot', { format: 'png' });
await writeFile('D:/KoreaCRM/apps/web/preview-dashboard-latest.png', Buffer.from(dashboard.data, 'base64'));
await evaluate('document.querySelector(".crm-topbar-avatar").click()');
await waitFor('location.pathname === "/account" && document.body.innerText.includes("Демо администратор")');
const account = await call('Page.captureScreenshot', { format: 'png' });
await writeFile('D:/KoreaCRM/apps/web/preview-account-latest.png', Buffer.from(account.data, 'base64'));
const profile = await evaluate('document.querySelector(".crm-profile-body h2")?.textContent');
const stores = await evaluate('document.querySelectorAll(".crm-store-item").length');
await evaluate('document.querySelector(".crm-nav-link[href=\'/products\']").click()');
await waitFor('location.pathname === "/products" && document.querySelectorAll(".crm-products-table tbody tr").length === 3');
const products = await call('Page.captureScreenshot', { format: 'png' });
await writeFile('D:/KoreaCRM/apps/web/preview-products.png', Buffer.from(products.data, 'base64'));
const productCount = await evaluate('document.querySelectorAll(".crm-products-table tbody tr").length');
await evaluate(setInput('.crm-products-search input', 'Centella'));
await waitFor('document.querySelectorAll(".crm-products-table tbody tr").length === 1');
await evaluate('document.querySelector(".crm-product-name").click()');
await waitFor('location.pathname.startsWith("/products/") && document.body.innerText.includes("Штрихкоды")');
console.log(JSON.stringify({ location: await evaluate('location.href'), profile, stores, products: productCount, searchResults: 1, detail: await evaluate('document.querySelector("h1")?.textContent'), screenshots: ['apps/web/preview-dashboard-latest.png', 'apps/web/preview-account-latest.png', 'apps/web/preview-products.png'] }));
socket.close();
