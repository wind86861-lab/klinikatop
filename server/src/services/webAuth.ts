/**
 * Veb hisoblar — klinika va admin uchun.
 *
 * Bemor Telegram orqali kiradi (imzo bilan), klinika va admin esa veb
 * orqali: ular ish joyida kompyuterda ishlaydi.
 *
 * Xavfsizlik qarorlari va sabablari:
 *
 *   • Parol `scrypt` bilan saqlanadi — u ataylab sekin va xotira talab
 *     qiladi, ya'ni o'g'irlangan bazadan parollarni tiklash qimmat.
 *   • Har hisob uchun alohida tuz: bir xil parolli ikki hisob bazada
 *     boshqacha ko'rinadi.
 *   • Taqqoslash `timingSafeEqual` bilan — javob vaqti parolning qaysi
 *     belgisi to'g'ri ekanini oshkor qilmaydi.
 *   • Ketma-ket xato urinishlar hisobni vaqtincha qulflaydi.
 *   • Kirmagan hisob uchun ham parol hisoblanadi ("soxta ish"): aks holda
 *     javob tezligi qaysi email ro'yxatda borligini bildirib qo'yardi.
 *   • Sessiya tokeni bazada TO'LIQ saqlanmaydi — faqat uning hashi.
 *     Baza sizib chiqsa ham tokenlar bilan kirish mumkin bo'lmaydi.
 */
import crypto from 'node:crypto';
import { db, toJson } from '../db';
import { badRequest, forbidden, unauthorized } from '../lib/errors';
import { mapUser } from '../lib/mappers';
import { config } from '../lib/config';
import { sendTelegramMessage } from '../lib/telegram';
import type { Role, User } from '../../../shared/types';

export type WebLevel = 'full' | 'clinic_admin' | 'clinic_operator';

/**
 * Hisob darajasi → platforma roli.
 *
 * Ikkisi bir xil emas: daraja KIRISH huquqini bildiradi (kim panelga kira
 * oladi), rol esa AMAL huquqini (kim nima qila oladi). `full` darajali
 * hisob platformada `admin` roli bilan ish ko'radi.
 */
const ROLE_FOR: Record<WebLevel, Role> = {
  full: 'admin',
  clinic_admin: 'clinic_admin',
  clinic_operator: 'clinic_operator',
};

/**
 * Kirish sahifasi — klinika kabineti yoki admin paneli.
 *
 * Ikkalasi endi alohida manzilda turadi (`/kabinet` va `/admin/login`) va
 * har biri faqat o'z hisobini qabul qiladi. Bu xavfsizlik chegarasi EMAS:
 * huquqni baribir rol tekshiruvi hal qiladi va parolni bilgan odam
 * so'rovni qo'lda ham yuborishi mumkin. Bu tartib masalasi —
 * administrator klinika xodimlari kiradigan sahifadan kirmaydi, va
 * xodim admin sahifasida o'z parolini terib o'tirmaydi.
 *
 * Shuning uchun tekshiruv parol TO'G'RI kelgandan keyin bo'ladi: shunda
 * javob hech kimga qaysi raqam admin ekanini oshkor qilmaydi.
 */
export type LoginScope = 'clinic' | 'admin';

const SCOPE_OF: Record<WebLevel, LoginScope> = {
  full: 'admin',
  clinic_admin: 'clinic',
  clinic_operator: 'clinic',
};

const WRONG_SCOPE: Record<LoginScope, string> = {
  clinic: 'Administrator hisobi bu sahifadan kirmaydi. /admin/login manzilidan foydalaning.',
  admin: 'Bu sahifa administratorlar uchun. Klinika kabinetiga /kabinet orqali kiring.',
};

/**
 * Telefon raqamini solishtirish uchun bir shaklga keltiradi.
 *
 * Bir odam raqamini turlicha yozadi: `+998 90 123 45 67`,
 * `998901234567`, `901234567`. Telegram esa o'z shaklida yuboradi.
 * Solishtirishda faqat raqamlar qoladi va O'zbekiston kodi
 * to'ldiriladi — aks holda bir xil raqam ikki xil hisob bo'lib
 * qolardi va odam nima uchun kira olmayotganini tushunmasdi.
 */
export function normalizePhone(raw: string): string {
  let digits = (raw ?? '').replace(/\D/g, '');

  // 9 xonali mahalliy raqam — O'zbekiston kodi qo'shiladi
  if (digits.length === 9) digits = '998' + digits;
  // 8 bilan boshlanuvchi eski shakl: 8 90 ... → 998 90 ...
  else if (digits.length === 10 && digits.startsWith('8')) digits = '998' + digits.slice(1);

  return digits;
}

