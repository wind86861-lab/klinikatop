/**
 * Admin: bitta klinika haqida TO'LIQ ma'lumot.
 *
 * "Klinikalar" jadvalida ham, "So'rovlar" varag'ida ham klinika nomi
 * bosilganda shu ochiladi. Maqsad — admin klinika haqida biror narsani
 * bilish uchun bazaga kirmasin:
 *   • kim, qayerda, qanday aloqa
 *   • holati: tekshiruv, obuna, komissiya, yo'llanma
 *   • FAOLLIGI: nechta so'rov keldi → nechtasini ochdi → taklif → bitim
 *     (so'rovlar nega javobsiz qolayotganini shu zanjir ko'rsatadi)
 *   • kabinetdagi xodimlar (kim kira oladi, oxirgi marta qachon kirgan)
 *   • oxirgi so'rovlar va ular bo'yicha klinika nima qilgan
 */
import { db } from '../db';
import { notFound } from '../lib/errors';
import { listSettings } from './terms.business';

const iso = (v: string | null | undefined) => (v ? new Date(v.replace(' ', 'T') + 'Z').toISOString() : null);

export interface AdminClinicDetail {
  id: number;
  name: string;
  city: string;
  address: string;
  phone: string | null;
  website: string | null;
  about: string;
  logoUrl: string | null;
  licenseNo: string | null;
  /** banisa.uz orqali ulanganmi */
  linkedToBanisa: boolean;
  verification: string;
  verificationNote: string | null;
  plan: string | null;
  subscriptionStatus: string;
  subscriptionUntil: string | null;
  trialUntil: string | null;
  effectiveCommissionPercent: number;
  acceptsReferral: boolean;
  createdAt: string;

  rating: { avg: number; count: number };
  /** O'rtacha javob vaqti, daqiqa — hali taklif bermagan bo'lsa null */
  avgResponseMinutes: number | null;

  activity: {
    received: number;
    viewed: number;
    offers: number;
    chosen: number;
    dealsConfirmed: number;
  };

  services: { operations: string[]; operationsTotal: number; labTests: number };
  staff: { fullName: string; phone: string; role: string; lastLoginAt: string | null; disabled: boolean }[];
  documents: { pending: number; approved: number; rejected: number };

  recentRequests: {
    id: number;
    service: string;
    patientName: string;
    sentAt: string;
    viewedAt: string | null;
    offerPriceUzs: number | null;
    offerStatus: string | null;
  }[];
}

const count = (sql: string, id: number) => (db.prepare(sql).get(id) as { n: number }).n;

export function getAdminClinicDetail(id: number): AdminClinicDetail {
  const c = db
    .prepare(
      `SELECT c.*, COALESCE(ci.name_uz, '') AS city_name
         FROM clinics c LEFT JOIN cities ci ON ci.id = c.city_id
        WHERE c.id = ?`,
    )
    .get(id) as any;
  if (!c) throw notFound('Klinika topilmadi');

  const operationsTotal = count(`SELECT COUNT(*) n FROM clinic_operations WHERE clinic_id = ?`, id);
  const operations = (
    db
      .prepare(
        `SELECT o.name_uz FROM clinic_operations co JOIN operations o ON o.id = co.operation_id
          WHERE co.clinic_id = ? ORDER BY o.name_uz LIMIT 30`,
      )
      .all(id) as { name_uz: string }[]
  ).map((r) => r.name_uz);

  const docs = db
    .prepare(
      `SELECT SUM(status = 'pending') p, SUM(status = 'approved') a, SUM(status = 'rejected') r
         FROM clinic_documents WHERE clinic_id = ?`,
    )
    .get(id) as { p: number | null; a: number | null; r: number | null };

  const staff = (
    db
      .prepare(
        `SELECT full_name, phone, level, last_login_at, disabled_at
           FROM admin_users WHERE clinic_id = ? ORDER BY created_at`,
      )
      .all(id) as any[]
  ).map((s) => ({
    fullName: s.full_name,
    phone: s.phone,
    role: s.level === 'clinic_admin' ? 'Klinika admini' : s.level === 'clinic_operator' ? 'Operator' : s.level,
    lastLoginAt: iso(s.last_login_at),
    disabled: Boolean(s.disabled_at),
  }));

  const recentRequests = (
    db
      .prepare(
        `SELECT r.id, b.created_at, b.viewed_at,
                COALESCE(o.name_uz, lt.name_uz, CASE r.kind WHEN 'referral' THEN 'Shifokor yo‘llanmasi' END, '—') AS service,
                TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS patient_name,
                f.price_uzs, f.status AS offer_status
           FROM request_broadcasts b
           JOIN requests r ON r.id = b.request_id
           JOIN users u ON u.id = r.patient_id
           LEFT JOIN operations o ON o.id = r.operation_id
           LEFT JOIN lab_tests lt ON lt.id = r.lab_test_id
           LEFT JOIN offers f ON f.id = (
             SELECT id FROM offers WHERE request_id = r.id AND clinic_id = b.clinic_id ORDER BY id DESC LIMIT 1
           )
          WHERE b.clinic_id = ?
          ORDER BY b.created_at DESC, r.id DESC
          LIMIT 15`,
      )
      .all(id) as any[]
  ).map((r) => ({
    id: r.id,
    service: r.service,
    patientName: r.patient_name || 'Ismsiz',
    sentAt: iso(r.created_at)!,
    viewedAt: iso(r.viewed_at),
    offerPriceUzs: r.price_uzs ?? null,
    offerStatus: r.offer_status ?? null,
  }));

  return {
    id: c.id,
    name: c.name,
    city: c.city_name,
    address: c.address ?? '',
    phone: c.phone ?? null,
    website: c.website ?? null,
    about: c.about ?? '',
    logoUrl: c.logo_url ?? null,
    licenseNo: c.license_file_id ?? null,
    linkedToBanisa: Boolean(c.external_id),
    verification: c.verification,
    verificationNote: c.verification_note ?? null,
    plan: c.plan ?? null,
    subscriptionStatus: c.subscription_status,
    subscriptionUntil: iso(c.subscription_until),
    trialUntil: iso(c.trial_until),
    effectiveCommissionPercent: c.commission_percent ?? listSettings().commissionPercent,
    acceptsReferral: c.accepts_referral === 1,
    createdAt: iso(c.created_at)!,
    rating: { avg: c.rating_avg ?? 0, count: c.rating_count ?? 0 },
    avgResponseMinutes: c.response_samples ? Math.round(c.response_minutes_sum / c.response_samples) : null,
    activity: {
      received: count(`SELECT COUNT(*) n FROM request_broadcasts WHERE clinic_id = ?`, id),
      viewed: count(`SELECT COUNT(*) n FROM request_broadcasts WHERE clinic_id = ? AND viewed_at IS NOT NULL`, id),
      offers: count(`SELECT COUNT(*) n FROM offers WHERE clinic_id = ?`, id),
      chosen: count(`SELECT COUNT(*) n FROM offers WHERE clinic_id = ? AND status = 'CHOSEN'`, id),
      dealsConfirmed: count(`SELECT COUNT(*) n FROM deals WHERE clinic_id = ? AND status = 'CONFIRMED'`, id),
    },
    services: {
      operations,
      operationsTotal,
      labTests: count(`SELECT COUNT(*) n FROM clinic_lab_tests WHERE clinic_id = ?`, id),
    },
    staff,
    documents: { pending: docs.p ?? 0, approved: docs.a ?? 0, rejected: docs.r ?? 0 },
    recentRequests,
  };
}
