/**
 * Taklif (5-bo'lim).
 *
 * Qoidalar:
 *  - Faqat TASDIQLANGAN va obunasi FAOL klinika taklif bera oladi (5.2)
 *  - Bir klinika bir so'rovga faqat bitta faol taklif (tahrirlash mumkin, tanlangunicha)
 *  - Narxga "nima kiradi" ochiq ko'rsatilishi SHART — yashirin qo'shimcha taqiqlanadi (5.1)
 */
import { db, dateFromSql, toJson, tx } from '../db';
import { PLAN_LIMITS, type OfferBadge, type OfferWithClinic } from '../../../shared/types';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { formatUzs } from '../lib/format';
import { mapClinicPublic, mapOffer } from '../lib/mappers';
import { bus, ch } from './events';
import { clinicMatchesRequest } from './matching';
import { notify } from './notifications';
import { getRequest, markViewed, publishProgress } from './requests';

export interface CreateOfferInput {
  requestId: number;
  clinicId: number;
  priceUzs: number;
  includes: string[];
  advantages: string[];
  leadTimeDays: number;
  note: string | null;
}

function hydrateOffer(row: any, allOffers?: any[]): OfferWithClinic {
  const clinicRow = db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(row.clinic_id);
  const siblings =
    allOffers ??
    (db.prepare(`SELECT * FROM offers WHERE request_id = ? AND status IN ('SENT','CHOSEN')`).all(row.request_id) as any[]);

  const badges: OfferBadge[] = [];
  if (siblings.length > 1) {
    const cheapest = Math.min(...siblings.map((o) => o.price_uzs));
    const fastest = Math.min(...siblings.map((o) => o.lead_time_days));
    if (row.price_uzs === cheapest) badges.push('cheapest');
    if (row.lead_time_days === fastest) badges.push('fastest');

    const ratings = siblings.map((o) => {
      const c = db.prepare(`SELECT rating_avg FROM clinics WHERE id = ?`).get(o.clinic_id) as { rating_avg: number };
      return { id: o.id, rating: c.rating_avg };
    });
    const top = Math.max(...ratings.map((r) => r.rating));
    if (top > 0 && ratings.find((r) => r.id === row.id)?.rating === top) badges.push('top_rated');
  }
  // 5-ekran: oxirgi 15 daqiqada kelgan taklif "Yangi"
  if (Date.now() - dateFromSql(row.created_at).getTime() < 15 * 60_000) badges.push('new');

  return { ...mapOffer(row), clinic: mapClinicPublic(clinicRow), badges };
}

export function listRequestOffers(requestId: number): OfferWithClinic[] {
  const rows = db
    .prepare(`SELECT * FROM offers WHERE request_id = ? AND status IN ('SENT','CHOSEN') ORDER BY price_uzs ASC`)
    .all(requestId) as any[];
  return rows.map((r) => hydrateOffer(r, rows));
}

export function getOffer(id: number): OfferWithClinic {
  const row = db.prepare(`SELECT * FROM offers WHERE id = ?`).get(id);
  if (!row) throw notFound('Taklif topilmadi');
  return hydrateOffer(row);
}

