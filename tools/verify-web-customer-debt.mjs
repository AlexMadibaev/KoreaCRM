import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const login = await fetch('http://127.0.0.1:3005/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'demo', password: 'demo1234' }) });
assert.equal(login.status, 200);
const { accessToken } = await login.json();
const target = (await fetch('http://127.0.0.1:9225/json').then(response => response.json())).find(item => item.url.startsWith('http://127.0.0.1:3004/'));
assert.ok(target);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const tasks = new Map(); let nextId = 0;
socket.addEventListener('message', event => { const reply = JSON.parse(event.data); const task = tasks.get(reply.id); if (task) { tasks.delete(reply.id); reply.error ? task.reject(Error(reply.error.message)) : task.resolve(reply.result); } });
function call(method, params = {}) { const id = ++nextId; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => tasks.set(id, { resolve, reject })); }
async function evaluate(expression) { const reply = await call('Runtime.evaluate', { expression, returnByValue: true }); if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text); return reply.result.value; }
async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw Error(`Timed out: ${expression}; ${await evaluate('document.body.innerText.slice(-1200)')}`); }
try {
  await call('Page.enable'); await call('Runtime.enable');
  await evaluate(`sessionStorage.setItem('accessToken', ${JSON.stringify(accessToken)})`);
  await call('Page.navigate', { url: 'http://127.0.0.1:3004/customers' });
  await waitFor('document.body.innerText.includes("Мария Ким")');
  await evaluate('Array.from(document.querySelectorAll("li button")).find(button => button.parentElement?.textContent.includes("Мария Ким"))?.click()');
  await evaluate('Array.from(document.querySelectorAll("[role=tab]")).find(button => button.textContent === "Долги")?.click()');
  await waitFor('document.body.innerText.includes("Долг по продаже")');
  assert.ok(await evaluate('Array.from(document.querySelectorAll("dt")).find(node => node.textContent === "Персональная скидка")?.nextElementSibling?.textContent === "10%"'));
  assert.ok(await evaluate('document.body.innerText.includes("Погашение долга")'));
  assert.ok(await evaluate('/Текущий долг:\\s*1\\s*400\\s*сомони/u.test(document.body.innerText)'));
  assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile('D:/KoreaCRM/apps/web/preview-customer-debt.png', Buffer.from(screenshot.data, 'base64'));
  if (process.argv.includes('--edit-discount')) {
    try {
      await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Редактировать")?.click()');
      await waitFor('!!document.querySelector("textarea")');
      await evaluate(`(() => { const input = document.querySelector('form:has(textarea) input[inputmode=decimal]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '12,5'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await evaluate(`(() => { const input = document.querySelector('form:has(textarea) input[type=date]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '1998-08-21'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await evaluate(`(() => { const input = document.querySelector('form:has(textarea) input[maxlength="500"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Ташкент, Юнусабад'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await evaluate(`(() => { const select = document.querySelector('form:has(textarea) select'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'Женский'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await evaluate('document.querySelector("form:has(textarea)")?.requestSubmit()');
      await waitFor('Array.from(document.querySelectorAll("dt")).find(node => node.textContent === "Персональная скидка")?.nextElementSibling?.textContent === "12.5%"');
      assert.ok(await evaluate('document.body.innerText.includes("21.08.1998") && document.body.innerText.includes("Ташкент, Юнусабад")'));
      const changed = await fetch('http://127.0.0.1:3005/customers/demo-customer-2', { headers: { Authorization: `Bearer ${accessToken}` } }).then(response => response.json());
      assert.equal(changed.gender, 'Женский');
      assert.equal(changed.birthday, '1998-08-21T00:00:00.000Z');
    } finally {
      await fetch('http://127.0.0.1:3005/customers/demo-customer-2', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ discountPercent: '10', birthday: null, gender: null, address: 'Ташкент, Чиланзар' }) });
    }
  }
  if (process.argv.includes('--pay')) {
    await evaluate(`(() => { const form = [...document.querySelectorAll('form')].find(form => form.textContent.includes('Погасить долг')); const select = [...form.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'demo-card')); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'demo-card'); select.dispatchEvent(new Event('change', { bubbles: true })); const input = form.querySelector('input[inputmode=decimal]'); const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; inputSetter.call(input, '100'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await evaluate('Array.from(document.querySelectorAll("form button")).find(button => button.textContent === "Погасить долг")?.click()');
    await waitFor('/Текущий долг:\\s*1\\s*300\\s*сомони/u.test(document.body.innerText)');
    await waitFor('document.body.innerText.includes("−100 сомони")');
    assert.equal(await evaluate('document.querySelector("[role=alert]")?.textContent ?? ""'), '');
  }
  console.log(JSON.stringify({ debtSale: true, payment: true, balance: true }));
} finally { socket.close(); }
