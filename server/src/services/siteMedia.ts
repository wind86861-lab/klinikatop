/**
 * Ochiq sayt media — admin yuklaydigan rasmlar va YouTube videolar.
 *
 * Bemor hujjatlaridan (`files.ts`) butunlay ALOHIDA: bular ochiq,
 * internetdagi har kim ko'radi. Aralashtirilsa, bir kun tibbiy hujjat
 * ochiq manzilga tushib qolishi mumkin edi. Shuning uchun alohida
 * jadval, alohida papka, alohida marshrut.
 *
 * Qoidalar:
 *   • faqat ro'yxatdagi kalitlar (`shared/siteMedia.ts`) — ixtiyoriy nom yo'q
 *   • faqat rasm (JPG, PNG, WEBP, SVG emas — SVG ichida skript bo'lishi mumkin)
 *   • fayl nomi kalit + tasodifiy qism: eski nusxa keshda qolmaydi
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db';
import { config } from '../lib/config';
import { badRequest, notFound } from '../lib/errors';
import {
  SITE_MEDIA_KEYS,
  SITE_MEDIA_SLOTS,
  type SiteMediaItem,
} from '../../../shared/siteMedia';

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Takrorlanuvchi fon video — faqat shu formatlar */
const ALLOWED_VIDEO: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** Sayt rasmi og'ir bo'lmasin — sahifa tezligi SEO'ga ta'sir qiladi */
export const MAX_SITE_IMAGE_BYTES = 3 * 1024 * 1024;
/**
 * Fon video. 8 MB — base64 bilan ~11 MB, nginx'ning 12 MB chegarasiga
 * sig'adi. 10–20 soniyalik ovozsiz H.264 1080p uchun yetarli.
 */
export const MAX_SITE_VIDEO_BYTES = 8 * 1024 * 1024;
/** Admin yo'lidagi tana chegarasi shundan hisoblanadi */
export const MAX_SITE_UPLOAD_BYTES = MAX_SITE_VIDEO_BYTES;

const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries({ ...ALLOWED, ...ALLOWED_VIDEO, 'image/svg+xml': 'svg' }).map(([mime, ext]) => [ext, mime]),
);

/**
 * SVG — bu XML hujjat va ichida skript bo'lishi mumkin. Saytda u <img>
 * orqali ko'rsatiladi (u yerda skript ishlamaydi), lekin fayl manzili
 * to'g'ridan-to'g'ri ochilsa ishlashi mumkin edi. Shuning uchun skript,
 * hodisa atributlari, tashqi havolalar va ichki HTML rad etiladi.
 */
