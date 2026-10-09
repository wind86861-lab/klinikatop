/**
 * Yo'naltiruvchi shifokor — ro'yxatdan o'tish va admin tasdig'i.
 *
 * Kirish faqat Telegram orqali (botda `/shifokor`). Telefon hech qachon
 * qo'lda yozilmaydi: u botda 📱 kontakt bilan tasdiqlangan bo'lishi
 * shart. Aks holda shifokor istalgan raqamni "o'ziniki" deb ko'rsata
 * olardi.
 *
 * Holatlar:
 *
 *   pending ──► approved
 *      │
 *      └─────► rejected ── yangi hujjat ──► in_review ──► approved / rejected
 *
 * `in_review` ga FAQAT yangi fayl o'tkazadi. Matn tahriri yoki fayl
 * o'chirish — yo'q: aks holda rad etilgan shifokor bio'dagi bitta
 * harfni o'zgartirib arizani cheksiz qayta navbatga qo'yardi.
 *
 * Shifokor BEMOR bo'lib qoladi (`roles` ga `doctor` QO'SHILADI). Klinika
 * xodimi yoki admin esa shifokor bo'la olmaydi — ular veb hisoblar va
 * Telegram orqali umuman kelmaydi, lekin baribir tekshiriladi.
 */
import { db, nowSql, parseJson, toJson, tx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { readLicense, removeLicense, storeLicense, type LicenseUpload } from './applicationFiles';
import { notify } from './notifications';
import type {
  AdminReferringDoctor,
  DoctorDocKind,
  ReferringDoctor,
  ReferringDoctorDocument,
  ReferringDoctorStatus,
  Role,
} from '../../../shared/types';

/** Bitta shifokorda ko'pi bilan nechta hujjat — spam va disk uchun chegara */
export const MAX_DOCTOR_DOCS = 6;

const iso = (s: string | null): string | null => (s ? new Date(s.replace(' ', 'T') + 'Z').toISOString() : null);

function mapDoc(r: any): ReferringDoctorDocument {
  return { id: r.id, kind: r.kind, name: r.name, mime: r.mime, size: r.size, createdAt: iso(r.created_at)! };
}

function docsOf(doctorId: number): ReferringDoctorDocument[] {
  return (
    db.prepare(`SELECT * FROM referring_doctor_documents WHERE doctor_id = ? ORDER BY id`).all(doctorId) as any[]
  ).map(mapDoc);
}

function mapDoctor(r: any): ReferringDoctor {
  return {
    id: r.id,
    userId: r.user_id,
    firstName: r.first_name,
    lastName: r.last_name,
    specialty: r.specialty,
    workplace: r.workplace,
    bio: r.bio ?? null,
    status: r.status,
    rejectReason: r.reject_reason ?? null,
    reviewedAt: iso(r.reviewed_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    documents: docsOf(r.id),
  };
}

function rowByUser(userId: number): any {
  return db.prepare(`SELECT * FROM referring_doctors WHERE user_id = ?`).get(userId);
}

export function getMyDoctor(userId: number): ReferringDoctor | null {
  const row = rowByUser(userId);
  return row ? mapDoctor(row) : null;
}

export interface DoctorDocUpload extends LicenseUpload {
  kind: DoctorDocKind;
}

export interface DoctorProfileInput {
  firstName: string;
  lastName: string;
  specialty: string;
  workplace: string;
  bio?: string | null;
  documents?: DoctorDocUpload[];
}

const clean = (s: string | null | undefined, max: number) => (s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/**
 * Hujjatlarni diskka yozadi va bazaga qo'shadi.
 *
 * Diskka yozish tranzaksiyadan TASHQARIDA bo'ladi (fayl tizimi
 * orqaga qaytmaydi) — shuning uchun baza yiqilsa yozilgan fayllar
 * shu yerning o'zida o'chiriladi, yetim fayl qolmaydi.
 */
function storeDocs(docs: DoctorDocUpload[]) {
  const stored: { kind: DoctorDocKind; file: ReturnType<typeof storeLicense> }[] = [];
  try {
    for (const doc of docs) {
      const label = doc.kind === 'master' ? 'Magistr diplomi' : 'Bakalavr diplomi';
      stored.push({ kind: doc.kind, file: storeLicense(doc, label) });
    }
  } catch (err) {
    for (const s of stored) removeLicense(s.file.storage);
    throw err;
  }
  return stored;
}

function insertDocs(doctorId: number, stored: ReturnType<typeof storeDocs>): void {
  const ins = db.prepare(
    `INSERT INTO referring_doctor_documents (doctor_id, kind, storage, name, mime, size) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const s of stored) ins.run(doctorId, s.kind, s.file.storage, s.file.name, s.file.mime, s.file.size);
}

/**
 * Rad etilgan shifokor YANGI hujjat yukladi → qayta ko'rib chiqishga.
 * Oldingi rad sababi o'chirilmaydi: admin o'tgan safar nima
 * noto'g'ri bo'lganini ko'rib turishi kerak.
 */
function reopenIfRejected(doctorId: number): void {
  db.prepare(
    `UPDATE referring_doctors SET status = 'in_review', updated_at = ? WHERE id = ? AND status = 'rejected'`,
  ).run(nowSql(), doctorId);
}

/**
 * Ro'yxatdan o'tish — yoki mavjud profilni yangilash.
 *
 * Qayta yuborish xavfsiz: ikkinchi so'rov yangi ariza ochmaydi, bor
 * profilni yangilaydi. Ilova tarmoq uzilib qayta yuborsa ham
 * navbatda ikki nusxa paydo bo'lmaydi.
 */
export function registerDoctor(userId: number, input: DoctorProfileInput): ReferringDoctor {
  const user = db.prepare(`SELECT id, telegram_id, phone, roles FROM users WHERE id = ?`).get(userId) as
    | { id: number; telegram_id: number; phone: string | null; roles: string }
    | undefined;
  if (!user) throw notFound('Foydalanuvchi topilmadi');

  const roles = parseJson<Role[]>(user.roles, ['patient']);
  if (user.telegram_id <= 0 || roles.some((r) => r === 'clinic_admin' || r === 'clinic_operator' || r === 'admin')) {
    throw conflict('role_taken', 'Bu hisob klinika yoki administrator hisobi bilan band');
  }
  if (!user.phone) {
    throw badRequest(
      'phone_required',
      'Avval botda /start bosib 📱 telefon raqamingizni ulashing, keyin qayta urining.',
    );
  }

  const profile = {
    firstName: clean(input.firstName, 80),
    lastName: clean(input.lastName, 80),
    specialty: clean(input.specialty, 120),
    workplace: clean(input.workplace, 200),
    bio: (input.bio ?? '').trim().slice(0, 1500) || null,
  };
  if (!profile.firstName || !profile.lastName) throw badRequest('name_required', 'Ism va familiyani kiriting');
  if (!profile.specialty) throw badRequest('specialty_required', 'Mutaxassislikni kiriting');
  if (!profile.workplace) throw badRequest('workplace_required', 'Ish joyini kiriting');

  const docs = input.documents ?? [];
  const existing = rowByUser(userId);
  const existingDocs = existing ? docsOf(existing.id) : [];

  if (existingDocs.length + docs.length > MAX_DOCTOR_DOCS) {
    throw badRequest('too_many_files', `Ko‘pi bilan ${MAX_DOCTOR_DOCS} ta hujjat`);
  }
  const hasBachelor = existingDocs.some((d) => d.kind === 'bachelor') || docs.some((d) => d.kind === 'bachelor');
  if (!hasBachelor) throw badRequest('bachelor_required', 'Bakalavr diplomini yuklang');

  const stored = storeDocs(docs);
  try {
    return tx(() => {
      let doctorId: number;
      if (existing) {
        doctorId = existing.id;
        db.prepare(
          `UPDATE referring_doctors
              SET first_name = ?, last_name = ?, specialty = ?, workplace = ?, bio = ?, updated_at = ?
            WHERE id = ?`,
        ).run(profile.firstName, profile.lastName, profile.specialty, profile.workplace, profile.bio, nowSql(), doctorId);
      } else {
        doctorId = Number(
          db
            .prepare(
              `INSERT INTO referring_doctors (user_id, first_name, last_name, specialty, workplace, bio)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(userId, profile.firstName, profile.lastName, profile.specialty, profile.workplace, profile.bio)
            .lastInsertRowid,
        );
        if (!roles.includes('doctor')) {
          db.prepare(`UPDATE users SET roles = ? WHERE id = ?`).run(toJson([...roles, 'doctor']), userId);
        }
      }

      insertDocs(doctorId, stored);
      if (stored.length) reopenIfRejected(doctorId);
      return mapDoctor(db.prepare(`SELECT * FROM referring_doctors WHERE id = ?`).get(doctorId));
    });
  } catch (err) {
    for (const s of stored) removeLicense(s.file.storage);
    throw err;
  }
}

