/**
 * Bemorning BRAUZERDAN kirishi — telefon raqami bo'yicha.
 *
 * ── Kod qaysi kanaldan keladi ──
 *
 * Ikki kanal bor va tartib TEJAMKORLIK bo'yicha:
 *
 *   1. TELEGRAM — hisobi bor odamga. Tekin, bir zumda, va raqam
 *      allaqachon o'sha hisobga bog'langan (`users.phone` ni
 *      `PATCH /me` qabul qilmaydi, u faqat Telegram kontaktidan
 *      to'ladi). Yangi ishonch talab qilmaydi.
 *   2. SMS — Telegramda umuman bo'lmagan odamga. Pul turadi,
 *      shuning uchun faqat boshqa yo'l qolmaganda.
 *
 * Shu sababli brauzerdan NOLDAN ro'yxatdan o'tish mumkin: raqam
 * bazada bo'lmasa ham kod SMS bilan yuboriladi va kod tasdiqlangach
 * hisob O'SHA YERDA yaratiladi.
 *
 * ── Bitta raqam = bitta hisob ──
 *
 * Raqam normallashtirilib qidiriladi (`998901234567`), bazada ham
 * shu ko'rinishda va noyob indeks bilan saqlanadi. Shuning uchun
 * "bir xil raqam" har doim bir xil hisobga olib boradi.
 */
import crypto from 'node:crypto';
import { db, tx } from '../db';
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from '../lib/errors';
import { hashPassword, passwordMatches } from './webAuth';
import { sendTelegramMessage } from '../lib/telegram';
import { sendSms, smsEnabled } from './sms';
import type { User } from '../../../shared/types';
import { mapUser } from '../lib/mappers';

/** Kod qancha yashaydi. Qisqa: o'g'irlangan kodning qiymati shuncha kam. */
const CODE_TTL_MIN = 5;
/** Necha marta xato kiritish mumkin — keyin kod kuyadi */
const MAX_ATTEMPTS = 5;
/** Sessiya muddati — bemor har kuni kod so'rab o'tirmasin */
const SESSION_DAYS = 30;
/** Bir raqamga soatiga nechta kod */
const CODES_PER_HOUR = 5;

/**
 * Telegramsiz hisoblar uchun AJRATILGAN identifikator diapazoni.
 *
 * `users.telegram_id` — `NOT NULL UNIQUE`, ya'ni har yozuvda
 * nimadir turishi shart. Bazada uch xil egasi bor:
 *
 *   musbat        — haqiqiy Telegram foydalanuvchisi
 *   -1 … -999999  — veb hisob, qiymati `-admin_users.id`
 *                   (`telegramChatFor` shunga tayanadi)
 *   bu diapazon   — brauzerdan ro'yxatdan o'tgan bemor
 *
 * Uchinchisi ikkinchisiga TEGMASLIGI shart: `telegramChatFor`
 * manfiy id ni `admin_users.id` deb qidiradi. Diapazon shu qadar
 * uzoqdaki, `admin_users` da bunday id hech qachon bo'lmaydi —
 * qidiruv bo'sh qaytadi va xabar jimgina o'tkazib yuboriladi. Bu
 * to'g'ri xatti-harakat: bunday odamning Telegram chati yo'q.
 *
 * Jadvalni qayta qurish (`telegram_id` ni `NULL` qilish) ham yo'l
 * edi, lekin `users` — bazadagi eng markaziy jadval va uni qayta
 * qurish bir marta ma'lumot yo'qotishga olib kelgan. Ajratilgan
 * diapazon xuddi shu natijani xavfsizroq beradi.
 */
const BROWSER_ID_BASE = -2_000_000_000;

/**
 * Raqamni yagona ko'rinishga keltiradi: faqat raqamlar, 998 bilan.
 *
 * Odam `+998 90 123-45-67`, `998901234567` va `901234567` ni bir xil
 * deb o'ylaydi — baza ham shunday o'ylashi kerak.
 */
