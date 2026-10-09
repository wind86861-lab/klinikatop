/**
 * Admin: bemor so'rovlari va ular QAYSI KLINIKALARGA ketgani.
 *
 * Nima uchun kerak: platformaning asosiy muammosi — so'rovlarning
 * ko'pi hech bir klinikaga yetmaydi yoki yetsa ham javobsiz qoladi.
 * Buni faqat bazaga kirib ko'rish mumkin edi. Endi admin har so'rov
 * bo'yicha ko'radi:
 *   • kim so'radi (bemor, telefon) va nima so'radi
 *   • qaysi klinikalarga yuborildi, kim OCHIB KO'RDI, kim TAKLIF berdi
 *   • hech kimga yetmagan bo'lsa — NEGA (boshqa viloyatda mos klinika
 *     bormi, umuman bormi)
 *
 * Diagnostika yuborish mantig'ining AYNAN o'zini chaqiradi
 * (`matching.ts`) — alohida taxminiy qoida yozilmaydi, aks holda admin
 * ko'rgan sabab haqiqiy sababdan farq qilib qolardi.
 */
import { db } from '../db';
import { conflict, notFound } from '../lib/errors';
import { broadcast } from './requests';
import { findAllClinicsInCity, findClinicsForLab, findMatchingClinics } from './matching';

const iso = (v: string | null) => (v ? new Date(v.replace(' ', 'T') + 'Z').toISOString() : null);

export const ADMIN_REQUEST_FILTERS = ['all', 'active', 'unreached', 'no_offers'] as const;
export type AdminRequestFilter = (typeof ADMIN_REQUEST_FILTERS)[number];

export interface AdminRequestRow {
  id: number;
  kind: 'operation' | 'lab' | 'referral';
  status: string;
  /** Nima so'ralgan — operatsiya yoki tekshiruv nomi */
  service: string;
  city: string;
  budgetUzs: number | null;
  patient: { id: number; name: string; phone: string | null; viaTelegram: boolean };
  /** Nechta klinikaga yuborildi / nechtasi ochib ko'rdi / nechta taklif */
  sent: number;
  viewed: number;
  offers: number;
  createdAt: string;
  expiresAt: string | null;
}

export interface AdminRequestClinic {
  clinicId: number;
  name: string;
  city: string;
  sentAt: string;
  viewedAt: string | null;
  offer: { id: number; priceUzs: number; status: string; createdAt: string } | null;
}

export interface AdminRequestDetail extends AdminRequestRow {
  note: string | null;
  otherRegionsOk: boolean;
  clinics: AdminRequestClinic[];
  deal: { id: number; status: string; clinicName: string; agreedPriceUzs: number } | null;
  /**
   * Hech kimga yetmagan so'rov uchun: mos klinika HOZIR qayerda bor.
   * `inCity` — so'rov viloyatida, `anywhere` — butun mamlakatda.
   */
  diagnosis: { inCity: number; anywhere: number } | null;
}

const LIST_SQL = `
  SELECT r.id, r.kind, r.status, r.created_at, r.expires_at, r.budget_uzs, r.note,
         r.other_regions_ok, r.operation_id, r.lab_test_id, r.city_id, r.fallback_category_id,
         u.id AS patient_id,
         TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS patient_name,
         u.phone AS patient_phone,
         u.telegram_id > 0 AS via_telegram,
         COALESCE(ci.name_uz, '') AS city,
         COALESCE(o.name_uz, lt.name_uz, '') AS service,
         (SELECT COUNT(*) FROM request_broadcasts b WHERE b.request_id = r.id) AS sent,
         (SELECT COUNT(*) FROM request_broadcasts b WHERE b.request_id = r.id AND b.viewed_at IS NOT NULL) AS viewed,
         (SELECT COUNT(*) FROM offers f WHERE f.request_id = r.id) AS offers
    FROM requests r
    JOIN users u ON u.id = r.patient_id
    LEFT JOIN cities ci ON ci.id = r.city_id
    LEFT JOIN operations o ON o.id = r.operation_id
    LEFT JOIN lab_tests lt ON lt.id = r.lab_test_id
`;

function mapRow(r: any): AdminRequestRow {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    service: r.service || (r.kind === 'referral' ? 'Shifokor yo‘llanmasi' : '—'),
    city: r.city,
    budgetUzs: r.budget_uzs ?? null,
    patient: {
      id: r.patient_id,
      name: r.patient_name || 'Ismsiz',
      phone: r.patient_phone ?? null,
      viaTelegram: r.via_telegram === 1,
    },
    sent: r.sent,
    viewed: r.viewed,
    offers: r.offers,
    createdAt: iso(r.created_at)!,
    expiresAt: iso(r.expires_at),
  };
}

