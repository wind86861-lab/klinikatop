/** Katalog: shaharlar, kategoriyalar, operatsiyalar + qidiruv. */
import { db } from '../db';
import { normalize } from '../lib/format';
import { mapCategory, mapCity, mapOperation } from '../lib/mappers';
import { notFound } from '../lib/errors';
import { UNKNOWN_OPERATION_SLUG, type City, type Operation, type OperationCategory } from '../../../shared/types';

export function listCities(): City[] {
  return (db.prepare(`SELECT * FROM cities ORDER BY id`).all() as any[]).map(mapCity);
}

export function listCategories(): OperationCategory[] {
  return (db.prepare(`SELECT * FROM operation_categories ORDER BY id`).all() as any[]).map(mapCategory);
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