export function normalizePhone(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;

  // 9 xonali mahalliy raqam — mamlakat kodi qo'shiladi
  const full = digits.length === 9 ? `998${digits}` : digits;

  // O'zbekiston raqami: 998 + 9 xona
  if (!/^998\d{9}$/.test(full)) return null;
  return full;
}

/**
 * Sessiya tokeni bazada XESH bo'lib saqlanadi (admin/klinika sessiyalari
 * kabi). Baza yoki zaxira nusxa sizib chiqsa ham undagi qiymat bilan
 * kirib bo'lmaydi — token faqat bemorning qurilmasida.
 */
export const sessionKey = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const hashCode = (phone: string, code: string) =>
  crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');

/** Vaqt bo'yicha sizib chiqmaydigan solishtirish */
function sameHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

interface PhoneUser {
  id: number;
  telegram_id: number;
  lang: string;
  password_hash: string | null;
}

function findByPhone(phone: string): PhoneUser | undefined {
  return db
    .prepare(`SELECT id, telegram_id, lang, password_hash FROM users WHERE phone = ? LIMIT 1`)
    .get(phone) as PhoneUser | undefined;
}

export type CodeChannel = 'telegram' | 'sms';

export interface CodeRequestResult {
  /** Shu raqamli hisob bormi — yo'q bo'lsa bu RO'YXATDAN O'TISH */
  found: boolean;
  /** Kod haqiqatan yetkazildimi */
  sent: boolean;
  /** Qaysi kanal ishlatildi — ekran shunga qarab matn yozadi */
  channel: CodeChannel | null;
}

/**
 * Kirish yoki ro'yxatdan o'tish uchun kod so'rash.
 *
 * Hisob BO'LMASA ham kod yuboriladi — bu ro'yxatdan o'tish yo'li.
 * Hisob kod tasdiqlangandan KEYIN yaratiladi (`verifyLoginCode`):
 * aks holda raqam terib chiqqan har kim bazada bo'sh yozuv
 * qoldirib ketardi.
 */
/**
 * Kod nima uchun so'ralmoqda:
 *   register — yangi hisob: raqam parol bilan band bo'lsa rad etiladi
 *   reset    — parolni tiklash: hisob bo'lishi shart
 *   login    — eski oqim (faqat lokal ishlab chiqishdagi ekran)
 */
export type CodePurpose = 'login' | 'register' | 'reset';

