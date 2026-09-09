/* Birinchi bo'yash vaqti — keshsiz, sekin 4G taqlidi bilan. */
import WebSocket from 'ws';
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let seq = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, {res, rej}); ws.send(JSON.stringify({id, method: m, params: p})); });
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { const {res, rej} = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
await new Promise((r) => ws.once('open', r));
await send('Page.enable'); await send('Network.enable');
await send('Network.clearBrowserCache');
await send('Network.emulateNetworkConditions', {
  offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8,
});
await send('Page.navigate', { url: process.argv[2] });
await new Promise((r) => setTimeout(r, 12000));
const out = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1),
    domInteractive: Math.round(performance.timing.domInteractive - performance.timing.navigationStart),
    soralgan: performance.getEntriesByType('resource').length,
  })`, returnByValue: true });
console.log(process.argv[3] ?? '', out.result.value);
ws.close();
