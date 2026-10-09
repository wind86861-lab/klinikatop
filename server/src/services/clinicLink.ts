/**
 * banisa klinikasini KlinikaTop'ga ulash.
 *
 * ═══ Oqim ═══
 *
 *   banisa paneli → "KlinikaTop'ga ulanish"
 *        ↓ banisa imzolangan bilet beradi (60 s, bir martalik)
 *   /ulanish?ticket=…
 *        ↓ bilet tekshiriladi
 *        ↓ banisa'dan profil va yo'nalishlar olinadi
 *        ↓ klinika yaratiladi yoki mavjudi bog'lanadi
 *   parol qo'yiladi → kabinet
 *
 * Klinika ariza to'ldirmaydi, moderator qo'ng'irog'ini kutmaydi va
 * 104 ta operatsiyadan o'z yo'nalishlarini qaytadan tanlamaydi.
 *
 * ═══ Ishonch ═══
 *
 * banisa `status: APPROVED` bergan klinika bu yerda ham tasdiqlangan
 * hisoblanadi. Litsenziyani ikkinchi marta tekshirish klinikaga
 * ortiqcha ish, bizga esa qo'shimcha ma'lumot bermaydi — banisa
 * o'sha hujjatni allaqachon ko'rgan.
 */
import crypto from 'node:crypto';
import { db, tx } from '../db';
import { config } from '../lib/config';
import { badRequest, conflict, unauthorized } from '../lib/errors';
import { mapClinic } from '../lib/mappers';
import { cleanAddress, cleanPhones, fetchClinicOperations, fetchClinics } from './banisa';
import { matchCity, rememberAlias } from './cityMatch';
import { createAccount, normalizePhone } from './webAuth';
import type { Clinic } from '../../../shared/types';

/** banisa'da shu holatdagi klinika ishlashi mumkin. */
const USABLE_STATUS = 'APPROVED';

export interface LinkTicket {
  clinicId: string;
  userId: string;
  phone: string;
  jti: string;
  exp: number;
}

/**
 * Biletni tekshiradi.
 *
 * Imzo HMAC-SHA256, `LINK_TICKET_SECRET` bilan — bu `JWT_ACCESS_SECRET`
 * emas. Ikki sir alohida bo'lgani uchun biri sizib chiqsa ikkinchisi
 * hali ham himoya qiladi.
 */
export function verifyTicket(raw: string): LinkTicket {
  const secret = config.banisa.linkTicketSecret;
  if (!secret) throw badRequest('link_not_configured', 'Ulanish sozlanmagan');

  const parts = (raw ?? '').split('.');
  if (parts.length !== 3) throw unauthorized('Bilet shakli noto‘g‘ri');

  const [headerB64, payloadB64, signatureB64] = parts;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const presented = Buffer.from(signatureB64, 'base64url');

  if (
    presented.length !== expected.length ||
    !crypto.timingSafeEqual(presented, expected)
  ) {
    throw unauthorized('Bilet imzosi noto‘g‘ri');
  }

  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw unauthorized('Bilet o‘qib bo‘lmadi');
  }

  if (!payload?.clinicId || !payload?.jti) throw unauthorized('Bilet to‘liq emas');

  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
    throw unauthorized('Bilet muddati tugagan. Qaytadan urinib ko‘ring.');
  }

  /*
   * Bir martalik.
   *
   * banisa biletni saqlamaydi — takrorni shu yerda to'xtatamiz.
   * Aks holda bir bilet bilan bir necha marta ulanib, har safar
   * yangi hisob yasash mumkin bo'lardi.
   */
  const used = db.prepare(`SELECT jti FROM used_link_tickets WHERE jti = ?`).get(payload.jti);
  if (used) throw conflict('ticket_used', 'Bu havola allaqachon ishlatilgan');

  db.prepare(
    `INSERT INTO used_link_tickets (jti, expires_at) VALUES (?, datetime(?, 'unixepoch'))`,
  ).run(payload.jti, exp);

  return {
    clinicId: String(payload.clinicId),
    userId: String(payload.userId ?? ''),
    phone: String(payload.phone ?? ''),
    jti: String(payload.jti),
    exp,
  };
}

