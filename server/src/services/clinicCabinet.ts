/**
 * Klinika kabineti servislari.
 *
 * Bu yerda klinikaning TAKRORLANUVCHI ishi turadi: verifikatsiya hujjatlari,
 * taklif shablonlari, shifokorlar, bo'sh kunlar, jamoa, analitika va
 * hisob-kitob. Bemor tomonidan farqi — bemor bitta so'rov yuboradi va ketadi,
 * klinika esa har kuni shu ekranlarda ishlaydi.
 *
 * Umumiy qoida: har bir funksiya `clinicId` oladi va faqat SHU klinikaning
 * ma'lumotiga tegadi. Egalik tekshiruvi marshrutda emas, shu yerda — chunki
 * bitta unutilgan tekshiruv boshqa klinikaning ma'lumotini ochib qo'yadi.
 */
import crypto from 'node:crypto';
import { db } from '../db';
import { config } from '../lib/config';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { getFileMeta } from './files';
import type {
  CapacitySlot,
  ClinicAnalytics,
  ClinicDocKind,
  ClinicDocument,
  ClinicOperator,
  ClinicRevenue,
  Doctor,
  NotificationPrefs,
  OfferTemplate,
  OperatorRole,
  PendingCommissionPayment,
} from '../../../shared/types';
import { DEFAULT_NOTIFICATION_PREFS, REQUIRED_DOC_KINDS } from '../../../shared/types';
import { notifyClinic } from './notifications';

const iso = (v: string | null) => (v ? new Date(v.replace(' ', 'T') + 'Z').toISOString() : null);
const json = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/* ═════════════════════  1. Verifikatsiya hujjatlari  ═════════════════════ */

function mapDocument(row: any): ClinicDocument {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    kind: row.kind,
    label: row.label ?? null,
    fileId: row.file_id,
    fileName: row.file_name ?? '',
    fileMimeType: row.file_mime ?? '',
    status: row.status,
    note: row.note ?? null,
    createdAt: iso(row.created_at)!,
  };
}

export function listDocuments(clinicId: number): ClinicDocument[] {
  const rows = db
    .prepare(
      `SELECT d.*, f.name AS file_name, f.mime_type AS file_mime
         FROM clinic_documents d
         LEFT JOIN files f ON f.id = d.file_id
        WHERE d.clinic_id = ?
        ORDER BY d.created_at DESC`,
    )
    .all(clinicId) as any[];
  return rows.map(mapDocument);
}

export function addDocument(input: {
  clinicId: number;
  ownerId: number;
  kind: ClinicDocKind;
  label: string | null;
  fileId: string;
}): ClinicDocument {
  // Fayl haqiqatan yuklovchiga tegishlimi — boshqa klinikaning litsenziyasini
  // o'ziniki qilib ko'rsatishning oldi olinadi
  const file = getFileMeta(input.fileId);
  if (file.ownerId !== input.ownerId) throw forbidden('Bu fayl sizga tegishli emas');

  const exists = db
    .prepare(`SELECT id FROM clinic_documents WHERE clinic_id = ? AND file_id = ?`)
    .get(input.clinicId, input.fileId);
  if (exists) throw conflict('document_exists', 'Bu hujjat allaqachon qo‘shilgan');

  const info = db
    .prepare(
      `INSERT INTO clinic_documents (clinic_id, kind, label, file_id) VALUES (?, ?, ?, ?)`,
    )
    .run(input.clinicId, input.kind, input.label?.trim()?.slice(0, 120) || null, input.fileId);

  return listDocuments(input.clinicId).find((d) => d.id === Number(info.lastInsertRowid))!;
}

export function removeDocument(clinicId: number, documentId: number): void {
  const row = db
    .prepare(`SELECT status FROM clinic_documents WHERE id = ? AND clinic_id = ?`)
    .get(documentId, clinicId) as { status: string } | undefined;
  if (!row) throw notFound('Hujjat topilmadi');
  // Tasdiqlangan hujjatni o'chirish verifikatsiyani buzadi
  if (row.status === 'approved') {
    throw conflict('document_approved', 'Tasdiqlangan hujjatni o‘chirib bo‘lmaydi');
  }
  db.prepare(`DELETE FROM clinic_documents WHERE id = ? AND clinic_id = ?`).run(documentId, clinicId);
}

