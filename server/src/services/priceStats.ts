/**
 * Narx statistikasi (4-bo'lim).
 *
 * Qoidalar:
 *  - Manba faqat TASDIQLANGAN bitimlarning REAL to'langan summasi (taklif narxi emas).
 *  - Yetarli ma'lumot bo'lmasa (< MIN_DEALS_FOR_PRICE_STATS) — "kam ma'lumot" belgisi
 *    bilan cold-start (qo'lda) oraliqqa tushiladi.
 *  - Ikki manba ARALASHMAYDI: `source` maydoni qaysi ekanini ochiq aytadi.
 */
import { db } from '../db';
import { config } from '../lib/config';
import type { PriceStats } from '../../../shared/types';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function buildHistogram(values: number[], min: number, max: number, buckets = 6) {
  if (max <= min) return [{ from: min, to: max, count: values.length }];
  const step = (max - min) / buckets;
  return Array.from({ length: buckets }, (_, i) => {
    const from = min + step * i;
    const to = i === buckets - 1 ? max : from + step;
    const count = values.filter((v) => (i === buckets - 1 ? v >= from && v <= to : v >= from && v < to)).length;
    return { from: Math.round(from), to: Math.round(to), count };
  });
}

/** Cold-start taqsimoti — kvartillardan sintetik histogramma yasaydi. */
function manualHistogram(min: number, p25: number, med: number, p75: number, max: number) {
  const edges = [min, p25, med, p75, max];
  const weights = [1, 3, 3, 1];
  return weights.map((w, i) => ({ from: Math.round(edges[i]), to: Math.round(edges[i + 1]), count: w }));
}

export function getPriceStats(operationId: number, cityId: number): PriceStats {
  const windowDays = config.rules.priceWindowDays;

  // 4.1: faqat tasdiqlangan bitimlarning real summasi
  const rows = db
    .prepare(
      `SELECT d.confirmed_amount_uzs AS amount
         FROM deals d
         JOIN requests r ON r.id = d.request_id
        WHERE d.status = 'CONFIRMED'
          AND d.confirmed_amount_uzs IS NOT NULL
          AND r.operation_id = ?
          AND r.city_id = ?
          AND d.confirmed_at >= datetime('now', ?)`,
    )
    .all(operationId, cityId, `-${windowDays} days`) as { amount: number }[];

  const values = rows.map((r) => r.amount).sort((a, b) => a - b);

  if (values.length >= config.rules.minDealsForPriceStats) {
    const min = values[0];
    const max = values[values.length - 1];
    return {
      operationId,
      cityId,
      source: 'deals',
      lowConfidence: false,
      sampleSize: values.length,
      min,
      p25: Math.round(percentile(values, 0.25)),
      median: Math.round(percentile(values, 0.5)),
      p75: Math.round(percentile(values, 0.75)),
      max,
      avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      histogram: buildHistogram(values, min, max),
      windowDays,
    };
  }

  // 4.3: cold start — qo'lda kiritilgan bozor oraliqlari
  const manual = db
    .prepare(`SELECT * FROM manual_prices WHERE operation_id = ? AND city_id = ?`)
    .get(operationId, cityId) as
    | { min_uzs: number; p25_uzs: number; median_uzs: number; p75_uzs: number; max_uzs: number }
    | undefined;

  if (!manual) {
    return {
      operationId,
      cityId,
      source: 'manual',
      lowConfidence: true,
      sampleSize: values.length,
      min: null,
      p25: null,
      median: null,
      p75: null,
      max: null,
      avg: null,
      histogram: [],
      windowDays,
    };
  }

  return {
    operationId,
    cityId,
    source: 'manual',
    // Real bitimlar hali yetarli emas — buni foydalanuvchiga ochiq aytamiz
    lowConfidence: true,
    sampleSize: values.length,
    min: manual.min_uzs,
    p25: manual.p25_uzs,
    median: manual.median_uzs,
    p75: manual.p75_uzs,
    max: manual.max_uzs,
    avg: manual.median_uzs,
    histogram: manualHistogram(manual.min_uzs, manual.p25_uzs, manual.median_uzs, manual.p75_uzs, manual.max_uzs),
    windowDays,
  };
}


/**
 * Tahlil so'rovi uchun narx oralig'i — ORGAN bo'yicha.
 *
 * Operatsiyada o'lchov birligi operatsiyaning o'zi, tahlilda esa
 * tekshiriladigan organ. Boshqa hammasi bir xil: faqat yopilgan
 * bitimlarning haqiqiy summasi olinadi.
 *
 * Qo'lda kiritilgan oraliq (`manual_prices`) hozircha faqat
 * operatsiyalar uchun. Tahlilda bitim yetarli bo'lmasa bo'sh
 * statistika qaytadi va byudjet ekrani o'zining odatiy oralig'ini
 * ko'rsatadi — bu allaqachon shunday ishlaydi.
 */
export function getLabPriceStats(organId: number, cityId: number): PriceStats {
  const windowDays = config.rules.priceWindowDays;

  const rows = db
    .prepare(
      `SELECT d.confirmed_amount_uzs AS amount
         FROM deals d
         JOIN requests r ON r.id = d.request_id
        WHERE d.status = 'CONFIRMED'
          AND d.confirmed_amount_uzs IS NOT NULL
          AND r.kind = 'lab'
          AND r.lab_organ_id = ?
          AND r.city_id = ?
          AND d.confirmed_at >= datetime('now', ?)`,
    )
    .all(organId, cityId, `-${windowDays} days`) as { amount: number }[];

  const values = rows.map((r) => r.amount).sort((a, b) => a - b);
  const empty: PriceStats = {
    operationId: 0,
    cityId,
    source: 'manual',
    lowConfidence: true,
    sampleSize: values.length,
    min: null,
    p25: null,
    median: null,
    p75: null,
    max: null,
    avg: null,
    histogram: [],
    windowDays,
  };

  if (values.length < config.rules.minDealsForPriceStats) return empty;

  const min = values[0];
  const max = values[values.length - 1];
  return {
    ...empty,
    source: 'deals',
    lowConfidence: false,
    min,
    p25: Math.round(percentile(values, 0.25)),
    median: Math.round(percentile(values, 0.5)),
    p75: Math.round(percentile(values, 0.75)),
    max,
    avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    histogram: buildHistogram(values, min, max),
  };
}

/** So'rov turiga qarab to'g'ri statistikani beradi. */
export function statsForRequest(req: {
  kind: string;
  operationId: number | null;
  labOrganId: number | null;
  cityId: number;
}): PriceStats | null {
  if (req.kind === 'lab') {
    return req.labOrganId ? getLabPriceStats(req.labOrganId, req.cityId) : null;
  }
  return req.operationId ? getPriceStats(req.operationId, req.cityId) : null;
}
