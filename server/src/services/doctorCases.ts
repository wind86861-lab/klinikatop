/**
 * Shifokor bemor uchun so'rov yaratadi — bemor roziligi bilan.
 *
 *   shifokor: raqam + xizmat + shahar + izoh → doctor_cases ('waiting')
 *        │
 *        ├─ raqam botda tasdiqlangan → bemorga darhol xabar
 *        └─ yo'q → shifokor bemorga havola/QR beradi; bemor botga kirib
 *                  📱 kontakt ulashadi, raqam mos kelsa xabar keladi
 *        │
 *   bemor: [Tasdiqlash] → haqiqiy so'rov (`createRequest`) → klinikalar
 *          [Rad etish]  → shifokorga "Bemor rad etdi"
 *          [Bu men emasman] → shifokorga ogohlantirish
 *
 * MAXFIYLIK. Tasdiqlanmagan so'rov `requests` ga YOZILMAYDI — klinikalar
 * faqat o'sha jadvalni ko'radi. Bot xabarida tashxis yo'q: faqat
 * shifokor ismi. Tafsilot bemor raqami mos kelgandagina ochiladi —
 * shifokor raqamni adashtirsa, begona odam kasallik haqida o'qimaydi.
 */
import crypto from 'node:crypto';
import { db, nowSql, parseJson } from '../db';
import { config } from '../lib/config';
import { badRequest, notFound, tooManyRequests } from '../lib/errors';
import { notify } from './notifications';
import { listRequestOffers } from './offers';
import { assertApprovedDoctor } from './referringDoctors';
import { createRequest } from './requests';
import { selectableLabTestIds } from './labOrgans';
import { normalizePhone } from './webAuth';
import { assertKindEnabled } from './requestKinds';
import type {
  DealStatus,
  DoctorCase,
  DoctorInvite,
  DoctorStats,
  AdminDoctorStatRow,
  OfferWithClinic,
  RequestKind,
  RequestStatus,
} from '../../../shared/types';

/** Taklifnoma qancha kutadi — undan keyin "muddati tugadi" */
export const CASE_TTL_HOURS = 72;
/** Javobsiz bemorga eslatma */
export const CASE_REMIND_HOURS = 24;
/** Bitta shifokor kuniga nechta so'rov yarata oladi */
export const MAX_CASES_PER_DAY = 30;
/** Nechta "Bu men emasman" dan keyin shifokor avtomatik to'xtatiladi */
export const NOT_ME_LIMIT = 3;

const iso = (s: string | null): string | null => (s ? new Date(s.replace(' ', 'T') + 'Z').toISOString() : null);
const phonesOf = (n: string) => [n, `+${n}`];

export function inviteLink(token: string): string {
  return `https://t.me/${config.telegram.botUsername}?start=inv_${token}`;
}

/* ─────────────────────────  O'qish  ───────────────────────── */

const CASE_SELECT = `
  SELECT c.*,
         o.name_uz AS op_uz, o.name_ru AS op_ru,
         lt.name_uz AS lt_uz, lt.name_ru AS lt_ru,
         u.first_name AS p_first, u.last_name AS p_last,
         r.status AS request_status,
         (SELECT COUNT(*) FROM offers x WHERE x.request_id = c.request_id AND x.status IN ('SENT','CHOSEN')) AS offers_count,
         dl.status AS deal_status, dl.agreed_price_uzs AS deal_price, r.chosen_offer_id AS chosen_offer_id,
         rec.offer_id AS rec_offer_id, rec.comment AS rec_comment, rec.created_at AS rec_at
    FROM doctor_cases c
    LEFT JOIN operations o ON o.id = c.operation_id
    LEFT JOIN lab_tests lt ON lt.id = c.lab_test_id
    LEFT JOIN users u ON u.id = c.patient_user_id
    LEFT JOIN requests r ON r.id = c.request_id
    LEFT JOIN deals dl ON dl.request_id = c.request_id
    LEFT JOIN doctor_recommendations rec ON rec.case_id = c.id AND rec.superseded_at IS NULL
`;

