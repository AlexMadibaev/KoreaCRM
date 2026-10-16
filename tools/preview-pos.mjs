import { writeFile } from 'node:fs/promises';

const targets = await fetch('http://127.0.0.1:9222/json').then(response => response.json());
const target = targets.find(item => item.url === 'http://127.0.0.1:5173/');
if (!target) throw new Error('POS browser tab not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let nextId = 0;
const waiting = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const pending = waiting.get(message.id);
  if (!pending) return;
  waiting.delete(message.id);
  message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
});
function call(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, timeout = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${expression}; message: ${await evaluate('document.querySelector("[role=alert]")?.textContent')}`);
}
const setInput = (selector, value) => `(() => { const input = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return input.value; })()`;

await call('Page.enable');
await call('Runtime.enable');
await call('Page.reload', { ignoreCache: true });
await waitFor('!!document.querySelector(".login-form")');
await evaluate(setInput('.login-form input[type=url]', 'http://127.0.0.1:3001'));
await evaluate(setInput('.login-form input[autocomplete=username]', 'demo'));
await evaluate(setInput('.login-form input[type=password]', 'demo1234'));
await evaluate('document.querySelector(".login-form").requestSubmit()');
await waitFor('!!document.querySelector(".pos")');
await evaluate('document.querySelector(".topbar button:not(.quiet)")?.click()');
await waitFor('document.querySelector(".connection-pill")?.textContent.includes("подключена")');
await evaluate(setInput('.columns input[placeholder^="Сканируйте"]', 'крем'));
await waitFor('!!document.querySelector(".results button")');
await evaluate('document.querySelector(".results button").click()');
await waitFor('!!document.querySelector(".cart li")');
await evaluate('document.querySelector(".shift form").requestSubmit()');
await waitFor('document.querySelector(".shift > p")?.textContent.includes("Открыта")');
await evaluate('document.querySelector(".fill-total").click()');
await waitFor('document.querySelector(".payment input[pattern]")?.value === "129000"');
await waitFor('!document.querySelector(".columns .primary").disabled');
const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile('D:/KoreaCRM/apps/pos/preview-sale.png', Buffer.from(screenshot.data, 'base64'));
await call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
const compact = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile('D:/KoreaCRM/apps/pos/preview-compact.png', Buffer.from(compact.data, 'base64'));
console.log('Saved POS preview screenshots');
socket.close();
