/**
 * Tibbiy hujjatlar (UZI, MRT, analiz).
 *
 * Maxfiylik qoidasi (oferta 3-bandi): faylni faqat egasi, so'rovni OLGAN
 * klinika va moderator ko'radi. Taklif tanlangandan keyin ham qolgan
 * klinikalar kirishi yopilmaydi — chunki ular so'rovni allaqachon ko'rgan;
 * lekin yangi klinikalar hech qachon kira olmaydi.
 *
 * Saqlash: diskda, tasodifiy nom bilan. Fayl nomi bemor bergan nomdan
 * olinmaydi — yo'l bo'ylab chiqib ketish (path traversal) imkoni yo'q.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db';
import { config } from '../lib/config';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { sniff } from './applicationFiles';

export const FILE_KINDS = ['uzi', 'mrt', 'analiz', 'xulosa', 'other'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 5;

const uploadDir = path.resolve(path.dirname(path.resolve(config.db.path)), 'uploads');

export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: FileKind;
  label: string | null;
  createdAt: string;
}

function mapFile(row: any): StoredFile {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    kind: row.kind,
    label: row.label ?? null,
    createdAt: new Date(row.created_at.replace(' ', 'T') + 'Z').toISOString(),
  };
}

export interface SaveFileInput {
  ownerId: number;
  name: string;
  mimeType: string;
  kind: FileKind;
  /** "Boshqa" turi tanlanganda bemor yozgan nom */
  label?: string | null;
  /** base64 — mijoz JSON bilan yuboradi, qo'shimcha kutubxona kerak bo'lmaydi */
  dataBase64: string;
}

export function saveFile(input: SaveFileInput): StoredFile {
  if (!ALLOWED_MIME[input.mimeType]) {
    throw badRequest('unsupported_type', 'Faqat rasm (JPG, PNG, WEBP) yoki PDF qabul qilinadi');
  }

  const buffer = Buffer.from(input.dataBase64, 'base64');
  if (buffer.length === 0) throw badRequest('empty_file', 'Fayl bo‘sh');
  if (buffer.length > MAX_FILE_BYTES) {
    throw badRequest('file_too_large', `Fayl ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB dan katta`);
  }

  /*
   * Tur FAYLNING O'ZIDAN aniqlanadi, mijoz aytganidan emas. Ilgari
   * `image/png` deb belgilangan HTML ham saqlanib, klinikaga berilardi.
   * Saqlanadigan tur ham haqiqiysi — telefon kamerasi JPEG'ni boshqa
   * nom bilan yuborsa ham to'g'ri ko'rsatiladi.
   */
  const real = sniff(buffer);
  if (!real || !ALLOWED_MIME[real.mime]) {
    throw badRequest('unsupported_type', 'Fayl rasm (JPG, PNG, WEBP, HEIC) yoki PDF emas');
  }
  const extension = ALLOWED_MIME[real.mime];
  input = { ...input, mimeType: real.mime };

  fs.mkdirSync(uploadDir, { recursive: true });

  // Nom tasodifiy — bemor bergan nom faqat ko'rsatish uchun saqlanadi
  const id = crypto.randomUUID();
  const storageName = `${id}.${extension}`;
  fs.writeFileSync(path.join(uploadDir, storageName), buffer);

  db.prepare(
    `INSERT INTO files (id, owner_id, name, mime_type, size_bytes, kind, label, storage_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ownerId,
    input.name.slice(0, 200),
    input.mimeType,
    buffer.length,
    input.kind,
    input.label?.trim()?.slice(0, 120) || null,
    storageName,
  );

  return mapFile(db.prepare(`SELECT * FROM files WHERE id = ?`).get(id));
}

export function getFileMeta(id: string): StoredFile & { ownerId: number; storagePath: string } {
  const row = db.prepare(`SELECT * FROM files WHERE id = ?`).get(id) as any;
  if (!row) throw notFound('Fayl topilmadi');
  return { ...mapFile(row), ownerId: row.owner_id, storagePath: row.storage_path };
}

export function listFiles(ids: string[]): StoredFile[] {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM files WHERE id IN (${placeholders})`).all(...ids) as any[];
  return rows.map(mapFile);
}