function serviceNames(r: any): { serviceUz: string; serviceRu: string } {
  if (r.kind === 'operation') return { serviceUz: r.op_uz ?? 'Operatsiya', serviceRu: r.op_ru ?? 'Операция' };
  if (r.kind === 'lab') return { serviceUz: r.lt_uz ?? 'Tahlil', serviceRu: r.lt_ru ?? 'Анализ' };
  return { serviceUz: 'Shifokor yo‘llanmasi', serviceRu: 'Направление врача' };
}

function mapCase(r: any): DoctorCase {
  const approved = r.status === 'approved';
  return {
    id: r.id,
    patientPhone: r.patient_phone,
    patientLinked: r.patient_user_id != null,
    // Ism faqat bemor rozilik bergandan keyin — undan oldin u "raqam"
    patientName: approved && r.p_first ? `${r.p_first} ${r.p_last ?? ''}`.trim() : null,
    kind: r.kind,
    operationId: r.operation_id ?? null,
    labTestId: r.lab_test_id ?? null,
    referralItems: parseJson<string[]>(r.referral_items, []),
    ...serviceNames(r),
    cityId: r.city_id,
    note: r.note ?? null,
    status: r.status,
    inviteLink: inviteLink(r.invite_token),
    requestId: r.request_id ?? null,
    requestStatus: (r.request_status as RequestStatus) ?? null,
    offersCount: r.offers_count ?? 0,
    dealStatus: (r.deal_status as DealStatus) ?? null,
    dealPriceUzs: r.deal_price ?? null,
    chosenOfferId: r.chosen_offer_id ?? null,
    recommendation: r.rec_offer_id
      ? { offerId: r.rec_offer_id, comment: r.rec_comment ?? null, createdAt: iso(r.rec_at)! }
      : null,
    expiresAt: iso(r.expires_at)!,
    decidedAt: iso(r.decided_at),
    createdAt: iso(r.created_at)!,
  };
}

function caseRow(id: number): any {
  return db.prepare(`${CASE_SELECT} WHERE c.id = ?`).get(id);
}

export function listDoctorCases(userId: number): DoctorCase[] {
  const doctor = doctorIdOf(userId);
  return (db.prepare(`${CASE_SELECT} WHERE c.doctor_id = ? ORDER BY c.id DESC LIMIT 200`).all(doctor) as any[]).map(
    mapCase,
  );
}

export function getDoctorCase(userId: number, caseId: number): DoctorCase & { offers: OfferWithClinic[] } {
  const row = caseRow(caseId);
  if (!row || row.doctor_id !== doctorIdOf(userId)) throw notFound('So‘rov topilmadi');
  const c = mapCase(row);
  return { ...c, offers: c.requestId ? listRequestOffers(c.requestId) : [] };
}

export function doctorStats(userId: number): DoctorStats {
  return statsForDoctor(doctorIdOf(userId));
}

/**
 * Shifokor statistikasi — shifokorning o'ziga ham, adminga ham.
 *
 * Tavsiya summasi — tavsiya PAYTIDAGI narx (klinika keyin o'zgartirsa
 * ham hisobot siljimaydi). "Qabul qilingan" — bemor aynan tavsiya
 * qilingan taklifni tanlagan (bitim shu taklif bo'yicha, bekor emas).
 */
