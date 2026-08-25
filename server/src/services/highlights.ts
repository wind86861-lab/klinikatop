/**
 * Bosh sahifa uchun jonli kontent: narx pulsi va bemorlar fikri.
 *
 * Ikkalasi ham FAQAT tasdiqlangan bitimlardan quriladi — ya'ni real to'langan
 * summalardan. Bu platformaning asosiy va'dasi: narx haqiqatdan olinadi.
 */
import { db } from '../db';
import { config } from '../lib/config';
import type { Lang } from '../../../shared/types';

export interface PricePulse {
  operationId: number;
  operationName: string;
  minUzs: number;
  maxUzs: number;
  sampleSize: number;
  windowDays: number;
  /** 'deals' — real to'lovlar; 'manual' — hali bitim kam, bozor tadqiqoti */
  source: 'deals' | 'manual';
}

export interface Testimonial {
  id: number;
  /** "Malika R." — familiya faqat bosh harfi bilan */
  patientName: string;
  operationName: string;
  rating: number;
  body: string;
  paidUzs: number;
  createdAt: string;
}

const PULSE_WINDOW_DAYS = 7;
export const PULSE_MIN_DEALS = 2;

/** "Malika Rasulova" → "Malika R." */
function shortName(first: string, last: string | null): string {
  const initial = last?.trim()?.[0];
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

/**
 * Shu hafta eng ko'p bitim bo'lgan operatsiya bo'yicha real to'lov oralig'i.
 * Yetarli bitim bo'lmasa — eng mashhur operatsiyaning taxminiy oralig'i.
 */
export function getPricePulse(cityId: number | null, lang: Lang = 'uz'): PricePulse | null {
  const nameColumn = lang === 'ru' ? 'op.name_ru' : 'op.name_uz';

  // 1) Real bitimlar — oxirgi hafta, shahar bo'yicha (shahar berilmasa butun mamlakat)
  const real = db
    .prepare(
      `SELECT r.operation_id             AS operationId,
              ${nameColumn}              AS operationName,
              MIN(d.confirmed_amount_uzs) AS minUzs,
              MAX(d.confirmed_amount_uzs) AS maxUzs,
              COUNT(*)                    AS sampleSize
         FROM deals d
         JOIN requests r   ON r.id = d.request_id
         JOIN operations op ON op.id = r.operation_id
        WHERE d.status = 'CONFIRMED'
          AND d.confirmed_amount_uzs IS NOT NULL
          AND d.confirmed_at >= datetime('now', @window)
          AND (@cityId IS NULL OR r.city_id = @cityId)
        GROUP BY r.operation_id
        HAVING COUNT(*) >= @minDeals
        ORDER BY COUNT(*) DESC, MAX(d.confirmed_at) DESC
        LIMIT 1`,
    )
    .get({
      window: `-${PULSE_WINDOW_DAYS} days`,
      cityId,
      minDeals: PULSE_MIN_DEALS,
    }) as Omit<PricePulse, 'windowDays' | 'source'> | undefined;

  if (real) {
    return { ...real, windowDays: PULSE_WINDOW_DAYS, source: 'deals' };
  }

  // 2) Cold start — eng ko'p so'rov kelgan operatsiyaning qo'lda kiritilgan oralig'i
  const fallback = db
    .prepare(
      `SELECT mp.operation_id AS operationId,
              ${nameColumn}   AS operationName,
              mp.p25_uzs      AS minUzs,
              mp.p75_uzs      AS maxUzs
         FROM manual_prices mp
         JOIN operations op ON op.id = mp.operation_id
        WHERE (@cityId IS NULL OR mp.city_id = @cityId)
        ORDER BY (SELECT COUNT(*) FROM requests r WHERE r.operation_id = mp.operation_id) DESC,
                 mp.operation_id ASC
        LIMIT 1`,
    )
    .get({ cityId }) as { operationId: number; operationName: string; minUzs: number; maxUzs: number } | undefined;

  if (!fallback) return null;

  return { ...fallback, sampleSize: 0, windowDays: PULSE_WINDOW_DAYS, source: 'manual' };
}

/**
 * Bemorlar fikri — sharh + real to'langan summa.
 *
 * Maxfiylik: familiya bosh harfi bilan qisqartiriladi. Sharh bemor ixtiyoriy
 * qoldirgan, summa esa u o'zi tasdiqlagan — oferta 2-bandiga muvofiq.
 * Belgilangan (shubhali) sharhlar ko'rsatilmaydi.
 */
export function getTestimonials(limit = 8, lang: Lang = 'uz'): Testimonial[] {
  const nameColumn = lang === 'ru' ? 'op.name_ru' : 'op.name_uz';

  const rows = db
    .prepare(
      `SELECT rv.id,
              u.first_name              AS firstName,
              u.last_name               AS lastName,
              ${nameColumn}             AS operationName,
              rv.average                AS rating,
              rv.body                   AS body,
              d.confirmed_amount_uzs    AS paidUzs,
              rv.created_at             AS createdAt
         FROM reviews rv
         JOIN deals d      ON d.id = rv.deal_id
         JOIN requests r   ON r.id = d.request_id
         JOIN operations op ON op.id = r.operation_id
         JOIN users u      ON u.id = rv.patient_id
        WHERE rv.flagged = 0
          AND rv.body IS NOT NULL
          AND TRIM(rv.body) != ''
          AND d.status = 'CONFIRMED'
          AND d.confirmed_amount_uzs IS NOT NULL
        ORDER BY rv.id DESC
        LIMIT ?`,
    )
    .all(limit) as any[];

  return rows.map((r) => ({
    id: r.id,
    patientName: shortName(r.firstName, r.lastName),
    operationName: r.operationName,
    rating: Math.round(r.rating * 10) / 10,
    body: r.body,
    paidUzs: r.paidUzs,
    createdAt: new Date(r.createdAt.replace(' ', 'T') + 'Z').toISOString(),
  }));
}

export const COMMISSION_PERCENT = config.rules.commissionPercent;
