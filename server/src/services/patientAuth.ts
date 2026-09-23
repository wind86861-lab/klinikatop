/**
 * Bemorning BRAUZERDAN kirishi — telefon raqami bo'yicha.
 *
 * ── Kod qayerdan keladi ──
 *
 * SMS emas, TELEGRAM. Sababi ikkita va ikkalasi ham amaliy:
 *
 *   1. SMS provayderi ulanmagan va u pul turadi. Telegram boti
 *      allaqachon bor va tekin.
 *   2. `users.phone` ning O'ZI Telegram tasdiqlagan raqam —
 *      `PATCH /me` uni ataylab qabul qilmaydi. Ya'ni raqam va
 *      Telegram hisobi allaqachon bog'langan; kodni o'sha kanalga
 *      yuborish hech qanday yangi ishonch talab qilmaydi.
 *
 * CHEGARASI ochiq aytilsin: Telegramda hech qachon bo'lmagan odam
 * brauzerdan RO'YXATDAN O'TA OLMAYDI — unga kod yuboradigan kanal
 * yo'q. Brauzer — allaqachon ro'yxatdan o'tgan odam uchun ikkinchi
 * eshik. Brauzerdan ro'yxatdan o'tish kerak bo'lsa, SMS provayderi
 * ulanadi va shu yerga ikkinchi kanal bo'lib qo'shiladi.
 *
 * ── Bitta raqam = bitta hisob ──
 *
 * Raqam normallashtirilib qidiriladi (`998901234567`), bazada ham
 * shu ko'rinishda va noyob indeks bilan saqlanadi. Shuning uchun
 * "bir xil raqam" har doim bir xil hisobga olib boradi.
 */
import crypto from 'node:crypto';
import { db } from '../db';
import { badRequest, tooManyRequests, unauthorized } from '../lib/errors';
import { sendTelegramMessage } from '../lib/telegram';
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

const hashCode = (phone: string, code: string) =>
  crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');

/** Vaqt bo'yicha sizib chiqmaydigan solishtirish */
function sameHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function findByPhone(phone: string): { id: number; telegram_id: number; lang: string } | undefined {
  return db
    .prepare(`SELECT id, telegram_id, lang FROM users WHERE phone = ? LIMIT 1`)
    .get(phone) as { id: number; telegram_id: number; lang: string } | undefined;
}

export interface CodeRequestResult {
  /** Shu raqamli hisob topildimi */
  found: boolean;
  /** Kod haqiqatan yuborildimi (bot javob bermasligi mumkin) */
  sent: boolean;
}

/**
 * Kirish kodini so'rash.
 *
 * Hisob topilmasa ham xato QAYTARILMAYDI, `found: false` qaytadi:
 * ilova "avval botdan ro'yxatdan o'ting" deb yo'l ko'rsatishi kerak.
 * Bu raqam bor-yo'qligini bilib olish imkonini beradi, lekin bu
 * baribir ochiq ma'lumot emas va chastota cheklangan — foydasi
 * zararidan ko'p.
 */
export async function requestLoginCode(rawPhone: string, ip: string | null): Promise<CodeRequestResult> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw badRequest('bad_phone', 'Telefon raqamini to‘liq kiriting');

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
  if (!user) return { found: false, sent: false };

  /*
   * Bot faqat MUSBAT `telegram_id` ga yoza oladi. Manfiysi — veb
   * hisob (klinika/admin), unda chat yo'q va kod yetib bormaydi.
   */
  if (user.telegram_id <= 0) return { found: true, sent: false };

  const code = String(crypto.randomInt(100_000, 1_000_000));

  db.prepare(
    `INSERT INTO phone_login_codes (phone, code_hash, expires_at, ip)
     VALUES (?, ?, datetime('now', '+${CODE_TTL_MIN} minutes'), ?)`,
  ).run(phone, hashCode(phone, code), ip);

  const text =
    user.lang === 'ru'
      ? `Код для входа: <b>${code}</b>\n\nДействует ${CODE_TTL_MIN} минут. Если это не вы — просто не вводите его.`
      : `Kirish kodi: <b>${code}</b>\n\n${CODE_TTL_MIN} daqiqa amal qiladi. Agar bu siz bo‘lmasangiz — kiritmang.`;

  const sent = await sendTelegramMessage(user.telegram_id, text);
  return { found: true, sent };
}

export interface PatientSession {
  token: string;
  expiresAt: string;
  user: User;
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

  const user = findByPhone(phone);
  if (!user) throw unauthorized('Hisob topilmadi');

  // Kod BIR MARTALIK: to'g'ri kelgan zahoti kuyadi
  db.prepare(`UPDATE phone_login_codes SET consumed_at = datetime('now') WHERE id = ?`).run(row.id);

  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO patient_sessions (token, user_id, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', '+${SESSION_DAYS} days'))`,
  ).run(token, user.id, ip, userAgent);

  const expiresAt = db
    .prepare(`SELECT expires_at FROM patient_sessions WHERE token = ?`)
    .get(token) as { expires_at: string };

  return {
    token,
    expiresAt: new Date(expiresAt.expires_at.replace(' ', 'T') + 'Z').toISOString(),
    user: mapUser(db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id)),
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
    .get(token) as Record<string, unknown> | undefined;

  return row ? mapUser(row) : null;
}

export function endPatientSession(token: string): void {
  db.prepare(`DELETE FROM patient_sessions WHERE token = ?`).run(token);
}

/** Eskirgan sessiya va kodlarni tozalash — rejalashtiruvchi chaqiradi. */
export function purgePatientAuth(): number {
  const a = db.prepare(`DELETE FROM patient_sessions WHERE expires_at <= datetime('now')`).run();
  const b = db
    .prepare(`DELETE FROM phone_login_codes WHERE created_at <= datetime('now', '-1 day')`)
    .run();
  return a.changes + b.changes;
}
