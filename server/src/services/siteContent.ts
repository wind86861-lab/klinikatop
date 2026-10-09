/**
 * Ochiq sayt — matnlar, hamkorlar va sahifani SERVERDA to'ldirish.
 *
 * ── Nega serverda ──
 *
 * Sayt statik HTML (SEO). Ilgari admin o'zgartirgan narsa faqat
 * brauzerda, JS bilan qo'yilardi: Google eski matnni ko'rardi, sahifa
 * ochilganda eski matn bir lahza chaqnab o'tardi, matnni esa umuman
 * o'zgartirib bo'lmasdi. Endi build chiqargan HTML — SHABLON: server
 * uni o'qiydi, admin o'zgartirgan matnlarni, rasmlar ro'yxatini va
 * hamkorlarni qo'yib beradi. Qayta build kerak emas, saqlash — darhol.
 *
 * ── Matn qanday almashtiriladi ──
 *
 * Komponentlarga tegilmaydi. Build `site-content/defaults.json` ni
 * chiqaradi (kalit → asl matn). Server HTML'da asl matn turgan joyni
 * topib, yangisini qo'yadi — faqat TO'LIQ matn tugunida (`>matn<`) yoki
 * to'liq atributda (`"matn"`). Shuning uchun "Kirish" so'zi "Kirish va
 * ro'yxatdan o'tish" ichida buzilmaydi.
 *
 * Bir xil asl matn bir necha joyda bo'lsa, u admin'da BITTA maydon
 * (hamma joyda birga o'zgaradi) — aks holda qaysi biri o'zgargani
 * noaniq bo'lardi.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db';
import { config } from '../lib/config';
import { badRequest, notFound } from '../lib/errors';
import { publicSiteMedia } from './siteMedia';

export type SiteLang = 'uz' | 'ru';

/* ═════════════════  Sahifalar  ═════════════════ */

/** Server to'ldiradigan sahifalar. Qolgani (ilova, kabinet) — oddiy statik. */
export const SITE_PAGES: { path: string; file: string; lang: SiteLang; group: string }[] = [
  { path: '/', file: 'index.html', lang: 'uz', group: 'home' },
  { path: '/ru/', file: 'ru/index.html', lang: 'ru', group: 'home' },
  { path: '/klinikalar-uchun/', file: 'klinikalar-uchun/index.html', lang: 'uz', group: 'clinics' },
  { path: '/ru/dlya-klinik/', file: 'ru/dlya-klinik/index.html', lang: 'ru', group: 'clinics' },
  { path: '/royxatdan-otish/', file: 'royxatdan-otish/index.html', lang: 'uz', group: 'auth' },
  { path: '/ru/registratsiya/', file: 'ru/registratsiya/index.html', lang: 'ru', group: 'auth' },
  { path: '/kirish/', file: 'kirish/index.html', lang: 'uz', group: 'login' },
  { path: '/ru/vkhod/', file: 'ru/vkhod/index.html', lang: 'ru', group: 'login' },
];

export function pageFor(urlPath: string) {
  const p = urlPath.endsWith('/') ? urlPath : `${urlPath}/`;
  return SITE_PAGES.find((x) => x.path === p) ?? null;
}

/* ═════════════════  Asl matnlar  ═════════════════ */

type Defaults = Record<SiteLang, Record<string, string>>;
let defaultsCache: { mtime: number; value: Defaults } | null = null;

function loadDefaults(): Defaults {
  const file = path.join(config.site.root, 'site-content', 'defaults.json');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return { uz: {}, ru: {} };
  }
  if (defaultsCache && defaultsCache.mtime === stat.mtimeMs) return defaultsCache.value;
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Defaults;
  defaultsCache = { mtime: stat.mtimeMs, value };
  return value;
}

/** Juda qisqa qiymatlar ("0", "5%") tahrirlanmaydi — ular boshqa joylarga ham urilardi */
const MIN_EDITABLE = 3;

