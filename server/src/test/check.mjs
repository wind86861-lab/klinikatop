/** Sahifani ochib, konsol xatolari va ekrandagi matnni qaytaradi. */
import WebSocket from 'ws';
const [, , url, waitMs = 6000] = process.argv;
const t = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl, { perMessageDeflate: false });
let seq = 0; const pending = new Map(); const logs = [];
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    logs.push('[error] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method === 'Runtime.exceptionThrown')
    logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200));
});
await new Promise((r) => ws.once('open', r));
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
if (process.env.INIT_SCRIPT) await send('Page.addScriptToEvaluateOnNewDocument', { source: process.env.INIT_SCRIPT });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, Number(waitMs)));
const txt = await send('Runtime.evaluate', { expression: 'document.body.innerText.trim().slice(0,70).replace(/\\n/g," / ")', returnByValue: true });
console.log('ekran:', JSON.stringify(txt.result.value));
console.log('xatolar:', logs.length ? logs.join(' || ') : 'YO\'Q');
ws.close();
