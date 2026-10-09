/**
 * Klinika arizasi — Telegramdan tashqarida to'ldiriladi.
 *
 * Klinika egasi Telegram hisobi bo'lmasa ham ariza qoldira oladi: oddiy
 * veb-sahifa, hech qanday autentifikatsiyasiz. Bu ataylab shunday —
 * klinika bilan ishlashni boshlash uchun undan Telegram talab qilish
 * keraksiz to'siq bo'lardi.
 *
 * Shuning uchun himoya boshqacha:
 *   • ariza darhol klinika bo'lib qolmaydi, avval moderator ko'radi
 *   • bir IP dan ketma-ket ariza cheklanadi
 *   • bir xil litsenziya raqami bilan takroriy ariza rad etiladi
 *
 * Tasdiqlangach klinika yaratiladi va unga VEB HISOB ochiladi. Hisobning
 * identifikatori — arizadagi TELEFON RAQAMI: uni moderator qo'ng'iroq
 * qilib tekshirgan.
 *
 * Klinika ikki yo'l bilan kiradi va ikkalasi ham shu raqamga tayanadi:
 *   • botga /start bosadi, raqamini yuboradi — bot uni tanib oladi
 *   • yoki brauzerda raqam va parol bilan kiradi
 */
import { db } from '../db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { createAccount } from './webAuth';
import { saveFile } from './files';
import { readLicense, removeLicense, storeLicense, type LicenseUpload } from './applicationFiles';
import { mapClinic } from '../lib/mappers';
import type { Clinic } from '../../../shared/types';

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface ClinicApplication {
  id: number;
  name: string;
  cityId: number;
  address: string;
  about: string;
  licenseNo: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  operationIds: number[];
  /** Qaysi tahlillarni qiladi (tekshiruv id'lari) */
  labTestIds: number[];
  /** Shifokor yo'llanmasi (rasm) so'rovlarini qabul qiladimi */
  acceptsReferral: boolean;
  status: ApplicationStatus;
  note: string | null;
  clinicId: number | null;
  /**
   * Parol o'rnatish uchun bir martalik token. Faqat moderatorga ko'rinadi
   * va faqat tasdiqlash paytida bir marta — klinikaga havola shaklida
   * yetkaziladi.
   */
  connectCode: string | null;
  /** Litsenziya fayli — faqat ma'lumoti; faylning o'zi admin yo'li orqali */
  licenseFile: { name: string; mime: string; size: number } | null;
  createdAt: string;
  reviewedAt: string | null;
}

const iso = (v: string | null) => (v ? new Date(v.replace(' ', 'T') + 'Z').toISOString() : null);

function map(row: any): ClinicApplication {
  return {
    id: row.id,
    name: row.name,
    cityId: row.city_id,
    address: row.address,
    about: row.about,
    licenseNo: row.license_no,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email ?? null,
    operationIds: JSON.parse(row.operation_ids || '[]'),
    labTestIds: JSON.parse(row.lab_test_ids || '[]'),
    acceptsReferral: row.accepts_referral === 1,
    status: row.status,
    note: row.note ?? null,
    clinicId: row.clinic_id ?? null,
    connectCode: row.connect_code ?? null,
    licenseFile: row.license_file
      ? { name: row.license_file_name ?? '', mime: row.license_file_mime ?? '', size: row.license_file_size ?? 0 }
      : null,
    createdAt: iso(row.created_at)!,
    reviewedAt: iso(row.reviewed_at),
  };
}

export interface ApplicationInput {
  name: string;
  cityId: number;
  address: string;
  about: string;
  licenseNo: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  operationIds: number[];
  labTestIds: number[];
  acceptsReferral: boolean;
  /** Litsenziya fayli — MAJBURIY: moderator raqamni hujjat bilan solishtiradi */
  licenseFile: LicenseUpload;
  ip: string | null;
}

/**
 * Bir IP dan sutkasiga nechta KO'RIB CHIQILMAGAN ariza bo'lishi mumkin.
 *
 * Cheklovning maqsadi — moderator navbatini toshirmaslik. Shuning uchun
 * faqat `pending` arizalar sanaladi: ko'rib chiqilgani (tasdiqlangan yoki
 * rad etilgani) endi navbatda emas va yangi ariza berishga to'sqinlik
 * qilmasligi kerak.
 *
 * Aks holda halol klinikalar tarmog'i bitta IP ortidan bir necha filial
 * uchun ariza bera olmay qolardi.
 */
const MAX_PENDING_PER_IP_PER_DAY = 10;

