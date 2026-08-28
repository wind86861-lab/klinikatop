/**
 * Yuklanishning BOSHIDA ekranda nima borligini ko'radi.
 *
 * "Ilova ochilmayapti" shikoyati odatda birinchi soniyalar haqida:
 * paket yuklanguncha ekranda hech narsa bo'lmasa, odam ilova buzilgan
 * deb o'ylaydi. Bu vosita aynan o'sha lahzani suratga oladi.
 *
 * Tarmoq va protsessor ataylab sekinlashtiriladi — O'zbekistondagi
 * oddiy telefon sharoiti, ishlab chiquvchining tez kompyuteri emas.
 *
 *   node server/src/test/early.mjs <url> <chiqish.png> [ms]
 */
import WebSocket from 'ws';

const [, , url, out, waitMs = 900] = process.argv;

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl, {
  perMessageDeflate: false,
});

let seq = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
});

await new Promise((r) => ws.once('open', r));
await send('Page.enable');
await send('Network.enable');

// Sekin 4G: 1.6 Mbit/s, 150 ms kechikish
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 150,
  downloadThroughput: 200_000,
  uploadThroughput: 100_000,
});
// O'rtacha telefon ishlab chiquvchi kompyuteridan taxminan shuncha sekin
await send('Emulation.setCPUThrottlingRate', { rate: 4 });
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
});

// Yuklanishni KUTMAYMIZ: maqsad — oraliq holatni ushlash
send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, Number(waitMs)));

const { data } = await send('Page.captureScreenshot', { format: 'png' });
(await import('node:fs')).writeFileSync(out, Buffer.from(data, 'base64'));

const text = await send('Runtime.evaluate', {
  expression: 'document.body.innerText.trim().slice(0, 60)',
  returnByValue: true,
});

console.log(`${waitMs} ms da ekranda:`, JSON.stringify(text.result.value));
ws.close();