/**
 * Ikki bosqich orasidagi ichki token.
 *
 * banisa bileti bir martalik va u birinchi bosqichda ishlatiladi.
 * Lekin klinika hali shaharni tasdiqlamagan — ikkinchi so'rov
 * kerak. Uni yangi bilet bilan qilib bo'lmaydi, shuning uchun
 * o'zimiz qisqa muddatli token beramiz.
 *
 * U banisa bileti bilan bir xil ma'lumotni tashiydi va O'Z sirimiz
 * bilan imzolanadi — tashqaridan yasab bo'lmaydi.
 */
const HANDOFF_MINUTES = 15;

export function issueHandoff(ticket: LinkTicket): string {
  const payload = Buffer.from(
    JSON.stringify({
      clinicId: ticket.clinicId,
      userId: ticket.userId,
      phone: ticket.phone,
      exp: Math.floor(Date.now() / 1000) + HANDOFF_MINUTES * 60,
    }),
  ).toString('base64url');

  const sig = crypto
    .createHmac('sha256', handoffSecret())
    .update(payload)
    .digest('base64url');

  return `${payload}.${sig}`;
}

export function readHandoff(raw: string): LinkTicket {
  const [payloadB64, sigB64] = (raw ?? '').split('.');
  if (!payloadB64 || !sigB64) throw unauthorized('Sessiya yaroqsiz');

  const expected = crypto.createHmac('sha256', handoffSecret()).update(payloadB64).digest();
  const presented = Buffer.from(sigB64, 'base64url');

  if (presented.length !== expected.length || !crypto.timingSafeEqual(presented, expected)) {
    throw unauthorized('Sessiya yaroqsiz');
  }

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  if (Number(payload.exp) * 1000 < Date.now()) {
    throw unauthorized('Vaqt tugadi. Ulanishni qaytadan boshlang.');
  }

  return {
    clinicId: String(payload.clinicId),
    userId: String(payload.userId ?? ''),
    phone: String(payload.phone ?? ''),
    jti: '',
    exp: Number(payload.exp),
  };
}

/**
 * Ichki token siri.
 *
 * banisa sirining o'zidan olinadi, lekin boshqa maqsad uchun —
 * shuning uchun aralashtiriladi. Bir xil sir ikki xil imzo uchun
 * ishlatilsa, biri ikkinchisining o'rniga o'tishi mumkin bo'lardi.
 */
function handoffSecret(): string {
  const base = config.banisa.linkTicketSecret;
  if (!base) throw badRequest('link_not_configured', 'Ulanish sozlanmagan');
  return crypto.createHash('sha256').update(`handoff:${base}`).digest('hex');
}

/** Eskirgan biletlarni tozalaydi — rejalashtiruvchi chaqiradi. */
export function purgeUsedTickets(): number {
  return db.prepare(`DELETE FROM used_link_tickets WHERE expires_at <= datetime('now')`).run()
    .changes;
}

export interface LinkPreview {
  /** banisa'dagi klinika */
  externalId: string;
  name: string;
  address: string;
  region: string | null;
  phones: string[];
  licenseNumber: string | null;
  /** Topilgan shahar; `null` bo'lsa klinikadan so'raladi */
  cityId: number | null;
  /** banisa'da yoqilgan, KlinikaTop katalogida mavjud yo'nalishlar */
  operationCount: number;
  /** banisa'da bor, lekin bizda topilmagan — ular tashlab yuboriladi */
  unknownOperations: number;
  /** Allaqachon ulanganmi */
  alreadyLinked: boolean;
}

