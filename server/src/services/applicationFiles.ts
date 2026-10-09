/**
 * Klinika arizasidagi litsenziya fayli.
 *
 * Bu fayl OCHIQ endpoint orqali keladi (arizachida hali hisob yo'q),
 * shuning uchun qoidalar qat'iyroq:
 *   • tur mijoz aytganiga emas, faylning O'ZIGA qarab aniqlanadi
 *     (birinchi baytlar) — `.pdf` deb nomlangan HTML o'tmaydi
 *   • saqlash — alohida yopiq papka, tasodifiy nom; ochiq manzil yo'q,
 *     faqat admin paneli o'qiydi
 *   • bemor hujjatlari (`uploads/`) bilan aralashmaydi
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config';
import { badRequest, notFound } from '../lib/errors';

export const MAX_LICENSE_BYTES = 8 * 1024 * 1024;

const dir = path.resolve(path.dirname(path.resolve(config.db.path)), 'applications');

type Kind = { mime: string; ext: string };

/** Faylning haqiqiy turi — imzo (magic bytes) bo'yicha. Bemor hujjatlari ham shuni ishlatadi */
export function sniff(buf: Buffer): Kind | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  // HEIC/HEIF — iPhone kamerasi
  const brand = buf.subarray(4, 12).toString('latin1');
  if (/^ftyp(heic|heix|heim|heis|hevc|hevx|mif1|msf1)/.test(brand)) return { mime: 'image/heic', ext: 'heic' };
  return null;
}

export interface LicenseUpload {
  name: string;
  dataBase64: string;
}

export interface StoredLicense {
  storage: string;
  name: string;
  mime: string;
  size: number;
}

/**
 * Tekshiradi va diskka yozadi. Bazaga yozish — chaqiruvchining ishi.
 *
 * `label` — xato xabaridagi nom. Shifokor diplomlari ham shu yo'ldan
 * o'tadi: qoidalar bir xil (tur imzo bo'yicha, yopiq papka).
 */
export function storeLicense(input: LicenseUpload, label = 'Litsenziya'): StoredLicense {
  const buffer = Buffer.from(input.dataBase64, 'base64');
  if (!buffer.length) throw badRequest('empty_file', `${label} fayli bo‘sh`);
  if (buffer.length > MAX_LICENSE_BYTES) {
    throw badRequest('file_too_large', `${label} fayli 8 MB dan katta. Rasmni kichikroq qilib yuklang.`);
  }
  const kind = sniff(buffer);
  if (!kind) throw badRequest('unsupported_type', `${label} PDF yoki rasm (JPG, PNG, WEBP, HEIC) bo‘lishi kerak`);

  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  const storage = `${crypto.randomUUID()}.${kind.ext}`;
  fs.writeFileSync(path.join(dir, storage), buffer, { mode: 0o640 });

  // Nom faqat ko'rsatish uchun; yo'l belgilari va boshqaruv belgilari olib tashlanadi
  const name = path.basename(input.name).replace(/[\u0000-\u001f"\\]/g, '').slice(0, 200) || `${label.toLowerCase()}.${kind.ext}`;
  return { storage, name, mime: kind.mime, size: buffer.length };
}

export function readLicense(storage: string): Buffer {
  if (!/^[0-9a-f-]{36}\.(pdf|jpg|png|webp|heic)$/.test(storage)) throw notFound('Fayl topilmadi');
  try {
    return fs.readFileSync(path.join(dir, storage));
  } catch {
    throw notFound('Fayl topilmadi');
  }
}

export function removeLicense(storage: string | null): void {
  if (!storage || !/^[0-9a-f-]{36}\.(pdf|jpg|png|webp|heic)$/.test(storage)) return;
  try {
    fs.unlinkSync(path.join(dir, storage));
  } catch {
    /* allaqachon yo'q */
  }
}
