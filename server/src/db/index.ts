import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config';
import { runMigrations } from './migrations';

const dbPath = path.resolve(config.db.path);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/**
 * Sxemani qo'llash — idempotent, har ishga tushishda xavfsiz.
 * Avval bazaviy sxema (yangi baza uchun), keyin migratsiyalar (mavjud baza uchun).
 */
export function migrate(): void {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  const applied = runMigrations(db);
  if (applied.length) console.log(`[db] migratsiya qo‘llandi: ${applied.join(', ')}`);
}

/* ── JSON ustunlari uchun yordamchilar ───────────────────────── */

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const toJson = (v: unknown) => JSON.stringify(v ?? null);

/** Tranzaksiya — bir nechta yozuv atomik bo'lishi kerak bo'lganda. */
export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}

/** SQLite `datetime('now')` bilan bir xil formatdagi UTC vaqt. */
export function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function sqlFromDate(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function dateFromSql(s: string): Date {
  return new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
}

export function hoursFromNow(h: number): string {
  return sqlFromDate(new Date(Date.now() + h * 3_600_000));
}