/**
 * Ulashdan OLDIN nima bo'lishini ko'rsatadi.
 *
 * Klinika tasdiqlash ekranida o'z ma'lumotini ko'radi va shahar
 * topilmagan bo'lsa o'zi tanlaydi.
 */
export async function previewLink(ticket: LinkTicket): Promise<LinkPreview> {
  const [clinic] = await fetchClinics([ticket.clinicId]);
  if (!clinic) throw badRequest('clinic_not_found', 'banisa’da klinika topilmadi');

  if (clinic.status !== USABLE_STATUS) {
    throw conflict(
      'clinic_not_approved',
      'Klinikangiz banisa.uz’da hali tasdiqlanmagan. Avval o‘sha yerda yakunlang.',
    );
  }

  const links = await fetchClinicOperations([ticket.clinicId]);
  const active = links.filter((l) => l.isActive).map((l) => l.operationId);
  const known = countKnownOperations(active);

  const existing = db
    .prepare(`SELECT id FROM clinics WHERE external_id = ?`)
    .get(ticket.clinicId) as { id: number } | undefined;

  return {
    externalId: clinic.id,
    name: clinic.nameUz,
    address: cleanAddress(clinic.addressUz, clinic.region),
    region: clinic.region,
    phones: cleanPhones(clinic.phones),
    licenseNumber: clinic.licenseNumber,
    cityId: matchCity(clinic.region).cityId,
    operationCount: known.length,
    unknownOperations: active.length - known.length,
    alreadyLinked: Boolean(existing),
  };
}

/**
 * Ulashni yakunlaydi.
 *
 * Klinika yaratiladi (yoki mavjudi bog'lanadi), profil ko'chiriladi,
 * yo'nalishlar qo'yiladi va hisob ochiladi.
 */