export function submitApplication(input: ApplicationInput): { id: number; status: ApplicationStatus } {
  if (!db.prepare(`SELECT 1 FROM cities WHERE id = ?`).get(input.cityId)) {
    throw badRequest('unknown_city', 'Bunday viloyat topilmadi');
  }
  /*
   * Kamida BITTA xizmat: operatsiya, tahlil yoki yo'llanma. Ilgari
   * faqat operatsiya majburiy edi — sof laboratoriya ro'yxatdan
   * o'tolmasdi.
   */
  if (input.operationIds.length === 0 && input.labTestIds.length === 0 && !input.acceptsReferral) {
    throw badRequest('services_required', 'Kamida bitta xizmat turini tanlang');
  }

  const license = input.licenseNo.trim();

  // Bir xil litsenziya bilan kutayotgan ariza bo'lsa — takrorlanmaydi
  const duplicate = db
    .prepare(`SELECT id FROM clinic_applications WHERE license_no = ? AND status = 'pending'`)
    .get(license);
  if (duplicate) {
    throw conflict('duplicate_application', 'Bu litsenziya bo‘yicha ariza allaqachon ko‘rib chiqilmoqda');
  }

  // Shu litsenziya bilan klinika allaqachon ishlab turgan bo'lishi mumkin
  const existingClinic = db
    .prepare(`SELECT id FROM clinics WHERE license_file_id = ?`)
    .get(license);
  if (existingClinic) {
    throw conflict('clinic_exists', 'Bu litsenziya bo‘yicha klinika allaqachon ro‘yxatdan o‘tgan');
  }

  if (input.ip) {
    const recent = db
      .prepare(
        `SELECT COUNT(*) AS n FROM clinic_applications
          WHERE submitted_ip = ? AND status = 'pending'
            AND created_at >= datetime('now', '-1 day')`,
      )
      .get(input.ip) as { n: number };
    if (recent.n >= MAX_PENDING_PER_IP_PER_DAY) {
      throw badRequest('too_many_applications', 'Bugun juda ko‘p ariza yuborildi. Ertaga urinib ko‘ring.');
    }
  }

  // Fayl HAMMA tekshiruvdan keyin yoziladi — rad etilgan arizadan diskda axlat qolmasin
  const file = storeLicense(input.licenseFile);

  let info;
  try {
    info = db
    .prepare(
      `INSERT INTO clinic_applications
         (name, city_id, address, about, license_no, contact_name, contact_phone,
          contact_email, operation_ids, lab_test_ids, accepts_referral, submitted_ip,
          license_file, license_file_name, license_file_mime, license_file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim().slice(0, 200),
      input.cityId,
      input.address.trim().slice(0, 300),
      input.about.trim().slice(0, 1500),
      license.slice(0, 120),
      input.contactName.trim().slice(0, 120),
      input.contactPhone.trim().slice(0, 40),
      input.contactEmail?.trim()?.slice(0, 160) || null,
      JSON.stringify(input.operationIds.slice(0, 60)),
      JSON.stringify(input.labTestIds.slice(0, 120)),
      input.acceptsReferral ? 1 : 0,
      input.ip,
      file.storage,
      file.name,
      file.mime,
      file.size,
    );
  } catch (err) {
    removeLicense(file.storage);
    throw err;
  }

  return { id: Number(info.lastInsertRowid), status: 'pending' };
}

export function listApplications(status: ApplicationStatus | 'all' = 'pending'): ClinicApplication[] {
  const rows =
    status === 'all'
      ? db.prepare(`SELECT * FROM clinic_applications ORDER BY created_at DESC LIMIT 200`).all()
      : db
          .prepare(`SELECT * FROM clinic_applications WHERE status = ? ORDER BY created_at DESC LIMIT 200`)
          .all(status);
  return (rows as any[]).map(map);
}

export function getApplication(id: number): ClinicApplication {
  const row = db.prepare(`SELECT * FROM clinic_applications WHERE id = ?`).get(id);
  if (!row) throw notFound('Ariza topilmadi');
  return map(row);
}

/**
 * Arizani tasdiqlash: klinika yaratiladi va ulanish kodi beriladi.
 *
 * Klinika `pending` verifikatsiyada qoladi — hujjatlar hali yuklanmagan.
 * Ya'ni tasdiqlash "ariza haqiqiy" degani, "klinika ishlashi mumkin"
 * degani emas. Ikkinchi bosqich — hujjat tekshiruvi — kabinetda bo'ladi.
 */
/**
 * Arizani tasdiqlash.
 *
 * Bu yerda uch narsa bir vaqtda tug'iladi: klinika, uning veb hisobi va
 * parol o'rnatish havolasi. Uchalasi bitta tranzaksiyada — yarim
 * yaratilgan klinika (hisobsiz) yoki egasiz hisob qolib ketmasligi kerak.
 *
 * Vaqtinchalik parol berilmaydi: moderator uni o'ylab topib telefonda
 * aytishi kerak bo'lardi va u yozishmalarda ochiq qolardi. Buning o'rniga
 * klinika o'z parolini o'zi qo'yadi.
 */
export function approveApplication(id: number, moderatorId: number): ClinicApplication {
  const app = getApplication(id);
  if (app.status !== 'pending') throw conflict('already_reviewed', 'Ariza allaqachon ko‘rib chiqilgan');
  if (!app.contactPhone) throw badRequest('no_phone', 'Arizada telefon yo‘q — hisob ochib bo‘lmaydi');

  db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO clinics (name, city_id, address, about, license_file_id, verification, accepts_referral)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(app.name, app.cityId, app.address, app.about, app.licenseNo, app.acceptsReferral ? 1 : 0);

    const clinicId = Number(info.lastInsertRowid);
    const insOp = db.prepare(
      `INSERT OR IGNORE INTO clinic_operations (clinic_id, operation_id) VALUES (?, ?)`,
    );
    for (const opId of app.operationIds) insOp.run(clinicId, opId);

    // Arizadagi tahlillar ham klinikaga ko'chadi — profildan qayta belgilash shart emas
    const insLab = db.prepare(`INSERT OR IGNORE INTO clinic_lab_tests (clinic_id, test_id) VALUES (?, ?)`);
    for (const testId of app.labTestIds) insLab.run(clinicId, testId);

    /*
     * Hisob ARIZADAGI RAQAM bilan ochiladi — o'sha raqamga moderator
     * qo'ng'iroq qilib tekshirgan. Klinika shu raqam bilan kiradi va
     * shu raqam Telegram bilan bog'lanish nuqtasi bo'ladi.
     */
    const { user, setupToken } = createAccount({
      phone: app.contactPhone,
      email: app.contactEmail,
      fullName: app.contactName,
      level: 'clinic_admin',
      clinicId,
    });

    /*
     * Arizadagi litsenziya klinika HUJJATLARIGA ko'chadi — kabinetda
     * "Litsenziya" allaqachon yuklangan bo'lib turadi va klinika uni
     * qayta yuklamaydi. Holati `pending`: ariza tasdig'i "ariza haqiqiy"
     * degani, hujjat tekshiruvi — verifikatsiya bosqichi.
     */
    const raw = db
      .prepare(`SELECT license_file, license_file_name, license_file_mime FROM clinic_applications WHERE id = ?`)
      .get(id) as { license_file: string | null; license_file_name: string | null; license_file_mime: string | null };
    if (raw.license_file) {
      const person = db.prepare(`SELECT id FROM users WHERE telegram_id = ?`).get(-user.id) as { id: number };
      const stored = saveFile({
        ownerId: person.id,
        name: raw.license_file_name || 'litsenziya',
        mimeType: raw.license_file_mime || 'application/pdf',
        kind: 'other',
        label: 'Litsenziya',
        dataBase64: readLicense(raw.license_file).toString('base64'),
      });
      db.prepare(
        `INSERT INTO clinic_documents (clinic_id, kind, label, file_id) VALUES (?, 'license', ?, ?)`,
      ).run(clinicId, `Litsenziya № ${app.licenseNo}`.slice(0, 120), stored.id);
    }

    db.prepare(
      `UPDATE clinic_applications
          SET status = 'approved', clinic_id = ?, connect_code = ?,
              reviewed_by = ?, reviewed_at = datetime('now')
        WHERE id = ?`,
    ).run(clinicId, setupToken, moderatorId, id);
  })();

  return getApplication(id);
}

export function rejectApplication(id: number, moderatorId: number, note: string): ClinicApplication {
  const app = getApplication(id);
  if (app.status !== 'pending') throw conflict('already_reviewed', 'Ariza allaqachon ko‘rib chiqilgan');
  if (!note.trim()) throw badRequest('note_required', 'Rad etish sababini yozing');

  db.prepare(
    `UPDATE clinic_applications
        SET status = 'rejected', note = ?, reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?`,
  ).run(note.trim().slice(0, 500), moderatorId, id);

  return getApplication(id);
}



/**
 * Arizani butunlay o'chirish — spam tozalash uchun.
 *
 * Tasdiqlangan arizani o'chirib bo'lmaydi: undan klinika yaratilgan va
 * o'chirish tarixni yo'qotardi. Faqat kutayotgan yoki rad etilganlar.
 */
export function deleteApplication(id: number): void {
  const app = getApplication(id);
  if (app.status === 'approved') {
    throw conflict('approved_application', 'Tasdiqlangan arizani o‘chirib bo‘lmaydi');
  }
  const raw = db.prepare(`SELECT license_file FROM clinic_applications WHERE id = ?`).get(id) as {
    license_file: string | null;
  };
  db.prepare(`DELETE FROM clinic_applications WHERE id = ?`).run(id);
  removeLicense(raw.license_file);
}

/** Admin uchun: arizadagi litsenziya faylining o'zi */
export function getApplicationLicense(id: number): { buffer: Buffer; name: string; mime: string } {
  const row = db
    .prepare(`SELECT license_file, license_file_name, license_file_mime FROM clinic_applications WHERE id = ?`)
    .get(id) as { license_file: string | null; license_file_name: string | null; license_file_mime: string | null } | undefined;
  if (!row?.license_file) throw notFound('Bu arizada litsenziya fayli yo‘q');
  return {
    buffer: readLicense(row.license_file),
    name: row.license_file_name || 'litsenziya',
    mime: row.license_file_mime || 'application/octet-stream',
  };
}
