/**
 * Tahlil katalogi: tekshiruvlar va organlar.
 *
 * Ikki daraja, chunki bitta savol yetarli emas edi. "Bosh miya"
 * degan javob MRT ni ham, KT ni ham, qon tahlilini ham anglatishi
 * mumkin — klinika esa ularning hammasini qilmaydi va narxi
 * butunlay boshqa.
 *
 * Qaysi organ qaysi tekshiruvga mos kelishini ADMIN belgilaydi:
 * bemorga faqat mantiqiy juftliklar ko'rsatiladi ("qon tahlili +
 * umurtqa" degan variant umuman chiqmaydi).
 */
import { db, tx } from '../db';
import { badRequest, notFound } from '../lib/errors';
import { mapLabOrgan, mapLabTest } from '../lib/mappers';
import type { ClinicLabService, LabOrgan, LabTest } from '../../../shared/types';

/**
 * Nomdan barqaror kalit yasaydi.
 *
 * Kirill va lotin harflari tashlab yuboriladi — o'zbekcha nomdan
 * ba'zan bo'sh qatorlik chiqadi, shuning uchun vaqt bilan zaxira
 * qiymat beriladi.
 */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `item-${Date.now().toString(36)}`
  );
}

/* ─────────────────────────  Organlar  ───────────────────────── */

export function listLabOrgans(includeHidden = false): LabOrgan[] {
  const rows = db
    .prepare(
      `SELECT * FROM lab_organs ${includeHidden ? '' : 'WHERE active = 1'} ORDER BY position, id`,
    )
    .all() as any[];
  return rows.map(mapLabOrgan);
}

export interface LabOrganInput {
  nameUz: string;
  nameRu?: string;
  icon?: string;
  position?: number;
  active?: boolean;
}

export function createLabOrgan(input: LabOrganInput): LabOrgan {
  const nameUz = input.nameUz.trim();
  if (nameUz.length < 2) throw badRequest('name_required', 'Tana a‘zosi nomini yozing');

  let slug = slugify(nameUz);
  if (db.prepare(`SELECT 1 FROM lab_organs WHERE slug = ?`).get(slug)) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }

  const info = db
    .prepare(
      `INSERT INTO lab_organs (slug, name_uz, name_ru, icon, position, active)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      slug,
      nameUz.slice(0, 120),
      (input.nameRu || nameUz).trim().slice(0, 120),
      (input.icon ?? '').slice(0, 8),
      input.position ?? 999,
      input.active === false ? 0 : 1,
    );

  const row = db.prepare(`SELECT * FROM lab_organs WHERE id = ?`).get(Number(info.lastInsertRowid));
  return mapLabOrgan(row);
}

export function updateLabOrgan(id: number, input: Partial<LabOrganInput>): LabOrgan {
  const row = db.prepare(`SELECT * FROM lab_organs WHERE id = ?`).get(id) as any;
  if (!row) throw notFound('Tana a‘zosi topilmadi');

  db.prepare(
    `UPDATE lab_organs SET name_uz = ?, name_ru = ?, icon = ?, position = ?, active = ?
      WHERE id = ?`,
  ).run(
    (input.nameUz ?? row.name_uz).trim().slice(0, 120),
    (input.nameRu ?? row.name_ru).trim().slice(0, 120),
    (input.icon ?? row.icon ?? '').slice(0, 8),
    input.position ?? row.position,
    input.active === false ? 0 : 1,
    id,
  );

  return mapLabOrgan(db.prepare(`SELECT * FROM lab_organs WHERE id = ?`).get(id));
}

/**
 * Tana a'zosini o'chirish — faqat ishlatilmagan bo'lsa.
 *
 * So'rovda ishlatilgan bo'lsa o'chirilmaydi: eski so'rovlar nima
 * haqida ekanini yo'qotardi. Bunday holatda uni YASHIRISH kerak.
 */
export function deleteLabOrgan(id: number): void {
  const used = db.prepare(`SELECT 1 FROM requests WHERE lab_organ_id = ?`).get(id);
  if (used) {
    throw badRequest(
      'organ_in_use',
      'Bu a‘zo bo‘yicha so‘rovlar bor — o‘chirish o‘rniga uni yashiring',
    );
  }
  db.prepare(`DELETE FROM lab_organs WHERE id = ?`).run(id);
}

/* ─────────────────────────  Tekshiruvlar  ───────────────────────── */

function organIdsOf(testId: number): number[] {
  return (
    db.prepare(`SELECT organ_id FROM lab_test_organs WHERE test_id = ?`).all(testId) as {
      organ_id: number;
    }[]
  ).map((r) => r.organ_id);
}

export function listLabTests(includeHidden = false): LabTest[] {
  const rows = db
    .prepare(
      `SELECT * FROM lab_tests ${includeHidden ? '' : 'WHERE active = 1'} ORDER BY position, id`,
    )
    .all() as any[];
  return rows.map((r) => mapLabTest(r, organIdsOf(r.id)));
}

export function getLabTest(id: number): LabTest {
  const row = db.prepare(`SELECT * FROM lab_tests WHERE id = ?`).get(id) as any;
  if (!row) throw notFound('Tekshiruv topilmadi');
  return mapLabTest(row, organIdsOf(id));
}

/** Bu juftlik admin ruxsat berganmi. */
export function isValidPair(testId: number, organId: number): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM lab_test_organs lo
           JOIN lab_tests t ON t.id = lo.test_id AND t.active = 1
           JOIN lab_organs o ON o.id = lo.organ_id AND o.active = 1
          WHERE lo.test_id = ? AND lo.organ_id = ?`,
      )
      .get(testId, organId),
  );
}

