/**
 * AI kalitlari — bir nechta, zaxira bilan.
 *
 * Nima uchun: prodda Gemini 503 "high demand" qaytardi va butun AI
 * lokal heuristikaga tushdi. O'sha paytdagi so'rovlar operatsiyasiz
 * va sohasiz ketdi — bitta provayderning vaqtinchalik yuklamasi
 * mahsulotning asosiy qismini o'chirardi.
 *
 * Kalitlar bazada, chunki yangi kalit qo'shish uchun deploy kutish
 * noto'g'ri: kalit tugagan payt aynan shoshilinch payt bo'ladi.
 *
 * Kalitning O'ZI hech qachon mijozga qaytarilmaydi.
 */
import { db } from '../db';
import { badRequest, notFound } from '../lib/errors';
import { config } from '../lib/config';

export type AiKeyProvider = 'gemini' | 'anthropic';

export interface AiKeyRow {
  id: number;
  provider: AiKeyProvider;
  label: string | null;
  /** Niqoblangan ko'rinish — to'liq kalit hech qachon chiqmaydi */
  masked: string;
  active: boolean;
  position: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastOkAt: string | null;
  createdAt: string;
}

/**
 * Kalitni niqoblash.
 *
 * Boshi va oxiri ko'rsatiladi: admin qaysi kalit ekanini tanishi
 * kerak, lekin uni nusxalab ola bilmasligi kerak.
 */
export function maskKey(key: string): string {
  if (key.length <= 10) return '•'.repeat(key.length);
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function mapRow(r: any): AiKeyRow {
  return {
    id: r.id,
    provider: r.provider,
    label: r.label ?? null,
    masked: maskKey(r.api_key),
    active: r.active === 1,
    position: r.position,
    lastError: r.last_error ?? null,
    lastErrorAt: r.last_error_at ?? null,
    lastOkAt: r.last_ok_at ?? null,
    createdAt: r.created_at,
  };
}

export function listAiKeys(): AiKeyRow[] {
  return (
    db.prepare(`SELECT * FROM ai_keys ORDER BY provider, position, id`).all() as any[]
  ).map(mapRow);
}

/**
 * Sinash uchun tartiblangan kalitlar.
 *
 * Muhit sozlamasidagi kalit ham qo'shiladi — ENG OXIRIDA. Shunda
 * bazada kalit bo'lmasa ham tizim ishlaydi, bor bo'lsa admin
 * qo'ygani ustun turadi.
 */
export function keysToTry(provider: AiKeyProvider): string[] {
  const rows = db
    .prepare(`SELECT api_key FROM ai_keys WHERE provider = ? AND active = 1 ORDER BY position, id`)
    .all(provider) as { api_key: string }[];

  const envKey = provider === 'gemini' ? config.ai.geminiKey : config.ai.apiKey;
  const out = rows.map((r) => r.api_key);
  if (envKey && !out.includes(envKey)) out.push(envKey);
  return out;
}

export function addAiKey(input: {
  provider: AiKeyProvider;
  apiKey: string;
  label: string | null;
}): AiKeyRow[] {
  const key = input.apiKey.trim();
  if (key.length < 12) throw badRequest('bad_key', 'Kalit juda qisqa');

  const exists = db.prepare(`SELECT id FROM ai_keys WHERE api_key = ?`).get(key);
  if (exists) throw badRequest('key_exists', 'Bu kalit allaqachon qo‘shilgan');

  const next = db
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM ai_keys WHERE provider = ?`)
    .get(input.provider) as { n: number };

  db.prepare(
    `INSERT INTO ai_keys (provider, api_key, label, position) VALUES (?, ?, ?, ?)`,
  ).run(input.provider, key, input.label?.trim().slice(0, 60) || null, next.n);

  return listAiKeys();
}

export function setAiKeyActive(id: number, active: boolean): AiKeyRow[] {
  const row = db.prepare(`SELECT id FROM ai_keys WHERE id = ?`).get(id);
  if (!row) throw notFound('Kalit topilmadi');
  db.prepare(`UPDATE ai_keys SET active = ? WHERE id = ?`).run(active ? 1 : 0, id);
  return listAiKeys();
}

export function deleteAiKey(id: number): AiKeyRow[] {
  db.prepare(`DELETE FROM ai_keys WHERE id = ?`).run(id);
  return listAiKeys();
}

/**
 * Kalit ishlagani yoki ishlamagani belgilanadi.
 *
 * Admin panelida "qaysi kalit tushib qolgan" degan savolga javob
 * shu yerdan chiqadi — aks holda u faqat jurnalda qolardi.
 */
export function markKeyResult(apiKey: string, error: string | null): void {
  if (error) {
    db.prepare(
      `UPDATE ai_keys SET last_error = ?, last_error_at = datetime('now') WHERE api_key = ?`,
    ).run(error.slice(0, 300), apiKey);
  } else {
    db.prepare(
      `UPDATE ai_keys SET last_ok_at = datetime('now'), last_error = NULL WHERE api_key = ?`,
    ).run(apiKey);
  }
}
