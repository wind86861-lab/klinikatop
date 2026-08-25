import type { NextFunction, Request, Response } from 'express';
import { db, nowSql, toJson } from '../db';
import { config } from '../lib/config';
import { forbidden, unauthorized } from '../lib/errors';
import { mapUser } from '../lib/mappers';
import { verifyInitData, type TelegramUser } from '../lib/telegram';
import type { Role, User } from '../../../shared/types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Telegram foydalanuvchisidan platforma profilini yaratadi yoki oladi (1.1). */
export function upsertUser(tg: TelegramUser): User {
  const existing = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(tg.id);

  if (existing) {
    db.prepare(
      `UPDATE users SET username = ?, first_name = ?, last_name = ?, photo_url = ? WHERE telegram_id = ?`,
    ).run(tg.username ?? null, tg.first_name ?? '', tg.last_name ?? null, tg.photo_url ?? null, tg.id);
    return mapUser(db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(tg.id));
  }

  // 1.3: til Telegram tilidan avto-aniqlanadi, keyin profilda o'zgartiriladi
  const lang = tg.language_code?.startsWith('ru') ? 'ru' : 'uz';
  db.prepare(
    `INSERT INTO users (telegram_id, username, first_name, last_name, photo_url, lang, roles)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(tg.id, tg.username ?? null, tg.first_name ?? '', tg.last_name ?? null, tg.photo_url ?? null, lang, toJson(['patient']));

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

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const user = resolveUser(req);
  if (!user) return next(unauthorized('initData yaroqsiz yoki yo‘q'));
  if (user.blockedAt) return next(forbidden('Hisobingiz bloklangan'));
  req.user = user;
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
