import { writeFile } from 'node:fs/promises';

const target = (await fetch('http://127.0.0.1:9223/json').then(response => response.json())).find(item => item.url === 'http://tauri.localhost/');
if (!target) throw Error('POS WebView not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let nextId = 0; const tasks = new Map();
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
try {
  await call('Runtime.evaluate', { expression: 'document.querySelector(".sales-history")?.scrollIntoView({block:"start"})' });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('D:/KoreaCRM/apps/pos/preview-history.png', Buffer.from(screenshot.data, 'base64'));
  console.log('D:/KoreaCRM/apps/pos/preview-history.png');
} finally { socket.close(); }