/** Obuna limiti — joriy oyda yuborilgan takliflar soni. */
export function monthlyOfferCount(clinicId: number): number {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n FROM offers
        WHERE clinic_id = ? AND created_at >= datetime('now', 'start of month')`,
    )
    .get(clinicId) as { n: number };
  return r.n;
}

function assertClinicCanOffer(clinicId: number) {
  const clinic = db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(clinicId) as any;
  if (!clinic) throw notFound('Klinika topilmadi');
  // 12.1: verifikatsiyasiz klinika taklif yubora olmaydi
  if (clinic.verification !== 'approved') {
    throw forbidden('Klinika hali tasdiqlanmagan — moderator tekshiruvidan keyin taklif yubora olasiz');
  }
  /*
   * To'siq aynan SHU YERDA turadi, matching'da emas.
   *
   * Klinika so'rovlarni ko'rib turadi va nimani boy berayotganini biladi —
   * shu holatdagina tarif sotib olishga sabab bo'ladi. Xato kodi alohida
   * (`subscription_required`), chunki ilova buni oddiy "ruxsat yo'q" emas,
   * "tarifni tanlang" ekrani sifatida ko'rsatishi kerak.
   */
  if (clinic.subscription_status !== 'active') {
    throw new AppError(
      402,
      'subscription_required',
      'Taklif yuborish uchun tarif kerak. So‘rovlarni ko‘rish bepul.',
    );
  }
  const plan = (clinic.plan ?? 'basic') as keyof typeof PLAN_LIMITS;
  const used = monthlyOfferCount(clinicId);
  if (used >= PLAN_LIMITS[plan].monthlyOffers) {
    throw new AppError(
      402,
      'offer_limit_reached',
      `Oylik taklif limiti tugadi (${PLAN_LIMITS[plan].monthlyOffers}). Yuqoriroq tarifga o‘ting.`,
    );
  }
}

function validateOfferBody(input: Pick<CreateOfferInput, 'priceUzs' | 'includes' | 'leadTimeDays'>) {
  if (!Number.isFinite(input.priceUzs) || input.priceUzs < 100_000 || input.priceUzs > 2_000_000_000) {
    throw badRequest('invalid_price', 'Narx noto‘g‘ri');
  }
  // Shaffoflik siyosati: nima kirishi ko'rsatilmasa taklif qabul qilinmaydi
  if (!Array.isArray(input.includes) || input.includes.length === 0) {
    throw badRequest('includes_required', 'Narxga nima kirishini ko‘rsating — bu majburiy');
  }
  if (!Number.isFinite(input.leadTimeDays) || input.leadTimeDays < 0 || input.leadTimeDays > 365) {
    throw badRequest('invalid_lead_time', 'Bajarish muddati noto‘g‘ri');
  }
}

export function createOffer(input: CreateOfferInput): OfferWithClinic {
  assertClinicCanOffer(input.clinicId);
  validateOfferBody(input);

  const req = getRequest(input.requestId);
  if (req.status !== 'NEW' && req.status !== 'COLLECTING') {
    throw conflict('request_closed', 'Bu so‘rov taklif qabul qilmaydi');
  }
  if (new Date(req.expiresAt).getTime() < Date.now()) {
    throw conflict('request_expired', 'So‘rov muddati tugagan');
  }
  if (!clinicMatchesRequest(input.clinicId, input.requestId)) {
    throw forbidden('Bu so‘rov sizning klinikangizga mos kelmaydi');
  }

  const existing = db
    .prepare(`SELECT id FROM offers WHERE request_id = ? AND clinic_id = ? AND status IN ('SENT','CHOSEN')`)
    .get(input.requestId, input.clinicId) as { id: number } | undefined;
  if (existing) {
    throw conflict('offer_exists', 'Siz bu so‘rovga allaqachon taklif yuborgansiz — uni tahrirlashingiz mumkin');
  }

  const offerId = tx(() => {
    const info = db
      .prepare(
        `INSERT INTO offers (request_id, clinic_id, price_uzs, includes, advantages, lead_time_days, note)
         VALUES (@requestId, @clinicId, @priceUzs, @includes, @advantages, @leadTimeDays, @note)`,
      )
      .run({
        requestId: input.requestId,
        clinicId: input.clinicId,
        priceUzs: Math.round(input.priceUzs),
        includes: toJson(input.includes),
        advantages: toJson(input.advantages ?? []),
        leadTimeDays: Math.round(input.leadTimeDays),
        note: input.note,
      });

    // "Javob tezligi" ko'rsatkichi — so'rov kelganidan taklifgacha o'tgan daqiqa
    const minutes = Math.max(
      1,
      Math.round((Date.now() - new Date(req.createdAt).getTime()) / 60_000),
    );
    db.prepare(
      `UPDATE clinics SET response_minutes_sum = response_minutes_sum + ?, response_samples = response_samples + 1
        WHERE id = ?`,
    ).run(minutes, input.clinicId);

    return Number(info.lastInsertRowid);
  });

  markViewed(input.requestId, input.clinicId);

  const offer = getOffer(offerId);
  bus.publish(ch.request(input.requestId), { type: 'offer:new', requestId: input.requestId, offer });
  publishProgress(input.requestId);
  notify(
    req.patientId,
    'new_offer',
    { clinic: offer.clinic.name, price: formatUzs(offer.priceUzs), operation: req.operation.nameUz },
    `/request/${input.requestId}`,
  );

  return offer;
}

/** Tanlanmagan taklifni tahrirlash (5.2). */
export function updateOffer(
  offerId: number,
  clinicId: number,
  patch: Partial<Pick<CreateOfferInput, 'priceUzs' | 'includes' | 'advantages' | 'leadTimeDays' | 'note'>>,
): OfferWithClinic {
  const row = db.prepare(`SELECT * FROM offers WHERE id = ?`).get(offerId) as any;
  if (!row) throw notFound('Taklif topilmadi');
  if (row.clinic_id !== clinicId) throw forbidden('Bu taklif sizniki emas');
  if (row.status !== 'SENT') throw conflict('offer_locked', 'Bu taklifni endi tahrirlab bo‘lmaydi');

  const next = {
    priceUzs: patch.priceUzs ?? row.price_uzs,
    includes: patch.includes ?? JSON.parse(row.includes),
    advantages: patch.advantages ?? JSON.parse(row.advantages),
    leadTimeDays: patch.leadTimeDays ?? row.lead_time_days,
    note: patch.note ?? row.note,
  };
  validateOfferBody(next);

  db.prepare(
    `UPDATE offers SET price_uzs = @priceUzs, includes = @includes, advantages = @advantages,
                       lead_time_days = @leadTimeDays, note = @note, updated_at = datetime('now')
      WHERE id = @id`,
  ).run({
    id: offerId,
    priceUzs: Math.round(next.priceUzs),
    includes: toJson(next.includes),
    advantages: toJson(next.advantages),
    leadTimeDays: Math.round(next.leadTimeDays),
    note: next.note,
  });

  const offer = getOffer(offerId);
  bus.publish(ch.request(row.request_id), { type: 'offer:updated', requestId: row.request_id, offer });
  return offer;
}

export function withdrawOffer(offerId: number, clinicId: number): void {
  const row = db.prepare(`SELECT * FROM offers WHERE id = ?`).get(offerId) as any;
  if (!row) throw notFound('Taklif topilmadi');
  if (row.clinic_id !== clinicId) throw forbidden('Bu taklif sizniki emas');
  if (row.status !== 'SENT') throw conflict('offer_locked', 'Bu taklifni qaytarib bo‘lmaydi');

  db.prepare(`UPDATE offers SET status = 'WITHDRAWN', updated_at = datetime('now') WHERE id = ?`).run(offerId);
  publishProgress(row.request_id);
}

export function listClinicOffers(clinicId: number): (OfferWithClinic & { requestStatus: string; operationName: string })[] {
  const rows = db
    .prepare(
      `SELECT o.*, r.status AS request_status, op.name_uz AS operation_name
         FROM offers o
         JOIN requests r ON r.id = o.request_id
         JOIN operations op ON op.id = r.operation_id
        WHERE o.clinic_id = ?
        ORDER BY o.id DESC`,
    )
    .all(clinicId) as any[];
  return rows.map((r) => ({
    ...hydrateOffer(r),
    requestStatus: r.request_status,
    operationName: r.operation_name,
  }));
}
