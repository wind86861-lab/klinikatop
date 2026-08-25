/**
 * Sharh va reyting (10-bo'lim).
 *
 * Himoya:
 *  - Faqat TASDIQLANGAN bitim egasi sharh qoldiradi (soxta sharh oldini olish)
 *  - Bir bitimga bir sharh (DB darajasida UNIQUE)
 *  - Klinika o'ziga sharh yoza olmaydi
 *  - Shubhali faollik moderatorga belgilanadi
 */
import { db, tx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { mapReview } from '../lib/mappers';
import { REVIEW_ASPECTS, type Review, type ReviewAspect } from '../../../shared/types';

export interface CreateReviewInput {
  dealId: number;
  patientId: number;
  scores: Record<ReviewAspect, number>;
  body: string | null;
}

export function createReview(input: CreateReviewInput): Review {
  const deal = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(input.dealId) as any;
  if (!deal) throw notFound('Bitim topilmadi');
  if (deal.patient_id !== input.patientId) throw forbidden('Bu bitim sizniki emas');
  // 10.1: faqat tasdiqlangan bitimdan
  if (deal.status !== 'CONFIRMED') {
    throw conflict('deal_not_confirmed', 'Sharh faqat tasdiqlangan bitimdan keyin qoldiriladi');
  }

  // Klinika xodimi o'z klinikasiga sharh yoza olmaydi (10.3)
  const author = db.prepare(`SELECT clinic_id FROM users WHERE id = ?`).get(input.patientId) as { clinic_id: number | null };
  if (author?.clinic_id === deal.clinic_id) throw forbidden('O‘z klinikangizga sharh yoza olmaysiz');

  const existing = db.prepare(`SELECT 1 FROM reviews WHERE deal_id = ?`).get(input.dealId);
  if (existing) throw conflict('review_exists', 'Bu bitimga sharh allaqachon qoldirilgan');

  for (const aspect of REVIEW_ASPECTS) {
    const v = input.scores[aspect];
    if (!Number.isInteger(v) || v < 1 || v > 5) throw badRequest('invalid_score', `"${aspect}" bahosi 1–5 oralig‘ida bo‘lishi kerak`);
  }

  const average = REVIEW_ASPECTS.reduce((s, a) => s + input.scores[a], 0) / REVIEW_ASPECTS.length;

  // Shubhali faollik: bir kunda bir bemordan bir nechta bir xil sharh
  const sameToday = db
    .prepare(
      `SELECT COUNT(*) AS n FROM reviews
        WHERE patient_id = ? AND created_at >= datetime('now', '-1 day')`,
    )
    .get(input.patientId) as { n: number };
  const flagged = sameToday.n >= 3 ? 1 : 0;

  const reviewId = tx(() => {
    const info = db
      .prepare(
        `INSERT INTO reviews (deal_id, clinic_id, patient_id, quality, attitude, cleanliness, result, average, body, flagged)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.dealId,
        deal.clinic_id,
        input.patientId,
        input.scores.quality,
        input.scores.attitude,
        input.scores.cleanliness,
        input.scores.result,
        average,
        input.body,
        flagged,
      );

    // 10.2: umumiy reyting = o'lchovlar o'rtachasi, bitimlar soni bo'yicha vaznlangan
    recomputeClinicRating(deal.clinic_id);
    return Number(info.lastInsertRowid);
  });

  if (flagged) {
    db.prepare(`INSERT INTO moderation_log (entity, entity_id, action, note) VALUES ('review', ?, 'flagged', ?)`).run(
      reviewId,
      'Bir kunda ko‘p sharh — tekshirish kerak',
    );
  }

  return getReview(reviewId);
}

export function recomputeClinicRating(clinicId: number) {
  const agg = db
    .prepare(`SELECT COUNT(*) AS n, AVG(average) AS avg FROM reviews WHERE clinic_id = ? AND flagged = 0`)
    .get(clinicId) as { n: number; avg: number | null };
  db.prepare(`UPDATE clinics SET rating_avg = ?, rating_count = ? WHERE id = ?`).run(
    agg.avg ?? 0,
    agg.n ?? 0,
    clinicId,
  );
}

export function getReview(id: number): Review {
  const row = db
    .prepare(
      `SELECT r.*, u.first_name AS patient_name FROM reviews r
         JOIN users u ON u.id = r.patient_id WHERE r.id = ?`,
    )
    .get(id);
  if (!row) throw notFound('Sharh topilmadi');
  return mapReview(row);
}

export function listClinicReviews(clinicId: number, limit = 20): Review[] {
  const rows = db
    .prepare(
      `SELECT r.*, u.first_name AS patient_name FROM reviews r
         JOIN users u ON u.id = r.patient_id
        WHERE r.clinic_id = ? AND r.flagged = 0
        ORDER BY r.id DESC LIMIT ?`,
    )
    .all(clinicId, limit);
  return rows.map(mapReview);
}