export async function requestLoginCode(
  rawPhone: string,
  ip: string | null,
  purpose: CodePurpose = 'login',
): Promise<CodeRequestResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw badRequest('bad_phone', 'Telefon raqamini to‘liq kiriting');

  /*
   * Maqsad tekshiruvi SMS'dan OLDIN — pullik xabar keraksiz ketmasin.
   * Parolsiz hisob (Telegramdan kelgan yoki ro'yxatdan o'tishni
   * yarim qoldirgan) ro'yxatdan o'ta oladi: raqam uning o'ziniki.
   */
  if (purpose !== 'login') {
    const owner = findByPhone(phone);
    if (purpose === 'register' && owner?.password_hash) {
      throw conflict(
        'already_registered',
        'Bu raqam allaqachon ro‘yxatdan o‘tgan. Kirish sahifasidan parol bilan kiring.',
      );
    }
    if (purpose === 'reset' && !owner?.password_hash) {
      throw badRequest('no_account', 'Bu raqam bilan parolli hisob topilmadi. Ro‘yxatdan o‘ting.');
    }
  }

  const recent = db
    .prepare(
      `SELECT COUNT(*) n FROM phone_login_codes
        WHERE phone = ? AND created_at >= datetime('now', '-1 hour')`,
    )
    .get(phone) as { n: number };
  if (recent.n >= CODES_PER_HOUR) {
    throw tooManyRequests('Juda ko‘p urinish. Bir soatdan keyin qayta urinib ko‘ring.', 3600);
  }

  const user = findByPhone(phone);

  /*
   * Kanal tanlash — TEJAMKORLIK bo'yicha.
   *
   * Telegram chati bor odamga bot yozadi: tekin va bir zumda.
   * Qolganiga SMS — u pul turadi, shuning uchun oxirgi yo'l.
   * `telegram_id <= 0` — veb hisob yoki brauzerdan ro'yxatdan
   * o'tgan bemor; ikkalasida ham chat yo'q.
   */
  const viaTelegram = Boolean(user && user.telegram_id > 0);
  const channel: CodeChannel | null = viaTelegram ? 'telegram' : smsEnabled() ? 'sms' : null;

  // Hech qanday kanal yo'q — kod yasashning ma'nosi yo'q
  if (!channel) return { found: Boolean(user), sent: false, channel: null };

  const code = String(crypto.randomInt(100_000, 1_000_000));

  db.prepare(
    `INSERT INTO phone_login_codes (phone, code_hash, expires_at, ip)
     VALUES (?, ?, datetime('now', '+${CODE_TTL_MIN} minutes'), ?)`,
  ).run(phone, hashCode(phone, code), ip);

  const ru = user?.lang === 'ru';
  let sent = false;

  if (viaTelegram) {
    const text = ru
      ? `Код для входа: <b>${code}</b>\n\nДействует ${CODE_TTL_MIN} минут. Если это не вы — просто не вводите его.`
      : `Kirish kodi: <b>${code}</b>\n\n${CODE_TTL_MIN} daqiqa amal qiladi. Agar bu siz bo‘lmasangiz — kiritmang.`;
    sent = await sendTelegramMessage(user!.telegram_id, text);
  } else {
    // SMS'da HTML yo'q va joy tor — matn qisqa
    const text = ru
      ? `KlinikaTop: код ${code}. Действует ${CODE_TTL_MIN} мин.`
      : `KlinikaTop: kod ${code}. ${CODE_TTL_MIN} daqiqa amal qiladi.`;
    sent = await sendSms(phone, text);
  }

  return { found: Boolean(user), sent, channel };
}

export interface PatientSession {
  token: string;
  expiresAt: string;
  user: User;
  /** Hisob AYNAN HOZIR yaratildimi — ilova onboardingga yuboradi */
  isNew: boolean;
}

/**
 * Telegramsiz bemor hisobini yaratadi.
 *
 * Faqat raqam va til ma'lum: ism, yosh, shahar keyin
 * `/register` ekranida to'ldiriladi (`profile_completed_at`
 * bo'sh qolgani uchun ilova o'zi o'sha yerga yo'naltiradi).
 *
 * `telegram_id` ikki qadamda qo'yiladi: qiymat `id` ga bog'liq,
 * `id` esa yozuv kiritilmaguncha ma'lum emas. Ikkalasi bitta
 * tranzaksiyada — yarim holat qolmaydi.
 */
function createBrowserUser(phone: string): number {
  return tx(() => {
    const info = db
      .prepare(
        `INSERT INTO users (telegram_id, first_name, lang, roles, phone)
         VALUES (?, '', 'uz', '["patient"]', ?)`,
      )
      /*
       * Vaqtinchalik qiymat ham AJRATILGAN diapazonda bo'lishi
       * kerak: `NOT NULL UNIQUE` bo'sh qoldirmaydi, tasodifiy
       * raqam esa mavjud yozuvga urilishi mumkin edi.
       */
      .run(BROWSER_ID_BASE - Date.now(), phone);

    const id = Number(info.lastInsertRowid);
    db.prepare(`UPDATE users SET telegram_id = ? WHERE id = ?`).run(BROWSER_ID_BASE - id, id);
    return id;
  });
}