export async function completeLink(
  ticket: LinkTicket,
  cityId: number,
): Promise<{ clinic: Clinic; setupToken: string | null; accountExists: boolean }> {
  const [source] = await fetchClinics([ticket.clinicId]);
  if (!source) throw badRequest('clinic_not_found', 'banisa’da klinika topilmadi');
  if (source.status !== USABLE_STATUS) {
    throw conflict('clinic_not_approved', 'Klinikangiz banisa.uz’da tasdiqlanmagan');
  }

  const city = db.prepare(`SELECT id FROM cities WHERE id = ?`).get(cityId);
  if (!city) throw badRequest('bad_city', 'Shahar noto‘g‘ri');

  // Klinika o'zi tanlagan shaharni eslab qolamiz — keyingi klinikaga asqotadi
  if (source.region) rememberAlias(source.region, cityId);

  const links = await fetchClinicOperations([ticket.clinicId]);
  const activeIds = links.filter((l) => l.isActive).map((l) => l.operationId);

  const address = cleanAddress(source.addressUz, source.region);
  const phones = cleanPhones(source.phones);

  const clinicId = tx(() => {
    const existing = db
      .prepare(`SELECT id FROM clinics WHERE external_id = ?`)
      .get(ticket.clinicId) as { id: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE clinics
            SET name = ?, city_id = ?, address = ?, phone = ?, logo_url = ?,
                external_synced_at = datetime('now')
          WHERE id = ?`,
      ).run(source.nameUz, cityId, address, phones[0] ?? null, source.logo, existing.id);
      applyOperations(existing.id, activeIds);
      return existing.id;
    }

    /*
     * banisa tasdiqlagan — bu yerda ham tasdiqlangan.
     *
     * Litsenziyani ikkinchi marta so'rash klinikaga ortiqcha ish,
     * bizga esa yangi ma'lumot bermaydi: banisa o'sha hujjatni
     * allaqachon ko'rgan va tekshirgan.
     */
    const info = db
      .prepare(
        `INSERT INTO clinics
           (name, city_id, address, about, phone, logo_url, license_file_id,
            verification, external_id, external_synced_at, accepts_referral)
         VALUES (?, ?, ?, '', ?, ?, ?, 'approved', ?, datetime('now'), 0)`,
      )
      .run(
        source.nameUz,
        cityId,
        address,
        phones[0] ?? null,
        source.logo,
        source.licenseNumber,
        ticket.clinicId,
      );

    const id = Number(info.lastInsertRowid);
    applyOperations(id, activeIds);
    return id;
  });

  const clinic = mapClinic(db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(clinicId));

  /*
   * Hisob ochiladi — klinika parol qo'yib kabinetga kiradi.
   *
   * Raqam biletdan olinadi: uni banisa imzolagan, ya'ni u yerdagi
   * sessiyaga tegishli. Alohida tekshirish kerak emas.
   *
   * Raqam bo'yicha hisob allaqachon bo'lsa (klinika ilgari bu yerga
   * o'zi kelgan bo'lsa), yangisi ochilmaydi — mavjudi klinikaga
   * biriktiriladi.
   */
  const phone = ticket.phone || (phones[0] ?? '');
  if (!phone) {
    return { clinic, setupToken: null, accountExists: false };
  }

  const normalized = normalizePhone(phone);
  const existingAccount = db
    .prepare(`SELECT id, clinic_id, LENGTH(password_hash) AS pwd FROM admin_users WHERE phone = ?`)
    .get(normalized) as { id: number; clinic_id: number | null; pwd: number } | undefined;

  if (existingAccount) {
    if (existingAccount.clinic_id !== clinicId) {
      db.prepare(`UPDATE admin_users SET clinic_id = ? WHERE id = ?`).run(clinicId, existingAccount.id);
      db.prepare(`UPDATE users SET clinic_id = ? WHERE telegram_id = ?`).run(
        clinicId,
        -existingAccount.id,
      );
    }
    // Parol bor bo'lsa kirish sahifasiga, yo'q bo'lsa parol qo'yishga
    return { clinic, setupToken: null, accountExists: existingAccount.pwd > 0 };
  }

  const created = createAccount({
    phone: normalized,
    fullName: source.nameUz,
    level: 'clinic_admin',
    clinicId,
  });

  return { clinic, setupToken: created.setupToken, accountExists: false };
}

/**
 * banisa'dagi yo'nalishlarni qo'yadi.
 *
 * Faqat `source = 'banisa'` qatorlarga tegiladi: klinika bu yerda
 * qo'lda qo'shgan yo'nalish bo'lsa (ulanishdan oldin), u saqlanadi.
 */
function applyOperations(clinicId: number, externalIds: string[]): void {
  const wanted = new Set(resolveOperationIds(externalIds));

  const current = db
    .prepare(`SELECT operation_id FROM clinic_operations WHERE clinic_id = ? AND source = 'banisa'`)
    .all(clinicId) as { operation_id: number }[];

  const remove = db.prepare(
    `DELETE FROM clinic_operations WHERE clinic_id = ? AND operation_id = ? AND source = 'banisa'`,
  );
  for (const row of current) {
    if (!wanted.has(row.operation_id)) remove.run(clinicId, row.operation_id);
  }

  const add = db.prepare(
    `INSERT OR REPLACE INTO clinic_operations (clinic_id, operation_id, source)
     VALUES (?, ?, 'banisa')`,
  );
  for (const opId of wanted) add.run(clinicId, opId);
}

/** banisa operatsiya identifikatorlarini bizdagi raqamlarga o'giradi. */
function resolveOperationIds(externalIds: string[]): number[] {
  if (externalIds.length === 0) return [];

  const placeholders = externalIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id FROM operations
        WHERE external_id IN (${placeholders}) AND source = 'banisa' AND active = 1`,
    )
    .all(...externalIds) as { id: number }[];

  return rows.map((r) => r.id);
}

function countKnownOperations(externalIds: string[]): number[] {
  return resolveOperationIds(externalIds);
}