export interface LabTestInput {
  nameUz: string;
  nameRu: string;
  icon?: string;
  position?: number;
  active?: boolean;
  /** Shu tekshiruvga mos organlar — kamida bittasi */
  organIds: number[];
}

function cleanOrganIds(ids: number[]): number[] {
  const valid = new Set(listLabOrgans(true).map((o) => o.id));
  const clean = [...new Set(ids)].filter((id) => valid.has(id));
  if (!clean.length) {
    throw badRequest('organs_required', 'Kamida bitta organ tanlang — bemor shundan tanlaydi');
  }
  return clean;
}

export function createLabTest(input: LabTestInput): LabTest {
  const nameUz = input.nameUz.trim();
  if (nameUz.length < 2) throw badRequest('name_required', 'Tekshiruv nomini yozing');
  const organIds = cleanOrganIds(input.organIds);

  return tx(() => {
    let slug = slugify(nameUz);
    // Nom takrorlansa slug ham takrorlanadi — raqam qo'shamiz
    if (db.prepare(`SELECT 1 FROM lab_tests WHERE slug = ?`).get(slug)) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    }

    const info = db
      .prepare(
        `INSERT INTO lab_tests (slug, name_uz, name_ru, icon, position, active)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        slug,
        nameUz.slice(0, 120),
        (input.nameRu || nameUz).trim().slice(0, 120),
        (input.icon ?? '').slice(0, 8),
        input.position ?? 999,
        input.active === false ? 0 : 1,
      );

    const id = Number(info.lastInsertRowid);
    const link = db.prepare(`INSERT OR IGNORE INTO lab_test_organs (test_id, organ_id) VALUES (?, ?)`);
    for (const o of organIds) link.run(id, o);
    return getLabTest(id);
  });
}

export function updateLabTest(id: number, input: Partial<LabTestInput>): LabTest {
  const current = getLabTest(id);

  return tx(() => {
    db.prepare(
      `UPDATE lab_tests SET name_uz = ?, name_ru = ?, icon = ?, position = ?, active = ?
        WHERE id = ?`,
    ).run(
      (input.nameUz ?? current.nameUz).trim().slice(0, 120),
      (input.nameRu ?? current.nameRu).trim().slice(0, 120),
      (input.icon ?? current.icon).slice(0, 8),
      input.position ?? 999,
      input.active === false ? 0 : 1,
      id,
    );

    if (input.organIds) {
      const organIds = cleanOrganIds(input.organIds);
      db.prepare(`DELETE FROM lab_test_organs WHERE test_id = ?`).run(id);
      const link = db.prepare(`INSERT OR IGNORE INTO lab_test_organs (test_id, organ_id) VALUES (?, ?)`);
      for (const o of organIds) link.run(id, o);

      /*
       * Endi mos kelmaydigan klinika juftliklari olib tashlanadi.
       *
       * Aks holda klinika "MRT + jigar" ni yoqib qo'ygan bo'lar, admin
       * esa jigarni MRT ro'yxatidan olib tashlagan bo'lardi — va
       * hech kim tanlay olmaydigan so'rov o'sha klinikaga borardi.
       */
      db.prepare(
        `DELETE FROM clinic_lab_services
          WHERE test_id = ?
            AND organ_id NOT IN (SELECT organ_id FROM lab_test_organs WHERE test_id = ?)`,
      ).run(id, id);
    }

    return getLabTest(id);
  });
}

/**
 * Tekshiruvni o'chirish — faqat ishlatilmagan bo'lsa.
 *
 * So'rovda ishlatilgan bo'lsa o'chirilmaydi: eski so'rovlar nima
 * haqida ekanini yo'qotardi. Bunday holatda uni YASHIRISH kerak.
 */
export function deleteLabTest(id: number): void {
  const used = db.prepare(`SELECT 1 FROM requests WHERE lab_test_id = ?`).get(id);
  if (used) {
    throw badRequest(
      'test_in_use',
      'Bu tekshiruv bo‘yicha so‘rovlar bor — o‘chirish o‘rniga uni yashiring',
    );
  }
  db.prepare(`DELETE FROM lab_tests WHERE id = ?`).run(id);
}

/* ─────────────────────────  Klinika xizmatlari  ───────────────────────── */

export function clinicLabServices(clinicId: number): ClinicLabService[] {
  return (
    db
      .prepare(`SELECT test_id, organ_id FROM clinic_lab_services WHERE clinic_id = ?`)
      .all(clinicId) as { test_id: number; organ_id: number }[]
  ).map((r) => ({ testId: r.test_id, organId: r.organ_id }));
}

/**
 * Ro'yxatni to'liq almashtiradi.
 *
 * Bo'sh ro'yxat ham QABUL QILINADI: klinika tahlil xizmatini
 * butunlay o'chirib qo'yishi mumkin bo'lishi kerak.
 *
 * Admin ruxsat bermagan juftlik jimgina tashlab yuboriladi — mijoz
 * eskirgan ro'yxat bilan ishlayotgan bo'lishi mumkin.
 */
export function saveClinicLabServices(
  clinicId: number,
  services: ClinicLabService[],
): ClinicLabService[] {
  const allowed = new Set(
    (
      db.prepare(`SELECT test_id, organ_id FROM lab_test_organs`).all() as {
        test_id: number;
        organ_id: number;
      }[]
    ).map((r) => `${r.test_id}:${r.organ_id}`),
  );

  const clean = [
    ...new Map(
      services
        .filter((s) => allowed.has(`${s.testId}:${s.organId}`))
        .map((s) => [`${s.testId}:${s.organId}`, s]),
    ).values(),
  ];

  tx(() => {
    db.prepare(`DELETE FROM clinic_lab_services WHERE clinic_id = ?`).run(clinicId);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO clinic_lab_services (clinic_id, test_id, organ_id) VALUES (?, ?, ?)`,
    );
    for (const s of clean) ins.run(clinicId, s.testId, s.organId);
  });

  return clean;
}