/** Ariza to'liqmi — majburiy hujjatlarning hammasi bormi. */
export function verificationChecklist(clinicId: number) {
  const docs = listDocuments(clinicId);
  const clinic = db
    .prepare(`SELECT name, address, phone, verification, verification_note FROM clinics WHERE id = ?`)
    .get(clinicId) as any;
  const operations = db
    .prepare(`SELECT COUNT(*) AS n FROM clinic_operations WHERE clinic_id = ?`)
    .get(clinicId) as { n: number };

  const items = [
    { key: 'profile', done: Boolean(clinic?.name && clinic?.address) },
    { key: 'phone', done: Boolean(clinic?.phone) },
    { key: 'operations', done: operations.n > 0 },
    ...REQUIRED_DOC_KINDS.map((kind) => ({
      key: `doc:${kind}`,
      done: docs.some((d) => d.kind === kind),
    })),
  ];

  return {
    status: clinic?.verification ?? 'pending',
    note: clinic?.verification_note ?? null,
    items,
    complete: items.every((i) => i.done),
    documents: docs,
  };
}

/* ═════════════════════  2. Taklif shablonlari  ═════════════════════ */

function mapTemplate(row: any): OfferTemplate {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    title: row.title,
    operationId: row.operation_id ?? null,
    priceUzs: row.price_uzs ?? null,
    includes: json<string[]>(row.includes, []),
    advantages: json<string[]>(row.advantages, []),
    note: row.note ?? null,
    usedCount: row.used_count,
    createdAt: iso(row.created_at)!,
  };
}

export function listTemplates(clinicId: number, operationId?: number | null): OfferTemplate[] {
  const rows = db
    .prepare(
      `SELECT * FROM offer_templates
        WHERE clinic_id = ?
          AND (@op IS NULL OR operation_id IS NULL OR operation_id = @op)
        ORDER BY used_count DESC, created_at DESC`,
    )
    .all(clinicId, { op: operationId ?? null }) as any[];
  return rows.map(mapTemplate);
}

export interface TemplateInput {
  title: string;
  operationId: number | null;
  priceUzs: number | null;
  includes: string[];
  advantages: string[];
  note: string | null;
}

