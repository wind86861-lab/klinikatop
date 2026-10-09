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
import type { LabOrgan, LabTest } from '../../../shared/types';

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

/**
 * Butun katalog — guruhlar va ularning tekshiruvlari birga.
 *
 * Daraxt emas, TEKIS ro'yxat qaytadi: har yozuvda `parentId` bor va
 * mijoz guruhlashni o'zi qiladi. Shunda bitta so'rov yetadi va
 * qidiruv ham oddiy massiv ustida ishlaydi.
 */
export function listLabTests(includeHidden = false): LabTest[] {
  const rows = db
    .prepare(
      /*
       * Tartib: GURUHLAR o'z `position` i bo'yicha, ichidagilar guruhi
       * ostida o'z `position` i bo'yicha. Ilgari guruhlar ID bo'yicha
       * tartiblanardi — admin "tartib" maydonini o'zgartirsa ham ro'yxat
       * siljimasdi, yangi qo'shilgan tekshiruv esa doim oxirida turardi.
       */
      `SELECT t.*,
              (SELECT COUNT(*) FROM lab_tests c
                WHERE c.parent_id = t.id ${includeHidden ? '' : 'AND c.active = 1'}) AS kids
         FROM lab_tests t
         LEFT JOIN lab_tests g ON g.id = t.parent_id
        ${includeHidden ? '' : 'WHERE t.active = 1'}
        ORDER BY COALESCE(g.position, t.position), COALESCE(t.parent_id, t.id), t.parent_id IS NOT NULL, t.position, t.id`,
    )
    .all() as any[];
  return rows.map((r) => mapLabTest(r, (r.kids ?? 0) > 0));
}

/**
 * Bemor tanlay oladigan tekshiruvlar — faqat BARGLAR.
 *
 * Bolasi bor yozuv papka: uni tanlash "MRT kerak" deyish bilan
 * barobar bo'lardi va klinika qaysi MRT ekanini bilmasdi.
 */
export function selectableLabTestIds(): Set<number> {
  return new Set(
    (
      db
        .prepare(
          `SELECT t.id FROM lab_tests t
            WHERE t.active = 1
              AND NOT EXISTS (SELECT 1 FROM lab_tests c WHERE c.parent_id = t.id AND c.active = 1)`,
        )
        .all() as { id: number }[]
    ).map((r) => r.id),
  );
}

export function getLabTest(id: number): LabTest {
  const row = db.prepare(`SELECT * FROM lab_tests WHERE id = ?`).get(id) as any;
  if (!row) throw notFound('Tekshiruv topilmadi');
  const kids = db.prepare(`SELECT COUNT(*) n FROM lab_tests WHERE parent_id = ?`).get(id) as {
    n: number;
  };
  return mapLabTest(row, kids.n > 0);
}

export interface LabTestInput {
  nameUz: string;
  nameRu?: string;
  icon?: string;
  position?: number;
  active?: boolean;
  /** Qaysi guruhga kiradi (MRT, MSKT). `null` — o'zi guruh */
  parentId?: number | null;
  /*
   * Narx katalogda YO'Q: uni klinika o'z taklifida beradi va u har
   * joyda boshqacha. Katalogdagi raqam bemorga va'da bo'lib
   * ko'rinardi. Bazadagi ustun eski qiymatlari bilan qolgan, lekin
   * hech qayerda o'qilmaydi.
   */
  durationMin?: number | null;
  /** Bemordan vazn so'raladimi */
  needsWeight?: boolean;
  /** Qarshi ko'rsatmalar — bo'sh bo'lsa qadam chiqmaydi */
  contraUz?: string | null;
  contraRu?: string | null;
}

const contraText = (v: string | null | undefined) => (v ?? '').trim().slice(0, 2000) || null;

