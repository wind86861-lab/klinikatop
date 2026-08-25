/**
 * Zaxira nusxa.
 *
 * SQLite faylini shunchaki nusxalash XAVFLI: yozuv o'rtasida olingan nusxa
 * buzilgan bo'lishi mumkin. Shuning uchun SQLite'ning o'z `backup` API'si
 * ishlatiladi — u ilova ishlab turganda ham izchil nusxa beradi.
 *
 * Tibbiy hujjatlar bazada emas, diskda yotadi — ular ham nusxalanadi.
 * Bazasiz hujjat ham, hujjatsiz baza ham foydasiz.
 *
 *   node dist/server/src/db/backup.js [saqlash-papkasi]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { config } from '../lib/config';

/** Necha kunlik nusxa saqlanadi. */
const KEEP_DAYS = 14;

async function main() {
  const outDir = process.argv[2] ?? '/var/backups/klinikatop';
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const dbPath = path.resolve(config.db.path);
  const uploadsDir = path.join(path.dirname(dbPath), 'uploads');

  // ── Baza: izchil nusxa (ilova ishlab tursa ham) ──
  const dbTarget = path.join(outDir, `klinikatop-${stamp}.db`);
  const db = new Database(dbPath, { readonly: true });
  await db.backup(dbTarget);
  db.close();

  // ── Hujjatlar ──
  let filesNote = 'hujjat yo‘q';
  if (fs.existsSync(uploadsDir) && fs.readdirSync(uploadsDir).length > 0) {
    const tarTarget = path.join(outDir, `uploads-${stamp}.tar.gz`);
    execFileSync('tar', ['-czf', tarTarget, '-C', path.dirname(uploadsDir), 'uploads']);
    filesNote = `${(fs.statSync(tarTarget).size / 1024 / 1024).toFixed(1)} MB`;
  }

  // ── Eskirganini tozalash ──
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  let removed = 0;
  for (const name of fs.readdirSync(outDir)) {
    const full = path.join(outDir, name);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      removed += 1;
    }
  }

  const size = (fs.statSync(dbTarget).size / 1024 / 1024).toFixed(1);
  console.log(`[backup] baza ${size} MB, hujjatlar ${filesNote}, eskisi o‘chirildi: ${removed}`);
}

main().catch((err) => {
  console.error('[backup] xatolik:', err);
  process.exit(1);
});