export interface WebUser {
  id: number;
  /** Kirish identifikatori */
  phone: string;
  email: string | null;
  fullName: string;
  level: WebLevel;
  clinicId: number | null;
  totpEnabled: boolean;
  lastLoginAt: string | null;
}

const iso = (v: string | null) => (v ? new Date(v.replace(' ', 'T') + 'Z').toISOString() : null);

function mapWebUser(row: any): WebUser {
  return {
    id: row.id,
    phone: row.phone,
    email: row.email ?? null,
    fullName: row.full_name,
    level: row.level,
    clinicId: row.clinic_id ?? null,
    totpEnabled: row.totp_enabled === 1,
    lastLoginAt: iso(row.last_login_at),
  };
}

/* ─────────────────────────  Parol  ───────────────────────── */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT).toString('hex');
}

/** Parolni tekshirish. Uzunlik farq qilsa ham vaqt bo'yicha xavfsiz. */
export function passwordMatches(password: string, salt: string, expected: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

/** Parol talablari — uzunlik eng muhimi, murakkablik emas. */
/**
 * Administrator (butun platforma) paroli — qattiqroq: 12+ belgi, katta va
 * kichik harf, raqam va belgi. Klinika hisoblariga oddiy qoida qoladi.
 */
export function assertAdminPasswordStrong(password: string): void {
  assertPasswordStrong(password);
  const missing: string[] = [];
  if (password.length < 12) missing.push('kamida 12 belgi');
  if (!/[a-z]/.test(password)) missing.push('kichik harf');
  if (!/[A-Z]/.test(password)) missing.push('katta harf');
  if (!/\d/.test(password)) missing.push('raqam');
  if (!/[^A-Za-z0-9]/.test(password)) missing.push('belgi (!@#… kabi)');
  if (password.length > 128) throw badRequest('weak_password', 'Parol 128 belgidan oshmasin');
  if (missing.length) throw badRequest('weak_password', `Administrator paroli uchun kerak: ${missing.join(', ')}`);
}

export function assertPasswordStrong(password: string): void {
  if (password.length < 10) {
    throw badRequest('weak_password', 'Parol kamida 10 belgidan iborat bo‘lsin');
  }
  if (/^\d+$/.test(password)) {
    throw badRequest('weak_password', 'Faqat raqamlardan iborat parol bo‘lmaydi');
  }
}

/* ─────────────────────────  Hisob yaratish  ───────────────────────── */

export interface CreateAccountInput {
  /** Kirish identifikatori — ariza jarayonida tekshirilgan raqam */
  phone: string;
  /** Ixtiyoriy: xabar yuborish uchun */
  email?: string | null;
  fullName: string;
  level: WebLevel;
  clinicId: number | null;
}

/**
 * Hisob yaratish — parolsiz.
 *
 * Parolni odam O'ZI o'rnatadi: moderator vaqtinchalik parol o'ylab topib,
 * uni telefonda aytishi kerak bo'lmaydi va parol hech qayerda ochiq
 * yozilmaydi. Buning o'rniga bir martalik sozlash tokeni beriladi.
 */
export function createAccount(input: CreateAccountInput): { user: WebUser; setupToken: string } {
  const phone = normalizePhone(input.phone);
  if (phone.length < 9) throw badRequest('bad_phone', 'Telefon raqami noto‘g‘ri');

  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw badRequest('bad_email', 'Email noto‘g‘ri');
  }

  const exists = db.prepare(`SELECT id FROM admin_users WHERE phone = ?`).get(phone);
  if (exists) throw badRequest('phone_taken', 'Bu raqam allaqachon ro‘yxatdan o‘tgan');

  if (email && db.prepare(`SELECT id FROM admin_users WHERE email = ?`).get(email)) {
    throw badRequest('email_taken', 'Bu email allaqachon ro‘yxatdan o‘tgan');
  }

  // Klinika roli klinikasiz bo'lmaydi va aksincha
  const isClinicRole = input.level === 'clinic_admin' || input.level === 'clinic_operator';
  if (isClinicRole && !input.clinicId) throw badRequest('clinic_required', 'Klinika ko‘rsatilmagan');
  if (!isClinicRole && input.clinicId) throw badRequest('clinic_not_allowed', 'Admin hisobi klinikaga bog‘lanmaydi');

  const setupToken = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + 7 * 24 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');

  const info = db
    .prepare(
      `INSERT INTO admin_users
         (phone, email, full_name, password_salt, password_hash, level, clinic_id, setup_token, setup_expires)
       VALUES (?, ?, ?, '', '', ?, ?, ?, ?)`,
    )
    .run(phone, email, input.fullName.trim().slice(0, 160), input.level, input.clinicId, setupToken, expires);

  const id = Number(info.lastInsertRowid);

  /*
   * Har veb hisobga `users` jadvalida juftlik yaratiladi.
   *
   * Nima uchun: butun tizimda "kim qildi" ustunlari `users(id)` ga
   * ishora qiladi — moderatsiya jurnali, taklif egasi, dialog a'zosi.
   * Veb hisob uchun alohida shaxs jadvali qilinsa, har bir shunday
   * ustunni ikkiga bo'lish kerak bo'lardi.
   *
   * `telegram_id` MANFIY qilinadi. Telegram identifikatorlari doim
   * musbat, shuning uchun bu qator Telegram orqali kirishning HECH
   * QANDAY yo'li bilan topilmaydi — bemor va klinika/admin shaxslari
   * bir-biriga aylana olmaydi. Ajratish shu bitta belgi bilan
   * ta'minlanadi va uni buzish uchun ataylab manfiy id yozish kerak.
   */
  db.prepare(
    `INSERT INTO users (telegram_id, first_name, roles, clinic_id, onboarded_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(-id, input.fullName.trim().slice(0, 160), toJson([ROLE_FOR[input.level]]), input.clinicId);

  const user = mapWebUser(db.prepare(`SELECT * FROM admin_users WHERE id = ?`).get(id));
  return { user, setupToken };
}

/** Sozlash tokeni bilan parol o'rnatish. Token bir martalik. */
export function completeSetup(token: string, password: string): WebUser {
  const row = db
    .prepare(`SELECT * FROM admin_users WHERE setup_token = ? AND setup_expires > datetime('now')`)
    .get(token) as any;
  if (!row) throw unauthorized('Havola yaroqsiz yoki muddati o‘tgan');

  assertPasswordStrong(password);

  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(
    `UPDATE admin_users
        SET password_salt = ?, password_hash = ?, setup_token = NULL, setup_expires = NULL
      WHERE id = ?`,
  ).run(salt, hashPassword(password, salt), row.id);

  return mapWebUser(db.prepare(`SELECT * FROM admin_users WHERE id = ?`).get(row.id));
}

/* ─────────────────────────  Kirish  ───────────────────────── */

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const SESSION_DAYS = 7;
/** Administrator sessiyasi — kabinetnikidan ancha qisqa. */
const ADMIN_SESSION_HOURS = 12;

/** Sessiya tokeni bazada hash bilan saqlanadi. */
function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface LoginResult {
  token: string;
  user: WebUser;
  /** 2FA yoqilgan bo'lsa sessiya hali to'liq emas */
  mfaRequired: boolean;
  /** Kod qayerdan olinadi: autentifikatsiya ilovasi yoki Telegram */
  mfaMethod?: MfaMethod;
}

export type MfaMethod = 'totp' | 'telegram';

/* ─────────────  Admin: Telegram orqali tasdiqlash kodi  ───────────── */

/*
 * Parol yetarli emas: admin paneliga kirishda 6 xonali kod adminning
 * O'Z Telegram'iga (bot orqali) yuboriladi. Parol o'g'irlansa ham
 * telefon qo'lda bo'lmasa kirib bo'lmaydi, kirish urinishi esa darhol
 * egasiga ko'rinadi.
 *
 * Kodlar xotirada — sessiya tokeni xeshiga bog'langan. Server qayta
 * ishga tushsa kod yo'qoladi va odam shunchaki qaytadan kiradi.
 * TOTP yoqilgan hisobda Telegram ishlatilmaydi — ilova kuchliroq.
 */
const TG_CODE_TTL_MS = 5 * 60_000;
const TG_CODE_MAX_ATTEMPTS = 5;
const tgChallenges = new Map<string, { hash: string; expiresAt: number; attempts: number }>();

function tgCodeHash(sessionKey: string, code: string): string {
  return crypto.createHash('sha256').update(`${sessionKey}:${code}`).digest('hex');
}

/** Admin hisobining telefoni bilan bog'langan haqiqiy Telegram foydalanuvchisi */
function adminTelegramId(phone: string | null): number | null {
  if (!phone) return null;
  const u = db
    // users.phone ba'zan "+998…", ba'zan "998…" ko'rinishida saqlangan
    .prepare(`SELECT telegram_id FROM users WHERE telegram_id > 0 AND phone IN (?, ?) ORDER BY id LIMIT 1`)
    .get(phone.replace(/^\+/, ''), '+' + phone.replace(/^\+/, '')) as { telegram_id: number } | undefined;
  return u?.telegram_id ?? null;
}

const escHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Kod qayerga boradi: sozlangan guruh, bo'lmasa adminning o'z Telegram'i */
function adminCodeChat(phone: string | null): number | null {
  const group = Number(config.telegram.adminAlertChatId);
  if (config.telegram.adminAlertChatId && Number.isFinite(group) && group !== 0) return group;
  return adminTelegramId(phone);
}

/** Telefonning o'rtasini yashiradi: 99890•••4567 */
const maskPhone = (p: string | null) => (p ? `${p.slice(0, 5)}•••${p.slice(-4)}` : '—');

function startTelegramChallenge(
  sessionKey: string,
  telegramId: number,
  ip: string | null,
  userAgent: string | null,
  who: string,
): void {
  const now = Date.now();
  for (const [k, v] of tgChallenges) if (v.expiresAt < now) tgChallenges.delete(k);

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  tgChallenges.set(sessionKey, { hash: tgCodeHash(sessionKey, code), expiresAt: now + TG_CODE_TTL_MS, attempts: 0 });

  const when = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
  const text =
    `🔐 <b>KlinikaTop admin paneliga kirish kodi</b>\n\n` +
    `<code>${code}</code>\n\n` +
    `Kim: ${escHtml(who)}\n` +
    `IP: ${escHtml(ip ?? 'noma’lum')}\n` +
    `Qurilma: ${escHtml((userAgent ?? 'noma’lum').slice(0, 120))}\n` +
    `Vaqt: ${when} (Toshkent)\n` +
    `Kod 5 daqiqa amal qiladi.\n\n` +
    `⚠️ Agar kirayotgan siz bo‘lmasangiz — kodni hech kimga bermang va parolni darhol almashtiring.`;

  // Yuborib bo'lmasa sessiya yopiladi: kod kelmaydi, kirish ham ochilmaydi
  void sendTelegramMessage(telegramId, text).then((sent) => {
    if (!sent) {
      tgChallenges.delete(sessionKey);
      db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(sessionKey);
      console.warn('[admin-2fa] Telegram kodi yuborilmadi — sessiya yopildi');
    }
  });
}

/** true — Telegram kodi tekshirildi (to'g'ri). Kutilmayotgan bo'lsa null. */
function checkTelegramCode(sessionKey: string, code: string): true | null {
  const ch = tgChallenges.get(sessionKey);
  if (!ch) return null;

  const closeSession = () => {
    tgChallenges.delete(sessionKey);
    db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(sessionKey);
  };

  if (Date.now() > ch.expiresAt) {
    closeSession();
    throw unauthorized('Kod eskirgan. Qaytadan kiring — yangi kod yuboriladi.');
  }
  const got = Buffer.from(tgCodeHash(sessionKey, String(code).trim()));
  const want = Buffer.from(ch.hash);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
    ch.attempts += 1;
    if (ch.attempts >= TG_CODE_MAX_ATTEMPTS) {
      closeSession();
      throw unauthorized('Kod 5 marta noto‘g‘ri kiritildi. Qaytadan kiring.');
    }
    throw unauthorized(`Kod noto‘g‘ri. Yana ${TG_CODE_MAX_ATTEMPTS - ch.attempts} ta urinish qoldi.`);
  }
  tgChallenges.delete(sessionKey);
  return true;
}

export const _adminTelegram2faTesting = { tgChallenges, tgCodeHash };

export function login(
  phoneOrEmail: string,
  password: string,
  ip: string | null,
  userAgent: string | null,
  /*
   * Qaysi kirish sahifasidan kelgani — MAJBURIY.
   *
   * Ilgari ixtiyoriy edi va bu himoyani ma'nosiz qilardi: `scope`
   * siz so'rov yuborgan har kim tekshiruvni chetlab o'ta olardi.
   * Endi eshikni aytmasdan kirib bo'lmaydi.
   */
  scope: LoginScope,
): LoginResult {
  /*
   * Kirish raqam bo'yicha. Email ham qabul qilinadi: eski hisoblar
   * unga o'rgangan va uni birdan uzib qo'yish odamni tashqarida
   * qoldirardi.
   */
  const input = (phoneOrEmail ?? '').trim();
  const row = input.includes('@')
    ? (db.prepare(`SELECT * FROM admin_users WHERE email = ?`).get(input.toLowerCase()) as any)
    : (db.prepare(`SELECT * FROM admin_users WHERE phone = ?`).get(normalizePhone(input)) as any);

  /*
   * Hisob topilmasa ham parol hisoblanadi.
   * Aks holda javob tezligi qaysi email ro'yxatda borligini bildirardi
   * va hujumchi hisoblarni sanab chiqa olardi.
   */
  if (!row) {
    hashPassword(password, 'dummy-salt-for-constant-time');
    throw unauthorized('Raqam yoki parol noto‘g‘ri');
  }

  if (row.disabled_at) throw forbidden('Hisob o‘chirilgan');

  if (row.locked_until && new Date(row.locked_until.replace(' ', 'T') + 'Z') > new Date()) {
    throw forbidden(`Hisob vaqtincha qulflangan. ${LOCK_MINUTES} daqiqadan keyin urinib ko‘ring.`);
  }

  // Parol hali o'rnatilmagan (sozlash havolasi ishlatilmagan)
  if (!row.password_hash) throw unauthorized('Avval parolni o‘rnating');

  if (!passwordMatches(password, row.password_salt, row.password_hash)) {
    const failed = row.failed_count + 1;
    const lockUntil =
      failed >= MAX_FAILED
        ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString().slice(0, 19).replace('T', ' ')
        : null;
    db.prepare(`UPDATE admin_users SET failed_count = ?, locked_until = ? WHERE id = ?`).run(
      failed,
      lockUntil,
      row.id,
    );
    throw unauthorized('Raqam yoki parol noto‘g‘ri');
  }

  /*
   * Eshik tekshiruvi shu yerda — parol to'g'ri, lekin sessiya hali
   * berilmagan. Xato urinishlar hisoblagichi allaqachon nolga tushdi:
   * bu parol xatosi emas, shunchaki noto'g'ri eshik.
   */
  db.prepare(`UPDATE admin_users SET failed_count = 0, locked_until = NULL WHERE id = ?`).run(row.id);

  if (SCOPE_OF[row.level as WebLevel] !== scope) {
    throw forbidden(WRONG_SCOPE[scope]);
  }

  db.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?`).run(row.id);

  const token = crypto.randomBytes(32).toString('base64url');

  /*
   * Administrator sessiyasi QISQAROQ.
   *
   * Klinika kabineti kun bo'yi ochiq turadi va uzoq muddat u yerda
   * ish qulayligi masalasi. Admin panelida esa butun platforma
   * boshqariladi: ochiq qolgan brauzer bir hafta emas, bir kun
   * ham ochiq turmasligi kerak.
   */
  const ttlHours = scope === 'admin' ? ADMIN_SESSION_HOURS : SESSION_DAYS * 24;
  const expires = new Date(Date.now() + ttlHours * 3600_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  /*
   * TOTP yoqilgan — ilova kodi. Aks holda admin paneli uchun Telegram
   * kodi (agar hisob telefoni Telegram foydalanuvchisiga bog'langan
   * bo'lsa). Bog'lanmagan admin hisobi avvalgidek kiradi — uni
   * qulflab qo'yish yagona administratorni tashqarida qoldirishi mumkin.
   */
  const tgId =
    row.totp_enabled !== 1 && scope === 'admin' && config.telegram.adminTelegram2fa && config.telegram.botToken
      ? adminCodeChat(row.phone)
      : null;
  if (row.totp_enabled !== 1 && scope === 'admin' && !tgId) {
    console.warn(`[admin-2fa] admin #${row.id}: Telegram bog'lanmagan yoki o'chirilgan — kod so'ralmadi`);
  }
  const mfaMethod: MfaMethod | undefined = row.totp_enabled === 1 ? 'totp' : tgId ? 'telegram' : undefined;
  const mfaRequired = mfaMethod !== undefined;

  db.prepare(
    `INSERT INTO admin_sessions (token, admin_id, ip, user_agent, expires_at, mfa_passed, ttl_hours, scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    tokenHash(token),
    row.id,
    ip,
    userAgent?.slice(0, 300) ?? null,
    expires,
    mfaRequired ? 0 : 1,
    ttlHours,
    scope,
  );

  if (mfaMethod === 'telegram' && tgId) {
    startTelegramChallenge(tokenHash(token), tgId, ip, userAgent, `${row.full_name ?? 'Admin'} (${maskPhone(row.phone)})`);
  }

  /*
   * Admin panelga kirish IZ QOLDIRADI.
   *
   * Butun platforma shu yerdan boshqariladi: kim, qachon va qaysi
   * IP'dan kirgani keyin savol tug'ilsa javob bo'lishi kerak.
   * Klinika kirishlari yozilmaydi — ular kundalik ish va jurnalni
   * ko'mib tashlardi.
   *
   * Token YOZILMAYDI: jurnal moderatorlarga ko'rinadi.
   */
  if (scope === 'admin') {
    db.prepare(
      `INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note)
       VALUES (?, 'admin_session', ?, 'login', ?)`,
    ).run(
      personFor(row.id)?.id ?? null,
      row.id,
      `${ip ?? 'IP noma’lum'} · ${(userAgent ?? '').slice(0, 120) || 'brauzer noma’lum'}`,
    );
  }

  return { token, user: mapWebUser(row), mfaRequired, mfaMethod };
}

/**
 * Telegram orqali kabinetga kirish.
 *
 * Parol so'ralmaydi va bu ataylab shunday. Isbot zanjiri:
 *
 *   1. Telegram `initData` ni imzolaydi — foydalanuvchi haqiqiy
 *   2. Uning raqami botga KONTAKT ULASHISH orqali kelgan, ya'ni uni
 *      Telegram tasdiqlagan (biz `contact.user_id` ni ham tekshiramiz)
 *   3. O'sha raqam ariza jarayonida moderator tomonidan qo'ng'iroq
 *      bilan tekshirilgan
 *
 * Ya'ni bu SMS bilan kirishga teng, faqat ishonchliroq: raqam
 * egaligini Telegram kafolatlaydi va kod hech qayerda uzatilmaydi.
 *
 * Sessiya qisqaroq: telefon qo'lda qolib ketishi mumkin, brauzerdagi
 * ish sessiyasi esa odatda o'z kompyuterida.
 */
const TELEGRAM_SESSION_HOURS = 12;

export function loginByVerifiedPhone(
  phone: string,
  ip: string | null,
  userAgent: string | null,
): LoginResult | null {
  const normalized = normalizePhone(phone);
  if (normalized.length < 9) return null;

  const row = db
    .prepare(`SELECT * FROM admin_users WHERE phone = ? AND disabled_at IS NULL`)
    .get(normalized) as any;

  // Parol qo'yilmagan hisob hali tayyor emas — avval uni sozlash kerak
  if (!row || !row.password_hash) return null;

  /*
   * Telegram ko'prigi ADMINISTRATOR sessiyasini hech qachon bermaydi.
   *
   * Bu yo'l parol so'ramaydi — u klinika egasining raqami botda
   * tasdiqlanganiga tayanadi. Butun platformani boshqaradigan hisob
   * uchun bu yetarli asos emas: administrator har doim o'z
   * sahifasidan, paroli bilan kiradi.
   */
  if (row.level === 'full') return null;

  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + TELEGRAM_SESSION_HOURS * 3600_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  /*
   * 2FA yoqilgan bo'lsa u BU YERDA HAM talab qilinadi. Telegram
   * raqamni tasdiqlaydi, lekin ikkinchi bosqichning maqsadi aynan
   * "bitta narsa o'g'irlansa ham yetarli bo'lmasin" — telefonni
   * qo'lga kiritgan odam uchun ham shu qoida amal qiladi.
   */
  const mfaRequired = row.totp_enabled === 1;

  db.prepare(
    `INSERT INTO admin_sessions (token, admin_id, ip, user_agent, expires_at, mfa_passed, ttl_hours, scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'clinic')`,
  ).run(
    tokenHash(token),
    row.id,
    ip,
    userAgent?.slice(0, 300) ?? null,
    expires,
    mfaRequired ? 0 : 1,
    TELEGRAM_SESSION_HOURS,
  );

  db.prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?`).run(row.id);

  return { token, user: mapWebUser(row), mfaRequired };
}

