/**
 * Platformaning biznes shartlari: komissiya foizi va sinov davri.
 *
 * Uch bosqichli qidiruv, har doim shu tartibda:
 *   1. Klinikaning o'ziga belgilangan qiymat (shartnoma bo'yicha)
 *   2. Admin qo'ygan platforma qiymati (`platform_settings`)
 *   3. Kodda yozilgan zaxira qiymat
 *
 * Nima uchun bazada: foiz va muddat — biznes qarori, kod emas. Admin ularni
 * deploy'siz o'zgartira olishi kerak. Lekin BITIM TUZILGANDAN keyin foiz
 * o'zgarsa, eski bitim qayta hisoblanmaydi — shuning uchun `deals` jadvalida
 * o'sha paytdagi foiz alohida saqlanadi.
 */
import { db } from '../db';
import { config } from '../lib/config';
import { badRequest } from '../lib/errors';
import { AUCTION_MODES, type AuctionMode } from '../../../shared/types';

export const SETTING_COMMISSION = 'commission_percent';
export const SETTING_TRIAL_MONTHS = 'trial_months';
export const SETTING_AUTO_CONFIRM_DAYS = 'auto_confirm_days';
export const SETTING_AUCTION_MODE = 'auction_mode';

/**
 * Amaldagi auksion turi.
 *
 * Noma'lum qiymat `anonymous` ga tushadi — bazaga qo'lda yozilgan
 * xato so'rov ekranini yiqitmasligi kerak, va ikki chekkaning
 * o'rtasi eng xavfsiz zaxira.
 */
export function auctionMode(): AuctionMode {
  const raw = textSetting(SETTING_AUCTION_MODE, 'anonymous');
  return (AUCTION_MODES as readonly string[]).includes(raw) ? (raw as AuctionMode) : 'anonymous';
}

/** Raqamli sozlama — buzuq qiymat zaxiraga tushadi, ishni to'xtatmaydi. */
function numericSetting(key: string, fallback: number): number {
  const row = db.prepare(`SELECT value FROM platform_settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function setSetting(key: string, value: number, adminId: number | null): void {
  db.prepare(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                                     updated_by = excluded.updated_by,
                                     updated_at = excluded.updated_at`,
  ).run(key, String(value), adminId);
}

/**
 * Matnli sozlama.
 *
 * `setSetting` faqat raqam qabul qilardi, chunki dastlab bu yerda
 * faqat foiz va muddat bor edi. Bot matnlari ham shu jadvalda
 * saqlanadi — ular ham biznes qarori va deploy'siz o'zgarishi kerak.
 */
export function textSetting(key: string, fallback: string): string {
  const row = db.prepare(`SELECT value FROM platform_settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setTextSetting(key: string, value: string, adminId: number | null): void {
  db.prepare(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                                     updated_by = excluded.updated_by,
                                     updated_at = excluded.updated_at`,
  ).run(key, value, adminId);
}

export function listSettings() {
  return {
    commissionPercent: numericSetting(SETTING_COMMISSION, config.rules.commissionPercent),
    trialMonths: numericSetting(SETTING_TRIAL_MONTHS, config.rules.trialMonths),
    autoConfirmDays: numericSetting(SETTING_AUTO_CONFIRM_DAYS, config.rules.autoConfirmDays),
    auctionMode: auctionMode(),
  };
}

/**
 * Shu klinika uchun amaldagi komissiya foizi.
 * Bitim tuzilayotganda chaqiriladi va natija bitimga yozib qo'yiladi.
 */
export function commissionPercentFor(clinicId: number): number {
  const row = db.prepare(`SELECT commission_percent FROM clinics WHERE id = ?`).get(clinicId) as
    | { commission_percent: number | null }
    | undefined;

  if (row?.commission_percent != null) return row.commission_percent;
  return numericSetting(SETTING_COMMISSION, config.rules.commissionPercent);
}

/** Klinikaga alohida foiz belgilash. `null` — umumiy qiymatga qaytarish. */
export function setClinicCommission(clinicId: number, percent: number | null): void {
  if (percent != null && (percent < 0 || percent > 50)) {
    throw badRequest('bad_percent', 'Komissiya 0 dan 50 gacha bo‘lishi kerak');
  }
  db.prepare(`UPDATE clinics SET commission_percent = ? WHERE id = ?`).run(percent, clinicId);
}

/* ─────────────────────────  Sinov davri  ───────────────────────── */

/**
 * Klinikaga sinov davri berish.
 *
 * Obuna holati `active` ga o'tadi va `trial` tarifi qo'yiladi — shunda
 * mavjud tekshiruvlar (taklif yuborish, chegaralar) o'zgarishsiz ishlaydi.
 * Muddat tugagach rejalashtiruvchi uni `expired` ga o'tkazadi.
 */
export function grantTrial(clinicId: number, months: number | null): { until: string } {
  const length = months ?? numericSetting(SETTING_TRIAL_MONTHS, config.rules.trialMonths);
  if (length < 0 || length > 36) throw badRequest('bad_months', 'Muddat 0 dan 36 oygacha');

  const until = new Date();
  until.setMonth(until.getMonth() + length);
  const iso = until.toISOString().slice(0, 19).replace('T', ' ');

  db.prepare(
    `UPDATE clinics
        SET trial_until = ?, plan = 'trial',
            subscription_status = 'active', subscription_until = ?
      WHERE id = ?`,
  ).run(iso, iso, clinicId);

  return { until: new Date(iso + 'Z').toISOString() };
}

/** Sinov davri hali davom etyaptimi. */
export function isOnTrial(clinicId: number): boolean {
  const row = db
    .prepare(`SELECT trial_until FROM clinics WHERE id = ? AND trial_until > datetime('now')`)
    .get(clinicId);
  return Boolean(row);
}