function requireDoctorRow(userId: number): any {
  const row = rowByUser(userId);
  if (!row) throw notFound('Shifokor profili topilmadi — avval ro‘yxatdan o‘ting');
  return row;
}

/** Bitta hujjat qo'shish. Rad etilgan bo'lsa ariza qayta ko'rib chiqishga ketadi. */
export function addDoctorDocument(userId: number, doc: DoctorDocUpload): ReferringDoctor {
  const row = requireDoctorRow(userId);
  if (docsOf(row.id).length >= MAX_DOCTOR_DOCS) {
    throw badRequest('too_many_files', `Ko‘pi bilan ${MAX_DOCTOR_DOCS} ta hujjat`);
  }
  const stored = storeDocs([doc]);
  try {
    tx(() => {
      insertDocs(row.id, stored);
      reopenIfRejected(row.id);
      db.prepare(`UPDATE referring_doctors SET updated_at = ? WHERE id = ?`).run(nowSql(), row.id);
    });
  } catch (err) {
    removeLicense(stored[0].file.storage);
    throw err;
  }
  return mapDoctor(db.prepare(`SELECT * FROM referring_doctors WHERE id = ?`).get(row.id));
}

/**
 * Hujjatni o'chirish. Holat O'ZGARMAYDI. Oxirgi bakalavr diplomini
 * o'chirib bo'lmaydi — u majburiy.
 */
