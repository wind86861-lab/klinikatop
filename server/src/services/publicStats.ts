/**
 * Ochiq sahifa uchun raqamlar.
 *
 * Bosh sahifani brauzerdan kirgan begona odam ko'radi, shuning uchun
 * bu yerda MAXFIY hech narsa yo'q: faqat jamlangan sonlar va katalog
 * hajmi. Bemor ismi, klinika daromadi, so'rov mazmuni — hech biri
 * chiqmaydi.
 *
 * Raqamlar HAQIQIY. Platforma yangi va sonlar hozircha kichik; ularni
 * bo'rttirish qisqa muddatli yutuq bo'lardi, lekin birinchi klinika
 * "bu yerda 5000 bemor bor edi-ku" deb so'raganda javob qolmasdi.
 * Shuning uchun sahifa katalog kengligiga tayanadi — u haqiqatan katta.
 */
import { db } from '../db';
import { config } from '../lib/config';

export interface PublicStats {
  /** Tasdiqlangan klinikalar */
  clinics: number;
  /** Klinikasi bor viloyatlar */
  cities: number;
  /** Katalogdagi operatsiyalar */
  operations: number;
  /** Tanlash mumkin bo'lgan tekshiruvlar */
  labTests: number;
  /** Yakunlangan bitimlar */
  deals: number;
  /** O'rtacha baho va sharhlar soni */
  ratingAvg: number | null;
  reviews: number;
  /** Klinikalarning o'rtacha javob vaqti (daqiqa) */
  avgResponseMinutes: number | null;
  /**
   * Bot manzili — bosh sahifadagi asosiy tugma shu yerga olib boradi.
   *
   * Serverdan keladi, build vaqtidagi o'zgaruvchidan emas: bot nomi
   * o'zgarsa yoki sinov boti ishlatilsa, qayta yig'ish kerak
   * bo'lmasin.
   */
  botUrl: string | null;
}

const one = <T>(sql: string): T => db.prepare(sql).get() as T;

/*
 * Bot nomi Telegramdan bir marta so'raladi va eslab qolinadi: u
 * o'zgarmaydi, har sahifa ochilishida so'rash esa keraksiz kechikish.
 */
let botUrlCache: string | null | undefined;

async function resolveBotUrl(): Promise<string | null> {
  if (botUrlCache !== undefined) return botUrlCache;
  if (!config.telegram.botToken) {
    botUrlCache = null;
    return null;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/getMe`);
    const data = (await res.json()) as { ok?: boolean; result?: { username?: string } };
    botUrlCache = data.ok && data.result?.username ? `https://t.me/${data.result.username}` : null;
  } catch {
    // Tarmoq xatosi — keyingi safar qayta urinamiz
    botUrlCache = undefined;
    return null;
  }
  return botUrlCache;
}

/*
 * Sonlar bir daqiqa keshlanadi.
 *
 * Bosh sahifa eng ko'p ochiladigan manzil bo'ladi va har ochilishda
 * o'nga yaqin `COUNT(*)` yurgizish bazani bekorga bezovta qiladi.
 * Bir daqiqalik eskilik bu yerda hech kimga sezilmaydi.
 */
let cache: { at: number; value: PublicStats } | null = null;
const TTL_MS = 60_000;

export async function getPublicStats(): Promise<PublicStats> {
  const botUrl = await resolveBotUrl();

  if (cache && Date.now() - cache.at < TTL_MS) {
    return { ...cache.value, botUrl };
  }

  const rating = one<{ avg: number | null; n: number }>(
    `SELECT AVG(rating_avg) AS avg, SUM(rating_count) AS n
       FROM clinics WHERE verification = 'approved' AND rating_count > 0`,
  );

  const response = one<{ sum: number | null; samples: number | null }>(
    `SELECT SUM(response_minutes_sum) AS sum, SUM(response_samples) AS samples
       FROM clinics WHERE verification = 'approved'`,
  );

  const value: PublicStats = {
    clinics: one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM clinics WHERE verification = 'approved'`,
    ).n,
    cities: one<{ n: number }>(
      `SELECT COUNT(DISTINCT city_id) AS n FROM clinics WHERE verification = 'approved'`,
    ).n,
    operations: one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM operations WHERE active = 1 AND slug != 'unknown'`,
    ).n,
    /* Faqat barglar: guruh tanlanmaydi, shuning uchun u son ham emas */
    labTests: one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM lab_tests t
        WHERE t.active = 1
          AND NOT EXISTS (SELECT 1 FROM lab_tests c WHERE c.parent_id = t.id AND c.active = 1)`,
    ).n,
    deals: one<{ n: number }>(`SELECT COUNT(*) AS n FROM deals WHERE status = 'CONFIRMED'`).n,
    ratingAvg: rating.avg == null ? null : Math.round(rating.avg * 10) / 10,
    reviews: rating.n ?? 0,
    avgResponseMinutes:
      response.samples && response.sum ? Math.round(response.sum / response.samples) : null,
    botUrl,
  };

  cache = { at: Date.now(), value };
  return value;
}