export function statsForDoctor(doctor: number): DoctorStats {
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS cases,
              SUM(status = 'waiting') AS waiting,
              SUM(status = 'approved') AS approved,
              SUM(status IN ('declined','not_me')) AS declined
         FROM doctor_cases WHERE doctor_id = ?`,
    )
    .get(doctor) as any;
  const offers = db
    .prepare(
      `SELECT COUNT(*) AS n FROM offers o JOIN doctor_cases c ON c.request_id = o.request_id
        WHERE c.doctor_id = ? AND o.status IN ('SENT','CHOSEN')`,
    )
    .get(doctor) as { n: number };
  const deals = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(d.confirmed_amount_uzs, d.agreed_price_uzs)), 0) AS sum
         FROM deals d JOIN doctor_cases c ON c.request_id = d.request_id
        WHERE c.doctor_id = ? AND d.status != 'CANCELLED'`,
    )
    .get(doctor) as { n: number; sum: number };

  const byClinic = (
    db
      .prepare(
        `SELECT rec.clinic_id AS clinicId, cl.name AS clinicName,
                COUNT(*) AS recommendations,
                COALESCE(SUM(rec.price_uzs), 0) AS recommendedSumUzs,
                SUM(d.id IS NOT NULL) AS accepted,
                COALESCE(SUM(CASE WHEN d.id IS NOT NULL THEN COALESCE(d.confirmed_amount_uzs, d.agreed_price_uzs) END), 0) AS acceptedSumUzs
           FROM doctor_recommendations rec
           JOIN clinics cl ON cl.id = rec.clinic_id
           LEFT JOIN deals d ON d.offer_id = rec.offer_id AND d.status != 'CANCELLED'
          WHERE rec.doctor_id = ? AND rec.superseded_at IS NULL
          GROUP BY rec.clinic_id
          ORDER BY recommendations DESC, recommendedSumUzs DESC`,
      )
      .all(doctor) as any[]
  ).map((r) => ({ ...r, accepted: r.accepted ?? 0 }));

  const sum = (k: 'recommendations' | 'recommendedSumUzs' | 'accepted' | 'acceptedSumUzs') =>
    byClinic.reduce((acc, r) => acc + (r[k] ?? 0), 0);

  return {
    cases: counts.cases ?? 0,
    waiting: counts.waiting ?? 0,
    approved: counts.approved ?? 0,
    declined: counts.declined ?? 0,
    offers: offers.n,
    deals: deals.n,
    dealSumUzs: deals.sum,
    recommendations: sum('recommendations'),
    recommendedSumUzs: sum('recommendedSumUzs'),
    acceptedRecommendations: sum('accepted'),
    acceptedSumUzs: sum('acceptedSumUzs'),
    byClinic,
  };
}

/** Admin: barcha shifokorlar jamlanmasi, eng faoli tepada */
export function adminDoctorStats(): AdminDoctorStatRow[] {
  const doctors = db
    .prepare(`SELECT id, first_name, last_name, specialty, workplace, status FROM referring_doctors ORDER BY id`)
    .all() as any[];
  return doctors
    .map((d) => ({
      doctorId: d.id,
      name: `${d.first_name} ${d.last_name}`,
      specialty: d.specialty,
      workplace: d.workplace,
      status: d.status,
      ...statsForDoctor(d.id),
    }))
    .sort((a, b) => b.recommendations - a.recommendations || b.cases - a.cases);
}

/**
 * Bemor tanlov qildi (qaysi yo'l bilan bo'lmasin) — shifokorga xabar.
 * `deals.chooseOffer` chaqiradi; shifokor yo'naltirmagan so'rovda jim.
 */
export function onOfferChosen(requestId: number, offerId: number): void {
  const c = db.prepare(`SELECT id FROM doctor_cases WHERE request_id = ?`).get(requestId) as { id: number } | undefined;
  if (!c) return;
  const r = caseRow(c.id);
  const offer = db
    .prepare(`SELECT o.price_uzs, cl.name FROM offers o JOIN clinics cl ON cl.id = o.clinic_id WHERE o.id = ?`)
    .get(offerId) as { price_uzs: number; name: string } | undefined;
  const doctor = db.prepare(`SELECT user_id FROM referring_doctors WHERE id = ?`).get(r.doctor_id) as { user_id: number };
  const mapped = mapCase(r);
  notify(
    doctor.user_id,
    'doctor_case_update',
    {
      status: 'chosen',
      service: mapped.serviceUz,
      phone: mapped.patientPhone,
      patient: mapped.patientName ?? `+${mapped.patientPhone}`,
      clinic: offer?.name ?? '',
      price: offer ? `${offer.price_uzs.toLocaleString('ru-RU')} so‘m` : '',
      recommended: mapped.recommendation?.offerId === offerId ? 1 : 0,
    },
    `/doctor/case/${c.id}`,
  );
}

