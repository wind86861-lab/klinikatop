/**
 * Klinikaga yo'naltirish (6-bo'lim).
 *
 * Asosiy shartlar — hammasi bajarilishi kerak:
 *   1. Klinika shu operatsiyani qilishini belgilagan
 *   2. Shahar mos
 *   3. Obuna FAOL
 *   4. Klinika TASDIQLANGAN
 *
 * Ikki kengaytma vizarddan keldi:
 *   • Bemor operatsiyani bilmasa ("unknown") → 1-shart olib tashlanadi:
 *     holat tavsifini o'qib, klinika o'zi aniqlaydi.
 *   • Bemor "boshqa viloyat ham bo'ladi" desa → 2-shart yumshatiladi,
 *     lekin o'z viloyati baribir birinchi turadi.
 */
/*
 * So'rovni klinikalarga tarqatish.
 *
 * MUHIM QAROR: obuna holati bu yerda TEKSHIRILMAYDI.
 *
 * Obunasiz klinika ham so'rovni ko'radi — chunki u nimani boy berayotganini
 * ko'rmasa, tarif sotib olishga sabab topmaydi. To'siq keyingi qadamda,
 * TAKLIF YUBORISHDA turadi va o'sha yerda "tarifni tanlang" deyiladi.
 *
 * Verifikatsiya esa aksincha — qat'iy shart. Tekshirilmagan klinika bemorning
 * tibbiy hujjatini ko'rmasligi kerak, hech qanday holatda.
 *
 * Saralashda faol obuna yuqorida turadi: to'lagan klinika ro'yxat boshida
 * ko'rinadi, bu tarifning haqiqiy afzalligi.
 */
import { db } from '../db';
import { mapClinicPublic } from '../lib/mappers';
import { UNKNOWN_OPERATION_SLUG, type ClinicPublic } from '../../../shared/types';

export interface MatchOptions {
  /** Viloyatdan tashqaridagi klinikalar ham qatnashadimi */
  otherRegionsOk?: boolean;
}

function isUnknownOperationId(operationId: number): boolean {
  const row = db.prepare(`SELECT slug FROM operations WHERE id = ?`).get(operationId) as
    | { slug: string }
    | undefined;
  return row?.slug === UNKNOWN_OPERATION_SLUG;
}

export function findMatchingClinics(
  operationId: number,
  cityId: number,
  options: MatchOptions = {},
): ClinicPublic[] {
  const anyOperation = isUnknownOperationId(operationId);
  const anyCity = Boolean(options.otherRegionsOk);

  const rows = db
    .prepare(
      `SELECT c.*
         FROM clinics c
        WHERE c.verification = 'approved'
          AND (@anyCity = 1 OR c.city_id = @cityId)
          AND (
            @anyOperation = 1
            OR EXISTS (
              SELECT 1 FROM clinic_operations co
               WHERE co.clinic_id = c.id AND co.operation_id = @operationId
            )
          )
        ORDER BY (c.city_id = @cityId) DESC,
                 (c.plan = 'pro') DESC,
                 c.rating_avg DESC,
                 c.deals_count DESC`,
    )
    .all({
      operationId,
      cityId,
      anyOperation: anyOperation ? 1 : 0,
      anyCity: anyCity ? 1 : 0,
    }) as any[];

  return rows.map(mapClinicPublic);
}

export function countMatchingClinics(
  operationId: number,
  cityId: number,
  options: MatchOptions = {},
): number {
  return findMatchingClinics(operationId, cityId, options).length;
}

/**
 * Klinika shu so'rovni ko'ra oladimi — taklif yuborishdan oldin tekshiriladi.
 * So'rovning o'z sozlamalari (bilmayman / boshqa viloyat) hisobga olinadi.
 */
export function clinicMatchesRequest(clinicId: number, requestId: number): boolean {
  const request = db
    .prepare(
      `SELECT r.operation_id AS operationId, r.city_id AS cityId,
              r.other_regions_ok AS otherRegionsOk
         FROM requests r WHERE r.id = ?`,
    )
    .get(requestId) as { operationId: number; cityId: number; otherRegionsOk: number } | undefined;
  if (!request) return false;

  return findMatchingClinics(request.operationId, request.cityId, {
    otherRegionsOk: Boolean(request.otherRegionsOk),
  }).some((c) => c.id === clinicId);
}
