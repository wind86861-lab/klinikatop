/** Katalog: shaharlar, kategoriyalar, operatsiyalar + qidiruv. */
import { db } from '../db';
import { normalize } from '../lib/format';
import { mapCategory, mapCity, mapOperation } from '../lib/mappers';
import { notFound } from '../lib/errors';
import { UNKNOWN_OPERATION_SLUG, type City, type Operation, type OperationCategory } from '../../../shared/types';

export function listCities(): City[] {
  return (db.prepare(`SELECT * FROM cities ORDER BY id`).all() as any[]).map(mapCity);
}

/**
 * Faqat ichida faol operatsiyasi bor kategoriyalar.
 *
 * Katalog banisa.uz dan olinadigan bo'lgach, eski qo'lda kiritilgan
 * kategoriyalar bo'shab qoldi. Ularni o'chirib bo'lmaydi: ichidagi
 * yozuvlar yashirilgan bo'lsa ham o'tgan so'rovlar ularga ishora
 * qiladi va o'chirish kaskad bilan o'sha so'rovlarni uzardi.
 *
 * Shuning uchun ma'lumot joyida qoladi, ro'yxatga esa faqat ichi
 * bo'sh bo'lmaganlari chiqadi — bemor ochib, ichidan hech narsa
 * chiqmaydigan bo'limga tushmasin.
 */
export function listCategories(): OperationCategory[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM operation_categories c
        WHERE EXISTS (SELECT 1 FROM operations o WHERE o.category_id = c.id AND o.active = 1)
           OR EXISTS (SELECT 1 FROM operations o WHERE o.subcategory_id = c.id AND o.active = 1)
        ORDER BY c.sort_order, c.name_uz`,
    )
    .all() as any[];
  return rows.map(mapCategory);
}

/**
 * Katalog daraxti: soha → bo'lim → operatsiya.
 *
 * Ilgari faqat tekis ro'yxat bor edi va "Ko'z Xirurgiyasi" ni ochgan
 * odam 23 ta operatsiyani birdaniga ko'rardi. Bir ekranga sig'maydigan
 * ro'yxatdan odam kerakligini topa olmaydi — u shunchaki birinchi
 * ko'ringanini bosadi yoki chiqib ketadi.
 *
 * Daraxt SERVERDA yig'iladi: mijoz uni har joyda qaytadan qurishi
 * kerak emas va bemor bilan klinika bir xil tuzilmani ko'radi.
 */
export interface CatalogSection {
  category: OperationCategory;
  operations: Operation[];
}

export interface CatalogBranch {
  category: OperationCategory;
  /** Bo'limga tegishli bo'lmagan, to'g'ridan-to'g'ri sohadagilar */
  loose: Operation[];
  sections: CatalogSection[];
  /** Soha ichidagi jami operatsiyalar — ochmasdan ko'rinadi */
  total: number;
}

export function catalogTree(): CatalogBranch[] {
  const categories = (
    db.prepare(`SELECT * FROM operation_categories ORDER BY sort_order, name_uz`).all() as any[]
  ).map(mapCategory);

  const operations = listOperations().filter((o) => o.slug !== UNKNOWN_OPERATION_SLUG);

  const byId = new Map(categories.map((c) => [c.id, c]));
  const roots = categories.filter((c) => c.parentId === null);

  const branches: CatalogBranch[] = [];

  for (const root of roots) {
    const mine = operations.filter((o) => o.categoryId === root.id);
    if (mine.length === 0) continue;

    const sections: CatalogSection[] = [];
    const loose: Operation[] = [];
    const bucket = new Map<number, Operation[]>();

    for (const op of mine) {
      /*
       * Bo'lim ko'rsatilgan, lekin u boshqa sohaniki bo'lsa — e'tiborga
       * olinmaydi. Manba o'zgarganda shunday holat yuzaga kelishi
       * mumkin va operatsiya begona sohada paydo bo'lib qolardi.
       */
      const sub = op.subcategoryId ? byId.get(op.subcategoryId) : null;
      if (sub && sub.parentId === root.id) {
        const list = bucket.get(sub.id);
        if (list) list.push(op);
        else bucket.set(sub.id, [op]);
      } else {
        loose.push(op);
      }
    }

    for (const [subId, ops] of bucket) {
      const category = byId.get(subId);
      if (category) sections.push({ category, operations: ops });
    }

    // Katta bo'limlar yuqorida: odam ko'pincha shularni qidiradi
    sections.sort((a, b) => b.operations.length - a.operations.length);

    branches.push({ category: root, loose, sections, total: mine.length });
  }

  branches.sort((a, b) => b.total - a.total);
  return branches;
}

export function listOperations(categoryId?: number): Operation[] {
  const rows = categoryId
    ? db.prepare(`SELECT * FROM operations WHERE active = 1 AND category_id = ? ORDER BY name_uz`).all(categoryId)
    : db.prepare(`SELECT * FROM operations WHERE active = 1 ORDER BY name_uz`).all();
  return (rows as any[]).map(mapOperation);
}

export function getOperation(id: number): Operation {
  const row = db.prepare(`SELECT * FROM operations WHERE id = ?`).get(id);
  if (!row) throw notFound('Operatsiya topilmadi');
  return mapOperation(row);
}

/** Katalog qidiruvi — tibbiy nom, xalq tilidagi nom va kalit so'zlar bo'yicha. */
export function searchOperations(query: string, limit = 20): Operation[] {
  const q = normalize(query);
  if (q.length < 2) return listOperations().slice(0, limit);

  const all = listOperations();
  const scored = all
    .map((op) => {
      const haystacks = [
        { text: normalize(op.nameUz), weight: 10 },
        { text: normalize(op.nameRu), weight: 10 },
        { text: normalize(op.aliasUz), weight: 8 },
        { text: normalize(op.aliasRu), weight: 8 },
        { text: op.keywords.map(normalize).join(' '), weight: 6 },
        { text: normalize(op.descUz), weight: 2 },
        { text: normalize(op.descRu), weight: 2 },
      ];
      let score = 0;
      for (const { text, weight } of haystacks) {
        if (text.startsWith(q)) score += weight * 2;
        else if (text.includes(q)) score += weight;
      }
      return { op, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => s.op);
}


/**
 * "Bilmayman — klinika aytadi" yozuvi.
 * Katalog ro'yxatlarida ko'rinmaydi (active = 0), shuning uchun alohida olinadi.
 */
export function getUnknownOperation(): Operation | null {
  const row = db.prepare(`SELECT * FROM operations WHERE slug = ?`).get(UNKNOWN_OPERATION_SLUG);
  return row ? mapOperation(row) : null;
}