function doctorIdOf(userId: number): number {
  const row = db.prepare(`SELECT id FROM referring_doctors WHERE user_id = ?`).get(userId) as { id: number } | undefined;
  if (!row) throw notFound('Shifokor profili topilmadi');
  return row.id;
}

/* ─────────────────────────  Yaratish  ───────────────────────── */

export interface CreateCaseInput {
  patientPhone: string;
  kind: RequestKind;
  operationId?: number | null;
  labTestId?: number | null;
  referralItems?: string[] | null;
  cityId: number;
  note?: string | null;
}

/** Telegram hisobi — raqami botda kontakt bilan tasdiqlangan bemor */
function telegramUserByPhone(phone: string): { id: number } | undefined {
  return db
    .prepare(`SELECT id FROM users WHERE telegram_id > 0 AND phone IN (?, ?) AND blocked_at IS NULL ORDER BY id LIMIT 1`)
    .get(...phonesOf(phone)) as { id: number } | undefined;
}

export function createDoctorCase(userId: number, input: CreateCaseInput): DoctorCase {
  const doctor = assertApprovedDoctor(userId);

  const phone = normalizePhone(input.patientPhone);
  if (!/^998\d{9}$/.test(phone)) throw badRequest('invalid_phone', 'Bemor raqamini to‘liq kiriting: +998 XX XXX XX XX');

  const me = db.prepare(`SELECT phone FROM users WHERE id = ?`).get(userId) as { phone: string | null };
  if (me.phone && normalizePhone(me.phone) === phone) {
    throw badRequest('own_phone', 'Bu sizning raqamingiz. O‘zingiz uchun so‘rovni ilovaning bemor qismida qoldiring.');
  }

  /*
   * Spamga qarshi. Oddiy shifokor kuniga o'nlab bemor ko'rmaydi;
   * bir raqamga bir kunda ikkinchi xabar esa bezovtalik.
   */
  const today = db
    .prepare(`SELECT COUNT(*) AS n FROM doctor_cases WHERE doctor_id = ? AND created_at > datetime('now', '-1 day')`)
    .get(doctor.id) as { n: number };
  if (today.n >= MAX_CASES_PER_DAY) {
    throw tooManyRequests(`Bir kunda ko‘pi bilan ${MAX_CASES_PER_DAY} ta so‘rov yaratish mumkin`);
  }
  const samePhone = db
    .prepare(
      `SELECT 1 FROM doctor_cases WHERE doctor_id = ? AND patient_phone = ? AND created_at > datetime('now', '-1 day')`,
    )
    .get(doctor.id, phone);
  if (samePhone) throw tooManyRequests('Bu bemorga bugun so‘rov yuborgansiz. Ertaga qayta urinib ko‘ring.');

  // Xizmat — bemorning o'z sehrgaridagi bilan bir xil qoidalar
  let operationId: number | null = null;
  let labTestId: number | null = null;
  let referralItems: string[] = [];
  const note = (input.note ?? '').trim().slice(0, 1500) || null;

  assertKindEnabled(input.kind);
  if (input.kind === 'operation') {
    const op = db
      .prepare(`SELECT id FROM operations WHERE id = ? AND active = 1`)
      .get(input.operationId ?? 0) as { id: number } | undefined;
    if (!op) throw badRequest('unknown_operation', 'Operatsiyani tanlang');
    operationId = op.id;
    // Operatsiya so'rovida klinika holat tavsifini ko'radi — u shu izohdan olinadi
    if (!note || note.length < 10) throw badRequest('note_required', 'Bemor holatini bir-ikki jumlada yozing');
  } else if (input.kind === 'lab') {
    if (!selectableLabTestIds().has(input.labTestId ?? 0)) throw badRequest('test_required', 'Aniq tekshiruvni tanlang');
    labTestId = input.labTestId!;
  } else if (input.kind === 'referral') {
    referralItems = (input.referralItems ?? [])
      .map((s) => String(s).trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 30);
    if (!referralItems.length) throw badRequest('referral_empty', 'Kerakli tahlil yoki tekshiruvlarni yozing');
  } else {
    throw badRequest('invalid_kind', 'Xizmat turini tanlang');
  }

  if (!db.prepare(`SELECT 1 FROM cities WHERE id = ?`).get(input.cityId)) {
    throw badRequest('unknown_city', 'Viloyatni tanlang');
  }

  const token = crypto.randomBytes(12).toString('base64url');
  const patient = telegramUserByPhone(phone);
  const id = Number(
    db
      .prepare(
        `INSERT INTO doctor_cases (doctor_id, patient_phone, patient_user_id, kind, operation_id, lab_test_id,
                                   referral_items, city_id, note, invite_token, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
      )
      .run(
        doctor.id,
        phone,
        patient?.id ?? null,
        input.kind,
        operationId,
        labTestId,
        referralItems.length ? JSON.stringify(referralItems) : null,
        input.cityId,
        note,
        token,
        `+${CASE_TTL_HOURS} hours`,
      ).lastInsertRowid,
  );

  if (patient) notifyPatient(id);
  return mapCase(caseRow(id));
}

/** Bemorga taklifnoma — tashxissiz, faqat shifokor */
function notifyPatient(caseId: number): void {
  const row = db
    .prepare(
      `SELECT c.patient_user_id, c.invite_token, d.first_name, d.last_name, d.specialty
         FROM doctor_cases c JOIN referring_doctors d ON d.id = c.doctor_id WHERE c.id = ?`,
    )
    .get(caseId) as any;
  if (!row?.patient_user_id) return;
  notify(
    row.patient_user_id,
    'doctor_case',
    { doctor: `${row.first_name} ${row.last_name}`, specialty: row.specialty },
    `/invite/${row.invite_token}`,
  );
  db.prepare(`UPDATE doctor_cases SET notified_at = ? WHERE id = ?`).run(nowSql(), caseId);
}

function notifyDoctor(caseId: number): void {
  const r = caseRow(caseId);
  if (!r) return;
  const doctor = db.prepare(`SELECT user_id FROM referring_doctors WHERE id = ?`).get(r.doctor_id) as { user_id: number };
  const c = mapCase(r);
  notify(
    doctor.user_id,
    'doctor_case_update',
    {
      status: c.status,
      service: c.serviceUz,
      phone: c.patientPhone,
      patient: c.patientName ?? `+${c.patientPhone}`,
    },
    `/doctor/case/${caseId}`,
  );
}

/* ─────────────────────────  Bemor tomoni  ───────────────────────── */

export type ClaimResult = 'ok' | 'mismatch' | 'gone' | 'no_phone';

/**
 * Bemor havolani ochdi (yoki kontakt ulashdi) — taklifnomani unga
 * biriktiramiz. Raqam mos kelishi SHART: havola kimga yuborilgani
 * noma'lum (forward qilingan bo'lishi mumkin).
 */
export function claimInvite(userId: number, token: string): ClaimResult {
  const c = db.prepare(`SELECT * FROM doctor_cases WHERE invite_token = ?`).get(token) as any;
  if (!c || c.status !== 'waiting') return 'gone';

  const user = db.prepare(`SELECT phone FROM users WHERE id = ? AND telegram_id > 0`).get(userId) as
    | { phone: string | null }
    | undefined;
  if (!user?.phone) return 'no_phone';
  if (normalizePhone(user.phone) !== c.patient_phone) return 'mismatch';

  if (c.patient_user_id !== userId) {
    db.prepare(`UPDATE doctor_cases SET patient_user_id = ? WHERE id = ?`).run(userId, c.id);
  }
  notifyPatient(c.id);
  return 'ok';
}

/**
 * Raqam botda endi tasdiqlandi — shu raqamga yozilgan, hali hech kimga
 * bog'lanmagan taklifnomalarni topib yuboramiz. Bemor havolani ochmagan
 * bo'lsa ham (shifokor "botga kiring" degan xolos) xabar yetib boradi.
 */
export function bindCasesByPhone(userId: number): number {
  const user = db.prepare(`SELECT phone FROM users WHERE id = ? AND telegram_id > 0`).get(userId) as
    | { phone: string | null }
    | undefined;
  if (!user?.phone) return 0;
  const rows = db
    .prepare(
      `SELECT id FROM doctor_cases WHERE patient_phone = ? AND status = 'waiting' AND patient_user_id IS NULL`,
    )
    .all(normalizePhone(user.phone)) as { id: number }[];
  for (const r of rows) {
    db.prepare(`UPDATE doctor_cases SET patient_user_id = ? WHERE id = ?`).run(userId, r.id);
    notifyPatient(r.id);
  }
  return rows.length;
}

/** Bemor o'z taklifnomasini ochadi — faqat raqami mos bo'lsa */
function inviteRowFor(userId: number, token: string): any {
  const c = db.prepare(`SELECT * FROM doctor_cases WHERE invite_token = ?`).get(token) as any;
  if (!c) throw notFound('Taklifnoma topilmadi');
  if (c.patient_user_id === userId) return c;

  if (c.patient_user_id == null && c.status === 'waiting') {
    const user = db.prepare(`SELECT phone FROM users WHERE id = ? AND telegram_id > 0`).get(userId) as
      | { phone: string | null }
      | undefined;
    if (user?.phone && normalizePhone(user.phone) === c.patient_phone) {
      db.prepare(`UPDATE doctor_cases SET patient_user_id = ? WHERE id = ?`).run(userId, c.id);
      return { ...c, patient_user_id: userId };
    }
  }
  // Boshqa odam: taklifnoma borligini ham aytmaymiz
  throw notFound('Taklifnoma topilmadi');
}

export function getInvite(userId: number, token: string): DoctorInvite {
  const c = inviteRowFor(userId, token);
  const r = caseRow(c.id);
  const d = db.prepare(`SELECT * FROM referring_doctors WHERE id = ?`).get(c.doctor_id) as any;
  const u = db.prepare(`SELECT weight_kg FROM users WHERE id = ?`).get(userId) as { weight_kg: number | null };
  const mapped = mapCase(r);
  return {
    token,
    doctor: { name: `${d.first_name} ${d.last_name}`, specialty: d.specialty, workplace: d.workplace },
    kind: mapped.kind,
    serviceUz: mapped.serviceUz,
    serviceRu: mapped.serviceRu,
    cityId: mapped.cityId,
    note: mapped.note,
    referralItems: mapped.referralItems,
    status: expiredNow(c) ? 'expired' : mapped.status,
    requestId: mapped.requestId,
    expiresAt: mapped.expiresAt,
    weightKg: u?.weight_kg ?? null,
    ...labFlags(c.lab_test_id),
  };
}

/** Taklifnomadagi tekshiruv: vazn kerakmi va qarshi ko'rsatmalari */
function labFlags(labTestId: number | null): { needsWeight: boolean; contraUz: string | null; contraRu: string | null } {
  if (!labTestId) return { needsWeight: false, contraUz: null, contraRu: null };
  const t = db.prepare(`SELECT needs_weight, contra_uz, contra_ru FROM lab_tests WHERE id = ?`).get(labTestId) as
    | { needs_weight: number; contra_uz: string | null; contra_ru: string | null }
    | undefined;
  return { needsWeight: t?.needs_weight !== 0, contraUz: t?.contra_uz ?? null, contraRu: t?.contra_ru ?? null };
}

const expiredNow = (c: any) => c.status === 'waiting' && new Date(c.expires_at.replace(' ', 'T') + 'Z') <= new Date();

function assertWaiting(c: any): void {
  if (expiredNow(c)) throw badRequest('invite_expired', 'Taklifnoma muddati tugagan. Shifokoringizdan qayta yuborishni so‘rang.');
  if (c.status !== 'waiting') throw badRequest('invite_decided', 'Bu taklifnoma bo‘yicha qaror allaqachon qabul qilingan');
}

export interface ApproveInviteInput {
  acceptTerms: boolean;
  weightKg?: number | null;
  /** Qarshi ko'rsatmalar bor tekshiruvda — bemor tasdig'i */
  contraindicationsAck?: boolean;
  userAgent?: string | null;
}

/**
 * Bemor rozi — haqiqiy so'rov yaratiladi va klinikalarga ketadi.
 *
 * `createRequest` ning barcha qoidalari o'z kuchida: profil to'liq,
 * oferta qabul qilingan, xizmat faol. Ya'ni shifokor orqali kelgan
 * so'rov bemorning o'zi qoldirganidan hech narsasi bilan "yengil" emas.
 */
export function approveInvite(userId: number, token: string, input: ApproveInviteInput): { requestId: number } {
  const c = inviteRowFor(userId, token);
  assertWaiting(c);

  const request = createRequest({
    patientId: userId,
    kind: c.kind,
    operationId: c.operation_id,
    labTestId: c.lab_test_id,
    referralItems: parseJson<string[]>(c.referral_items, []),
    weightKg: input.weightKg ?? null,
    cityId: c.city_id,
    budgetUzs: null,
    // Operatsiyada holat tavsifi — shifokor izohi; boshqalarida izoh sifatida
    conditionText: c.kind === 'operation' ? c.note ?? '' : '',
    note: c.kind === 'operation' ? null : c.note,
    urgency: 'normal',
    attachments: [],
    otherRegionsOk: false,
    dateFrom: null,
    dateTo: null,
    dateFlexible: true,
    aiSuggested: false,
    forSelf: true,
    acceptTerms: input.acceptTerms,
    contraindicationsAck: input.contraindicationsAck,
    userAgent: input.userAgent ?? null,
    doctorCaseId: c.id,
  });

  db.prepare(`UPDATE doctor_cases SET status = 'approved', request_id = ?, decided_at = ? WHERE id = ?`).run(
    request.id,
    nowSql(),
    c.id,
  );
  notifyDoctor(c.id);
  return { requestId: request.id };
}

export function declineInvite(userId: number, token: string, notMe: boolean): void {
  const c = inviteRowFor(userId, token);
  assertWaiting(c);
  db.prepare(`UPDATE doctor_cases SET status = ?, decided_at = ? WHERE id = ?`).run(
    notMe ? 'not_me' : 'declined',
    nowSql(),
    c.id,
  );
  notifyDoctor(c.id);

  /*
   * "Bu men emasman" ko'paysa — shifokor begona raqamlarga yozyapti.
   * Avtomatik to'xtatamiz; admin ko'rib chiqib qayta ochadi.
   */
  if (notMe) {
    const n = db
      .prepare(
        `SELECT COUNT(*) AS n FROM doctor_cases WHERE doctor_id = ? AND status = 'not_me' AND decided_at > datetime('now', '-30 days')`,
      )
      .get(c.doctor_id) as { n: number };
    if (n.n >= NOT_ME_LIMIT) {
      db.prepare(
        `UPDATE referring_doctors SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ? AND status = 'approved'`,
      ).run(
        `Avtomatik to‘xtatildi: 30 kunda ${n.n} ta bemor “Bu men emasman” deb javob berdi. Admin ko‘rib chiqadi.`,
        nowSql(),
        c.doctor_id,
      );
    }
  }
}

/* ─────────────────────────  Rejalashtiruvchi  ───────────────────────── */

/** Muddati o'tganlarini yopadi, javobsizlarga bir marta eslatadi */
export function processDoctorCases(): { expired: number; reminded: number } {
  const expired = db
    .prepare(`SELECT id FROM doctor_cases WHERE status = 'waiting' AND expires_at <= datetime('now')`)
    .all() as { id: number }[];
  for (const r of expired) {
    db.prepare(`UPDATE doctor_cases SET status = 'expired', decided_at = ? WHERE id = ?`).run(nowSql(), r.id);
    notifyDoctor(r.id);
  }

  const remind = db
    .prepare(
      `SELECT id FROM doctor_cases
        WHERE status = 'waiting' AND patient_user_id IS NOT NULL AND reminded_at IS NULL
          AND notified_at <= datetime('now', ?)`,
    )
    .all(`-${CASE_REMIND_HOURS} hours`) as { id: number }[];
  for (const r of remind) {
    notifyPatient(r.id);
    db.prepare(`UPDATE doctor_cases SET reminded_at = ? WHERE id = ?`).run(nowSql(), r.id);
  }
  return { expired: expired.length, reminded: remind.length };
}
