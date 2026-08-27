/**
 * Test uchun veb hisoblarni tayyorlaydi va tokenlarni chiqaradi.
 *
 * HTTP testi endi klinika va admin sifatida veb sessiya bilan ishlaydi —
 * ular uchun Telegram imzosi umuman ishlamaydi. Bu skript o'sha
 * sessiyalarni haqiqiy oqim orqali yaratadi: hisob → parol → kirish.
 * Yorliq yo'q, chunki test aynan shu oqimni tekshirishi kerak.
 *
 * Chiqish: `CLINIC_TOKEN <token>` va `ADMIN_TOKEN <token>` qatorlari.
 */
import { db } from '../db';
import { completeSetup, createAccount, login } from '../services/webAuth';

const PASSWORD = 'sinov-paroli-2026';

function provision(email: string, fullName: string, level: 'full' | 'clinic_admin', clinicId: number | null) {
  // Qayta ishga tushirishga chidamli bo'lishi uchun eskisini olib tashlaymiz
  const old = db.prepare(`SELECT id FROM admin_users WHERE email = ?`).get(email) as { id: number } | undefined;
  if (old) {
    db.prepare(`DELETE FROM users WHERE telegram_id = ?`).run(-old.id);
    db.prepare(`DELETE FROM admin_users WHERE id = ?`).run(old.id);
  }

  const { setupToken } = createAccount({ email, fullName, level, clinicId });
  completeSetup(setupToken, PASSWORD);
  return login(email, PASSWORD, '127.0.0.1', 'test').token;
}

/** Test klinikasi — bo'lmasa yaratiladi. */
function testClinic(): number {
  const row = db.prepare(`SELECT id FROM clinics WHERE name = 'HTTP Test Klinika'`).get() as
    | { id: number }
    | undefined;
  if (row) return row.id;

  const info = db
    .prepare(
      `INSERT INTO clinics (name, city_id, address, about, license_file_id, verification)
       VALUES ('HTTP Test Klinika', 1, 'Toshkent', 'Test', 'LIC-1', 'pending')`,
    )
    .run();
  const id = Number(info.lastInsertRowid);
  db.prepare(`INSERT OR IGNORE INTO clinic_operations (clinic_id, operation_id) VALUES (?, 1)`).run(id);
  return id;
}

const clinicId = testClinic();

console.log(`CLINIC_ID ${clinicId}`);
console.log(`CLINIC_TOKEN ${provision('klinika@test.local', 'Test Klinika', 'clinic_admin', clinicId)}`);
console.log(`ADMIN_TOKEN ${provision('admin@test.local', 'Test Admin', 'full', null)}`);