export function logout(token: string): void {
  db.prepare(`DELETE FROM admin_sessions WHERE token = ?`).run(tokenHash(token));
}

/** Veb hisobga bog'langan shaxs qatori. */
export function personFor(webUserId: number): User | null {
  const row = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(-webUserId);
  return row ? mapUser(row) : null;
}

/**
 * Sessiyani tekshirish. 2FA o'tilmagan sessiya to'liq hisoblanmaydi.
 *
 * Eshik ham qaytariladi: u sessiyaga yozilgan va har so'rovda
 * majburlanadi (`requireDoor`). Eski, `scope` siz sessiyalar uchun
 * hisob darajasidan kelib chiqiladi — ular migratsiyada to'ldirilgan,
 * bu shunchaki qo'shimcha ehtiyot.
 */
export function resolveSession(
  token: string,
): { user: WebUser; mfaPassed: boolean; scope: LoginScope } | null {
  const hash = tokenHash(token);
  const row = db
    .prepare(
      `SELECT s.mfa_passed, s.expires_at, s.ttl_hours, s.scope, u.* FROM admin_sessions s
         JOIN admin_users u ON u.id = s.admin_id
        WHERE s.token = ? AND s.expires_at > datetime('now') AND u.disabled_at IS NULL`,
    )
    .get(hash) as any;
  if (!row) return null;

  /*
   * Muddat — BEKORCHILIK vaqti, umr emas.
   *
   * Ilgari u qat'iy edi: kun bo'yi ishlab turgan klinika ham 12
   * soatdan keyin chiqib ketardi va takliflar kechikardi. Endi har
   * foydalanishda oldinga suriladi; ishlatilmagan sessiya esa
   * avvalgidek o'ladi.
   *
   * Yozuv HAR so'rovda emas: muddatning o'ndan biri o'tgandagina
   * yangilanadi. Aks holda har API chaqiruvi bitta yozuv amali
   * bo'lardi.
   */
  const ttlMs = (row.ttl_hours ?? 168) * 3600_000;
  const remaining = new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime() - Date.now();
  if (remaining < ttlMs * 0.9) {
    db.prepare(
      `UPDATE admin_sessions SET expires_at = datetime('now', ?) WHERE token = ?`,
    ).run(`+${row.ttl_hours ?? 168} hours`, hash);
  }

  return {
    user: mapWebUser(row),
    mfaPassed: row.mfa_passed === 1,
    scope: (row.scope as LoginScope | null) ?? SCOPE_OF[row.level as WebLevel],
  };
}

