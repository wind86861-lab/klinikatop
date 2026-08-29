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
  /** Klinika taklif qilgan aniq sanalar (YYYY-MM-DD) */
  proposedDates?: string[];
  /** Budjetdan yuqori narx uchun izoh */
  aboveBudgetReason?: string | null;
  note: string | null;
}

/**
 * Narx bemor budjetidan qancha chetga chiqishi mumkin.
 *
 * Ikki tomonga ham: pastga tushirish ham cheklanadi. Juda arzon
 * taklif ham shubhali — u odatda "nimadir narxga kirmagan" degani
 * va bemor buni keyin, klinikaga kelganda bilib qoladi.
 */
export const PRICE_TOLERANCE = 0.2;

/** Ro'yxatdagi bandlar: erkin matn ham qabul qilinadi. */
const MAX_LIST_ITEMS = 12;
const MAX_ITEM_LEN = 80;

/**
 * Bandlarni tozalaydi.
 *
 * Klinika o'z bandini yozishi mumkin — tayyor variantlar hammasini
 * qamrab ololmaydi. Shuning uchun bu yerda faqat shakl tekshiriladi:
 * bo'shlar tashlanadi, uzunlari qisqartiriladi, takrorlar olib
 * tashlanadi. Nima yozish klinikaning ishi, bemor esa buni ko'rib
 * o'zi baho beradi.
 */
function cleanList(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of items) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_ITEM_LEN);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_LIST_ITEMS) break;
  }
  return out;
}

/** Sana ro'yxati: faqat YYYY-MM-DD, o'tmish emas, tartiblangan. */
function cleanDates(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();

  return items
    .filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => d >= today)
    .filter((d) => (seen.has(d) ? false : (seen.add(d), true)))
    .sort()
    .slice(0, 6);
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

function validateOfferBody(
  input: Pick<CreateOfferInput, 'priceUzs' | 'includes' | 'leadTimeDays' | 'aboveBudgetReason'>,
  budgetUzs: number | null,
) {
  if (!Number.isFinite(input.priceUzs) || input.priceUzs < 100_000 || input.priceUzs > 2_000_000_000) {
    throw badRequest('invalid_price', 'Narx noto‘g‘ri');
  }
  // Shaffoflik siyosati: nima kirishi ko'rsatilmasa taklif qabul qilinmaydi
  if (cleanList(input.includes).length === 0) {
    throw badRequest('includes_required', 'Narxga nima kirishini ko‘rsating — bu majburiy');
  }
  if (!Number.isFinite(input.leadTimeDays) || input.leadTimeDays < 0 || input.leadTimeDays > 365) {
    throw badRequest('invalid_lead_time', 'Bajarish muddati noto‘g‘ri');
  }

  /*
   * Narx bemor budjetidan ±20% dan chetga chiqmaydi.
   *
   * Ilgari yuqori chegara yo'q edi: klinika 8 mln so'ragan bemorga 30
   * mln taklif qila olardi. Bu ikki tomonga ham zarar — bemor bunday
   * taklifni o'qimaydi ham, klinika esa bekorga vaqt sarflaydi va
   * ro'yxatni to'ldirib qo'yadi.
   *
   * ±20% — kelishuv oynasi. Uning ichida klinika yaxshiroq shart bilan
   * qimmatroq (yoki soddaroq bilan arzonroq) taklif bera oladi, lekin
   * bemorning mo'ljalidan uzoqlashib ketmaydi.
   *
   * Budjetdan yuqori bo'lsa SABAB majburiy: bemor nima uchun
   * qimmatroq ekanini bilmasa, u shunchaki eng arzonini tanlaydi.
   */
  if (budgetUzs) {
    const max = Math.round(budgetUzs * (1 + PRICE_TOLERANCE));
    const min = Math.round(budgetUzs * (1 - PRICE_TOLERANCE));

    if (input.priceUzs > max) {
      throw badRequest(
        'price_too_high',
        `Narx bemor budjetidan ${Math.round(PRICE_TOLERANCE * 100)}% dan ortiq yuqori bo‘lmasin`,
      );
    }
    if (input.priceUzs < min) {
      throw badRequest(
        'price_too_low',
        `Narx bemor budjetidan ${Math.round(PRICE_TOLERANCE * 100)}% dan ortiq past bo‘lmasin`,
      );
    }

    if (input.priceUzs > budgetUzs) {
      const reason = (input.aboveBudgetReason ?? '').trim();
      if (reason.length < 10) {
        throw badRequest(
          'above_budget_reason_required',
          'Narx bemor budjetidan yuqori — nima uchun ekanini tushuntiring',
        );
      }
    }
  }
}

