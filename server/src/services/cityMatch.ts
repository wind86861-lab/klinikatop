/**
 * banisa hududini KlinikaTop shahriga moslashtirish.
 *
 * ═══ Muammo ═══
 *
 * banisa'da hudud ERKIN MATN. Haqiqiy bazada Toshkent to'rt xil
 * yozilgan:
 *
 *   "Toshkent"   "Toshkent shahri"   "tashkent_city"   "toshkent"
 *
 * KlinikaTop'da esa 12 ta qat'iy shahar bor va so'rov mosligi
 * shunga tayanadi.
 *
 * ═══ Uch qatlam ═══
 *
 *   1. Normallashtirish — qo'shimchalarni olib tashlash, lotinlashtirish
 *   2. Taxalluslar jadvali — normallashtirish tutmagan holatlar
 *   3. Topilmasa — KLINIKADAN SO'RAYMIZ
 *
 * Uchinchisi shart. Noto'g'ri shahar klinikaga so'rov kelishini
 * butunlay to'xtatadi va buni bir necha hafta sezmaslik mumkin —
 * shuning uchun jimgina taxmin qilinmaydi.
 */
import { db } from '../db';

/**
 * Solishtirish uchun bir shaklga keltiradi.
 *
 * "Toshkent shahri" → toshkent
 * "tashkent_city"   → toshkent
 * "TOSHKENT"        → toshkent
 */
export function normalizeRegion(raw: string): string {
  let value = (raw ?? '')
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  // Ma'no bermaydigan qo'shimchalar
  value = value
    .replace(/\b(city|shahri|shahar|viloyati|viloyat|region|oblast|obl)\b/g, ' ')
    .trim();

  // Kirill va inglizcha yozilishlar lotinga
  const translit: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'j', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
    т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
    ы: 'y', э: 'e', ю: 'yu', я: 'ya', ъ: '', ь: '', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
  };

  value = value
    .split('')
    .map((ch) => translit[ch] ?? ch)
    .join('');

  /*
   * "tashkent" → "toshkent": inglizcha va o'zbekcha yozilish
   * unlilarda farq qiladi. Faqat shu ikki juftlik uchraydi.
   */
  value = value.replace(/\bta(sh|s)kent\b/, 'toshkent').replace(/\bsamarkand\b/, 'samarqand');

  // Faqat harflar qoladi: "toshkent  shahri" → "toshkent"
  return value.replace(/[^a-z]/g, '');
}

export interface CityMatch {
  cityId: number | null;
  /** Qanday topilgani — jurnal va nosozlikni izlash uchun */
  via: 'alias' | 'name' | 'none';
}

/**
 * Hududga mos shaharni topadi.
 *
 * `cityId` `null` bo'lsa — topilmadi, klinikadan so'rash kerak.
 */
export function matchCity(region: string | null | undefined): CityMatch {
  const key = normalizeRegion(region ?? '');
  if (!key) return { cityId: null, via: 'none' };

  const alias = db.prepare(`SELECT city_id FROM city_aliases WHERE alias = ?`).get(key) as
    | { city_id: number }
    | undefined;
  if (alias) return { cityId: alias.city_id, via: 'alias' };

  /*
   * Taxallus topilmasa shahar nomlarining o'zi bilan solishtiramiz —
   * yangi shahar qo'shilsa taxallus yozishni kutmasin.
   */
  const cities = db.prepare(`SELECT id, name_uz, name_ru, slug FROM cities`).all() as {
    id: number;
    name_uz: string;
    name_ru: string;
    slug: string;
  }[];

  for (const city of cities) {
    if (
      normalizeRegion(city.name_uz) === key ||
      normalizeRegion(city.name_ru) === key ||
      normalizeRegion(city.slug) === key
    ) {
      // Keyingi safar tezroq topilsin
      rememberAlias(key, city.id);
      return { cityId: city.id, via: 'name' };
    }
  }

  return { cityId: null, via: 'none' };
}

/** Yangi yozilishni eslab qoladi — klinika qo'lda tanlagandan keyin. */
export function rememberAlias(alias: string, cityId: number): void {
  const key = normalizeRegion(alias);
  if (!key) return;
  db.prepare(`INSERT OR IGNORE INTO city_aliases (alias, city_id) VALUES (?, ?)`).run(key, cityId);
}
