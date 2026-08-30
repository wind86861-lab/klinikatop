/** Admin va moderator amallari (12, 14-bo'limlar). */
import { db, toJson } from '../db';
import { badRequest, notFound } from '../lib/errors';
import { mapDeal, mapUser } from '../lib/mappers';
import type { AdminMetrics, AdminUserRow, Deal, Role, User } from '../../../shared/types';
import { recomputeClinicRating } from './reviews';
import { listSettings } from './terms.business';
import type { AdminClinicFilter, AdminClinicRow } from '../../../shared/types';

export function getMetrics(): AdminMetrics {
  const one = <T>(sql: string, ...args: unknown[]): T => db.prepare(sql).get(...(args as any)) as T;

  const users = one<{ n: number }>(`SELECT COUNT(*) AS n FROM users`).n;
  const clinics = one<{ n: number }>(`SELECT COUNT(*) AS n FROM clinics`).n;
  const patients = one<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE clinic_id IS NULL`).n;
  const pending = one<{ n: number }>(`SELECT COUNT(*) AS n FROM clinics WHERE verification = 'pending'`).n;
  const requests = one<{ n: number }>(`SELECT COUNT(*) AS n FROM requests`).n;
  const offers = one<{ n: number }>(`SELECT COUNT(*) AS n FROM offers`).n;
  const deals = one<{ n: number }>(`SELECT COUNT(*) AS n FROM deals`).n;
  const confirmed = one<{ n: number }>(`SELECT COUNT(*) AS n FROM deals WHERE status = 'CONFIRMED'`).n;
  const disputes = one<{ n: number }>(`SELECT COUNT(*) AS n FROM deals WHERE status = 'DISPUTED'`).n;
  const commission = one<{ s: number }>(
    `SELECT COALESCE(SUM(commission_uzs), 0) AS s FROM deals WHERE status = 'CONFIRMED'`,
  ).s;
  const subs = one<{ s: number }>(`SELECT COALESCE(SUM(amount_uzs), 0) AS s FROM subscription_payments`).s;

  return {
    users,
    patients,
    clinics,
    pendingVerifications: pending,
    requests,
    offers,
    deals,
    confirmedDeals: confirmed,
    commissionUzs: commission,
    subscriptionRevenueUzs: subs,
    conversionPercent: requests > 0 ? Math.round((deals / requests) * 100) : 0,
    disputes,
  };
}

/** 12.2: nizolar ro'yxati — moderator chat, summa va hujjatlar asosida hal qiladi. */
export function listDisputes(): Deal[] {
  const rows = db.prepare(`SELECT * FROM deals WHERE status = 'DISPUTED' ORDER BY id DESC`).all() as any[];
  return rows.map(mapDeal);
}

export function resolveDispute(
  dealId: number,
  moderatorId: number,
  resolution: 'confirm' | 'cancel',
  amountUzs: number | null,
  note: string,
): Deal {
  const deal = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(dealId) as any;
  if (!deal) throw notFound('Bitim topilmadi');

  if (resolution === 'confirm') {
    const amount = amountUzs ?? deal.agreed_price_uzs;
    const percent = deal.commission_percent ?? 5;
    db.prepare(
      `UPDATE deals SET status = 'CONFIRMED', confirmed_amount_uzs = ?, commission_uzs = ?,
                        commission_percent = ?, confirmed_at = datetime('now') WHERE id = ?`,
    ).run(amount, Math.round((amount * percent) / 100), percent, dealId);
    db.prepare(`UPDATE requests SET status = 'COMPLETED' WHERE id = ?`).run(deal.request_id);
  } else {
    db.prepare(`UPDATE deals SET status = 'CANCELLED' WHERE id = ?`).run(dealId);
    db.prepare(`UPDATE requests SET status = 'CANCELLED' WHERE id = ?`).run(deal.request_id);
  }

  db.prepare(
    `INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note) VALUES (?, 'deal', ?, ?, ?)`,
  ).run(moderatorId, dealId, `dispute:${resolution}`, note);

  return mapDeal(db.prepare(`SELECT * FROM deals WHERE id = ?`).get(dealId));
}

/**
 * Foydalanuvchilar ro'yxati.
 *
 * Ilgari qat'iy `LIMIT 100` turardi va qidiruv yo'q edi: 193 ta
 * foydalanuvchidan 93 tasi panelda umuman ko'rinmasdi va ularni
 * topishning hech qanday yo'li yo'q edi.
 */
export function listUsers(opts: { search?: string; limit?: number } = {}): AdminUserRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const q = (opts.search ?? '').trim().toLowerCase();

  const rows = db
    .prepare(
      `SELECT u.*, c.name AS clinic_name
         FROM users u
         LEFT JOIN clinics c ON c.id = u.clinic_id
        WHERE (? = '' OR lower(u.first_name) LIKE ? OR lower(COALESCE(u.last_name, '')) LIKE ?
               OR COALESCE(u.phone, '') LIKE ? OR lower(COALESCE(u.username, '')) LIKE ?)
        ORDER BY u.id DESC
        LIMIT ?`,
    )
    .all(q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, limit) as any[];

  return rows.map((r) => ({ ...mapUser(r), clinicName: r.clinic_name ?? null }));
}

export function setUserRoles(userId: number, roles: Role[], moderatorId: number): User {
  /*
   * Admin o'zidan admin rolini ola olmaydi.
   *
   * Panelga faqat admin kiradi, ya'ni bu bir bosishda o'zini
   * tashqarida qoldirish degani — qaytarish uchun boshqa admin yoki
   * bazaga qo'lda kirish kerak bo'lardi.
   */
  if (userId === moderatorId && !roles.includes('admin')) {
    throw badRequest('cannot_demote_self', 'O‘zingizdan admin huquqini ola olmaysiz');
  }
  db.prepare(`UPDATE users SET roles = ? WHERE id = ?`).run(toJson(roles), userId);
  db.prepare(`INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note) VALUES (?, 'user', ?, 'roles', ?)`).run(
    moderatorId,
    userId,
    roles.join(','),
  );
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  if (!row) throw notFound('Foydalanuvchi topilmadi');
  return mapUser(row);
}

export function setUserBlocked(userId: number, blocked: boolean, moderatorId: number, note: string): User {
  // Xuddi shu sabab: o'zini bloklash ham qaytarib bo'lmaydigan xato
  if (userId === moderatorId && blocked) {
    throw badRequest('cannot_block_self', 'O‘zingizni bloklay olmaysiz');
  }
  db.prepare(`UPDATE users SET blocked_at = ${blocked ? `datetime('now')` : 'NULL'} WHERE id = ?`).run(userId);
  db.prepare(`INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note) VALUES (?, 'user', ?, ?, ?)`).run(
    moderatorId,
    userId,
    blocked ? 'block' : 'unblock',
    note,
  );
  return mapUser(db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId));
}

/** Cold start narxini qo'lda kiritish/yangilash (14-bo'lim). */
export function upsertManualPrice(input: {
  operationId: number;
  cityId: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  note?: string;
}) {
  db.prepare(
    `INSERT INTO manual_prices (operation_id, city_id, min_uzs, p25_uzs, median_uzs, p75_uzs, max_uzs, note)
     VALUES (@operationId, @cityId, @min, @p25, @median, @p75, @max, @note)
     ON CONFLICT(operation_id, city_id) DO UPDATE SET
       min_uzs = excluded.min_uzs, p25_uzs = excluded.p25_uzs, median_uzs = excluded.median_uzs,
       p75_uzs = excluded.p75_uzs, max_uzs = excluded.max_uzs, note = excluded.note,
       updated_at = datetime('now')`,
  ).run({ ...input, note: input.note ?? 'Qo‘lda kiritilgan' });
}

/** Shubhali sharhni moderator hal qiladi (10.3). */
export function moderateReview(reviewId: number, moderatorId: number, action: 'approve' | 'remove', note: string) {
  const review = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(reviewId) as any;
  if (!review) throw notFound('Sharh topilmadi');

  if (action === 'approve') db.prepare(`UPDATE reviews SET flagged = 0 WHERE id = ?`).run(reviewId);
  else db.prepare(`DELETE FROM reviews WHERE id = ?`).run(reviewId);

  recomputeClinicRating(review.clinic_id);
  db.prepare(`INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note) VALUES (?, 'review', ?, ?, ?)`).run(
    moderatorId,
    reviewId,
    action,
    note,
  );
}

export function listFlaggedReviews() {
  return db
    .prepare(
      `SELECT r.*, u.first_name AS patient_name, c.name AS clinic_name
         FROM reviews r JOIN users u ON u.id = r.patient_id JOIN clinics c ON c.id = r.clinic_id
        WHERE r.flagged = 1 ORDER BY r.id DESC`,
    )
    .all();
}

/**
 * Admin uchun klinikalar ro'yxati.
 *
 * Bitta so'rovda hamma kerakli ma'lumot: holat, obuna, sinov davri, amaldagi
 * komissiya va ko'rib chiqilmagan hujjatlar soni. Shunday qilib admin ekranda
 * har klinika uchun alohida so'rov yubormaydi.
 *
 * `effective_commission` — klinikaga xos foiz bo'lsa o'sha, aks holda
 * platforma qiymati. Hisob SQL'da qilinadi, chunki u ro'yxatni saralashda
 * ham kerak bo'lishi mumkin.
 */
export function listClinicsForAdmin(filter: AdminClinicFilter = 'all'): AdminClinicRow[] {
  const platformPercent = listSettings().commissionPercent;

  const where =
    filter === 'pending'
      ? `c.verification = 'pending'
         OR (c.verification = 'rejected'
             AND EXISTS (SELECT 1 FROM clinic_documents d
                          WHERE d.clinic_id = c.id AND d.status = 'pending'))`
      : filter === 'approved'
        ? `c.verification = 'approved'`
        : filter === 'no_subscription'
          ? `c.subscription_status <> 'active'`
          : '1 = 1';

  const rows = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM offers o WHERE o.clinic_id = c.id) AS offers_count,
              (SELECT COUNT(*) FROM clinic_documents d
                WHERE d.clinic_id = c.id AND d.status = 'pending') AS pending_docs
         FROM clinics c
        WHERE ${where}
        ORDER BY (c.verification = 'pending') DESC, c.created_at DESC`,
    )
    .all() as any[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    cityId: r.city_id,
    verification: r.verification,
    plan: r.plan ?? null,
    subscriptionStatus: r.subscription_status,
    subscriptionUntil: r.subscription_until
      ? new Date(r.subscription_until.replace(' ', 'T') + 'Z').toISOString()
      : null,
    trialUntil: r.trial_until ? new Date(r.trial_until.replace(' ', 'T') + 'Z').toISOString() : null,
    commissionPercent: r.commission_percent ?? null,
    effectiveCommissionPercent: r.commission_percent ?? platformPercent,
    ratingAvg: r.rating_avg,
    dealsCount: r.deals_count,
    offersCount: r.offers_count,
    pendingDocuments: r.pending_docs,
    createdAt: new Date(r.created_at.replace(' ', 'T') + 'Z').toISOString(),
  }));
}
