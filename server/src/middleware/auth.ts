import type { NextFunction, Request, Response } from 'express';
import { db, nowSql, toJson } from '../db';
import { config } from '../lib/config';
import { forbidden, unauthorized } from '../lib/errors';
import { mapUser } from '../lib/mappers';
import { verifyInitData, type TelegramUser } from '../lib/telegram';
import { personFor, resolveSession } from '../services/webAuth';
import type { Role, User } from '../../../shared/types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      /** Veb sessiya orqali kirilganda — klinika va admin uchun */
      web?: { id: number; phone: string; level: string; mfaPassed: boolean };
    }
  }
}

/**
 * Telegram ismini ism va familiyaga ajratadi.
 *
 * Ko'p odam Telegram profilida butun ismini `first_name` ga yozadi va
 * `last_name` ni umuman to'ldirmaydi. Natijada ro'yxatdan o'tish
 * ekranida "Aziz Karimov" BITTA maydonga tushar, familiya esa bo'sh
 * qolardi — forma familiyani majburiy so'ragani uchun odam uni qo'lda
 * qayta yozishga majbur bo'lardi.
 *
 * Ajratish faqat Telegram FAMILIYA BERMAGANDA qilinadi: bergan bo'lsa
 * unga ishonamiz. Bir nechta so'z bo'lsa oxirgisi familiya deb
 * olinadi — o'zbek ismlarida odatda shunday va odam istagan payt
 * profilda tuzatadi.
 */
function splitTelegramName(first: string, last: string | null): { first: string; last: string | null } {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (l) return { first: f, last: l };

  const parts = f.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: f, last: null };

  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/** Telegram foydalanuvchisidan platforma profilini yaratadi yoki oladi (1.1). */