function overridesFor(lang: SiteLang): Map<string, string> {
  const rows = db.prepare(`SELECT key, value FROM site_texts WHERE lang = ?`).all(lang) as { key: string; value: string }[];
  return new Map(rows.map((r) => [r.key, r.value]));
}

export interface SiteTextEntry {
  /** Guruhdagi birinchi kalit — tahrirlash identifikatori */
  id: string;
  keys: string[];
  /** Qaysi sahifada: home | clinics | auth | login | common */
  page: string;
  default: string;
  value: string | null;
}

const pageOfKey = (key: string) => {
  const top = key.split('.')[0];
  return ['home', 'clinics', 'auth', 'login'].includes(top) ? top : 'common';
};

/** Admin tahrirlovchisi uchun: bir xil asl matnli kalitlar bitta maydon */
export function listSiteTexts(lang: SiteLang): SiteTextEntry[] {
  const defaults = loadDefaults()[lang] ?? {};
  const overrides = overridesFor(lang);
  const byValue = new Map<string, SiteTextEntry>();
  for (const [key, def] of Object.entries(defaults)) {
    if (def.trim().length < MIN_EDITABLE) continue;
    const entry = byValue.get(def);
    if (entry) {
      entry.keys.push(key);
    } else {
      byValue.set(def, { id: key, keys: [key], page: pageOfKey(key), default: def, value: overrides.get(key) ?? null });
    }
  }
  return [...byValue.values()];
}