export function listAdminRequests(filter: AdminRequestFilter = 'all'): AdminRequestRow[] {
  const where =
    filter === 'active'
      ? `WHERE r.status IN ('NEW','COLLECTING')`
      : filter === 'unreached'
        ? `WHERE NOT EXISTS (SELECT 1 FROM request_broadcasts b WHERE b.request_id = r.id)`
        : filter === 'no_offers'
          ? `WHERE EXISTS (SELECT 1 FROM request_broadcasts b WHERE b.request_id = r.id)
               AND NOT EXISTS (SELECT 1 FROM offers f WHERE f.request_id = r.id)`
          : '';
  const rows = db.prepare(`${LIST_SQL} ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT 500`).all();
  return (rows as any[]).map(mapRow);
}

/** Hozir bu so'rov yuborilsa nechta klinikaga yetardi — yuborish qoidasining o'zi bilan */
function reachNow(r: any, anyCity: boolean): number {
  const opts = { otherRegionsOk: anyCity };
  if (r.kind === 'referral') return findAllClinicsInCity(r.city_id, opts).length;
  if (r.kind === 'lab') return r.lab_test_id ? findClinicsForLab(r.lab_test_id, r.city_id, opts).length : 0;
  if (!r.operation_id) return 0;
  return findMatchingClinics(r.operation_id, r.city_id, { ...opts, fallbackCategoryId: r.fallback_category_id }).length;
}

export function getAdminRequest(id: number): AdminRequestDetail {
  const r = db.prepare(`${LIST_SQL} WHERE r.id = ?`).get(id) as any;
  if (!r) throw notFound('So‘rov topilmadi');

  const clinics = (
    db
      .prepare(
        `SELECT b.clinic_id, b.created_at, b.viewed_at, c.name, COALESCE(ci.name_uz, '') AS city,
                f.id AS offer_id, f.price_uzs, f.status AS offer_status, f.created_at AS offer_at
           FROM request_broadcasts b
           JOIN clinics c ON c.id = b.clinic_id
           LEFT JOIN cities ci ON ci.id = c.city_id
           LEFT JOIN offers f ON f.id = (
             SELECT id FROM offers WHERE request_id = b.request_id AND clinic_id = b.clinic_id
              ORDER BY id DESC LIMIT 1
           )
          WHERE b.request_id = ?
          ORDER BY f.id IS NULL, b.viewed_at IS NULL, c.name`,
      )
      .all(id) as any[]
  ).map(
    (c): AdminRequestClinic => ({
      clinicId: c.clinic_id,
      name: c.name,
      city: c.city,
      sentAt: iso(c.created_at)!,
      viewedAt: iso(c.viewed_at),
      offer: c.offer_id
        ? { id: c.offer_id, priceUzs: c.price_uzs, status: c.offer_status, createdAt: iso(c.offer_at)! }
        : null,
    }),
  );

  const deal = db
    .prepare(
      `SELECT d.id, d.status, d.agreed_price_uzs, c.name AS clinic_name
         FROM deals d JOIN clinics c ON c.id = d.clinic_id WHERE d.request_id = ?`,
    )
    .get(id) as { id: number; status: string; agreed_price_uzs: number; clinic_name: string } | undefined;

  return {
    ...mapRow(r),
    note: r.note ?? null,
    otherRegionsOk: r.other_regions_ok === 1,
    clinics,
    deal: deal
      ? { id: deal.id, status: deal.status, clinicName: deal.clinic_name, agreedPriceUzs: deal.agreed_price_uzs }
      : null,
    diagnosis: clinics.length === 0 ? { inCity: reachNow(r, false), anywhere: reachNow(r, true) } : null,
  };
}

/**
 * Faol so'rovni QAYTA yuborish — yuborilgandan keyin qo'shilgan
 * klinikalarga. Oldin olganlarga takroriy xabar ketmaydi (`broadcast`).
 * Yopilgan yoki muddati o'tgan so'rov qayta ochilmaydi: bemor javob
 * kutishni to'xtatgan.
 */
export function rebroadcastRequest(id: number): { added: number } {
  const r = db
    .prepare(`SELECT status, expires_at > datetime('now') AS alive FROM requests WHERE id = ?`)
    .get(id) as { status: string; alive: number } | undefined;
  if (!r) throw notFound('So‘rov topilmadi');
  if (!['NEW', 'COLLECTING'].includes(r.status) || !r.alive) {
    throw conflict('request_closed', 'So‘rov yopilgan yoki muddati tugagan — qayta yuborib bo‘lmaydi');
  }
  return { added: broadcast(id) };
}