export function createTemplate(clinicId: number, input: TemplateInput): OfferTemplate {
  const info = db
    .prepare(
      `INSERT INTO offer_templates
         (clinic_id, title, operation_id, price_uzs, includes, advantages, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      clinicId,
      input.title.trim().slice(0, 120),
      input.operationId,
      input.priceUzs,
      JSON.stringify(input.includes.slice(0, 12)),
      JSON.stringify(input.advantages.slice(0, 12)),
      input.note?.trim()?.slice(0, 500) || null,
    );
  return getTemplate(clinicId, Number(info.lastInsertRowid));
}

export function getTemplate(clinicId: number, id: number): OfferTemplate {
  const row = db
    .prepare(`SELECT * FROM offer_templates WHERE id = ? AND clinic_id = ?`)
    .get(id, clinicId);
  if (!row) throw notFound('Shablon topilmadi');
  return mapTemplate(row);
}

export function updateTemplate(clinicId: number, id: number, input: Partial<TemplateInput>): OfferTemplate {
  const current = getTemplate(clinicId, id);
  db.prepare(
    `UPDATE offer_templates
        SET title = ?, operation_id = ?, price_uzs = ?, includes = ?,
            advantages = ?, note = ?
      WHERE id = ? AND clinic_id = ?`,
  ).run(
    (input.title ?? current.title).trim().slice(0, 120),
    input.operationId !== undefined ? input.operationId : current.operationId,
    input.priceUzs !== undefined ? input.priceUzs : current.priceUzs,
    JSON.stringify((input.includes ?? current.includes).slice(0, 12)),
    JSON.stringify((input.advantages ?? current.advantages).slice(0, 12)),
    input.note !== undefined ? input.note?.trim()?.slice(0, 500) || null : current.note,
    id,
    clinicId,
  );
  return getTemplate(clinicId, id);
}

export function deleteTemplate(clinicId: number, id: number): void {
  const info = db.prepare(`DELETE FROM offer_templates WHERE id = ? AND clinic_id = ?`).run(id, clinicId);
  if (info.changes === 0) throw notFound('Shablon topilmadi');
}

/** Shablon taklifda ishlatilganda — eng foydalisi ro'yxatda tepaga chiqadi. */
export function markTemplateUsed(clinicId: number, id: number): void {
  db.prepare(
    `UPDATE offer_templates SET used_count = used_count + 1 WHERE id = ? AND clinic_id = ?`,
  ).run(id, clinicId);
}

/* ═════════════════════  3. Shifokorlar  ═════════════════════ */

function mapDoctor(row: any): Doctor {
  const operationIds = db
    .prepare(`SELECT operation_id FROM doctor_operations WHERE doctor_id = ?`)
    .all(row.id) as { operation_id: number }[];
  return {
    id: row.id,
    clinicId: row.clinic_id,
    fullName: row.full_name,
    specialty: row.specialty,
    experienceYears: row.experience_years ?? null,
    photoFileId: row.photo_file_id ?? null,
    bio: row.bio ?? null,
    operationIds: operationIds.map((o) => o.operation_id),
    active: row.active === 1,
    createdAt: iso(row.created_at)!,
  };
}

export function listDoctors(clinicId: number): Doctor[] {
  const rows = db
    .prepare(`SELECT * FROM doctors WHERE clinic_id = ? ORDER BY active DESC, full_name`)
    .all(clinicId) as any[];
  return rows.map(mapDoctor);
}

export interface DoctorInput {
  fullName: string;
  specialty: string;
  experienceYears: number | null;
  photoFileId: string | null;
  bio: string | null;
  operationIds: number[];
  active: boolean;
}

export function createDoctor(clinicId: number, input: DoctorInput): Doctor {
  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO doctors (clinic_id, full_name, specialty, experience_years, photo_file_id, bio, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        clinicId,
        input.fullName.trim().slice(0, 160),
        input.specialty.trim().slice(0, 120),
        input.experienceYears,
        input.photoFileId,
        input.bio?.trim()?.slice(0, 1000) || null,
        input.active ? 1 : 0,
      );
    const doctorId = Number(info.lastInsertRowid);
    setDoctorOperations(doctorId, input.operationIds);
    return doctorId;
  })();
  return getDoctor(clinicId, id);
}

function setDoctorOperations(doctorId: number, operationIds: number[]) {
  db.prepare(`DELETE FROM doctor_operations WHERE doctor_id = ?`).run(doctorId);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO doctor_operations (doctor_id, operation_id) VALUES (?, ?)`,
  );
  for (const opId of operationIds.slice(0, 40)) ins.run(doctorId, opId);
}

export function getDoctor(clinicId: number, id: number): Doctor {
  const row = db.prepare(`SELECT * FROM doctors WHERE id = ? AND clinic_id = ?`).get(id, clinicId);
  if (!row) throw notFound('Shifokor topilmadi');
  return mapDoctor(row);
}

export function updateDoctor(clinicId: number, id: number, input: Partial<DoctorInput>): Doctor {
  const current = getDoctor(clinicId, id);
  db.transaction(() => {
    db.prepare(
      `UPDATE doctors
          SET full_name = ?, specialty = ?, experience_years = ?, photo_file_id = ?, bio = ?, active = ?
        WHERE id = ? AND clinic_id = ?`,
    ).run(
      (input.fullName ?? current.fullName).trim().slice(0, 160),
      (input.specialty ?? current.specialty).trim().slice(0, 120),
      input.experienceYears !== undefined ? input.experienceYears : current.experienceYears,
      input.photoFileId !== undefined ? input.photoFileId : current.photoFileId,
      input.bio !== undefined ? input.bio?.trim()?.slice(0, 1000) || null : current.bio,
      (input.active ?? current.active) ? 1 : 0,
      id,
      clinicId,
    );
    if (input.operationIds) setDoctorOperations(id, input.operationIds);
  })();
  return getDoctor(clinicId, id);
}

