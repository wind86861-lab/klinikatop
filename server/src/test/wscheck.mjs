/**
 * Kabinet soketi tekshiruvi.
 *
 * Klinika va admin brauzerda `initData` yubormaydi — ular sessiya
 * tokeni bilan ulanadi (`Sec-WebSocket-Protocol`). Bu yo'l ilgari
 * umuman yo'q edi va kabinetda real vaqt ishlamasdi, shuning uchun
 * u alohida tekshiriladi.
 *
 * Kerak: server ishlab tursin (npm run dev).
 *   node src/test/wscheck.mjs <token>
 */
import WebSocket from 'ws';

const token = process.argv[2];
const URL = process.env.WS_URL ?? 'ws://127.0.0.1:8080/ws';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Ulanish TURIB QOLADIMI.
 *
 * Faqat `open` hodisasini kutish yetarli emas: qo'l berish har doim
 * muvaffaqiyatli bo'ladi, server esa huquqi yo'q mijozni shundan
 * KEYIN 4401 bilan yopadi. Shuning uchun ochilgandan so'ng biroz
 * kutamiz — ulanish tirik qolsa, demak qabul qilingan.
 */
function tryConnect(protocols) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL, protocols);
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* allaqachon yopiq */ }
      resolve(result);
    };
    ws.on('open', () => setTimeout(() => done({ open: ws.readyState === WebSocket.OPEN }), 600));
    ws.on('close', (code) => done({ open: false, code }));
    ws.on('error', () => { /* `close` baribir keladi */ });
    setTimeout(() => done({ open: false, code: 'timeout' }), 5000);
  });
}

console.log('\nKabinet soketi');

const anon = await tryConnect(undefined);
check('imzosiz ulanish rad etiladi', !anon.open, String(anon.code));

const bad = await tryConnect([`klinikatop.web.${'x'.repeat(40)}`]);
check('yaroqsiz token rad etiladi', !bad.open, String(bad.code));

const good = await tryConnect([`klinikatop.web.${token}`]);
check('kabinet tokeni bilan ulanadi', good.open === true, String(good.code ?? 'open'));

console.log(failed ? `\n${failed} ta yiqildi` : '\nHammasi o‘tdi');
process.exitCode = failed ? 1 : 0;
