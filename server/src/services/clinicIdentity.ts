/**
 * Telefon raqami — klinikaning yagona shaxsi.
 *
 * Klinika egasi uchun bitta raqam uch joyda ishlaydi:
 *
 *   ariza      — moderator shu raqamga qo'ng'iroq qilib tekshiradi
 *   bot        — Telegram raqam egasini o'zi tasdiqlaydi
 *   veb kirish — o'sha raqam va parol
 *
 * Shu sababli alohida SMS tekshiruvi kerak emas: Telegram kontakt
 * ulashganda raqam haqiqatan shu odamniki ekanini kafolatlaydi, biz
 * esa `contact.user_id` ni yuboruvchi bilan solishtiramiz.
 *
 * Bu fayl "shu raqamning klinikadagi holati qanday" degan savolga
 * javob beradi va uni bot ham, veb ham bir xil ishlatadi — ikki joyda
 * ikki xil javob bo'lib qolmasin.
 */
import { db } from '../db';
import { normalizePhone } from './webAuth';

export type ClinicStanding =
  /** Bu raqam bo'yicha hech narsa yo'q */
  | { kind: 'none' }
  /** Ariza yuborilgan, moderator hali ko'rmagan */
  | { kind: 'pending'; applicationId: number; clinicName: string }
  /** Ariza rad etilgan */
  | { kind: 'rejected'; applicationId: number; clinicName: string; note: string | null }
  /** Tasdiqlangan, lekin parol hali qo'yilmagan */
  | { kind: 'needs_password'; accountId: number; clinicId: number; clinicName: string; setupToken: string }
  /** Hammasi tayyor — kabinet ochiladi */
  | { kind: 'ready'; accountId: number; clinicId: number; clinicName: string; verification: string };

/**
 * Raqam bo'yicha klinika holati.
 *
 * Tartib muhim: avval HISOB qaraladi, keyin ariza. Hisob bor bo'lsa
 * ariza allaqachon tasdiqlangan va uning holati eskirgan bo'ladi.
 */
export function clinicStandingByPhone(rawPhone: string): ClinicStanding {
  const phone = normalizePhone(rawPhone);
  if (phone.length < 9) return { kind: 'none' };

  const account = db
    .prepare(
      `SELECT a.id, a.clinic_id, a.password_hash, a.setup_token, a.setup_expires, a.disabled_at,
              c.name AS clinic_name, c.verification
         FROM admin_users a
         LEFT JOIN clinics c ON c.id = a.clinic_id
        WHERE a.phone = ? AND a.clinic_id IS NOT NULL`,
    )
    .get(phone) as any;

  if (account && !account.disabled_at) {
    if (!account.password_hash) {
      /*
       * Parol qo'yilmagan. Sozlash havolasi muddati o'tgan bo'lishi
       * mumkin — u holda yangisini beramiz. Aks holda odam boshi berk
       * ko'chaga tushib, moderatorga qo'ng'iroq qilishi kerak bo'lardi.
       */
      const token = ensureSetupToken(account.id, account.setup_token, account.setup_expires);
      return {
        kind: 'needs_password',
        accountId: account.id,
        clinicId: account.clinic_id,
        clinicName: account.clinic_name ?? '',
        setupToken: token,
      };
    }

    return {
      kind: 'ready',
      accountId: account.id,
      clinicId: account.clinic_id,
      clinicName: account.clinic_name ?? '',
      verification: account.verification ?? 'pending',
    };
  }

  /*
   * Hisob yo'q — ariza bosqichida. Eng SO'NGGI ariza olinadi: rad
   * etilgandan keyin qayta yuborilgan bo'lishi mumkin va odamga eskisi
   * emas, hozirgi holati kerak.
   */
  const application = db
    .prepare(
      `SELECT id, name, status, note FROM clinic_applications
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(contact_phone, '+', ''), ' ', ''), '-', ''), '(', '') LIKE ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(`%${phone.slice(-9)}`) as any;

  if (!application) return { kind: 'none' };

  if (application.status === 'rejected') {
    return {
      kind: 'rejected',
      applicationId: application.id,
      clinicName: application.name,
      note: application.note ?? null,
    };
  }

  return { kind: 'pending', applicationId: application.id, clinicName: application.name };
}

/** Amaldagi sozlash tokeni; muddati o'tgan bo'lsa yangisi yasaladi. */
function ensureSetupToken(
  accountId: number,
  current: string | null,
  expires: string | null,
): string {
  const valid = current && expires && new Date(expires.replace(' ', 'T') + 'Z') > new Date();
  if (valid) return current!;

  const token = randomToken();
  const until = new Date(Date.now() + 7 * 24 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(`UPDATE admin_users SET setup_token = ?, setup_expires = ? WHERE id = ?`).run(
    token,
    until,
    accountId,
  );
  return token;
}

function randomToken(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:crypto').randomBytes(24).toString('base64url');
}

/** Telegram foydalanuvchisining saqlangan raqami. */
export function phoneOfTelegramUser(userId: number): string | null {
  const row = db.prepare(`SELECT phone FROM users WHERE id = ?`).get(userId) as
    | { phone: string | null }
    | undefined;
  return row?.phone ?? null;
}
