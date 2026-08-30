/**
 * Ulangan klinikalarning yo'nalishlarini banisa bilan sinxron tutadi.
 *
 * ═══ Nima uchun tortish, turtish emas ═══
 *
 * banisa'da chiquvchi webhook infratuzilmasi yo'q, lekin sabab
 * faqat shu emas. Tortish O'ZINI O'ZI TUZATADI: bir marta
 * o'tkazib yuborilsa keyingi safar to'g'rilanadi. Webhook esa
 * yo'qolgan xabarni hech qachon qaytarmaydi va ikki tomon abadiy
 * farq qilib qoladi.
 *
 * ═══ Nima uchun to'liq ro'yxat ═══
 *
 * `ClinicSurgicalService` da `updatedAt` yo'q, ya'ni "nima
 * o'zgardi" degan savolga javob bera olmaydi. To'liq ro'yxat esa
 * O'CHIRISHNI ham ko'rsatadi — inkremental usul buni hech qachon
 * ko'rsatmaydi.
 *
 * Hajm muammo emas: 11 klinika × ~20 yo'nalish ≈ 220 qator.
 *
 * ═══ Chegara ═══
 *
 * Faqat `external_id` bor klinikalarga tegiladi. O'zi kelgan
 * klinikalarning yo'nalishlariga bu yerdan hech qachon tegilmaydi.
 */
import { db, tx } from '../db';
import { fetchClinicOperations, fetchClinics, banisaConfigured } from './banisa';

/** banisa'da shu holatdagi klinika ishlashi mumkin. */
const USABLE_STATUS = 'APPROVED';

export interface ClinicSyncResult {
  clinics: number;
  added: number;
  removed: number;
  /** banisa'da holati o'zgargani uchun to'xtatilganlar */
  suspended: number;
  durationMs: number;
}

export async function syncLinkedClinics(): Promise<ClinicSyncResult> {
  const began = Date.now();
  const empty: ClinicSyncResult = {
    clinics: 0,
    added: 0,
    removed: 0,
    suspended: 0,
    durationMs: 0,
  };

  if (!banisaConfigured()) return { ...empty, durationMs: Date.now() - began };

  const linked = db
    .prepare(`SELECT id, external_id FROM clinics WHERE external_id IS NOT NULL`)
    .all() as { id: number; external_id: string }[];

  if (linked.length === 0) return { ...empty, durationMs: Date.now() - began };

  const externalIds = linked.map((c) => c.external_id);
  const byExternal = new Map(linked.map((c) => [c.external_id, c.id]));

  const [profiles, links] = await Promise.all([
    fetchClinics(externalIds),
    fetchClinicOperations(externalIds),
  ]);

  /*
   * banisa'dan chiqarilgan klinika bu yerda ham to'xtatiladi.
   *
   * Aks holda banisa bloklagan klinika KlinikaTop orqali ishlashda
   * davom etardi — va bemor uni banisa tekshirgan deb o'ylardi.
   */
  let suspended = 0;
  const stopSuspend = db.prepare(
    `UPDATE clinics SET verification = 'rejected', verification_note = ?
      WHERE id = ? AND verification = 'approved'`,
  );
  const resume = db.prepare(
    `UPDATE clinics SET verification = 'approved', verification_note = NULL
      WHERE id = ? AND verification = 'rejected'`,
  );

  for (const profile of profiles) {
    const clinicId = byExternal.get(profile.id);
    if (!clinicId) continue;

    if (profile.status !== USABLE_STATUS) {
      suspended += stopSuspend.run('banisa.uz’da holati o‘zgargan', clinicId).changes;
    } else {
      resume.run(clinicId);
    }
  }

  /* ── Yo'nalishlar ── */

  // banisa identifikatorlarini bizdagi raqamlarga o'giramiz
  const wanted = new Map<number, Set<number>>();
  const activeExternal = [...new Set(links.filter((l) => l.isActive).map((l) => l.operationId))];
  const opIdByExternal = resolveOperations(activeExternal);

  for (const link of links) {
    if (!link.isActive) continue;
    const clinicId = byExternal.get(link.clinicId);
    const opId = opIdByExternal.get(link.operationId);
    // banisa'da bor, lekin bizning katalogda yo'q — tashlab yuboriladi
    if (!clinicId || !opId) continue;

    const set = wanted.get(clinicId);
    if (set) set.add(opId);
    else wanted.set(clinicId, new Set([opId]));
  }

  let added = 0;
  let removed = 0;

  tx(() => {
    const current = db
      .prepare(`SELECT clinic_id, operation_id FROM clinic_operations WHERE source = 'banisa'`)
      .all() as { clinic_id: number; operation_id: number }[];

    const have = new Map<number, Set<number>>();
    for (const row of current) {
      const set = have.get(row.clinic_id);
      if (set) set.add(row.operation_id);
      else have.set(row.clinic_id, new Set([row.operation_id]));
    }

    const insert = db.prepare(
      `INSERT OR REPLACE INTO clinic_operations (clinic_id, operation_id, source)
       VALUES (?, ?, 'banisa')`,
    );
    const remove = db.prepare(
      `DELETE FROM clinic_operations
        WHERE clinic_id = ? AND operation_id = ? AND source = 'banisa'`,
    );

    for (const clinic of linked) {
      const want = wanted.get(clinic.id) ?? new Set<number>();
      const has = have.get(clinic.id) ?? new Set<number>();

      for (const opId of want) {
        if (!has.has(opId)) {
          insert.run(clinic.id, opId);
          added++;
        }
      }
      for (const opId of has) {
        if (!want.has(opId)) {
          remove.run(clinic.id, opId);
          removed++;
        }
      }
    }

    db.prepare(
      `UPDATE clinics SET external_synced_at = datetime('now') WHERE external_id IS NOT NULL`,
    ).run();
  });

  return {
    clinics: linked.length,
    added,
    removed,
    suspended,
    durationMs: Date.now() - began,
  };
}

function resolveOperations(externalIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (externalIds.length === 0) return out;

  /*
   * SQLite o'zgaruvchilar soniga chegara qo'yadi (odatda 999).
   * Ro'yxat undan uzun bo'lsa bo'lakka bo'lamiz.
   */
  const CHUNK = 500;
  for (let i = 0; i < externalIds.length; i += CHUNK) {
    const chunk = externalIds.slice(i, i + CHUNK);
    const rows = db
      .prepare(
        `SELECT id, external_id FROM operations
          WHERE external_id IN (${chunk.map(() => '?').join(',')})
            AND source = 'banisa' AND active = 1`,
      )
      .all(...chunk) as { id: number; external_id: string }[];

    for (const row of rows) out.set(row.external_id, row.id);
  }

  return out;
}
