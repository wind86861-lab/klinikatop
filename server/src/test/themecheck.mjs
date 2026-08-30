/**
 * Mavzu izchilligini tekshiradi.
 *
 * Qidirilayotgan xato: `html` foni bilan CSS tokenlari bir-biriga mos
 * kelmasligi. Mos kelmasa ekran ikkiga bo'linadi — yuqorisi qorong'i,
 * pasti yorug'. Bu xato ikki marta qaytgan, shuning uchun tekshiruv
 * shu yerda qoladi.
 *
 *   node server/src/test/themecheck.mjs <url> [init-script]
 *
 * To'rt holat tekshiriladi: sukut (yorug' bo'lishi shart), `auto` +
 * qorong'i tizim, `auto` + yorug' tizim, va aniq tanlangan qorong'i.
 */
import WebSocket from 'ws';

const [, , url, initScript = ''] = process.argv;
if (!url) throw new Error('url kerak');

const CASES = [
  { name: 'sukut (tanlovsiz)', theme: null, media: 'dark', want: 'light' },
  { name: 'auto + tizim qorong‘i', theme: 'auto', media: 'dark', want: 'dark' },
  { name: 'auto + tizim yorug‘', theme: 'auto', media: 'light', want: 'light' },
  { name: 'tanlov: qorong‘i', theme: 'dark', media: 'light', want: 'dark' },
  { name: 'tanlov: yorug‘', theme: 'light', media: 'dark', want: 'light' },
];

const BG = { light: 'rgb(234, 240, 238)', dark: 'rgb(12, 24, 23)' };

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('Chrome sahifasi topilmadi');

let pass = 0;
let fail = 0;

for (const c of CASES) {
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
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
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
  });
  await new Promise((r) => ws.once('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: c.media }],
  });
  const store = c.theme
    ? `localStorage.setItem('klinikatop.theme', '${c.theme}');`
    : `localStorage.removeItem('klinikatop.theme');`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript + store });
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 4000));

  const got = JSON.parse(
    (
      await send('Runtime.evaluate', {
        expression: `JSON.stringify({
          mark: document.documentElement.getAttribute('data-theme'),
          html: getComputedStyle(document.documentElement).backgroundColor,
          body: getComputedStyle(document.body).backgroundColor
        })`,
        returnByValue: true,
      })
    ).result.value,
  );
  ws.close();

  // Uchalasi ham bir xil bo'lishi SHART — farq bo'lsa ekran bo'linadi
  const ok = got.mark === c.want && got.html === BG[c.want] && got.body === BG[c.want];
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${c.name} → ${got.mark} / ${got.html}`);
}

console.log(`\nMavzu: ${pass} o'tdi, ${fail} yiqildi`);
process.exit(fail ? 1 : 0);
