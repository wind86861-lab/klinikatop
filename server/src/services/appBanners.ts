/**
 * Bemor ilovasi bosh sahifasidagi bannerlar.
 *
 * Admin rasm yuklaydi, havolani tanlaydi va yoqib-o'chiradi — deploy'siz.
 * Rasmlar sayt rasmlari bilan bir papkada (`site-media`), lekin o'z nomi
 * bilan (`banner-<hex>.<ext>`): nom har yuklashda yangi, shuning uchun
 * brauzer uni uzoq keshlaydi va almashtirilganda eskisini ko'rsatmaydi.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db';
import { config } from '../lib/config';
import { badRequest, notFound } from '../lib/errors';
import { parseYoutubeId } from './siteMedia';
import type { AppBanner, AppBannerVideo } from '../../../shared/types';

/** Telefon ekrani uchun yetarli; og'ir rasm bosh sahifani sekinlashtiradi */
export const MAX_BANNER_BYTES = 2 * 1024 * 1024;
/**
 * Banner videosi — qisqa, ovozsiz, aylanib o'ynaydigan. 8 MB base64 bilan
 * ~11 MB: nginx'ning 12 MB chegarasiga sig'adi. Mobil internetda og'ir
 * bo'lmasligi uchun 5–15 soniya, 720p tavsiya qilinadi.
 */
export const MAX_BANNER_VIDEO_BYTES = 8 * 1024 * 1024;

const MIME: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };
const VIDEO_MIME: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm' };
const dir = () => path.resolve(path.dirname(path.resolve(config.db.path)), 'site-media');
const FILE_RE = /^banner-[0-9a-f]{16}\.(png|webp|jpg|mp4|webm)$/;

function videoOf(r: any): AppBannerVideo | null {
  if (r.video_file) return { kind: 'file', src: `/api/public/banners/${r.video_file}` };
  if (r.video_url?.startsWith('yt:')) return { kind: 'youtube', id: r.video_url.slice(3) };
  if (r.video_url) return { kind: 'link', src: r.video_url };
  return null;
}

function map(r: any): AppBanner {
  return {
    id: r.id,
    titleUz: r.title_uz,
    titleRu: r.title_ru,
    subUz: r.sub_uz ?? null,
    subRu: r.sub_ru ?? null,
    link: r.link,
    imageUrl: r.file_name ? `/api/public/banners/${r.file_name}` : null,
    video: videoOf(r),
    overlay: r.overlay === 1,
    active: r.active === 1,
    sort: r.sort,
  };
}

export function listBanners(): AppBanner[] {
  return (db.prepare(`SELECT * FROM app_banners ORDER BY sort, id`).all() as any[]).map(map);
}

/** Bemorga — faqat yoqilganlari */
export function activeBanners(): AppBanner[] {
  return listBanners().filter((b) => b.active);
}

/**
 * Havola: ilova ichidagi yo'l (`/` bilan, `//` emas) yoki https.
 * `javascript:` va boshqa sxemalar o'tmaydi.
 */
function cleanLink(raw: string): string {
  const s = raw.trim();
  if (/^\/(?!\/)[\w\-./?=&%]*$/.test(s) && s.length <= 200) return s;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:') return u.toString();
  } catch {
    /* pastda xato */
  }
  throw badRequest('bad_link', 'Havola ilova ichidagi manzil (/...) yoki https:// bo‘lsin');
}

function saveImage(mimeType: string, dataBase64: string): string {
  const ext = MIME[mimeType];
  if (!ext) throw badRequest('unsupported_type', 'Rasm JPG, PNG yoki WEBP bo‘lsin');
  const buf = Buffer.from(dataBase64, 'base64');
  if (!buf.length) throw badRequest('empty_file', 'Fayl bo‘sh');
  if (buf.length > MAX_BANNER_BYTES) throw badRequest('file_too_large', 'Rasm 2 MB dan katta — kichikroq qiling');
  fs.mkdirSync(dir(), { recursive: true });
  const name = `banner-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir(), name), buf);
  return name;
}

function saveVideo(mimeType: string, dataBase64: string): string {
  const ext = VIDEO_MIME[mimeType];
  if (!ext) throw badRequest('unsupported_type', 'Video MP4 yoki WEBM bo‘lsin');
  const buf = Buffer.from(dataBase64, 'base64');
  if (!buf.length) throw badRequest('empty_file', 'Fayl bo‘sh');
  if (buf.length > MAX_BANNER_VIDEO_BYTES) {
    throw badRequest('file_too_large', 'Video 8 MB dan katta — qisqaroq yoki 720p qilib siqing');
  }
  fs.mkdirSync(dir(), { recursive: true });
  const name = `banner-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir(), name), buf);
  return name;
}

/**
 * Video havolasi: YouTube (har qanday shakli → `yt:<id>`) yoki
 * to'g'ridan-to'g'ri https .mp4/.webm fayl. Boshqa sahifa havolasi
 * (masalan Instagram) ishlamaydi — u video fayl emas.
 */
function cleanVideoLink(raw: string): string {
  const s = raw.trim();
  const yt = parseYoutubeId(s);
  if (yt) return `yt:${yt}`;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' && /\.(mp4|webm)$/i.test(u.pathname)) return u.toString();
  } catch {
    /* pastda xato */
  }
  throw badRequest('bad_video_link', 'YouTube havolasi yoki https://… .mp4 / .webm fayl havolasini kiriting');
}

function removeFile(name: string | null) {
  if (!name || !FILE_RE.test(name)) return;
  try {
    fs.unlinkSync(path.join(dir(), name));
  } catch {
    /* allaqachon yo'q */
  }
}

