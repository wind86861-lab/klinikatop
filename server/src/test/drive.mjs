/**
 * Brauzer drayveri — Chrome DevTools Protocol orqali (qo'shimcha paketsiz).
 * Ilovani haqiqiy brauzerda ochadi, konsol xatolarini yig'adi va surat oladi.
 *
 *   node server/src/test/drive.mjs <url> <chiqish.png> [kutish_ms]
 */
import WebSocket from 'ws';

const [, , url, out, waitMsArg, ...actions] = process.argv;
const waitMs = Number(waitMsArg ?? 3500);

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('Chrome sahifasi topilmadi');

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
  // Konsol xatolari va ushlanmagan istisnolar — ilova jim yiqilmasin
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push(`[exception] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`);
  }
});

await new Promise((r) => ws.once('open', r));

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});

/*
 * Sahifa yuklanishidan OLDIN kiritiladigan skript.
 *
 * Imzosiz kirish olib tashlangandan keyin brauzerda sinash uchun Telegram
 * ko'prigini taqlid qilish kerak bo'ldi. Ilova `window.Telegram` ni modul
 * yuklanganda o'qiydi, shuning uchun uni navigatsiyadan keyin qo'yish kech —
 * `addScriptToEvaluateOnNewDocument` esa har yuklanishda birinchi bo'lib
 * ishlaydi.
 *
 *   INIT_SCRIPT="window.Telegram = {...}" node drive.mjs ...
 */
if (process.env.INIT_SCRIPT) {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: process.env.INIT_SCRIPT });
}

await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, waitMs));

/**
 * Harakatlar: `click:<matn>` yoki `js:<ifoda>`.
 * Matn bo'yicha bosish — foydalanuvchi ko'rgan narsani bosadi, CSS selektorga bog'lanmaydi.
 */
for (const action of actions) {
  const [kind, ...rest] = action.split(':');
  const arg = rest.join(':');

  if (kind === 'click') {
    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        const needle = ${JSON.stringify(arg)}.toLowerCase();
        const els = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], .list-item, .chip, .card--interactive')];
        const hit = els.find((e) => (e.textContent || '').toLowerCase().includes(needle));
        if (!hit) return 'TOPILMADI';
        hit.click();
        return 'OK';
      })()`,
      returnByValue: true,
    });
    if (res.result.value !== 'OK') logs.push(`[drive] bosib bo'lmadi: ${arg}`);
  } else if (kind === 'wait') {
    await new Promise((r) => setTimeout(r, Number(arg)));
  } else if (kind === 'js') {
    await send('Runtime.evaluate', { expression: arg, returnByValue: true });
  }

  await new Promise((r) => setTimeout(r, 1400));
}

const probe = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    path: location.pathname,
    title: document.querySelector('.app-header__title, .onb__title')?.textContent ?? null,
    screens: document.querySelectorAll('.screen, .onb').length,
    rootChildren: document.getElementById('root')?.childElementCount ?? 0,
  })`,
  returnByValue: true,
});

const info = JSON.parse(probe.result.value);

if (out) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
}

console.log(JSON.stringify({ ...info, logs }, null, 2));
ws.close();
