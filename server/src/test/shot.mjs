/**
 * Sahifa surati — o'lchamni ko'rsatib olish uchun.
 *
 * `drive.mjs` bemor ilovasi uchun telefon o'lchamini majburlaydi.
 * Kabinet va admin paneli esa brauzerda ochiladi va ularni ish stoli
 * enida ko'rish kerak — shuning uchun alohida vosita.
 *
 *   node server/src/test/shot.mjs <url> <chiqish.png> [en] [bo'y] [mobil] [kutish_ms]
 *
 * Telegram yoki kabinet sessiyasini INIT_SCRIPT orqali kiritish mumkin.
 */
import WebSocket from 'ws';
const [, , url, out, w = 1440, h = 1000, mobile = '0', waitMs = 3000] = process.argv;
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let seq = 0; const pending = new Map(); const logs = [];
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('[error] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + m.params.exceptionDetails.text);
});
await new Promise((r) => ws.once('open', r));
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: mobile === '1' });
if (process.env.INIT_SCRIPT) await send('Page.addScriptToEvaluateOnNewDocument', { source: process.env.INIT_SCRIPT });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, +waitMs));
const info = await send('Runtime.evaluate', { expression: 'JSON.stringify({h: document.body.scrollHeight, kids: document.getElementById("root").children.length})', returnByValue: true });
const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
const fs = await import('node:fs');
fs.writeFileSync(out, Buffer.from(data, 'base64'));
console.log(info.result.value, logs.length ? JSON.stringify(logs) : 'xatosiz');
ws.close();
import WebSocket from 'ws';
const [, , url, out, w = 1440, h = 1000, mobile = '0', waitMs = 3000] = process.argv;
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let seq = 0; const pending = new Map(); const logs = [];
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('[error] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + m.params.exceptionDetails.text);
});
await new Promise((r) => ws.once('open', r));
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: mobile === '1' });
if (process.env.INIT_SCRIPT) await send('Page.addScriptToEvaluateOnNewDocument', { source: process.env.INIT_SCRIPT });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, +waitMs));
const info = await send('Runtime.evaluate', { expression: 'JSON.stringify({h: document.body.scrollHeight, kids: document.getElementById("root").children.length})', returnByValue: true });
const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
const fs = await import('node:fs');
fs.writeFileSync(out, Buffer.from(data, 'base64'));
console.log(info.result.value, logs.length ? JSON.stringify(logs) : 'xatosiz');
ws.close();