/**
 * Kirish nazorati. Klinika faqat o'ziga YUBORILGAN so'rovdagi faylni ko'radi.
 */
export function assertFileAccess(
  fileId: string,
  userId: number,
  clinicId: number | null,
  isModerator: boolean,
): { storagePath: string; mimeType: string; name: string } {
  const file = getFileMeta(fileId);

  if (file.ownerId === userId || isModerator) {
    return { storagePath: file.storagePath, mimeType: file.mimeType, name: file.name };
  }

  if (clinicId) {
    // Fayl klinikaga yuborilgan so'rovlardan birida ilova qilinganmi
    const linked = db
      .prepare(
        `SELECT 1 FROM requests r
           JOIN request_broadcasts b ON b.request_id = r.id AND b.clinic_id = ?
          WHERE r.attachments LIKE ?
          LIMIT 1`,
      )
      .get(clinicId, `%"${fileId}"%`);
    if (linked) {
      return { storagePath: file.storagePath, mimeType: file.mimeType, name: file.name };
    }
  }

  throw forbidden('Bu hujjat sizga ochiq emas');
}

export function readFile(storagePath: string): Buffer {
  const full = path.join(uploadDir, path.basename(storagePath));
  if (!fs.existsSync(full)) throw notFound('Fayl diskda topilmadi');
  return fs.readFileSync(full);
}

/** So'rovga ilova qilinayotgan fayllar haqiqatan bemorga tegishlimi. */
export function assertOwnedFiles(ids: string[], ownerId: number): void {
  if (!ids.length) return;
  if (ids.length > MAX_FILES_PER_REQUEST) {
    throw badRequest('too_many_files', `Ko‘pi bilan ${MAX_FILES_PER_REQUEST} ta hujjat`);
  }
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id FROM files WHERE id IN (${placeholders}) AND owner_id = ?`)
    .all(...ids, ownerId) as { id: string }[];
  if (rows.length !== ids.length) throw forbidden('Hujjat topilmadi yoki sizga tegishli emas');
}

/**
 * Fayllarni butunlay o'chirish — diskdan ham, bazadan ham.
 *
 * Faqat EGASINING fayllari o'chiriladi. Bu ortiqcha ehtiyot emas:
 * so'rovga birovning fayli biriktirilgan bo'lsa (masalan klinika
 * yuborgan hujjat), uni so'rov bilan birga yo'q qilib yuborish
 * noto'g'ri bo'lardi.
 *
 * Diskdagi fayl topilmasa — jim o'tamiz. Yozuvni o'chirishga bu
 * to'sqinlik qilmasligi kerak: maqsad ma'lumotni yo'q qilish, va
 * fayl allaqachon yo'q bo'lsa maqsadga erishilgan.
 */
export function deleteFiles(ids: string[], ownerId: number): number {
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, storage_path FROM files WHERE id IN (${placeholders}) AND owner_id = ?`)
    .all(...ids, ownerId) as { id: string; storage_path: string }[];

  for (const row of rows) {
    /*
     * `storage_path` — nisbiy fayl nomi, to'liq yo'l emas. `readFile`
     * ham shunday qiladi: `basename` olinadi va `uploadDir` bilan
     * qo'shiladi. Bu bir vaqtning o'zida yo'ldan chiqishning ham
     * oldini oladi — bazada qandaydir `../../etc/passwd` paydo bo'lsa
     * ham u papkadan tashqariga chiqmaydi.
     */
    try {
      fs.unlinkSync(path.join(uploadDir, path.basename(row.storage_path)));
    } catch {
      /* fayl allaqachon yo'q — maqsadga erishilgan */
    }
  }

  const del = db.prepare(`DELETE FROM files WHERE id = ? AND owner_id = ?`);
  for (const row of rows) del.run(row.id, ownerId);

  return rows.length;
}