function assertSafeSvg(buffer: Buffer): void {
  const text = buffer.toString('utf8');
  if (!/<svg[\s>]/i.test(text)) throw badRequest('bad_svg', 'Fayl SVG emas');
  if (
    /<script/i.test(text) ||
    /\son[a-z]+\s*=/i.test(text) ||
    /<foreignObject/i.test(text) ||
    /javascript:/i.test(text) ||
    /(href|src)\s*=\s*["']\s*(https?:)?\/\//i.test(text) ||
    /<!ENTITY/i.test(text)
  ) {
    throw badRequest('unsafe_svg', 'SVG ichida skript yoki tashqi havola bor — boshqa faylni yuklang (yoki PNG)');
  }
}

const dir = path.resolve(path.dirname(path.resolve(config.db.path)), 'site-media');

/** Ochiq manzil. Nom o'zi versiya — shuning uchun uzoq keshlanadi. */
const publicUrl = (file: string) => `/api/public/media/${file}`;

interface Row {
  key: string;
  kind: 'image' | 'youtube';
  file_name: string | null;
  youtube_id: string | null;
  alt_uz: string;
  alt_ru: string;
  updated_at: string;
}

function map(row: Row): SiteMediaItem {
  /*
   * Bazada fayl turlari (rasm ham, video ham) `kind = 'image'` bo'lib
   * yoziladi — jadvaldagi CHECK faqat 'image'/'youtube' ni biladi va uni
   * o'zgartirish jadvalni qayta qurishni talab qilardi. Haqiqiy tur
   * joylar ro'yxatidan olinadi.
   */
  const slotKind = SITE_MEDIA_SLOTS.find((s) => s.key === row.key)?.kind;
  return {
    key: row.key,
    kind: row.kind === 'youtube' ? 'youtube' : slotKind === 'video' ? 'video' : 'image',
    url: row.file_name ? publicUrl(row.file_name) : null,
    youtubeId: row.youtube_id,
    altUz: row.alt_uz,
    altRu: row.alt_ru,
    updatedAt: new Date(row.updated_at.replace(' ', 'T') + 'Z').toISOString(),
  };
}

function slotOf(key: string) {
  if (!SITE_MEDIA_KEYS.has(key)) throw notFound('Bunday media joyi yo‘q');
  return SITE_MEDIA_SLOTS.find((s) => s.key === key)!;
}

export function listSiteMedia(): SiteMediaItem[] {
  return (db.prepare(`SELECT * FROM site_media`).all() as Row[]).map(map);
}

/** Sayt uchun: faqat to'ldirilganlari, kalit bo'yicha */
export function publicSiteMedia(): Record<string, SiteMediaItem> {
  const out: Record<string, SiteMediaItem> = {};
  for (const item of listSiteMedia()) {
    if (item.url || item.youtubeId) out[item.key] = item;
  }
  return out;
}

function removeFile(name: string | null) {
  if (!name) return;
  try {
    fs.unlinkSync(path.join(dir, path.basename(name)));
  } catch {
    /* allaqachon yo'q — muhim emas */
  }
}

function current(key: string): Row | undefined {
  return db.prepare(`SELECT * FROM site_media WHERE key = ?`).get(key) as Row | undefined;
}

export function setSiteImage(
  key: string,
  input: { mimeType: string; dataBase64: string; altUz: string; altRu: string },
): SiteMediaItem {
  const slot = slotOf(key);
  if (slot.kind === 'youtube') throw badRequest('wrong_kind', 'Bu joyga YouTube havolasi qo‘yiladi');
  const isVideo = slot.kind === 'video';

  const allowed = isVideo ? ALLOWED_VIDEO : slot.svg ? { ...ALLOWED, 'image/svg+xml': 'svg' } : ALLOWED;
  const ext = allowed[input.mimeType];
  if (!ext) {
    throw badRequest(
      'unsupported_type',
      isVideo ? 'Faqat MP4 yoki WEBM video' : slot.svg ? 'Faqat SVG, PNG, WEBP yoki JPG' : 'Faqat JPG, PNG, WEBP yoki AVIF',
    );
  }

  const buffer = Buffer.from(input.dataBase64, 'base64');
  if (!buffer.length) throw badRequest('empty_file', 'Fayl bo‘sh');
  if (ext === 'svg') assertSafeSvg(buffer);
  if (isVideo && buffer.length > MAX_SITE_VIDEO_BYTES) {
    throw badRequest('file_too_large', 'Video 8 MB dan katta. Qisqaroq qiling yoki siqib yuklang — sahifa tezroq ochiladi.');
  }
  if (!isVideo && buffer.length > MAX_SITE_IMAGE_BYTES) {
    throw badRequest('file_too_large', 'Rasm 3 MB dan katta. WEBP formatida siqib yuklang — sayt tezroq ochiladi.');
  }

  fs.mkdirSync(dir, { recursive: true });
  const name = `${key}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);

  const before = current(key);
  db.prepare(
    `INSERT INTO site_media (key, kind, file_name, youtube_id, alt_uz, alt_ru, updated_at)
     VALUES (?, 'image', ?, NULL, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       kind = 'image', file_name = excluded.file_name, youtube_id = NULL,
       alt_uz = excluded.alt_uz, alt_ru = excluded.alt_ru, updated_at = excluded.updated_at`,
  ).run(key, name, input.altUz.trim(), input.altRu.trim());
  removeFile(before?.file_name ?? null);

  return map(current(key)!);
}

/**
 * YouTube havolasidan ID ajratiladi. Qabul qilinadi:
 * youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, /shorts/ID yoki shunchaki ID.
 */
export function parseYoutubeId(raw: string): string | null {
  const s = raw.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return /^[A-Za-z0-9_-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* URL emas */
  }
  return null;
}

export function setSiteVideo(key: string, input: { url: string; altUz: string; altRu: string }): SiteMediaItem {
  const slot = slotOf(key);
  if (slot.kind !== 'youtube') throw badRequest('wrong_kind', 'Bu joyga rasm yuklanadi');

  const id = parseYoutubeId(input.url);
  if (!id) throw badRequest('bad_youtube', 'YouTube havolasini tanib bo‘lmadi');

  db.prepare(
    `INSERT INTO site_media (key, kind, file_name, youtube_id, alt_uz, alt_ru, updated_at)
     VALUES (?, 'youtube', NULL, ?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       kind = 'youtube', file_name = NULL, youtube_id = excluded.youtube_id,
       alt_uz = excluded.alt_uz, alt_ru = excluded.alt_ru, updated_at = excluded.updated_at`,
  ).run(key, id, input.altUz.trim(), input.altRu.trim());

  return map(current(key)!);
}

export function clearSiteMedia(key: string): void {
  slotOf(key);
  const before = current(key);
  db.prepare(`DELETE FROM site_media WHERE key = ?`).run(key);
  removeFile(before?.file_name ?? null);
}

/**
 * Ochiq faylni o'qish. Nom qat'iy shaklda bo'lishi va bazada
 * turishi SHART — diskdagi boshqa hech narsa berilmaydi.
 */
export function readSiteMediaFile(name: string): { buffer: Buffer; mimeType: string } {
  const file = siteMediaFilePath(name);
  try {
    return { buffer: fs.readFileSync(file.path), mimeType: file.mimeType };
  } catch {
    throw notFound('Fayl topilmadi');
  }
}

/**
 * Ochiq faylning diskdagi yo'li — `res.sendFile` uchun. Video uchun bu
 * SHART: brauzer (ayniqsa Safari) videoni bo'laklab (Range) so'raydi,
 * `sendFile` buni o'zi qo'llab-quvvatlaydi.
 */
export function siteMediaFilePath(name: string): { path: string; mimeType: string } {
  if (!/^[a-z0-9-]+-[0-9a-f]{12}\.(jpg|png|webp|avif|mp4|webm|svg)$/.test(name)) throw notFound('Fayl topilmadi');
  const row = db.prepare(`SELECT 1 FROM site_media WHERE file_name = ?`).get(name);
  if (!row) throw notFound('Fayl topilmadi');
  const full = path.join(dir, name);
  if (!fs.existsSync(full)) throw notFound('Fayl topilmadi');
  return { path: full, mimeType: EXT_MIME[name.split('.').pop()!] };
}