export function deleteDoctorDocument(userId: number, docId: number): ReferringDoctor {
  const row = requireDoctorRow(userId);
  const doc = db
    .prepare(`SELECT * FROM referring_doctor_documents WHERE id = ? AND doctor_id = ?`)
    .get(docId, row.id) as any;
  if (!doc) throw notFound('Hujjat topilmadi');

  if (doc.kind === 'bachelor') {
    const left = db
      .prepare(`SELECT COUNT(*) AS n FROM referring_doctor_documents WHERE doctor_id = ? AND kind = 'bachelor'`)
      .get(row.id) as { n: number };
    if (left.n <= 1) throw badRequest('bachelor_required', 'Bakalavr diplomi majburiy — avval yangisini yuklang');
  }

  db.prepare(`DELETE FROM referring_doctor_documents WHERE id = ?`).run(docId);
  removeLicense(doc.storage);
  return mapDoctor(db.prepare(`SELECT * FROM referring_doctors WHERE id = ?`).get(row.id));
}

export interface DoctorFile {
  buffer: Buffer;
  name: string;
  mime: string;
}

function readDoc(doctorId: number, docId: number): DoctorFile {
  const doc = db
    .prepare(`SELECT * FROM referring_doctor_documents WHERE id = ? AND doctor_id = ?`)
    .get(docId, doctorId) as any;
  if (!doc) throw notFound('Hujjat topilmadi');
  return { buffer: readLicense(doc.storage), name: doc.name, mime: doc.mime };
}

/** Shifokor o'z hujjatini ko'radi */
export function readMyDoctorDocument(userId: number, docId: number): DoctorFile {
  return readDoc(requireDoctorRow(userId).id, docId);
}

/**
 * Tasdiqlangan shifokor — bemor uchun so'rov yaratishdan oldingi to'siq.
 * Tasdiqlanmagan shifokor kabinetni ko'radi, lekin tavsiya yubora olmaydi.
 */
export function assertApprovedDoctor(userId: number): ReferringDoctor {
  const row = rowByUser(userId);
  if (!row || row.status !== 'approved') throw forbidden('Avval admin arizangizni tasdiqlashi kerak');
  return mapDoctor(row);
}