/** Matnni saqlash; `null` — asl holiga qaytarish. Guruhdagi hamma kalit birga. */
export function setSiteText(lang: SiteLang, id: string, value: string | null): void {
  const defaults = loadDefaults()[lang] ?? {};
  const def = defaults[id];
  if (def === undefined) throw notFound('Bunday matn yo‘q');
  const keys = Object.entries(defaults)
    .filter(([, v]) => v === def)
    .map(([k]) => k);

  const clean = value?.replace(/\r\n/g, '\n').trim() ?? null;
  if (clean !== null && clean.length === 0) throw badRequest('empty_text', 'Matn bo‘sh bo‘lmasin. Asl holiga qaytarish uchun "Asl matn" tugmasini bosing.');
  if (clean !== null && clean.length > 2000) throw badRequest('text_too_long', 'Matn juda uzun (2000 belgigacha)');

  const tx = db.transaction(() => {
    const del = db.prepare(`DELETE FROM site_texts WHERE lang = ? AND key = ?`);
    const ins = db.prepare(
      `INSERT INTO site_texts (lang, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(lang, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    for (const k of keys) {
      if (clean === null || clean === def) del.run(lang, k);
      else ins.run(lang, k, clean);
    }
  });
  tx();
  invalidateSite();
}

/* ═════════════════  Hamkorlar  ═════════════════ */

const partnerDir = () => path.resolve(path.dirname(path.resolve(config.db.path)), 'site-media');

const LOGO_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
};
/** SVG faqat <img> ichida ko'rsatiladi — u yerda skript ishlamaydi */
export const MAX_LOGO_BYTES = 1024 * 1024;

export interface SitePartner {
  id: number;
  name: string;
  url: string | null;
  logoUrl: string;
  sort: number;
}

function mapPartner(r: any): SitePartner {
  return { id: r.id, name: r.name, url: r.url ?? null, logoUrl: `/api/public/partners/${r.file_name}`, sort: r.sort };
}

export function listPartners(): SitePartner[] {
  return (db.prepare(`SELECT * FROM site_partners ORDER BY sort, id`).all() as any[]).map(mapPartner);
}

function cleanUrl(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
    return u.toString();
  } catch {
    throw badRequest('bad_url', 'Havola noto‘g‘ri');
  }
}

function saveLogo(mimeType: string, dataBase64: string): string {
  const ext = LOGO_MIME[mimeType];
  if (!ext) throw badRequest('unsupported_type', 'Logo PNG, WEBP, JPG yoki SVG bo‘lsin');
  const buf = Buffer.from(dataBase64, 'base64');
  if (!buf.length) throw badRequest('empty_file', 'Fayl bo‘sh');
  if (buf.length > MAX_LOGO_BYTES) throw badRequest('file_too_large', 'Logo 1 MB dan katta');
  fs.mkdirSync(partnerDir(), { recursive: true });
  const name = `partner-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(partnerDir(), name), buf);
  return name;
}

export function addPartner(input: { name: string; url?: string | null; mimeType: string; dataBase64: string }): SitePartner {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw badRequest('name_required', 'Hamkor nomini yozing');
  const url = cleanUrl(input.url);
  const file = saveLogo(input.mimeType, input.dataBase64);
  const sort = ((db.prepare(`SELECT MAX(sort) m FROM site_partners`).get() as { m: number | null }).m ?? 0) + 1;
  const info = db.prepare(`INSERT INTO site_partners (name, url, file_name, sort) VALUES (?, ?, ?, ?)`).run(name, url, file, sort);
  invalidateSite();
  return mapPartner(db.prepare(`SELECT * FROM site_partners WHERE id = ?`).get(info.lastInsertRowid));
}

export function updatePartner(
  id: number,
  input: { name?: string; url?: string | null; mimeType?: string; dataBase64?: string },
): SitePartner {
  const row = db.prepare(`SELECT * FROM site_partners WHERE id = ?`).get(id) as any;
  if (!row) throw notFound('Hamkor topilmadi');
  const name = input.name !== undefined ? input.name.trim().slice(0, 120) : row.name;
  if (!name) throw badRequest('name_required', 'Hamkor nomini yozing');
  const url = input.url !== undefined ? cleanUrl(input.url) : row.url;
  let file = row.file_name;
  if (input.dataBase64 && input.mimeType) {
    file = saveLogo(input.mimeType, input.dataBase64);
    removePartnerFile(row.file_name);
  }
  db.prepare(`UPDATE site_partners SET name = ?, url = ?, file_name = ? WHERE id = ?`).run(name, url, file, id);
  invalidateSite();
  return mapPartner(db.prepare(`SELECT * FROM site_partners WHERE id = ?`).get(id));
}

function removePartnerFile(name: string) {
  try {
    fs.unlinkSync(path.join(partnerDir(), path.basename(name)));
  } catch {
    /* allaqachon yo'q */
  }
}

export function deletePartner(id: number): void {
  const row = db.prepare(`SELECT file_name FROM site_partners WHERE id = ?`).get(id) as { file_name: string } | undefined;
  if (!row) throw notFound('Hamkor topilmadi');
  db.prepare(`DELETE FROM site_partners WHERE id = ?`).run(id);
  removePartnerFile(row.file_name);
  invalidateSite();
}

/** Tartib: berilgan id'lar ketma-ketligi */
export function reorderPartners(ids: number[]): SitePartner[] {
  const set = db.prepare(`UPDATE site_partners SET sort = ? WHERE id = ?`);
  db.transaction(() => ids.forEach((id, i) => set.run(i + 1, id)))();
  invalidateSite();
  return listPartners();
}

export function partnerFilePath(name: string): { path: string; mimeType: string } {
  if (!/^partner-[0-9a-f]{16}\.(png|webp|jpg|svg)$/.test(name)) throw notFound('Fayl topilmadi');
  if (!db.prepare(`SELECT 1 FROM site_partners WHERE file_name = ?`).get(name)) throw notFound('Fayl topilmadi');
  const full = path.join(partnerDir(), name);
  if (!fs.existsSync(full)) throw notFound('Fayl topilmadi');
  const ext = name.split('.').pop()!;
  const mimeType = Object.entries(LOGO_MIME).find(([, e]) => e === ext)![0];
  return { path: full, mimeType };
}

/* ═════════════════  Sahifani to'ldirish  ═════════════════ */

let version = 0;
const rendered = new Map<string, { version: number; mtime: number; html: string }>();

/** Matn, media yoki hamkor o'zgarganda — keyingi so'rov yangidan quriladi */
export function invalidateSite(): void {
  version++;
}

/** Astro'ning HTML escape qoidasi bilan bir xil — asl matnni shablonda topish uchun */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function applyTexts(html: string, lang: SiteLang): string {
  const defaults = loadDefaults()[lang] ?? {};
  const overrides = overridesFor(lang);
  // Uzunlari avval — qisqa matn uzunning bo'lagi bo'lib qolmasin
  const pairs = [...overrides.entries()]
    .map(([k, v]) => [defaults[k], v] as const)
    .filter(([d, v]) => d && d.trim().length >= MIN_EDITABLE && d !== v)
    .sort((a, b) => b[0].length - a[0].length);

  const seen = new Set<string>();
  for (const [def, value] of pairs) {
    if (seen.has(def)) continue;
    seen.add(def);
    const from = esc(def);
    const to = esc(value).replace(/\n/g, '<br>');
    const toAttr = esc(value.replace(/\n/g, ' '));
    // To'liq matn tuguni (atrofida faqat bo'shliq) va to'liq atribut qiymati
    html = html
      .replace(new RegExp(`(>\\s*)${reEsc(from)}(\\s*<)`, 'g'), (_m, a, b) => `${a}${to}${b}`)
      .replace(new RegExp(`(=")${reEsc(from)}(")`, 'g'), (_m, a, b) => `${a}${toAttr}${b}`);
  }
  return html;
}

function applyPartners(html: string): string {
  const partners = listPartners();
  if (!partners.length) return html;
  const item = (p: SitePartner) => {
    const img = `<img src="${esc(p.logoUrl)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`;
    return p.url
      ? `<a class="partner" href="${esc(p.url)}" target="_blank" rel="noopener nofollow" title="${esc(p.name)}">${img}</a>`
      : `<span class="partner" title="${esc(p.name)}">${img}</span>`;
  };
  // Yuguruvchi lenta uzluksiz bo'lishi uchun ro'yxat ikki marta
  const items = partners.map(item).join('');
  return html.replace(/(<div[^>]*data-partners[^>]*>)(<\/div>)/, `$1${items}${items}$2`);
}

/**
 * Logo va favicon — admin yuklagan bo'lsa, saytning HAMMA joyida.
 * To'q fon uchun alohida logo bo'lmasa, asosiy logo ishlatiladi.
 */
function applyLogo(html: string, media: ReturnType<typeof publicSiteMedia>): string {
  const main = media['logo']?.url;
  const light = media['logo-light']?.url ?? main;
  if (main) {
    html = html.split('src="/logo.svg"').join(`src="${esc(main)}"`);
    const type = main.endsWith('.svg') ? 'image/svg+xml' : main.endsWith('.png') ? 'image/png' : 'image/webp';
    html = html.replace('<link rel="icon" href="/favicon.svg" type="image/svg+xml">', `<link rel="icon" href="${esc(main)}" type="${type}">`);
  }
  if (light) html = html.split('src="/logo-light.svg"').join(`src="${esc(light)}"`);
  return html;
}

/** Media ro'yxati sahifaga ichida — alohida so'rov va kechikish yo'q */
function applyMedia(html: string): string {
  const json = JSON.stringify(publicSiteMedia()).replace(/</g, '\\u003c');
  return html.replace('</head>', `<script>window.__KT_MEDIA__=${json}</script></head>`);
}

export function renderSitePage(urlPath: string): string {
  const page = pageFor(urlPath);
  if (!page) throw notFound('Sahifa topilmadi');
  const file = path.join(config.site.root, page.file);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw notFound('Sahifa topilmadi');
  }
  const cached = rendered.get(page.path);
  if (cached && cached.version === version && cached.mtime === stat.mtimeMs) return cached.html;

  let html = fs.readFileSync(file, 'utf8');
  html = applyTexts(html, page.lang);
  html = applyPartners(html);
  html = applyLogo(html, publicSiteMedia());
  html = applyMedia(html);
  rendered.set(page.path, { version, mtime: stat.mtimeMs, html });
  return html;
}