export interface BannerInput {
  titleUz?: string;
  titleRu?: string;
  subUz?: string | null;
  subRu?: string | null;
  link?: string;
  active?: boolean;
  /** Yangi rasm */
  mimeType?: string;
  dataBase64?: string;
  /** Rasmni olib tashlash — matnli ko'rinishga qaytadi */
  removeImage?: boolean;
  /** Video fayl — havolani almashtiradi */
  videoMimeType?: string;
  videoBase64?: string;
  /** Video havola (YouTube yoki .mp4) — faylni almashtiradi */
  videoLink?: string;
  /** Videoni butunlay olib tashlash */
  removeVideo?: boolean;
  overlay?: boolean;
}

const text = (v: string | null | undefined, max: number) => (v ?? '').trim().slice(0, max);

export function createBanner(input: BannerInput): AppBanner {
  const titleUz = text(input.titleUz, 80);
  if (!titleUz) throw badRequest('title_required', 'Sarlavhani yozing');
  const link = cleanLink(input.link ?? '/new');
  const file = input.dataBase64 && input.mimeType ? saveImage(input.mimeType, input.dataBase64) : null;
  const sort = ((db.prepare(`SELECT MAX(sort) m FROM app_banners`).get() as { m: number | null }).m ?? 0) + 1;
  const info = db
    .prepare(
      `INSERT INTO app_banners (title_uz, title_ru, sub_uz, sub_ru, link, file_name, active, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      titleUz,
      text(input.titleRu, 80) || titleUz,
      text(input.subUz, 140) || null,
      text(input.subRu, 140) || null,
      link,
      file,
      input.active === false ? 0 : 1,
      sort,
    );
  return map(db.prepare(`SELECT * FROM app_banners WHERE id = ?`).get(info.lastInsertRowid));
}

export function updateBanner(id: number, input: BannerInput): AppBanner {
  const row = db.prepare(`SELECT * FROM app_banners WHERE id = ?`).get(id) as any;
  if (!row) throw notFound('Banner topilmadi');

  const titleUz = input.titleUz !== undefined ? text(input.titleUz, 80) : row.title_uz;
  if (!titleUz) throw badRequest('title_required', 'Sarlavhani yozing');
  const titleRu = input.titleRu !== undefined ? text(input.titleRu, 80) || titleUz : row.title_ru;
  const subUz = input.subUz !== undefined ? text(input.subUz, 140) || null : row.sub_uz;
  const subRu = input.subRu !== undefined ? text(input.subRu, 140) || null : row.sub_ru;
  const link = input.link !== undefined ? cleanLink(input.link) : row.link;
  const active = input.active !== undefined ? (input.active ? 1 : 0) : row.active;

  const overlay = input.overlay !== undefined ? (input.overlay ? 1 : 0) : row.overlay;

  let file: string | null = row.file_name;
  if (input.dataBase64 && input.mimeType) file = saveImage(input.mimeType, input.dataBase64);
  else if (input.removeImage) file = null;

  // Video manbasi bitta: fayl YOKI havola
  let videoFile: string | null = row.video_file;
  let videoUrl: string | null = row.video_url;
  if (input.videoBase64 && input.videoMimeType) {
    videoFile = saveVideo(input.videoMimeType, input.videoBase64);
    videoUrl = null;
  } else if (input.videoLink !== undefined && input.videoLink.trim()) {
    videoUrl = cleanVideoLink(input.videoLink);
    videoFile = null;
  } else if (input.removeVideo) {
    videoFile = null;
    videoUrl = null;
  }

  db.prepare(
    `UPDATE app_banners SET title_uz = ?, title_ru = ?, sub_uz = ?, sub_ru = ?, link = ?, active = ?, file_name = ?,
                            video_file = ?, video_url = ?, overlay = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(titleUz, titleRu, subUz, subRu, link, active, file, videoFile, videoUrl, overlay, id);
  // Eski fayllar faqat baza yangilangandan KEYIN o'chiriladi
  if (file !== row.file_name) removeFile(row.file_name);
  if (videoFile !== row.video_file) removeFile(row.video_file);
  return map(db.prepare(`SELECT * FROM app_banners WHERE id = ?`).get(id));
}

export function deleteBanner(id: number): void {
  const row = db.prepare(`SELECT file_name, video_file FROM app_banners WHERE id = ?`).get(id) as
    | { file_name: string | null; video_file: string | null }
    | undefined;
  if (!row) throw notFound('Banner topilmadi');
  db.prepare(`DELETE FROM app_banners WHERE id = ?`).run(id);
  removeFile(row.file_name);
  removeFile(row.video_file);
}

export function reorderBanners(ids: number[]): AppBanner[] {
  const set = db.prepare(`UPDATE app_banners SET sort = ? WHERE id = ?`);
  db.transaction(() => ids.forEach((id, i) => set.run(i + 1, id)))();
  return listBanners();
}

export function bannerFilePath(name: string): { path: string; mimeType: string } {
  if (!FILE_RE.test(name)) throw notFound('Fayl topilmadi');
  if (!db.prepare(`SELECT 1 FROM app_banners WHERE file_name = ? OR video_file = ?`).get(name, name)) {
    throw notFound('Fayl topilmadi');
  }
  const full = path.join(dir(), name);
  if (!fs.existsSync(full)) throw notFound('Fayl topilmadi');
  const ext = name.split('.').pop()!;
  return { path: full, mimeType: Object.entries({ ...MIME, ...VIDEO_MIME }).find(([, e]) => e === ext)![0] };
}
