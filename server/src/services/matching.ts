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
  /**
   * Operatsiya noma'lum bo'lganda — qaysi soha bo'yicha yuborish.
   * AI aniq operatsiyani ayta olmasa ham sohani deyarli har doim biladi.
   */
  fallbackCategoryId?: number | null;
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
  const unknownOperation = isUnknownOperationId(operationId);
  const anyCity = Boolean(options.otherRegionsOk);
  const categoryId = options.fallbackCategoryId ?? null;

  /*
   * Operatsiya noma'lum bo'lsa ham so'rov HAMMAGA yuborilmaydi.
   *
   * Ilgari shunday edi: filtr butunlay o'char va ko'z muammosi
   * stomatologiyaga ham borardi. Klinika o'zi qila olmaydigan
   * so'rovlarni ko'raverib oqimni o'qishni tashlardi, bemor esa
   * mos bo'lmagan takliflar olardi.
   *
   * Endi uch bosqich:
   *   1. Aniq operatsiya ma'lum → shu operatsiyani qiladiganlar
   *   2. Noma'lum, lekin SOHA ma'lum → shu sohada ishlaydiganlar
   *   3. Ikkalasi ham noma'lum → oxirgi chora, hammasi
   *
   * Uchinchi holat kam uchraydi: AI aniq operatsiyani bilmasa ham
   * sohani deyarli har doim aytadi.
   */
  const anyOperation = unknownOperation && categoryId === null;
  const byCategory = unknownOperation && categoryId !== null;

  const rows = db
    .prepare(
      `SELECT c.*
         FROM clinics c
        WHERE c.verification = 'approved'
          AND (@anyCity = 1 OR c.city_id = @cityId)
          AND (
            @anyOperation = 1
            OR (
              @byCategory = 1
              AND EXISTS (
                SELECT 1 FROM clinic_operations co
                  JOIN operations o ON o.id = co.operation_id
                  JOIN operation_categories oc ON oc.id = o.category_id
                 WHERE co.clinic_id = c.id
                   /* Bo'lim tanlangan bo'lsa ota sohasi ham hisoblanadi */
                   AND (o.category_id = @categoryId OR oc.parent_id = @categoryId)
              )
            )
            OR (
              @anyOperation = 0
              AND @byCategory = 0
              AND EXISTS (
                SELECT 1 FROM clinic_operations co
                 WHERE co.clinic_id = c.id AND co.operation_id = @operationId
              )
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
      categoryId,
      anyOperation: anyOperation ? 1 : 0,
      byCategory: byCategory ? 1 : 0,
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
      `SELECT r.kind, r.operation_id AS operationId,
              r.lab_test_id AS labTestId, r.lab_organ_id AS labOrganId,
              r.city_id AS cityId,
              r.other_regions_ok AS otherRegionsOk,
              r.fallback_category_id AS fallbackCategoryId
         FROM requests r WHERE r.id = ?`,
    )
    .get(requestId) as
    | {
        kind: string;
        operationId: number | null;
        labTestId: number | null;
        labOrganId: number | null;
        cityId: number;
        otherRegionsOk: number;
        fallbackCategoryId: number | null;
      }
    | undefined;
  if (!request) return false;

  // Yo'llanma shahardagi hamma tasdiqlangan klinikaga ochiq
  if (request.kind === 'referral') {
    return findAllClinicsInCity(request.cityId, {
      otherRegionsOk: Boolean(request.otherRegionsOk),
    }).some((c) => c.id === clinicId);
  }

  // Turga qarab: tahlil so'rovida shart organ bo'yicha tekshiriladi
  if (request.kind === 'lab') {
    if (!request.labTestId) return false;
    return findClinicsForLab(request.labTestId, request.cityId, {
      otherRegionsOk: Boolean(request.otherRegionsOk),
    }).some((c) => c.id === clinicId);
  }

  if (!request.operationId) return false;
  return findMatchingClinics(request.operationId, request.cityId, {
    otherRegionsOk: Boolean(request.otherRegionsOk),
    fallbackCategoryId: request.fallbackCategoryId,
  }).some((c) => c.id === clinicId);
}


/**
 * Yo'llanma so'rovi uchun klinikalar — shahardagi HAMMASI.
 *
 * Bu yerda saralanadigan narsa yo'q: yo'llanmada nima yozilgani
 * rasmda qoladi va uni faqat odam o'qiy oladi. Shuning uchun shart
 * bittagina — klinika tasdiqlangan bo'lsin.
 *
 * Tartib boshqalari bilan bir xil: avval o'z shahri, keyin obunasi
 * faol bo'lganlar, keyin reytingi yuqorilar.
 */
export function findAllClinicsInCity(
  cityId: number,
  options: { otherRegionsOk?: boolean } = {},
): ClinicPublic[] {
  const anyCity = Boolean(options.otherRegionsOk);

  const rows = db
    .prepare(
      `SELECT c.*
         FROM clinics c
        WHERE c.verification = 'approved'
          AND (@anyCity = 1 OR c.city_id = @cityId)
        ORDER BY (c.city_id = @cityId) DESC,
                 (c.subscription_status = 'active') DESC,
                 c.rating_avg DESC`,
    )
    .all({ cityId, anyCity: anyCity ? 1 : 0 }) as any[];

  return rows.map(mapClinicPublic);
}

/**
 * Tahlil so'rovi uchun klinikalar — ORGAN bo'yicha.
 *
 * Operatsiyada shart "shu operatsiyani qiladimi", tahlilda "shu
 * organ bo'yicha tekshiruv qiladimi". Boshqa shartlar bir xil:
 * shahar mos va klinika tasdiqlangan.
 *
 * Organni hech kim belgilamagan bo'lsa ro'yxat BO'SH qaytadi va
 * so'rov hech qayerga ketmaydi. Bu ataylab: tahlil qilmaydigan
 * klinikaga so'rov yuborish uni ham, bemorni ham bezovta qilardi.
 */
export function findClinicsForLab(
  testId: number,
  cityId: number,
  options: { otherRegionsOk?: boolean } = {},
): ClinicPublic[] {
  const anyCity = Boolean(options.otherRegionsOk);

  const rows = db
    .prepare(
      `SELECT c.*
         FROM clinics c
         JOIN clinic_lab_tests cl ON cl.clinic_id = c.id
        WHERE cl.test_id = @testId
          AND c.verification = 'approved'
          AND (@anyCity = 1 OR c.city_id = @cityId)
        ORDER BY (c.city_id = @cityId) DESC,
                 (c.subscription_status = 'active') DESC,
                 c.rating_avg DESC`,
    )
    .all({ testId, cityId, anyCity: anyCity ? 1 : 0 }) as any[];

  return rows.map(mapClinicPublic);
}
