/**
 * Operatsiyaning narx oralig'i — admin qo'lidagi katalog ma'lumoti.
 *
 * Bemor byudjetni ixtiyoriy qo'yardi va klinikalar bajarib
 * bo'lmaydigan so'rovlarni ko'rardi: 100 ming so'mga yurak
 * operatsiyasi. Har bunday taklif qo'lda rad etilardi.
 *
 * Nega klinikada emas, ADMINDA: klinika o'z narxini ko'tarish uchun
 * pastki chegarani surib qo'yishi mumkin bo'lardi. Oraliq — bozor
 * ma'lumoti emas, katalog ma'lumoti.
 */
import { db } from '../db';
import { badRequest, notFound } from '../lib/errors';
import { mapCategory, mapOperation } from '../lib/mappers';
import type { AdminOperation, Operation } from '../../../shared/types';

/**
 * Narx yozish uchun to'liq ro'yxat — o'chirilganlari ham.
 *
 * Nofaol operatsiya ham ko'rsatiladi: u qaytarib yoqilganda narxi
 * allaqachon turgan bo'lishi kerak, aks holda yoqilgan zahoti
 * chegarasiz qolib ketadi.
 */
export function listOperationsForPricing(): AdminOperation[] {
  const rows = db
    .prepare(
      `SELECT o.*,
              c.id   AS c_id,   c.parent_id AS c_parent, c.slug AS c_slug,
              c.name_uz AS c_name_uz, c.name_ru AS c_name_ru, c.icon AS c_icon,
              s.id   AS s_id,   s.parent_id AS s_parent, s.slug AS s_slug,
              s.name_uz AS s_name_uz, s.name_ru AS s_name_ru, s.icon AS s_icon
         FROM operations o
         LEFT JOIN operation_categories c ON c.id = o.category_id
         LEFT JOIN operation_categories s ON s.id = o.subcategory_id
        ORDER BY c.name_uz, o.name_uz`,
    )
    .all() as any[];

  return rows.map((r) => ({
    ...mapOperation(r),
    active: Boolean(r.active),
    category: r.c_id
      ? mapCategory({
          id: r.c_id, parent_id: r.c_parent, slug: r.c_slug,
          name_uz: r.c_name_uz, name_ru: r.c_name_ru, icon: r.c_icon,
        })
      : null,
    subcategory: r.s_id
      ? mapCategory({
          id: r.s_id, parent_id: r.s_parent, slug: r.s_slug,
          name_uz: r.s_name_uz, name_ru: r.s_name_ru, icon: r.s_icon,
        })
      : null,
  }));
}

/**
 * Oraliqni saqlaydi. `null` — chegarani olib tashlash.
 *
 * min > max holati BAZAGA yetib bormaydi: bunday oraliqqa hech
 * qanday byudjet to'g'ri kelmaydi va operatsiyaga so'rov yuborish
 * butunlay imkonsiz bo'lib qolardi — buni admin darhol sezmasligi
 * mumkin.
 */
export function setOperationPriceRange(
  operationId: number,
  minPriceUzs: number | null,
  maxPriceUzs: number | null,
): Operation {
  const exists = db.prepare(`SELECT id FROM operations WHERE id = ?`).get(operationId);
  if (!exists) throw notFound('Bunday operatsiya topilmadi');

  if (minPriceUzs != null && maxPriceUzs != null && minPriceUzs > maxPriceUzs) {
    throw badRequest('invalid_range', 'Eng kam narx eng ko‘pidan katta bo‘la olmaydi');
  }

  db.prepare(
    `UPDATE operations SET min_price_uzs = ?, max_price_uzs = ? WHERE id = ?`,
  ).run(minPriceUzs, maxPriceUzs, operationId);

  return mapOperation(db.prepare(`SELECT * FROM operations WHERE id = ?`).get(operationId));
}