export function deleteDoctor(clinicId: number, id: number): void {
  const info = db.prepare(`DELETE FROM doctors WHERE id = ? AND clinic_id = ?`).run(id, clinicId);
  if (info.changes === 0) throw notFound('Shifokor topilmadi');
}

/* ═════════════════════  4. Bo'sh slot / kalendar  ═════════════════════ */

/**
 * Band kunlar bitimlardan hisoblanadi — klinika qo'lda kiritmaydi.
 * Shunday qilib kalendar haqiqatni ko'rsatadi, klinikaning xohishini emas.
 */
export function listSlots(clinicId: number, from: string, to: string): CapacitySlot[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.clinic_id, s.date, s.capacity, s.note,
              (SELECT COUNT(*) FROM deals d
                WHERE d.clinic_id = s.clinic_id
                  AND date(d.scheduled_at) = s.date
                  AND d.status IN ('AGREED','PAID','CONFIRMED')) AS booked
         FROM capacity_slots s
        WHERE s.clinic_id = ? AND s.date BETWEEN ? AND ?
        ORDER BY s.date`,
    )
    .all(clinicId, from, to) as any[];

  return rows.map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    date: r.date,
    capacity: r.capacity,
    booked: r.booked,
    note: r.note ?? null,
  }));
}

export function setSlot(clinicId: number, date: string, capacity: number, note: string | null): CapacitySlot {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('bad_date', 'Sana YYYY-MM-DD ko‘rinishida bo‘lishi kerak');
  if (capacity < 0 || capacity > 50) throw badRequest('bad_capacity', 'Quvvat 0 dan 50 gacha');

  db.prepare(
    `INSERT INTO capacity_slots (clinic_id, date, capacity, note)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (clinic_id, date) DO UPDATE SET capacity = excluded.capacity, note = excluded.note`,
  ).run(clinicId, date, capacity, note?.trim()?.slice(0, 200) || null);

  return listSlots(clinicId, date, date)[0];
}

export function deleteSlot(clinicId: number, date: string): void {
  db.prepare(`DELETE FROM capacity_slots WHERE clinic_id = ? AND date = ?`).run(clinicId, date);
}

/* ═════════════════════  5. Jamoa (operatorlar)  ═════════════════════ */

export function listOperators(clinicId: number): ClinicOperator[] {
  const rows = db
    .prepare(
      `SELECT id, first_name, last_name, username, roles, last_seen_at, created_at
         FROM users WHERE clinic_id = ? ORDER BY created_at`,
    )
    .all(clinicId) as any[];

  return rows.map((r) => {
    const roles = json<string[]>(r.roles, []);
    return {
      userId: r.id,
      firstName: r.first_name,
      lastName: r.last_name ?? null,
      username: r.username ?? null,
      role: (roles.includes('clinic_admin') ? 'clinic_admin' : 'clinic_operator') as OperatorRole,
      lastSeenAt: iso(r.last_seen_at),
      createdAt: iso(r.created_at)!,
    };
  });
}




export function removeOperator(clinicId: number, actorId: number, userId: number): void {
  if (actorId === userId) throw badRequest('self_remove', 'O‘zingizni chiqarib yubora olmaysiz');

  const target = db
    .prepare(`SELECT roles FROM users WHERE id = ? AND clinic_id = ?`)
    .get(userId, clinicId) as any;
  if (!target) throw notFound('Operator topilmadi');

  // Oxirgi administratorni chiqarib bo'lmaydi — klinika boshqaruvsiz qolmasin
  const roles = json<string[]>(target.roles, []);
  if (roles.includes('clinic_admin')) {
    const admins = db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE clinic_id = ? AND roles LIKE '%clinic_admin%'`)
      .get(clinicId) as { n: number };
    if (admins.n <= 1) throw conflict('last_admin', 'Oxirgi administratorni chiqarib bo‘lmaydi');
  }

  db.prepare(`UPDATE users SET clinic_id = NULL, roles = ? WHERE id = ?`).run(
    JSON.stringify(roles.filter((r) => r !== 'clinic_admin' && r !== 'clinic_operator')),
    userId,
  );
}