/** Kodni tekshirib, brauzer sessiyasini beradi. */
export function verifyLoginCode(
  rawPhone: string,
  rawCode: string,
  ip: string | null,
  userAgent: string | null,
): PatientSession {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw badRequest('bad_phone', 'Telefon raqamini to‘liq kiriting');

  const code = String(rawCode ?? '').replace(/\D/g, '');
  if (code.length !== 6) throw badRequest('bad_code', 'Kod 6 raqamdan iborat');

  const row = db
    .prepare(
      `SELECT * FROM phone_login_codes
        WHERE phone = ? AND consumed_at IS NULL AND expires_at > datetime('now')
        ORDER BY id DESC LIMIT 1`,
    )
    .get(phone) as
    | { id: number; code_hash: string; attempts: number }
    | undefined;

  if (!row) throw unauthorized('Kod eskirgan yoki yo‘q. Yangisini so‘rang.');

  if (row.attempts >= MAX_ATTEMPTS) {
    db.prepare(`UPDATE phone_login_codes SET consumed_at = datetime('now') WHERE id = ?`).run(row.id);
    throw unauthorized('Juda ko‘p xato urinish. Yangi kod so‘rang.');
  }

  if (!sameHash(row.code_hash, hashCode(phone, code))) {
    db.prepare(`UPDATE phone_login_codes SET attempts = attempts + 1 WHERE id = ?`).run(row.id);
    throw unauthorized('Kod noto‘g‘ri');
  }

  // Kod BIR MARTALIK: to'g'ri kelgan zahoti kuyadi
  db.prepare(`UPDATE phone_login_codes SET consumed_at = datetime('now') WHERE id = ?`).run(row.id);

  /*
   * Hisob bo'lmasa — SHU YERDA yaratiladi. Kod tasdiqlangani
   * raqam haqiqatan shu odamniki ekanini bildiradi, ya'ni
   * ro'yxatdan o'tish uchun boshqa hech narsa kerak emas.
   */
  const existing = findByPhone(phone);
  const isNew = !existing;
  const userId = existing?.id ?? createBrowserUser(phone);

  // Kod bilan ochilgan sessiya — faqat shundan parol o'rnatish mumkin
  return openSession(userId, ip, userAgent, true, isNew);
}

