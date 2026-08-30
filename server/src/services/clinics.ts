/**
 * Klinika: ro'yxatdan o'tish, verifikatsiya (12-bo'lim), obuna (11-bo'lim), dashboard (10-ekran).
 */
import { db, toJson, tx } from '../db';
import { config } from '../lib/config';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { mapClinic, mapClinicPublic } from '../lib/mappers';
import {
  PLAN_LIMITS,
  type Clinic,
  type ClinicDashboard,
  type ClinicPublic,
  type SubscriptionPlan,
  type VerificationStatus,
} from '../../../shared/types';
import { notify, notifyClinic } from './notifications';
import { monthlyOfferCount } from './offers';

export function getClinic(id: number): Clinic {
  const row = db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(id);
  if (!row) throw notFound('Klinika topilmadi');
  return mapClinic(row);
}

export function getClinicPublic(id: number): ClinicPublic {
  const row = db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(id);
  if (!row) throw notFound('Klinika topilmadi');
  return mapClinicPublic(row);
}

export function getClinicOperations(clinicId: number): number[] {
  const rows = db.prepare(`SELECT operation_id FROM clinic_operations WHERE clinic_id = ?`).all(clinicId) as {
    operation_id: number;
  }[];
  return rows.map((r) => r.operation_id);
}

export interface RegisterClinicInput {
  userId: number;
  name: string;
  cityId: number;
  address: string;
  about: string;
  licenseFileId: string | null;
  operationIds: number[];
}

/** 5.1 klinika oqimi: ariza → moderator tekshiradi → "Tasdiqlangan" belgisi. */
export function registerClinic(input: RegisterClinicInput): Clinic {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(input.userId) as any;
  if (!user) throw notFound('Foydalanuvchi topilmadi');
  if (user.clinic_id) throw conflict('already_clinic', 'Siz allaqachon klinikaga biriktirilgansiz');
  if (!input.name.trim()) throw badRequest('name_required', 'Klinika nomi kerak');
  if (!db.prepare(`SELECT 1 FROM cities WHERE id = ?`).get(input.cityId)) {
    throw badRequest('unknown_city', 'Shahar topilmadi');
  }
  if (!input.operationIds.length) throw badRequest('operations_required', 'Kamida bitta operatsiya yo‘nalishini tanlang');

  const clinicId = tx(() => {
    const info = db
      .prepare(
        `INSERT INTO clinics (name, city_id, address, about, license_file_id, verification, subscription_status)
         VALUES (?, ?, ?, ?, ?, 'pending', 'none')`,
      )
      .run(input.name.trim(), input.cityId, input.address, input.about, input.licenseFileId);
    const id = Number(info.lastInsertRowid);

    const ins = db.prepare(`INSERT OR IGNORE INTO clinic_operations (clinic_id, operation_id) VALUES (?, ?)`);
    for (const opId of input.operationIds) ins.run(id, opId);

    const roles: string[] = JSON.parse(user.roles);
    if (!roles.includes('clinic_admin')) roles.push('clinic_admin');
    db.prepare(`UPDATE users SET clinic_id = ?, roles = ? WHERE id = ?`).run(id, toJson(roles), input.userId);

    return id;
  });

  return getClinic(clinicId);
}

/**
 * Klinikaning yo'nalishlari.
 *
 * Yozuv MANBAGA qarab ishlaydi va bu muhim: banisa'dan kelgan
 * yo'nalishlar o'sha yerda boshqariladi, bu yerdan tahrirlanmaydi.
 * Ilgari bu funksiya hamma qatorni o'chirib qayta yozardi — ya'ni
 * saqlash banisa ulanishini buzar va keyingi sinxronizatsiya uni
 * qaytarardi. Shu sababli ulangan klinikaga ekran butunlay yopilgandi.
 *
 * Endi faqat `manual` qatorlar almashtiriladi. Natijada ulangan
 * klinika ham banisa'da yo'q yo'nalishni O'ZI qo'sha oladi —
 * KlinikaTop katalogi kengroq va ulanish uni yopib qo'ymasligi kerak.
 */