export function createLabTest(input: LabTestInput): LabTest {
  const nameUz = input.nameUz.trim();
  if (nameUz.length < 2) throw badRequest('name_required', 'Tekshiruv nomini yozing');

  return tx(() => {
    let slug = slugify(nameUz);
    // Nom takrorlansa slug ham takrorlanadi — raqam qo'shamiz
    if (db.prepare(`SELECT 1 FROM lab_tests WHERE slug = ?`).get(slug)) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    }

    const info = db
      .prepare(
        `INSERT INTO lab_tests (slug, name_uz, name_ru, icon, position, active,
                                parent_id, duration_min, needs_weight, contra_uz, contra_ru)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        slug,
        nameUz.slice(0, 120),
        (input.nameRu || nameUz).trim().slice(0, 120),
        (input.icon ?? '').slice(0, 8),
        input.position ?? 999,
        input.active === false ? 0 : 1,
        input.parentId ?? null,
        input.durationMin ?? null,
        input.needsWeight === false ? 0 : 1,
        contraText(input.contraUz),
        contraText(input.contraRu),
      );

    return getLabTest(Number(info.lastInsertRowid));
  });
}

export function updateLabTest(id: number, input: Partial<LabTestInput>): LabTest {
  const current = getLabTest(id);
  /*
   * Berilmagan maydon O'ZGARMAYDI. Ilgari qisman tahrirda (faqat nom)
   * o'rin 999 ga tushib, o'chirilgan tekshiruv esa qayta yoqilib qolardi.
   */
  const row = db.prepare(`SELECT position, active FROM lab_tests WHERE id = ?`).get(id) as {
    position: number;
    active: number;
  };

  return tx(() => {
    db.prepare(
      `UPDATE lab_tests SET name_uz = ?, name_ru = ?, icon = ?, position = ?, active = ?,
                            parent_id = ?, duration_min = ?, needs_weight = ?, contra_uz = ?, contra_ru = ?
        WHERE id = ?`,
    ).run(
      (input.nameUz ?? current.nameUz).trim().slice(0, 120),
      (input.nameRu ?? current.nameRu).trim().slice(0, 120),
      (input.icon ?? current.icon).slice(0, 8),
      input.position ?? row.position,
      input.active === undefined ? row.active : input.active ? 1 : 0,
      /*
       * O'ziga o'zi ota bo'lib qolmasin — bunday yozuv ro'yxatda
       * hech qachon ko'rinmasdi.
       */
      input.parentId === id ? null : (input.parentId ?? current.parentId),
      input.durationMin !== undefined ? input.durationMin : current.durationMin,
      input.needsWeight === undefined ? (current.needsWeight ? 1 : 0) : input.needsWeight ? 1 : 0,
      input.contraUz !== undefined ? contraText(input.contraUz) : current.contraUz,
      input.contraRu !== undefined ? contraText(input.contraRu) : current.contraRu,
      id,
    );

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
  const kids = db.prepare(`SELECT 1 FROM lab_tests WHERE parent_id = ?`).get(id);
  if (kids) {
    throw badRequest(
      'test_has_children',
      'Bu guruh ichida tekshiruvlar bor — avval ularni o‘chiring yoki boshqa guruhga o‘tkazing',
    );
  }

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

export function clinicLabTestIds(clinicId: number): number[] {
  return (
    db.prepare(`SELECT test_id FROM clinic_lab_tests WHERE clinic_id = ?`).all(clinicId) as {
      test_id: number;
    }[]
  ).map((r) => r.test_id);
}

/**
 * Ro'yxatni to'liq almashtiradi.
 *
 * Bo'sh ro'yxat ham QABUL QILINADI: klinika tahlil xizmatini
 * butunlay o'chirib qo'yishi mumkin bo'lishi kerak.
 *
 * Mavjud bo'lmagan tur jimgina tashlab yuboriladi — mijoz eskirgan
 * ro'yxat bilan ishlayotgan bo'lishi mumkin.
 */
export function saveClinicLabTests(clinicId: number, testIds: number[]): number[] {
  const valid = new Set(listLabTests(true).map((x) => x.id));
  const clean = [...new Set(testIds)].filter((id) => valid.has(id));

  tx(() => {
    db.prepare(`DELETE FROM clinic_lab_tests WHERE clinic_id = ?`).run(clinicId);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO clinic_lab_tests (clinic_id, test_id) VALUES (?, ?)`,
    );
    for (const id of clean) ins.run(clinicId, id);
  });

  return clean;
}