export function createOffer(input: CreateOfferInput): OfferWithClinic {
  assertClinicCanOffer(input.clinicId);

  const req = getRequest(input.requestId);
  validateOfferBody(input, req.budgetUzs);
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
        `INSERT INTO offers
           (request_id, clinic_id, price_uzs, includes, advantages, lead_time_days,
            proposed_dates, above_budget_reason, note)
         VALUES (@requestId, @clinicId, @priceUzs, @includes, @advantages, @leadTimeDays,
                 @proposedDates, @aboveBudgetReason, @note)`,
      )
      .run({
        requestId: input.requestId,
        clinicId: input.clinicId,
        priceUzs: Math.round(input.priceUzs),
        includes: toJson(cleanList(input.includes)),
        advantages: toJson(cleanList(input.advantages)),
        proposedDates: toJson(cleanDates(input.proposedDates)),
        aboveBudgetReason:
          req.budgetUzs && input.priceUzs > req.budgetUzs
            ? (input.aboveBudgetReason ?? '').trim().slice(0, 300)
            : null,
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
  patch: Partial<
    Pick<
      CreateOfferInput,
      'priceUzs' | 'includes' | 'advantages' | 'leadTimeDays' | 'proposedDates' | 'aboveBudgetReason' | 'note'
    >
  >,
): OfferWithClinic {
  const row = db.prepare(`SELECT * FROM offers WHERE id = ?`).get(offerId) as any;
  if (!row) throw notFound('Taklif topilmadi');
  if (row.clinic_id !== clinicId) throw forbidden('Bu taklif sizniki emas');
  if (row.status !== 'SENT') throw conflict('offer_locked', 'Bu taklifni endi tahrirlab bo‘lmaydi');

  const req = getRequest(row.request_id);

  const next = {
    priceUzs: patch.priceUzs ?? row.price_uzs,
    includes: patch.includes ?? JSON.parse(row.includes),
    advantages: patch.advantages ?? JSON.parse(row.advantages),
    leadTimeDays: patch.leadTimeDays ?? row.lead_time_days,
    proposedDates: patch.proposedDates ?? JSON.parse(row.proposed_dates ?? '[]'),
    aboveBudgetReason: patch.aboveBudgetReason ?? row.above_budget_reason,
    note: patch.note ?? row.note,
  };
  validateOfferBody(next, req.budgetUzs);

  const aboveBudget = Boolean(req.budgetUzs && next.priceUzs > req.budgetUzs);

  db.prepare(
    `UPDATE offers SET price_uzs = @priceUzs, includes = @includes, advantages = @advantages,
                       lead_time_days = @leadTimeDays, proposed_dates = @proposedDates,
                       above_budget_reason = @aboveBudgetReason,
                       note = @note, updated_at = datetime('now')
      WHERE id = @id`,
  ).run({
    id: offerId,
    priceUzs: Math.round(next.priceUzs),
    includes: toJson(cleanList(next.includes)),
    advantages: toJson(cleanList(next.advantages)),
    leadTimeDays: Math.round(next.leadTimeDays),
    proposedDates: toJson(cleanDates(next.proposedDates)),
    // Narx budjetga tushib qolsa izoh ham kerak emas
    aboveBudgetReason: aboveBudget ? (next.aboveBudgetReason ?? '').trim().slice(0, 300) : null,
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