export function updateClinicOperations(clinicId: number, operationIds: number[]) {
  tx(() => {
    db.prepare(`DELETE FROM clinic_operations WHERE clinic_id = ? AND source = 'manual'`).run(clinicId);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO clinic_operations (clinic_id, operation_id, source) VALUES (?, ?, 'manual')`,
    );
    // banisa'niki allaqachon bor bo'lsa `OR IGNORE` uni tegmasdan o'tkazadi
    for (const id of operationIds) ins.run(clinicId, id);
  });
}

/** banisa'dan kelgan yo'nalishlar — ular bu yerda tahrirlanmaydi. */
export function externalOperationIds(clinicId: number): number[] {
  return (
    db
      .prepare(`SELECT operation_id FROM clinic_operations WHERE clinic_id = ? AND source = 'banisa'`)
      .all(clinicId) as { operation_id: number }[]
  ).map((r) => r.operation_id);
}

export function updateClinicProfile(
  clinicId: number,
  input: Partial<{
    name: string;
    address: string;
    about: string;
    logoUrl: string | null;
    phone: string | null;
    website: string | null;
    workHours: string | null;
    beds: number | null;
    foundedYear: number | null;
    equipment: string[];
    photos: string[];
  }>,
): Clinic {
  const current = db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(clinicId) as any;
  if (!current) throw notFound('Klinika topilmadi');

  const pick = <T>(next: T | undefined, fallback: T): T => (next === undefined ? fallback : next);
  const list = (next: string[] | undefined, fallback: string) =>
    next === undefined
      ? fallback
      : JSON.stringify(next.map((v) => v.trim()).filter(Boolean).slice(0, 24));

  db.prepare(
    `UPDATE clinics
        SET name = ?, address = ?, about = ?, logo_url = ?, phone = ?, website = ?,
            work_hours = ?, beds = ?, founded_year = ?, equipment = ?, photos = ?
      WHERE id = ?`,
  ).run(
    pick(input.name, current.name).trim().slice(0, 200),
    pick(input.address, current.address).slice(0, 300),
    pick(input.about, current.about).slice(0, 1500),
    pick(input.logoUrl, current.logo_url),
    pick(input.phone, current.phone)?.slice(0, 40) ?? null,
    pick(input.website, current.website)?.slice(0, 200) ?? null,
    pick(input.workHours, current.work_hours)?.slice(0, 120) ?? null,
    pick(input.beds, current.beds),
    pick(input.foundedYear, current.founded_year),
    list(input.equipment, current.equipment ?? '[]'),
    list(input.photos, current.photos ?? '[]'),
    clinicId,
  );

  return getClinic(clinicId);
}

/* ── Verifikatsiya (12.1) ───────────────────────────────────── */

/**
 * Moderator navbati.
 *
 * Faqat 'pending' emas: rad etilgan klinika hujjatni tuzatib qayta yuklasa,
 * u ham navbatga qaytadi. Aks holda klinika tuzatgan bo'lsa ham hech kim
 * ko'rmaydi va ariza abadiy rad etilgan holda qoladi.
 */
export function listPendingVerifications(): Clinic[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM clinics c
        WHERE c.verification = 'pending'
           OR (c.verification = 'rejected'
               AND EXISTS (SELECT 1 FROM clinic_documents d
                            WHERE d.clinic_id = c.id AND d.status = 'pending'))
        ORDER BY c.id ASC`,
    )
    .all();
  return rows.map(mapClinic);
}

export function setVerification(
  clinicId: number,
  moderatorId: number,
  status: VerificationStatus,
  note: string | null,
): Clinic {
  if (status === 'rejected' && !note?.trim()) {
    throw badRequest('note_required', 'Rad etish sababini yozing');
  }

  db.prepare(`UPDATE clinics SET verification = ?, verification_note = ? WHERE id = ?`).run(status, note, clinicId);
  db.prepare(`INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note) VALUES (?, 'clinic', ?, ?, ?)`).run(
    moderatorId,
    clinicId,
    `verification:${status}`,
    note,
  );

  notifyClinic(clinicId, 'verification_result', { approved: status === 'approved' ? 1 : 0, note: note ?? '' }, `/clinic`);
  return getClinic(clinicId);
}

/* ── Obuna (11-bo'lim) ──────────────────────────────────────── */

/** To'lov davri — oylik. To'lov bo'lmasa obuna TO'XTATILADI, faol bitimlar saqlanadi. */
export function activateSubscription(clinicId: number, plan: SubscriptionPlan, months = 1): Clinic {
  const clinic = getClinic(clinicId);
  if (clinic.verification !== 'approved') {
    throw forbidden('Avval klinika tasdiqlanishi kerak');
  }

  const amount = PLAN_LIMITS[plan].priceUzs * months;
  const startsFrom =
    clinic.subscriptionUntil && new Date(clinic.subscriptionUntil) > new Date()
      ? clinic.subscriptionUntil.replace('T', ' ').slice(0, 19)
      : null;

  tx(() => {
    db.prepare(
      `UPDATE clinics SET plan = ?, subscription_status = 'active',
              subscription_until = datetime(COALESCE(?, 'now'), ?)
        WHERE id = ?`,
    ).run(plan, startsFrom, `+${months} months`, clinicId);

    const updated = db.prepare(`SELECT subscription_until FROM clinics WHERE id = ?`).get(clinicId) as {
      subscription_until: string;
    };
    db.prepare(
      `INSERT INTO subscription_payments (clinic_id, plan, amount_uzs, period_from, period_to)
       VALUES (?, ?, ?, datetime(COALESCE(?, 'now')), ?)`,
    ).run(clinicId, plan, amount, startsFrom, updated.subscription_until);
  });

  return getClinic(clinicId);
}

/**
 * 11.2: muddati o'tgan obunalarni to'xtatish + tugashidan oldin eslatma.
 * Faol bitimlar davom etadi, faqat yangi so'rov kelmaydi (matching sharti).
 */
export function processSubscriptions(): { suspended: number; reminded: number } {
  const expired = db
    .prepare(
      `SELECT id FROM clinics
        WHERE subscription_status = 'active' AND subscription_until IS NOT NULL
          AND subscription_until <= datetime('now')`,
    )
    .all() as { id: number }[];

  for (const c of expired) {
    db.prepare(`UPDATE clinics SET subscription_status = 'expired' WHERE id = ?`).run(c.id);
    notifyClinic(c.id, 'subscription_expiring', { days: 0 }, `/clinic/subscription`);
  }

  const soon = db
    .prepare(
      `SELECT id, subscription_until FROM clinics
        WHERE subscription_status = 'active' AND subscription_until IS NOT NULL
          AND subscription_until <= datetime('now', '+3 days')
          AND subscription_until > datetime('now')`,
    )
    .all() as { id: number; subscription_until: string }[];

  for (const c of soon) {
    const days = Math.max(
      1,
      Math.ceil((new Date(c.subscription_until.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 86_400_000),
    );
    notifyClinic(c.id, 'subscription_expiring', { days }, `/clinic/subscription`);
  }

  return { suspended: expired.length, reminded: soon.length };
}

export function suspendSubscription(clinicId: number, moderatorId: number, note: string): Clinic {
  db.prepare(`UPDATE clinics SET subscription_status = 'suspended' WHERE id = ?`).run(clinicId);
  db.prepare(`INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note) VALUES (?, 'clinic', ?, 'suspend', ?)`).run(
    moderatorId,
    clinicId,
    note,
  );
  return getClinic(clinicId);
}

/* ── Dashboard (10-ekran) ───────────────────────────────────── */

export function getDashboard(clinicId: number): ClinicDashboard {
  const clinic = getClinic(clinicId);

  const incoming = db
    .prepare(
      `SELECT COUNT(*) AS n FROM request_broadcasts b
         JOIN requests r ON r.id = b.request_id
        WHERE b.clinic_id = ? AND r.status IN ('NEW','COLLECTING')`,
    )
    .get(clinicId) as { n: number };

  const offers = db
    .prepare(`SELECT COUNT(*) AS n FROM offers WHERE clinic_id = ?`)
    .get(clinicId) as { n: number };

  const wins = db
    .prepare(`SELECT COUNT(*) AS n FROM offers WHERE clinic_id = ? AND status = 'CHOSEN'`)
    .get(clinicId) as { n: number };

  const money = db
    .prepare(
      `SELECT COALESCE(SUM(confirmed_amount_uzs), 0) AS revenue,
              COALESCE(SUM(commission_uzs), 0) AS commission
         FROM deals WHERE clinic_id = ? AND status = 'CONFIRMED'`,
    )
    .get(clinicId) as { revenue: number; commission: number };

  const weekly = db
    .prepare(
      `WITH RECURSIVE days(d) AS (
         SELECT date('now', '-6 days')
         UNION ALL SELECT date(d, '+1 day') FROM days WHERE d < date('now')
       )
       SELECT days.d AS date,
         (SELECT COUNT(*) FROM request_broadcasts b JOIN requests r ON r.id = b.request_id
           WHERE b.clinic_id = @clinicId AND date(b.created_at) = days.d) AS requests,
         (SELECT COUNT(*) FROM offers o WHERE o.clinic_id = @clinicId AND date(o.created_at) = days.d) AS offers,
         (SELECT COUNT(*) FROM offers o WHERE o.clinic_id = @clinicId AND o.status = 'CHOSEN' AND date(o.updated_at) = days.d) AS wins
       FROM days`,
    )
    .all({ clinicId }) as { date: string; requests: number; offers: number; wins: number }[];

  const plan = clinic.plan ?? 'basic';

  return {
    kpi: {
      incomingRequests: incoming.n,
      offersSent: offers.n,
      offersWon: wins.n,
      winRatePercent: offers.n > 0 ? Math.round((wins.n / offers.n) * 100) : 0,
      revenueUzs: money.revenue,
      commissionUzs: money.commission,
      avgResponseMinutes: clinic.avgResponseMinutes,
    },
    weekly,
    subscription: {
      plan: clinic.plan,
      status: clinic.subscriptionStatus,
      until: clinic.subscriptionUntil,
      offersUsed: monthlyOfferCount(clinicId),
      offersLimit: PLAN_LIMITS[plan].monthlyOffers,
    },
  };
}

export const COMMISSION_PERCENT = config.rules.commissionPercent;
