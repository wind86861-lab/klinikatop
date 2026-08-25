/**
 * Tezlik cheklovi — xotirada, tashqi bog'liqliksiz.
 *
 * Nima uchun kerak:
 *   • `/ai/*` har chaqiruvda pul turadi — cheklovsiz hisobni bo'shatish oson
 *   • fayl yuklash 8 MB gacha — cheklovsiz diskni to'ldiradi
 *   • yozuv amallari (so'rov, taklif) — spam va bot hujumi
 *
 * "Sizib chiquvchi paqir" (leaky bucket) usuli: har kalit uchun oyna ichida
 * nechta so'rov bo'lgani sanaladi, oyna tugagach hisob nolga tushadi.
 *
 * Bitta jarayon uchun. Server bir nechta nusxada ishlasa Redis kerak bo'ladi —
 * lekin bitta mashinada bu yetarli va hech qanday qo'shimcha xizmat talab
 * qilmaydi.
 */
import type { NextFunction, Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Eskirgan yozuvlar xotirani egallab qolmasin
const CLEANUP_EVERY_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, CLEANUP_EVERY_MS).unref?.();

export interface LimitOptions {
  /** Oyna uzunligi, soniyada */
  windowSec: number;
  /** Oyna ichida ruxsat etilgan so'rovlar soni */
  max: number;
  /** Cheklov nomi — turli marshrutlar bir-biriga xalaqit bermasligi uchun */
  name: string;
}

/**
 * Kalit: avval foydalanuvchi, keyin IP.
 *
 * Foydalanuvchi bo'yicha cheklash to'g'riroq — bitta uy internetidan kirgan
 * ikki bemor bir-birini bloklamaydi. Autentifikatsiyadan oldingi marshrutlar
 * uchun IP qoladi.
 */
function keyFor(req: Request, name: string): string {
  const who = req.user?.id ? `u${req.user.id}` : `ip${req.ip ?? 'unknown'}`;
  return `${name}:${who}`;
}

export function rateLimit(options: LimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFor(req, options.name);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowSec * 1000 });
      return next();
    }

    bucket.count += 1;

    if (bucket.count > options.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('retry-after', String(retryAfter));
      return res.status(429).json({
        error: `Juda ko‘p so‘rov. ${retryAfter} soniyadan keyin urinib ko‘ring.`,
        code: 'rate_limited',
        retryAfter,
      });
    }

    next();
  };
}

/**
 * Amaldagi cheklovlar.
 *
 * Raqamlar odam uchun keng, bot uchun tor: oddiy bemor daqiqada bir necha
 * marta bosadi, skript esa yuzlab marta.
 */
export const limits = {
  /** AI — eng qimmati, shuning uchun eng tori */
  ai: rateLimit({ name: 'ai', windowSec: 60, max: 10 }),
  /** Fayl yuklash */
  upload: rateLimit({ name: 'upload', windowSec: 60, max: 20 }),
  /** Yozuv amallari: so'rov, taklif, xabar */
  write: rateLimit({ name: 'write', windowSec: 60, max: 60 }),
  /** Umumiy himoya — barcha API uchun */
  global: rateLimit({ name: 'global', windowSec: 60, max: 300 }),
};

/** Testlar orasida holatni tozalash uchun. */
export function resetRateLimits() {
  buckets.clear();
}