function openSession(
  userId: number,
  ip: string | null,
  userAgent: string | null,
  viaCode: boolean,
  isNew: boolean,
): PatientSession {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO patient_sessions (token, user_id, ip, user_agent, expires_at, code_verified_at)
     VALUES (?, ?, ?, ?, datetime('now', '+${SESSION_DAYS} days'), ${viaCode ? "datetime('now')" : 'NULL'})`,
  ).run(sessionKey(token), userId, ip, userAgent);

  const expiresAt = db
    .prepare(`SELECT expires_at FROM patient_sessions WHERE token = ?`)
    .get(sessionKey(token)) as { expires_at: string };

  return {
    token,
    expiresAt: new Date(expiresAt.expires_at.replace(' ', 'T') + 'Z').toISOString(),
    user: mapUser(db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId)),
    isNew,
  };
}

/** Sessiya tokenidan foydalanuvchini topadi. Muddati o'tgani ishlamaydi. */
export function resolvePatientSession(token: string): User | null {
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.* FROM patient_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(sessionKey(token)) as Record<string, unknown> | undefined;

  return row ? mapUser(row) : null;
}

export function endPatientSession(token: string): void {
  db.prepare(`DELETE FROM patient_sessions WHERE token = ?`).run(sessionKey(token));
}

/** Eskirgan sessiya va kodlarni tozalash — rejalashtiruvchi chaqiradi. */
export function purgePatientAuth(): number {
  const a = db.prepare(`DELETE FROM patient_sessions WHERE expires_at <= datetime('now')`).run();
  const b = db
    .prepare(`DELETE FROM phone_login_codes WHERE created_at <= datetime('now', '-1 day')`)
    .run();
  return a.changes + b.changes;
}

/* ═════════════════  Parol bilan kirish  ═════════════════ */

/** Ketma-ket nechta xato — keyin hisob vaqtincha yopiladi */
const MAX_LOGIN_FAILS = 5;
const LOCK_MINUTES = 15;
/** Kod bilan ochilgan sessiya parol o'rnatish uchun qancha "yangi" hisoblanadi */
const FRESH_CODE_MINUTES = 15;

/**
 * Bemor paroli talabi. Klinikadan (10 belgi) yumshoqroq: bemor
 * telefondan yozadi, himoyaning asosiy qismi esa bloklash va kod.
 */
export function assertPatientPassword(password: string): void {
  if (password.length < 8) throw badRequest('weak_password', 'Parol kamida 8 belgidan iborat bo‘lsin');
  if (password.length > 200) throw badRequest('weak_password', 'Parol juda uzun');
  if (/^\d+$/.test(password)) throw badRequest('weak_password', 'Faqat raqamlardan iborat parol bo‘lmaydi');
}

/**
 * Telefon + parol bilan kirish. SMS YO'Q.
 *
 * Xato xabari bitta: "raqam yoki parol noto'g'ri" — qaysi biri
 * xatoligini aytish hisob borligini oshkor qilardi.
 */
export function loginWithPassword(
  rawPhone: string,
  password: string,
  ip: string | null,
  userAgent: string | null,
): PatientSession {
  const wrong = () => unauthorized('Raqam yoki parol noto‘g‘ri');
  const phone = normalizePhone(rawPhone);
  if (!phone) throw wrong();

  const row = db
    .prepare(
      `SELECT id, password_salt, password_hash, login_failed, login_locked_until, blocked_at
         FROM users WHERE phone = ? LIMIT 1`,
    )
    .get(phone) as
    | {
        id: number;
        password_salt: string | null;
        password_hash: string | null;
        login_failed: number;
        login_locked_until: string | null;
        blocked_at: string | null;
      }
    | undefined;

  if (!row?.password_hash || !row.password_salt) {
    // Vaqt bo'yicha farq qilmasin: hisob bo'lmasa ham xesh hisoblanadi
    hashPassword(password, 'x'.repeat(32));
    throw wrong();
  }

  if (row.login_locked_until && new Date(row.login_locked_until.replace(' ', 'T') + 'Z') > new Date()) {
    throw tooManyRequests(`Juda ko‘p xato urinish. ${LOCK_MINUTES} daqiqadan keyin qayta urinib ko‘ring.`, LOCK_MINUTES * 60);
  }

  if (!passwordMatches(password, row.password_salt, row.password_hash)) {
    const fails = row.login_failed + 1;
    db.prepare(
      `UPDATE users SET login_failed = ?, login_locked_until = ${fails >= MAX_LOGIN_FAILS ? `datetime('now', '+${LOCK_MINUTES} minutes')` : 'NULL'}
        WHERE id = ?`,
    ).run(fails >= MAX_LOGIN_FAILS ? 0 : fails, row.id);
    throw wrong();
  }

  if (row.blocked_at) throw forbidden('Hisobingiz bloklangan');

  db.prepare(`UPDATE users SET login_failed = 0, login_locked_until = NULL WHERE id = ?`).run(row.id);
  return openSession(row.id, ip, userAgent, false, false);
}

/**
 * Parol o'rnatish yoki tiklash.
 *
 * Faqat KOD bilan yaqinda ochilgan sessiyadan. Parol bilan kirgan
 * sessiya (u o'g'irlangan bo'lishi ham mumkin) parolni o'zgartira
 * olmaydi — buning uchun raqamga kelgan kod kerak.
 *
 * Parol o'zgargach shu odamning BOSHQA sessiyalari yopiladi: tiklash
 * odatda "kimdir kirib olgan" gumonidan qilinadi.
 */
export function setPatientPassword(token: string, password: string): void {
  const session = db
    .prepare(
      `SELECT user_id,
              code_verified_at IS NOT NULL
                AND code_verified_at > datetime('now', '-${FRESH_CODE_MINUTES} minutes') AS fresh
         FROM patient_sessions
        WHERE token = ? AND expires_at > datetime('now')`,
    )
    .get(sessionKey(token)) as { user_id: number; fresh: number } | undefined;

  if (!session) throw unauthorized('Sessiya topilmadi. Qaytadan kod oling.');
  if (!session.fresh) throw forbidden('Parolni o‘zgartirish uchun raqamingizga kelgan kod bilan qayta tasdiqlang.');

  assertPatientPassword(password);

  const salt = crypto.randomBytes(16).toString('hex');
  tx(() => {
    db.prepare(
      `UPDATE users SET password_salt = ?, password_hash = ?, password_set_at = datetime('now'),
              login_failed = 0, login_locked_until = NULL
        WHERE id = ?`,
    ).run(salt, hashPassword(password, salt), session.user_id);
    db.prepare(`DELETE FROM patient_sessions WHERE user_id = ? AND token != ?`).run(session.user_id, sessionKey(token));
    // Kod bir marta ishlatildi — shu sessiyadan qayta parol almashtirib bo'lmaydi
    db.prepare(`UPDATE patient_sessions SET code_verified_at = NULL WHERE token = ?`).run(sessionKey(token));
  });
}

/* ═════════════════  Telegram ichidan parol (saytga kirish uchun)  ═════════════════ */

export interface WebLoginStatus {
  /** Saytda kiriladigan raqam (998XXXXXXXXX) — botda kontakt bilan tasdiqlangan */
  phone: string | null;
  hasPassword: boolean;
  passwordSetAt: string | null;
}

export function webLoginStatus(userId: number): WebLoginStatus {
  const row = db.prepare(`SELECT phone, password_hash, password_set_at FROM users WHERE id = ?`).get(userId) as
    | { phone: string | null; password_hash: string | null; password_set_at: string | null }
    | undefined;
  return {
    phone: row?.phone ? normalizePhone(row.phone) : null,
    hasPassword: Boolean(row?.password_hash),
    passwordSetAt: row?.password_set_at ? new Date(row.password_set_at.replace(' ', 'T') + 'Z').toISOString() : null,
  };
}

/**
 * Parol qo'yish yoki o'zgartirish — TELEGRAM ichidan.
 *
 * SMS kod kerak emas: shaxs Telegram imzosi bilan aniqlangan, raqam
 * esa botda kontakt bilan tasdiqlangan. Eski parol ham so'ralmaydi —
 * Telegram hisobi o'zi yetarli dalil (va eski parolni unutgan odam
 * aynan shu yo'l bilan tiklaydi).
 *
 * Raqam shu yerda 998XXXXXXXXX ko'rinishiga keltiriladi: bot kontaktni
 * Telegram qanday bersa shunday saqlaydi (`+998…`), sayt esa
 * normallashgan raqam bo'yicha qidiradi — aks holda parol qo'yilgan
 * bo'lsa ham saytdan kirib bo'lmasdi.
 *
 * Parol o'zgarganda shu odamning BRAUZER sessiyalari yopiladi.
 */
export function setPasswordFromTelegram(userId: number, password: string): WebLoginStatus {
  const user = db.prepare(`SELECT id, telegram_id, phone FROM users WHERE id = ?`).get(userId) as
    | { id: number; telegram_id: number; phone: string | null }
    | undefined;
  if (!user || user.telegram_id <= 0) throw forbidden('Parol Telegram ilovasi orqali qo‘yiladi');
  const phone = user.phone ? normalizePhone(user.phone) : null;
  if (!phone) {
    throw badRequest('phone_required', 'Avval botda /start bosib 📱 telefon raqamingizni ulashing.');
  }

  const other = db.prepare(`SELECT id FROM users WHERE phone = ? AND id != ?`).get(phone, userId) as { id: number } | undefined;
  if (other) {
    throw conflict(
      'phone_taken',
      'Bu raqam bilan saytda alohida hisob ochilgan. Saytdagi «Parolni tiklash» orqali kiring yoki qo‘llab-quvvatlashga yozing.',
    );
  }

  assertPatientPassword(password);
  const salt = crypto.randomBytes(16).toString('hex');
  tx(() => {
    db.prepare(
      `UPDATE users SET phone = ?, password_salt = ?, password_hash = ?, password_set_at = datetime('now'),
              login_failed = 0, login_locked_until = NULL
        WHERE id = ?`,
    ).run(phone, salt, hashPassword(password, salt), userId);
    db.prepare(`DELETE FROM patient_sessions WHERE user_id = ?`).run(userId);
  });
  return webLoginStatus(userId);
}