export function setOperatorRole(clinicId: number, userId: number, role: OperatorRole): void {
  const target = db
    .prepare(`SELECT roles FROM users WHERE id = ? AND clinic_id = ?`)
    .get(userId, clinicId) as any;
  if (!target) throw notFound('Operator topilmadi');

  const roles = new Set(json<string[]>(target.roles, []));
  roles.delete('clinic_admin');
  roles.delete('clinic_operator');
  roles.add(role);
  db.prepare(`UPDATE users SET roles = ? WHERE id = ?`).run(JSON.stringify([...roles]), userId);
}

/* ═════════════════════  6. Analitika  ═════════════════════ */

export function getAnalytics(clinicId: number, windowDays = 30): ClinicAnalytics {
  const since = `-${windowDays} days`;

  const seen = db
    .prepare(
      `SELECT COUNT(*) AS n FROM request_broadcasts b
        WHERE b.clinic_id = ? AND b.created_at >= datetime('now', ?)`,
    )
    .get(clinicId, since) as { n: number };

  const offers = db
    .prepare(
      `SELECT COUNT(*) AS sent,
              SUM(CASE WHEN status = 'CHOSEN' THEN 1 ELSE 0 END) AS won,
              AVG(price_uzs) AS avg_price,
              AVG(CASE WHEN status = 'CHOSEN' THEN price_uzs END) AS avg_win
         FROM offers
        WHERE clinic_id = ? AND created_at >= datetime('now', ?)`,
    )
    .get(clinicId, since) as any;

  const response = db
    .prepare(`SELECT response_minutes_sum AS s, response_samples AS n FROM clinics WHERE id = ?`)
    .get(clinicId) as { s: number; n: number };

  const daily = db
    .prepare(
      `WITH RECURSIVE days(d) AS (
         SELECT date('now', ?)
         UNION ALL SELECT date(d, '+1 day') FROM days WHERE d < date('now')
       )
       SELECT d AS date,
         (SELECT COUNT(*) FROM request_broadcasts b
           WHERE b.clinic_id = @clinic AND date(b.created_at) = d) AS requests,
         (SELECT COUNT(*) FROM offers o
           WHERE o.clinic_id = @clinic AND date(o.created_at) = d) AS offers,
         (SELECT COUNT(*) FROM offers o
           WHERE o.clinic_id = @clinic AND o.status = 'CHOSEN' AND date(o.updated_at) = d) AS wins
       FROM days`,
    )
    .all(since, { clinic: clinicId }) as any[];

  const topOperations = db
    .prepare(
      `SELECT r.operation_id AS operationId, op.name_uz AS name,
              COUNT(*) AS requests,
              SUM(CASE WHEN o.status = 'CHOSEN' THEN 1 ELSE 0 END) AS wins
         FROM request_broadcasts b
         JOIN requests r ON r.id = b.request_id
         JOIN operations op ON op.id = r.operation_id
         LEFT JOIN offers o ON o.request_id = r.id AND o.clinic_id = b.clinic_id
        WHERE b.clinic_id = ? AND b.created_at >= datetime('now', ?)
        GROUP BY r.operation_id
        ORDER BY requests DESC
        LIMIT 6`,
    )
    .all(clinicId, since) as any[];

  // Yutqazgan takliflarda g'olib narx o'rtacha necha foiz arzon edi
  const lost = db
    .prepare(
      `SELECT AVG((mine.price_uzs - win.price_uzs) * 100.0 / mine.price_uzs) AS pct
         FROM offers mine
         JOIN offers win ON win.request_id = mine.request_id AND win.status = 'CHOSEN'
        WHERE mine.clinic_id = ? AND mine.status = 'REJECTED'
          AND mine.created_at >= datetime('now', ?)`,
    )
    .get(clinicId, since) as { pct: number | null };

  const sent = offers?.sent ?? 0;
  const won = offers?.won ?? 0;

  return {
    windowDays,
    requestsSeen: seen.n,
    offersSent: sent,
    offersWon: won,
    responseRate: seen.n > 0 ? sent / seen.n : 0,
    winRate: sent > 0 ? won / sent : 0,
    avgResponseMinutes: response?.n > 0 ? Math.round(response.s / response.n) : null,
    avgOfferUzs: offers?.avg_price ? Math.round(offers.avg_price) : null,
    avgWinningOfferUzs: offers?.avg_win ? Math.round(offers.avg_win) : null,
    daily: daily.map((d) => ({ date: d.date, requests: d.requests, offers: d.offers, wins: d.wins })),
    topOperations: topOperations.map((o) => ({
      operationId: o.operationId,
      name: o.name,
      requests: o.requests,
      wins: o.wins ?? 0,
    })),
    lostByPercent: lost?.pct != null ? Math.round(lost.pct * 10) / 10 : null,
  };
}