/* ═════════════════  Admin  ═════════════════ */

export type AdminDoctorFilter = ReferringDoctorStatus | 'all';

function mapAdmin(r: any): AdminReferringDoctor {
  return { ...mapDoctor(r), phone: r.phone ?? null, username: r.username ?? null };
}

const ADMIN_SELECT = `SELECT d.*, u.phone, u.username FROM referring_doctors d JOIN users u ON u.id = d.user_id`;

export function listDoctorsForAdmin(filter: AdminDoctorFilter): {
  doctors: AdminReferringDoctor[];
  counts: Record<AdminDoctorFilter, number>;
} {
  // Kutayotganlar birinchi, eng eskisi tepada — navbat adolatli bo'lsin
  const rows = (
    filter === 'all'
      ? db.prepare(`${ADMIN_SELECT} ORDER BY d.created_at DESC`).all()
      : db
          .prepare(
            `${ADMIN_SELECT} WHERE d.status = ?
             ORDER BY CASE WHEN d.status IN ('pending','in_review') THEN d.updated_at END ASC, d.updated_at DESC`,
          )
          .all(filter)
  ) as any[];

  const counts = { all: 0, pending: 0, in_review: 0, approved: 0, rejected: 0 } as Record<AdminDoctorFilter, number>;
  for (const c of db.prepare(`SELECT status, COUNT(*) AS n FROM referring_doctors GROUP BY status`).all() as {
    status: ReferringDoctorStatus;
    n: number;
  }[]) {
    counts[c.status] = c.n;
    counts.all += c.n;
  }
  return { doctors: rows.map(mapAdmin), counts };
}

/** Admin menyusidagi raqam — ko'rib chiqilishi kerak bo'lgan arizalar */
export function pendingDoctorCount(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM referring_doctors WHERE status IN ('pending','in_review')`).get() as {
      n: number;
    }
  ).n;
}

export function getDoctorForAdmin(id: number): AdminReferringDoctor {
  const row = db.prepare(`${ADMIN_SELECT} WHERE d.id = ?`).get(id);
  if (!row) throw notFound('Shifokor topilmadi');
  return mapAdmin(row);
}

export function readDoctorDocumentForAdmin(doctorId: number, docId: number): DoctorFile {
  return readDoc(doctorId, docId);
}

/**
 * Admin qarori.
 *
 * Avval bazaga yoziladi, KEYIN xabar yuboriladi: Telegram ishlamay
 * qolsa ham qaror yo'qolmaydi. `notify` o'zi ham Telegram xatosini
 * yutadi, ya'ni bu yerga qaytib kelmaydi.
 */
function decide(id: number, adminId: number, approved: boolean, reason: string | null): AdminReferringDoctor {
  const row = db.prepare(`SELECT * FROM referring_doctors WHERE id = ?`).get(id) as any;
  if (!row) throw notFound('Shifokor topilmadi');
  if (row.status !== 'pending' && row.status !== 'in_review') {
    throw badRequest('not_pending', 'Bu ariza allaqachon ko‘rib chiqilgan');
  }

  tx(() => {
    db.prepare(
      `UPDATE referring_doctors
          SET status = ?, reject_reason = CASE WHEN ? IS NULL THEN reject_reason ELSE ? END,
              reviewed_by = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(approved ? 'approved' : 'rejected', reason, reason, adminId, nowSql(), nowSql(), id);
    db.prepare(
      `INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note) VALUES (?, 'doctor', ?, ?, ?)`,
    ).run(adminId, id, approved ? 'approve' : 'reject', reason);
  });

  notify(row.user_id, 'doctor_review', { approved: approved ? 1 : 0, note: reason ?? '' }, '/doctor');
  return getDoctorForAdmin(id);
}

export function approveDoctor(id: number, adminId: number): AdminReferringDoctor {
  return decide(id, adminId, true, null);
}

export function rejectDoctor(id: number, adminId: number, reason: string): AdminReferringDoctor {
  const clean = reason.trim().slice(0, 500);
  if (clean.length < 3) throw badRequest('reason_required', 'Rad etish sababini yozing');
  return decide(id, adminId, false, clean);
}