export function upsertUser(tg: TelegramUser): User {
  const existing = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(tg.id);
  const name = splitTelegramName(tg.first_name ?? '', tg.last_name ?? null);

  if (existing) {
    /*
     * Telegram FAQAT o'zi egalik qiladigan maydonlarni yangilaydi.
     *
     * Ilgari bu yerda ism va familiya ham har so'rovda qayta
     * yozilardi. Bemor profilida familiyasini kiritsa, keyingi
     * so'rovda u Telegramdagi qiymat bilan almashardi — Telegramda
     * familiya yo'q bo'lsa esa BO'SHAB qolardi. Natijada profil
     * "to'liq emas" bo'lib, odam ro'yxatdan o'tish ekraniga qaytaverar
     * va nima uchun ekanini tushunmasdi.
     *
     * Endi ism va familiya faqat BO'SH bo'lsa to'ldiriladi: birinchi
     * kirishda qulaylik beradi, keyin esa odamning tanloviga tegmaydi.
     */
    db.prepare(
      `UPDATE users
          SET username   = ?,
              photo_url  = ?,
              first_name = CASE WHEN first_name IS NULL OR first_name = '' THEN ? ELSE first_name END,
              last_name  = CASE WHEN last_name IS NULL OR last_name = ''  THEN ? ELSE last_name  END
        WHERE telegram_id = ?`,
    ).run(tg.username ?? null, tg.photo_url ?? null, name.first, name.last, tg.id);
    return mapUser(db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(tg.id));
  }

  // 1.3: til Telegram tilidan avto-aniqlanadi, keyin profilda o'zgartiriladi
  const lang = tg.language_code?.startsWith('ru') ? 'ru' : 'uz';
  db.prepare(
    `INSERT INTO users (telegram_id, username, first_name, last_name, photo_url, lang, roles)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(tg.id, tg.username ?? null, name.first, name.last, tg.photo_url ?? null, lang, toJson(['patient']));

  return mapUser(db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(tg.id));
}

/**
 * Foydalanuvchini aniqlash.
 *
 * YAGONA yo'l — Telegram imzolagan `initData`. Imzosiz kirish (`x-dev-user`)
 * butunlay olib tashlandi: u ishlab chiqishni osonlashtirardi, lekin bitta
 * noto'g'ri sozlangan muhit butun platformani ochib qo'yardi. Testlar ham
 * shu yo'ldan o'tadi — sinov boti tokeni bilan haqiqiy imzo yasaydi.
 *
 * Sessiya saqlanmaydi: har so'rovda imzo qaytadan tekshiriladi.
 */
export function resolveUser(req: Request): User | null {
  const initData = (req.header('x-init-data') ?? '').trim();
  if (!initData || !config.telegram.botToken) return null;

  const res = verifyInitData(initData);
  if (!res.ok) return null;
  return upsertUser(res.user);
}

/**
 * Veb sessiya — klinika va admin uchun.
 *
 * Token `Authorization: Bearer <token>` sarlavhasida keladi, cookie'da
 * emas: shunda CSRF hujumi mumkin bo'lmaydi (brauzer boshqa saytdan
 * yuborilgan so'rovga sarlavhani o'zi qo'shmaydi).
 */
export function resolveWebUser(req: Request): { user: User; web: NonNullable<Request['web']> } | null {
  const header = req.header('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;

  const session = resolveSession(header.slice(7).trim());
  if (!session) return null;

  const person = personFor(session.user.id);
  if (!person) return null;

  return {
    user: person,
    web: {
      id: session.user.id,
      phone: session.user.phone,
      level: session.user.level,
      mfaPassed: session.mfaPassed,
    },
  };
}

/**
 * Kirishning IKKI yo'li bor va ular kesishmaydi:
 *
 *   bemor          → Telegram imzosi (`x-init-data`)
 *   klinika, admin → veb sessiyasi (`Authorization: Bearer`)
 *
 * Bemorning qatoriga klinika yoki admin roli HECH QACHON berilmaydi, veb
 * hisobning qatori esa manfiy `telegram_id` tufayli Telegram orqali
 * topilmaydi. Shuning uchun bir shaxs ikkinchi tomonga o'ta olmaydi —
 * "bir bosishda rol almashish" muammosi shu yerda yopiladi.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  /*
   * Ikkala belgi bir so'rovda kelishi NOANIQLIK.
   *
   * Qonuniy holatda bunday bo'lmaydi: bemor ilovasi faqat imzo,
   * kabinet faqat sessiya yuboradi. Ikkovi birga kelsa — yo mijozda
   * xato, yo kimdir ataylab sinab ko'ryapti. Birontasini "ustun" deb
   * tanlash o'rniga rad etamiz: tanlash qoidasi vaqt o'tib esdan
   * chiqadi va aynan shu joyda rollar aralashadi.
   */
  const hasWeb = (req.header('authorization') ?? '').toLowerCase().startsWith('bearer ');
  const hasTelegram = Boolean((req.header('x-init-data') ?? '').trim());

  if (hasWeb && hasTelegram) {
    return next(
      forbidden('Bir so‘rovda ikki xil kirish belgisi yuborilgan'),
    );
  }

  const web = resolveWebUser(req);
  if (web) {
    if (web.user.blockedAt) return next(forbidden('Hisobingiz bloklangan'));
    req.user = web.user;
    req.web = web.web;
    return next();
  }

  const user = resolveUser(req);
  if (!user) return next(unauthorized('initData yaroqsiz yoki yo‘q'));
  if (user.blockedAt) return next(forbidden('Hisobingiz bloklangan'));
  req.user = user;
  next();
}

/**
 * Veb sessiya majburiy — klinika kabineti va admin paneli uchun.
 *
 * 2FA yoqilgan hisob uni o'tmaguncha sessiya to'liq emas: parol o'g'irlangan
 * bo'lsa ham panel ochilmaydi.
 */
export function requireWeb(req: Request, _res: Response, next: NextFunction) {
  if (!req.web) return next(forbidden('Bu bo‘limga veb kabinet orqali kiriladi'));
  if (!req.web.mfaPassed) return next(forbidden('Ikki bosqichli tasdiqni yakunlang'));
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!req.user.roles.some((r) => roles.includes(r))) {
      return next(forbidden(`Bu amal uchun rol talab qilinadi: ${roles.join(', ')}`));
    }
    next();
  };
}

/** Klinika xodimi — biriktirilgan klinika id sini qaytaradi. */
export function requireClinic(req: Request): number {
  if (!req.user) throw unauthorized();
  if (!req.user.clinicId || !req.user.roles.some((r) => r === 'clinic_admin' || r === 'clinic_operator')) {
    throw forbidden('Siz klinikaga biriktirilmagansiz');
  }
  return req.user.clinicId;
}

export function touchOnboarded(userId: number) {
  db.prepare(`UPDATE users SET onboarded_at = ? WHERE id = ? AND onboarded_at IS NULL`).run(nowSql(), userId);
}