/* ═════════════════════  7. Daromad va hisob-kitob  ═════════════════════ */

export function getRevenue(clinicId: number): ClinicRevenue {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS deals,
              COALESCE(SUM(confirmed_amount_uzs), 0) AS gross,
              COALESCE(SUM(commission_uzs), 0) AS commission
         FROM deals WHERE clinic_id = ? AND status = 'CONFIRMED'`,
    )
    .get(clinicId) as any;

  const months = db
    .prepare(
      `SELECT strftime('%Y-%m', confirmed_at) AS month,
              COUNT(*) AS deals,
              COALESCE(SUM(confirmed_amount_uzs), 0) AS gross,
              COALESCE(SUM(commission_uzs), 0) AS commission
         FROM deals
        WHERE clinic_id = ? AND status = 'CONFIRMED' AND confirmed_at IS NOT NULL
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12`,
    )
    .all(clinicId) as any[];

  const clinic = db
    .prepare(`SELECT plan, subscription_status, subscription_until FROM clinics WHERE id = ?`)
    .get(clinicId) as any;

  const paid = db
    .prepare(`SELECT COALESCE(SUM(amount_uzs), 0) AS n FROM subscription_payments WHERE clinic_id = ?`)
    .get(clinicId) as { n: number };

  /*
   * Qarzni faqat TASDIQLANGAN to'lov kamaytiradi. Klinika topshirgan,
   * lekin admin hali ko'rmagan summa alohida ko'rsatiladi — aks holda
   * klinika istalgan raqamni yozib qarzini nolga tushira olardi.
   */
  const paidCommission = db
    .prepare(
      `SELECT COALESCE(SUM(amount_uzs), 0) AS n FROM commission_payments
        WHERE clinic_id = ? AND status = 'confirmed'`,
    )
    .get(clinicId) as { n: number };

  const pendingCommission = db
    .prepare(
      `SELECT COALESCE(SUM(amount_uzs), 0) AS n FROM commission_payments
        WHERE clinic_id = ? AND status = 'declared'`,
    )
    .get(clinicId) as { n: number };

  const payments = db
    .prepare(
      `SELECT id, amount_uzs, method, reference, status, review_note, reviewed_at, created_at
         FROM commission_payments WHERE clinic_id = ?
        ORDER BY created_at DESC LIMIT 24`,
    )
    .all(clinicId) as any[];

  return {
    commissionPercent: config.rules.commissionPercent,
    totals: {
      confirmedDeals: totals.deals,
      grossUzs: totals.gross,
      commissionUzs: totals.commission,
      netUzs: totals.gross - totals.commission,
    },
    months: months.map((m) => ({
      month: m.month,
      deals: m.deals,
      grossUzs: m.gross,
      commissionUzs: m.commission,
      netUzs: m.gross - m.commission,
    })),
    // Hisoblangan komissiyadan to'langani ayiriladi; manfiy bo'lmaydi
    outstandingUzs: Math.max(0, totals.commission - paidCommission.n),
    paidCommissionUzs: paidCommission.n,
    /** Topshirilgan, lekin admin hali tasdiqlamagan summa */
    pendingCommissionUzs: pendingCommission.n,
    commissionPayments: payments.map((p) => ({
      id: p.id,
      amountUzs: p.amount_uzs,
      method: p.method,
      reference: p.reference ?? null,
      status: p.status,
      reviewNote: p.review_note ?? null,
      reviewedAt: iso(p.reviewed_at ?? null),
      createdAt: iso(p.created_at)!,
    })),
    subscription: {
      plan: clinic?.plan ?? null,
      status: clinic?.subscription_status ?? 'none',
      until: iso(clinic?.subscription_until ?? null),
      paidUzs: paid.n,
    },
  };
}

/* ═════════════════════  8. Sharhga javob  ═════════════════════ */

export function replyToReview(clinicId: number, reviewId: number, body: string): void {
  const review = db
    .prepare(`SELECT clinic_id, reply_body FROM reviews WHERE id = ?`)
    .get(reviewId) as any;
  if (!review) throw notFound('Sharh topilmadi');
  if (review.clinic_id !== clinicId) throw forbidden('Bu sharh sizning klinikangizga tegishli emas');
  // Bitta javob — munozara chatda bo'ladi, sharh ostida emas
  if (review.reply_body) throw conflict('already_replied', 'Bu sharhga allaqachon javob berilgan');

  const text = body.trim();
  if (text.length < 5) throw badRequest('reply_too_short', 'Javob juda qisqa');

  db.prepare(`UPDATE reviews SET reply_body = ?, reply_at = datetime('now') WHERE id = ?`).run(
    text.slice(0, 1000),
    reviewId,
  );
}

/* ═════════════════════  9. Bildirishnoma sozlamalari  ═════════════════════ */

export function getNotificationPrefs(userId: number): NotificationPrefs {
  const row = db.prepare(`SELECT notification_prefs FROM users WHERE id = ?`).get(userId) as any;
  return { ...DEFAULT_NOTIFICATION_PREFS, ...json<Partial<NotificationPrefs>>(row?.notification_prefs, {}) };
}

export function setNotificationPrefs(userId: number, patch: Partial<NotificationPrefs>): NotificationPrefs {
  const next = { ...getNotificationPrefs(userId), ...patch };
  db.prepare(`UPDATE users SET notification_prefs = ? WHERE id = ?`).run(JSON.stringify(next), userId);
  return next;
}


/**
 * Komissiya to'lovini yozib qo'yish.
 *
 * To'lov shlyuzi (Payme/Click) ulanmagan — bu yerda faqat FAKT qayd etiladi:
 * qancha, qaysi usulda, qaysi hujjat bo'yicha. Shlyuz ulanganda uning
 * tasdig'i shu funksiyani chaqiradi, qolgan hisob-kitob o'zgarmaydi.
 */
export function declareCommissionPayment(input: {
  clinicId: number;
  amountUzs: number;
  method: string;
  reference: string | null;
}): ClinicRevenue {
  const revenue = getRevenue(input.clinicId);

  if (input.amountUzs <= 0) throw badRequest('bad_amount', 'Summa noldan katta bo‘lishi kerak');

  /*
   * Qarzdan ortiq topshirib bo'lmaydi. Hisobga TEKSHIRUVDAGI summa ham
   * kiradi: aks holda klinika bir qarzni ikki marta topshirib, admin
   * ikkalasini tasdiqlab yuborishi mumkin edi.
   */
  const room = revenue.outstandingUzs - revenue.pendingCommissionUzs;
  if (input.amountUzs > room) {
    throw badRequest('overpayment', 'Summa to‘lanmagan komissiyadan katta');
  }

  db.prepare(
    `INSERT INTO commission_payments (clinic_id, amount_uzs, method, reference, period, status)
     VALUES (?, ?, ?, ?, strftime('%Y-%m', 'now'), 'declared')`,
  ).run(input.clinicId, input.amountUzs, input.method.slice(0, 40), input.reference?.slice(0, 120) || null);

  return getRevenue(input.clinicId);
}

/** Admin uchun — tekshiruv kutayotgan komissiya to'lovlari. */
export function listPendingCommissionPayments(): PendingCommissionPayment[] {
  return (
    db
      .prepare(
        `SELECT p.id, p.clinic_id, c.name AS clinic_name, p.amount_uzs, p.method,
                p.reference, p.created_at
           FROM commission_payments p
           JOIN clinics c ON c.id = p.clinic_id
          WHERE p.status = 'declared'
          ORDER BY p.created_at ASC`,
      )
      .all() as any[]
  ).map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    clinicName: r.clinic_name,
    amountUzs: r.amount_uzs,
    method: r.method,
    reference: r.reference ?? null,
    createdAt: iso(r.created_at)!,
  }));
}

/**
 * Admin komissiya to'lovini tasdiqlaydi yoki rad etadi.
 *
 * Faqat shu yerda qarz kamayadi. Rad etilgan yozuv O'CHIRILMAYDI —
 * klinika nima yuborganini va nima uchun qaytarilganini ko'rishi kerak.
 */
export function reviewCommissionPayment(
  paymentId: number,
  adminId: number,
  decision: 'confirmed' | 'rejected',
  note: string | null,
): PendingCommissionPayment[] {
  const row = db
    .prepare(`SELECT clinic_id, status, amount_uzs FROM commission_payments WHERE id = ?`)
    .get(paymentId) as { clinic_id: number; status: string; amount_uzs: number } | undefined;

  if (!row) throw notFound('To‘lov topilmadi');
  if (row.status !== 'declared') {
    throw conflict('already_reviewed', 'Bu to‘lov allaqachon ko‘rib chiqilgan');
  }
  if (decision === 'rejected' && !note?.trim()) {
    throw badRequest('note_required', 'Rad etish sababini yozing');
  }

  db.prepare(
    `UPDATE commission_payments
        SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?
      WHERE id = ?`,
  ).run(decision, adminId, note?.trim().slice(0, 300) || null, paymentId);

  notifyClinic(
    row.clinic_id,
    decision === 'confirmed' ? 'commission_confirmed' : 'commission_rejected',
    { amount: row.amount_uzs, note: note ?? '' },
    '/clinic/revenue',
  );

  return listPendingCommissionPayments();
}

/* ═════════════════  10. Moderator: hujjat tekshiruvi  ═════════════════ */

/** Moderator uchun — klinikaning barcha hujjatlari. */
export function listDocumentsForModeration(clinicId: number): ClinicDocument[] {
  return listDocuments(clinicId);
}

export function setDocumentStatus(
  documentId: number,
  status: 'approved' | 'rejected',
  note: string | null,
): ClinicDocument {
  const row = db.prepare(`SELECT clinic_id FROM clinic_documents WHERE id = ?`).get(documentId) as any;
  if (!row) throw notFound('Hujjat topilmadi');
  // Rad etishda sabab majburiy — klinika nimani tuzatishini bilishi kerak
  if (status === 'rejected' && !note?.trim()) {
    throw badRequest('note_required', 'Rad etish sababini yozing');
  }

  db.prepare(`UPDATE clinic_documents SET status = ?, note = ? WHERE id = ?`).run(
    status,
    note?.trim()?.slice(0, 500) || null,
    documentId,
  );

  return listDocuments(row.clinic_id).find((d) => d.id === documentId)!;
}