/** Eskirgan sessiyalarni tozalash — rejalashtiruvchi chaqiradi. */
export function purgeExpiredSessions(): number {
  return db.prepare(`DELETE FROM admin_sessions WHERE expires_at <= datetime('now')`).run().changes;
}

/**
 * Parolni almashtirish.
 *
 * Joriy parol so'raladi — sessiya bor bo'lsa ham. Sabab: ochiq qolgan
 * kompyuter yonidan o'tgan odam parolni almashtirib, egasini o'z
 * hisobidan chiqarib yubora olmasligi kerak.
 *
 * Almashtirilgach BOSHQA hamma sessiya yopiladi. Odam odatda aynan
 * shu sababdan parolni almashtiradi — kimdir kirgan deb o'ylaydi —
 * va eski sessiyalar ochiq qolsa bu harakat ma'nosiz bo'lardi.
 */
export function changePassword(
  webUserId: number,
  currentPassword: string,
  newPassword: string,
  keepToken: string,
): void {
  const row = db.prepare(`SELECT * FROM admin_users WHERE id = ?`).get(webUserId) as any;
  if (!row) throw unauthorized();

  if (!row.password_hash || !passwordMatches(currentPassword, row.password_salt, row.password_hash)) {
    throw unauthorized('Joriy parol noto‘g‘ri');
  }

  const isAdmin = SCOPE_OF[row.level as WebLevel] === 'admin';
  if (isAdmin) assertAdminPasswordStrong(newPassword);
  else assertPasswordStrong(newPassword);
  if (passwordMatches(newPassword, row.password_salt, row.password_hash)) {
    throw badRequest('same_password', 'Yangi parol joriy paroldan farq qilishi kerak');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(`UPDATE admin_users SET password_salt = ?, password_hash = ? WHERE id = ?`).run(
    salt,
    hashPassword(newPassword, salt),
    webUserId,
  );

  db.prepare(`DELETE FROM admin_sessions WHERE admin_id = ? AND token <> ?`).run(
    webUserId,
    tokenHash(keepToken),
  );

  // Admin paroli o'zgardi — guruh (yoki adminning o'zi) darhol bilsin
  if (isAdmin) {
    const chat = adminCodeChat(row.phone);
    if (chat) {
      const when = new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
      void sendTelegramMessage(
        chat,
        `🔑 <b>KlinikaTop admin paroli almashtirildi</b>\n\n` +
          `Kim: ${escHtml(`${row.full_name ?? 'Admin'} (${maskPhone(row.phone)})`)}\n` +
          `Vaqt: ${when} (Toshkent)\n` +
          `Boshqa qurilmalardagi sessiyalar yopildi.\n\n` +
          `⚠️ Agar buni siz qilmagan bo‘lsangiz — darhol tekshiring.`,
      );
    }
  }
}

/** Ochiq sessiyalar — qayerdan va qachon kirilgani. */
export interface SessionRow {
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  expiresAt: string;
}

export function listSessions(webUserId: number, currentToken: string): SessionRow[] {
  const hash = tokenHash(currentToken);
  return (
    db
      .prepare(`SELECT token, ip, user_agent, expires_at FROM admin_sessions WHERE admin_id = ? ORDER BY expires_at DESC`)
      .all(webUserId) as any[]
  ).map((r) => ({
    current: r.token === hash,
    ip: r.ip,
    userAgent: r.user_agent,
    expiresAt: iso(r.expires_at)!,
  }));
}

/** 2FA ni o'chirish — joriy parol bilan tasdiqlanadi. */
export function disableTotp(webUserId: number, password: string): void {
  const row = db.prepare(`SELECT * FROM admin_users WHERE id = ?`).get(webUserId) as any;
  if (!row) throw unauthorized();
  if (!passwordMatches(password, row.password_salt, row.password_hash)) {
    throw unauthorized('Parol noto‘g‘ri');
  }
  db.prepare(`UPDATE admin_users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?`).run(webUserId);
}

/* ─────────────────────────  2FA (TOTP)  ───────────────────────── */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * TOTP kodi (RFC 6238): 30 soniyalik oyna, 6 raqam, HMAC-SHA1.
 * Google Authenticator va shunga o'xshash ilovalar shu standartda ishlaydi.
 */
function totpAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const digest = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/** Joriy oynadagi kod — 2FA sozlashni tekshirishda va testlarda kerak. */
export function currentTotp(secret: string): string {
  return totpAt(secret, Math.floor(Date.now() / 30_000));
}

/**
 * Kodni tekshirish. Bir oyna oldinga va orqaga ruxsat beriladi —
 * telefon soati bir necha soniya farq qilishi normal.
 */
export function verifyTotp(secret: string, code: string): boolean {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) return false;

  const counter = Math.floor(Date.now() / 30_000);
  for (const drift of [-1, 0, 1]) {
    const expected = totpAt(secret, counter + drift);
    const a = Buffer.from(expected);
    const b = Buffer.from(clean);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** 2FA sozlashni boshlash — sir yaratiladi, lekin hali yoqilmaydi. */
export function startTotpSetup(userId: number, issuer = 'KlinikaTop'): { secret: string; otpauth: string } {
  const secret = base32Encode(crypto.randomBytes(20));
  db.prepare(`UPDATE admin_users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?`).run(secret, userId);

  const row = db.prepare(`SELECT phone, email FROM admin_users WHERE id = ?`).get(userId) as {
    phone: string;
    email: string | null;
  };
  const label = encodeURIComponent(`${issuer}:${row.email ?? row.phone}`);
  return {
    secret,
    otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`,
  };
}

/** Kodni tasdiqlab 2FA ni yoqish. */
export function confirmTotp(userId: number, code: string): void {
  const row = db.prepare(`SELECT totp_secret FROM admin_users WHERE id = ?`).get(userId) as any;
  if (!row?.totp_secret) throw badRequest('no_totp', 'Avval 2FA sozlashni boshlang');
  if (!verifyTotp(row.totp_secret, code)) throw unauthorized('Kod noto‘g‘ri');
  db.prepare(`UPDATE admin_users SET totp_enabled = 1 WHERE id = ?`).run(userId);
}

/** Kirish paytidagi 2FA tekshiruvi — sessiyani to'liq qiladi. */
export function passMfa(token: string, code: string): void {
  const session = resolveSession(token);
  if (!session) throw unauthorized('Sessiya topilmadi');

  // Telegram kodi kutilayotgan sessiya — o'shani tekshiramiz
  if (checkTelegramCode(tokenHash(token), code)) {
    db.prepare(`UPDATE admin_sessions SET mfa_passed = 1 WHERE token = ?`).run(tokenHash(token));
    return;
  }

  const row = db.prepare(`SELECT totp_secret FROM admin_users WHERE id = ?`).get(session.user.id) as any;
  if (!row?.totp_secret || !verifyTotp(row.totp_secret, code)) throw unauthorized('Kod noto‘g‘ri');

  db.prepare(`UPDATE admin_sessions SET mfa_passed = 1 WHERE token = ?`).run(tokenHash(token));
}
