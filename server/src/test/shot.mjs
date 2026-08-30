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

let seq = 0;
const pending = new Map();
const logs = [];

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    logs.push('[error] ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + msg.params.exceptionDetails.text);
  }
});

await new Promise((r) => ws.once('open', r));
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: +w,
  height: +h,
  deviceScaleFactor: 1,
  mobile: mobile === '1',
});

if (process.env.INIT_SCRIPT) {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: process.env.INIT_SCRIPT });
}

await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, +waitMs));

/*
 * CLICK_TEXT — sahifa yuklangach matni bo'yicha tugmani bosadi.
 * Admin panelidagi bo'limlar URL bilan emas, holat bilan almashadi,
 * shuning uchun ularni suratga olishning boshqa yo'li yo'q.
 */
if (process.env.CLICK_TEXT) {
  const clicked = await send('Runtime.evaluate', {
    expression: `(() => {
      const want = ${JSON.stringify(process.env.CLICK_TEXT)};
      const el = [...document.querySelectorAll('button, a')]
        .find((n) => (n.textContent || '').trim().includes(want));
      if (!el) return 'topilmadi';
      el.click();
      return 'bosildi';
    })()`,
    returnByValue: true,
  });
  logs.push('[click] ' + clicked.result.value);
  await new Promise((r) => setTimeout(r, 2500));
}

const info = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({h: document.body.scrollHeight, kids: document.getElementById("root").children.length})',
  returnByValue: true,
});

const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
const fs = await import('node:fs');
fs.writeFileSync(out, Buffer.from(data, 'base64'));

console.log(info.result.value, logs.length ? JSON.stringify(logs) : 'xatosiz');
ws.close();
