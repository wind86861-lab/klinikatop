/**
 * Kirish eshiklarini brauzerda tekshiradi.
 *
 * Klinika `/kabinet` dan, administrator `/admin/login` dan kiradi.
 * Serverdagi tekshiruv `run.ts` va `http.sh` da qamrab olingan; bu
 * yerda BRAUZER xulqi sinaladi — noto'g'ri eshikdagi xabar, kirgandan
 * keyin qayerga tushishi va sessiyasiz odam qaysi sahifaga borishi.
 *
 * Bular faqat brauzerda ko'rinadi: ilova tokenni bir marta o'qiydi va
 * bu yerda bir vaqtlar odam parolni to'g'ri kiritsa ham kirish
 * sahifasida qolib ketadigan xato bo'lgan.
 *
 * Kerak:
 *   • server        — npm run dev (server/)
 *   • vite          — npm run dev (webapp/)
 *   • chrome        — google-chrome --headless=new --remote-debugging-port=9222
 *
 * Ishlatish (server/ ichida):
 *   node src/test/logincheck.mjs
 *
 * Sinov hisoblarini o'zi yaratadi.
 */
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const CLINIC_PHONE = '998900000501';
const ADMIN_PHONE = '998900000502';
const PASSWORD = 'sinov-paroli-2026';

/* ── Hisoblar ── */
execFileSync(
  'npx',
  [
    'tsx',
    '-e',
    `
    const wa = require('./src/services/webAuth');
    const { db } = require('./src/db');
    for (const p of ['${CLINIC_PHONE}', '${ADMIN_PHONE}']) {
      db.prepare('DELETE FROM admin_users WHERE phone = ?').run(p);
    }
    const clinicId = db.prepare('SELECT id FROM clinics LIMIT 1').get().id;
    const c = wa.createAccount({ phone: '${CLINIC_PHONE}', fullName: 'Eshik Klinika', level: 'clinic_admin', clinicId });
    wa.completeSetup(c.setupToken, '${PASSWORD}');
    const a = wa.createAccount({ phone: '${ADMIN_PHONE}', fullName: 'Eshik Admin', level: 'full', clinicId: null });
    wa.completeSetup(a.setupToken, '${PASSWORD}');
    `,
  ],
  { stdio: 'inherit' },
);

/* ── Brauzer ── */
const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });

let seq = 0;
const pending = new Map();
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
  }
});

await new Promise((r) => ws.once('open', r));
await send('Page.enable');
await send('Runtime.enable');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evalx = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

const go = async (path) => {
  await send('Page.navigate', { url: WEB + path });
  await wait(2500);
};

/*
 * Qiymatni React ko'radigan qilib qo'yamiz.
 *
 * `el.value = x` React'ning ichki nusxasini yangilamaydi va o'zgarish
 * yo'qoladi — shuning uchun asl setter chaqiriladi.
 */
const fill = async (phone) => {
  await evalx(`(() => {
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const ins = document.querySelectorAll('.wa__form input');
    set(ins[0], ${JSON.stringify(phone)});
    set(ins[1], ${JSON.stringify(PASSWORD)});
    return 'ok';
  })()`);
  await wait(200);
  await evalx(`document.querySelector('.wa__form button[type=submit]').click(), 'ok'`);
  await wait(2000);
};

const notice = () => evalx(`(document.querySelector('.notice') || {}).textContent || ''`);
const where = () => evalx('location.pathname');
const clear = () => evalx(`localStorage.clear(), 'ok'`);

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('\nKirish eshiklari');

await go('/kabinet');
await clear();

await go('/kabinet');
await fill(ADMIN_PHONE);
check('admin klinika eshigidan o‘tolmaydi', (await where()) === '/kabinet' && /admin\/login/.test(await notice()));

await go('/admin/login');
await fill(CLINIC_PHONE);
check('klinika admin eshigidan o‘tolmaydi', (await where()) === '/admin/login' && /kabinet/.test(await notice()));

await go('/admin/login');
await fill(ADMIN_PHONE);
check('admin o‘z eshigidan kirdi', (await where()) === '/admin', await where());

await clear();
await go('/admin');
check('sessiyasiz /admin → /admin/login', (await where()) === '/admin/login', await where());

await go('/clinic');
check('sessiyasiz /clinic → /kabinet', (await where()) === '/kabinet', await where());

await go('/kabinet');
await fill(CLINIC_PHONE);
check('klinika o‘z eshigidan kirdi', (await where()).startsWith('/clinic'), await where());

console.log(failed ? `\n${failed} ta yiqildi` : '\nHammasi o‘tdi');
ws.close();
process.exitCode = failed ? 1 : 0;
