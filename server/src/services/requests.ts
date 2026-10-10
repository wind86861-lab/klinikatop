/**
 * So'rov (2-bo'lim): yaratish, hayot sikli, taymer, tahrirlash/bekor qilish.
 *
 * Hayot sikli: NEW → COLLECTING → CHOSEN → COMPLETED
 *                        └──(taymer / bekor)──→ CANCELLED
 */
import { assertKindEnabled } from './requestKinds';
import { db, hoursFromNow, parseJson, tx } from '../db';
import { config } from '../lib/config';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { deleteFiles } from './files';
import { formatUzs } from '../lib/format';
import { mapCity, mapLabTest, mapOperation, mapRequest, mapUser } from '../lib/mappers';
import {
  REQUEST_KINDS,
  ageFromBirthYear,
  REQUEST_TRANSITIONS,
  UNKNOWN_OPERATION_SLUG,
  isProfileComplete,
  type RequestStatus,
  type RequestWithMeta,
  type Urgency,
  requestTitle,
  type RequestKind,
} from '../../../shared/types';
import { bus, ch } from './events';
import { findAllClinicsInCity, findClinicsForLab, findMatchingClinics } from './matching';
import { selectableLabTestIds } from './labOrgans';
import { notify, notifyClinic } from './notifications';
import { validateAnswers } from './requestSteps';
import { TERMS_VERSION, recordAcceptance } from './terms';
import { assertOwnedFiles, listFiles } from './files';

const REQUEST_SELECT = `
  SELECT r.*,
         (SELECT COUNT(*) FROM request_broadcasts b WHERE b.request_id = r.id) AS broadcast_count,
         (SELECT COUNT(*) FROM request_broadcasts b WHERE b.request_id = r.id AND b.viewed_at IS NOT NULL) AS viewed_count,
         (SELECT COUNT(*) FROM offers o WHERE o.request_id = r.id AND o.status IN ('SENT','CHOSEN')) AS offers_count
    FROM requests r
`;

export function hydrate(row: any): RequestWithMeta {
  /*
   * Ikki tur, ikki manba: operatsiya so'rovida `operation`, tahlil
   * so'rovida `labTest` to'ladi. Ikkovi hech qachon birga bo'lmaydi.
   */
  const operation = row.operation_id
    ? db.prepare(`SELECT * FROM operations WHERE id = ?`).get(row.operation_id)
    : null;
  const test = row.lab_test_id
    ? db.prepare(`SELECT * FROM lab_tests WHERE id = ?`).get(row.lab_test_id)
    : null;
  const city = db.prepare(`SELECT * FROM cities WHERE id = ?`).get(row.city_id);
  return {
    ...mapRequest(row),
    operation: operation ? mapOperation(operation) : null,
    labTest: test ? mapLabTest(test) : null,
    city: mapCity(city),
    offersCount: row.offers_count ?? 0,
    files: listFiles(parseJson<string[]>(row.attachments, [])),
  };
}

export function getRequest(id: number): RequestWithMeta {
  const row = db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id);
  if (!row) throw notFound('So‘rov topilmadi');
  return hydrate(row);
}

export function listPatientRequests(patientId: number): RequestWithMeta[] {
  const rows = db.prepare(`${REQUEST_SELECT} WHERE r.patient_id = ? ORDER BY r.id DESC`).all(patientId) as any[];
  return rows.map(hydrate);
}

/** Holat o'tishi ruxsat etilganmi — state machine majburlanadi. */
export function assertTransition(from: RequestStatus, to: RequestStatus) {
  if (!REQUEST_TRANSITIONS[from].includes(to)) {
    throw conflict('invalid_transition', `So‘rov holatini ${from} → ${to} ga o‘zgartirib bo‘lmaydi`);
  }
}

export interface CreateRequestInput {
  patientId: number;
  /** Operatsiya so'rovimi yoki tahlil. Berilmasa — operatsiya. */
  kind?: RequestKind;
  /** Operatsiya so'rovida majburiy, tahlilda ishlatilmaydi */
  operationId?: number | null;
  /** Tahlil so'rovida majburiy: qanday tekshiruv */
  labTestId?: number | null;
  /** Yo'llanma so'rovida qo'lda yozilgan analiz nomlari */
  referralItems?: string[] | null;
  /** Tahlil so'rovida so'raladi (kg) */
  weightKg?: number | null;
  cityId: number;
  budgetUzs: number | null;
  /** Holat tavsifi — bemor o'z so'zi bilan yozadi, majburiy */
  conditionText: string;
  note: string | null;
  urgency: Urgency;
  attachments: string[];
  otherRegionsOk: boolean;
  dateFrom: string | null;
  dateTo: string | null;
  dateFlexible: boolean;
  /** AI suhbati — bemor nima yozganini klinika to'liq ko'radi */
  aiConversation?: { role: 'user' | 'assistant'; content: string }[] | null;
  aiSuggested: boolean;
  /**
   * So'rov kimga: o'ziga (true) yoki tanishiga (false).
   * Tanishiga bo'lsa quyidagi maydonlar to'ldiriladi va profil
   * ma'lumotlari ISHLATILMAYDI — klinika noto'g'ri odamning yoshini
   * ko'rmasligi kerak.
   */
  forSelf?: boolean;
  subjectName?: string | null;
  subjectBirthYear?: number | null;
  /** Admin qo'shgan savollarga javoblar — kalit: bosqich kaliti */
  extraAnswers?: Record<string, unknown> | null;
  /** Operatsiya noma'lum bo'lsa — AI aniqlagan soha */
  fallbackCategoryId?: number | null;
  subjectGender?: 'male' | 'female' | null;
  /** Bemor ommaviy ofertani qabul qilganini tasdiqlaydi — har so'rovda majburiy */
  acceptTerms: boolean;
  userAgent?: string | null;
  /**
   * Shifokor yaratgan va bemor tasdiqlagan so'rov. Admin qo'shgan
   * savollar bu yo'lda SO'RALMAYDI: bemor ularni ko'rmagan, shifokor
   * esa ularning javobini bilmaydi — majburiy savol so'rovni
   * butunlay to'xtatib qo'yardi.
   */
  doctorCaseId?: number | null;
  /**
   * Bemor qarshi ko'rsatmalar yo'qligini tasdiqladi. Tekshiruvda
   * qarshi ko'rsatmalar matni bo'lsa — MAJBURIY (kapsula endoskopiyasi).
   */
  contraindicationsAck?: boolean;
}

/**
 * Sana oralig'i va "moslashuvchan" belgisini bir shaklga keltiradi.
 *
 * ═══ Ular MUSTAQIL maydon emas ═══
 *
 * "Moslashuvchan" degani "aniq oraliq yo'q" degani. Ilgari ikkalasi
 * alohida yozilardi va bir-biriga zid holat yuzaga kelardi: bemor
 * 28–31 avgustni belgilab, ustiga "moslashuvchan" ni ham yoqib
 * qo'yardi. Klinika buni qanday tushunishi kerak edi — sanaga
 * qat'iymi yoki yo'qmi? Javob yo'q edi.
 *
 * Endi belgi HISOBLANADI: oraliq bor bo'lsa moslashuvchan emas,
 * oraliq yo'q bo'lsa moslashuvchan. Zid holatni yozib bo'lmaydi.
 *
 * ═══ O'tmish sanasi ═══
 *
 * Kelgusi operatsiyani o'tgan kunga belgilab bo'lmaydi. Ilgari server
 * buni umuman tekshirmasdi: har qanday matn 40 belgigacha o'tardi va
 * klinikaga "2020-yil 1-yanvar" bo'lib borardi.
 */
export interface DateWindow {
  dateFrom: string | null;
  dateTo: string | null;
  dateFlexible: boolean;
}

export function normalizeDateWindow(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
): DateWindow {
  const today = new Date().toISOString().slice(0, 10);
  const shape = /^\d{4}-\d{2}-\d{2}$/;

  const from = (dateFrom ?? '').slice(0, 10) || null;
  const to = (dateTo ?? '').slice(0, 10) || null;

  if (from && !shape.test(from)) throw badRequest('invalid_date', 'Sana noto‘g‘ri');
  if (to && !shape.test(to)) throw badRequest('invalid_date', 'Sana noto‘g‘ri');

  if (from && from < today) {
    throw badRequest('date_in_past', 'O‘tgan sanaga operatsiya belgilab bo‘lmaydi');
  }
  if (to && to < today) {
    throw badRequest('date_in_past', 'O‘tgan sanaga operatsiya belgilab bo‘lmaydi');
  }
  if (from && to && to < from) {
    throw badRequest('date_order', 'Tugash sanasi boshlanishidan oldin bo‘lmaydi');
  }

  // Faqat tugash sanasi berilgan bo'lsa — u oraliqning boshi bo'ladi
  const start = from ?? to;
  const end = from ? to : null;

  return { dateFrom: start, dateTo: end, dateFlexible: start === null };
}

/**
 * Qo'lda yozilgan analiz nomlarini tozalaydi.
 *
 * Bemor yozgani — erkin matn, ya'ni unda ortiqcha probel, takror va
 * bo'sh qatorlar bo'ladi. Klinikaga toza ro'yxat borishi kerak:
 * takrorlangan band unga "ikki marta kerakmi?" degan savol berardi.
 *
 * Chegara 30 ta: bundan ko'pi yo'llanma emas, boshqa narsa.
 */
const MAX_REFERRAL_ITEMS = 30;

function cleanReferralItems(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of raw) {
    const item = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (item.length < 2) continue;

    // Takror faqat KATTA-KICHIK harf bilan farq qilsa ham takror
    const key = item.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(item);
    if (out.length >= MAX_REFERRAL_ITEMS) break;
  }

  return out;
}

/**
 * Byudjetni turga va operatsiyaning narx oralig'iga solishtiradi.
 *
 * Qaytaradigan qiymat — BAZAGA yoziladigan byudjet. Tahlil va
 * yo'llanmada bu doim `null`: u yerda narxni bemor emas, klinika
 * biladi.
 *
 * Nega bittasi jimgina tashlanadi, ikkinchisi rad etiladi:
 *
 *  - Tur mos kelmasa (tahlilga byudjet) — TASHLANADI. Bemorning
 *    telefonida ilovaning eski keshlangan versiyasi turishi mumkin
 *    va u hali byudjet so'rayveradi. Xato qaytarilsa bemor buni
 *    tuzata olmaydi, faqat "yuborilmadi" ni ko'radi.
 *  - Oraliqdan chiqsa — RAD ETILADI. Bu bemorning ongli tanlovi;
 *    jimgina o'chirib tashlash so'rovni "byudjetim yo'q" holatiga
 *    aylantiradi, klinikalar esa bajarilmaydigan so'rovni ko'rib
 *    har birini qo'lda rad etishga majbur bo'lardi.
 */
function resolveBudget(
  kind: RequestKind,
  operationId: number | null,
  budgetUzs: number | null | undefined,
): number | null {
  if (kind !== 'operation') return null;
  const budget = budgetUzs ?? null;
  if (budget == null) return null;

  if (budget < 500_000 || budget > 2_000_000_000) {
    throw badRequest('invalid_budget', 'Byudjet noto‘g‘ri');
  }

  const range = operationId
    ? (db
        .prepare(`SELECT min_price_uzs, max_price_uzs FROM operations WHERE id = ?`)
        .get(operationId) as { min_price_uzs: number | null; max_price_uzs: number | null } | undefined)
    : undefined;

  if (range?.min_price_uzs != null && budget < range.min_price_uzs) {
    throw badRequest(
      'budget_below_min',
      `Bu operatsiya uchun eng kam byudjet ${formatUzs(range.min_price_uzs)}`,
    );
  }
  if (range?.max_price_uzs != null && budget > range.max_price_uzs) {
    throw badRequest(
      'budget_above_max',
      `Bu operatsiya uchun eng ko‘p byudjet ${formatUzs(range.max_price_uzs)}`,
    );
  }
  return budget;
}

export function createRequest(input: CreateRequestInput): RequestWithMeta {
  // Profil to'liq bo'lmasa so'rov yuborilmaydi: klinika kimga taklif
  // berayotganini bilishi kerak (ism, familiya, viloyat)
  const profile = db.prepare(`SELECT * FROM users WHERE id = ?`).get(input.patientId);
  if (!profile) throw notFound('Foydalanuvchi topilmadi');
  if (!isProfileComplete(mapUser(profile))) {
    throw conflict('profile_incomplete', 'Avval ism, familiya va viloyatni to‘ldiring');
  }

  // Ommaviy oferta — har so'rovda qabul qilinadi (yuridik talab)
  if (!input.acceptTerms) {
    throw badRequest('terms_not_accepted', 'Ommaviy oferta shartlarini qabul qiling');
  }

  const window = normalizeDateWindow(input.dateFrom, input.dateTo);

  /*
   * Faol so'rovlar soniga cheklov YO'Q.
   *
   * Ilgari bir vaqtda uchtadan ortiq so'rov qoldirib bo'lmasdi. Amalda
   * bu haqiqiy bemorga xalaqit berardi: bitta odamda bir necha muammo
   * bo'lishi mumkin, oila a'zolari uchun ham so'rov qoldiradi va eski
   * so'rovlar yopilishini kutib o'tirishga majbur edi.
   *
   * Spamdan himoya boshqa qatlamda: `limits.write` daqiqada 60 ta
   * yozuv amaliga ruxsat beradi. Odam uchun bu juda keng, skript uchun
   * esa tor — ya'ni toshqinni o'sha yerda to'xtatamiz, oddiy
   * foydalanuvchini cheklamasdan.
   */

  const kind: RequestKind = REQUEST_KINDS.includes(input.kind as RequestKind)
    ? (input.kind as RequestKind)
    : 'operation';
  // Admin o'chirgan tur — qabul qilinmaydi (eski ilova ham o'tkaza olmaydi)
  assertKindEnabled(kind);

  /*
   * Uch tur — uch xil majburiy maydon.
   *
   * Operatsiyada operatsiya va holat tavsifi kerak; tahlilda
   * tekshiruv va vazn; yo'llanmada esa faqat rasm — qolgan hamma
   * narsa o'sha qog'ozda yozilgan. Ularni bitta tekshiruvga
   * qo'shib bo'lmaydi: har birida boshqasining maydoni umuman yo'q.
   */
  let op: { slug: string } | null = null;
  let labTestId: number | null = null;
  let referralItems: string[] = [];
  let weightKg: number | null = null;
  /** Qarshi ko'rsatmalar tasdiqlandi (faqat ular bor tekshiruvda yoziladi) */
  let contraAck = false;
  let condition = '';

  if (kind === 'referral') {
    /*
     * RASM YOKI RO'YXAT — bittasi bo'lsa yetarli.
     *
     * Yo'llanma so'rovining butun mazmuni klinikaga nima kerakligini
     * aytishda. Buni ikki yo'l bilan aytish mumkin: qog'ozni suratga
     * olish yoki analiz nomlarini yozish. Ikkovi ham bo'lmasa, so'rov
     * klinikaga "nimadir kerak" degan bo'sh xabar bo'lib borardi va
     * hech kim taklif bera olmasdi.
     *
     * Ilgari faqat rasm qabul qilinardi. Lekin qog'oz har doim ham
     * bo'lavermaydi: shifokor og'zaki aytgan, yoki suratda yozuv
     * o'qilmayapti.
     */
    referralItems = cleanReferralItems(input.referralItems);

    if (!input.attachments?.length && referralItems.length === 0) {
      throw badRequest(
        'referral_empty',
        'Yo‘llanmani rasmga oling yoki kerakli analizlarni yozing',
      );
    }
  } else if (kind === 'lab') {
    const test = db
      .prepare(`SELECT id, name_uz, needs_weight, contra_uz, min_age, max_age FROM lab_tests WHERE id = ? AND active = 1`)
      .get(input.labTestId ?? 0) as
      | { id: number; name_uz: string; needs_weight: number; contra_uz: string | null; min_age: number | null; max_age: number | null }
      | undefined;
    if (!test) throw badRequest('test_required', 'Qanday tekshiruv kerakligini tanlang');

    /*
     * GURUHNI tanlab bo'lmaydi.
     *
     * "MRT" degan javob klinikaga hech narsa aytmaydi: MRT ning
     * o'zi 24 xil va har birining narxi boshqa. Ilova ro'yxatni
     * o'zi cheklaydi, lekin unga ishonib bo'lmaydi.
     */
    if (!selectableLabTestIds().has(test.id)) {
      throw badRequest('test_is_group', 'Guruh ichidan aniq tekshiruvni tanlang');
    }
    labTestId = test.id;

    /*
     * YOSH CHEGARASI (kapsula endoskopiyasi: 18–65).
     *
     * Bemor o'zi uchun so'rasa — profilidagi tug'ilgan yil, boshqa
     * odam uchun — "kimga" qadamida kiritilgani. Chegaradan tashqaridagi
     * so'rov klinikaga yetib bormaydi: ilova ham to'xtatadi, lekin unga
     * ishonib bo'lmaydi (eski ilova, shifokor taklifnomasi).
     */
    if (test.min_age != null || test.max_age != null) {
      const birthYear = input.forSelf === false ? (input.subjectBirthYear ?? null) : (mapUser(profile).birthYear ?? null);
      const age = ageFromBirthYear(birthYear);
      if (age == null) {
        throw badRequest('age_required', 'Bu tekshiruv uchun bemorning tug‘ilgan yili kerak');
      }
      const tooYoung = test.min_age != null && age < test.min_age;
      const tooOld = test.max_age != null && age > test.max_age;
      if (tooYoung || tooOld) {
        const range =
          test.min_age != null && test.max_age != null
            ? `${test.min_age} yoshdan ${test.max_age} yoshgacha`
            : test.min_age != null
              ? `${test.min_age} yoshdan katta`
              : `${test.max_age} yoshgacha`;
        throw badRequest('age_not_allowed', `${test.name_uz} faqat ${range} bo‘lgan bemorlarga o‘tkaziladi`);
      }
    }


    /*
     * Vazn — 2 dan 400 kg gacha. Chegara keng: chaqaloq ham,
     * kattalar ham shu oraliqda. Undan tashqarisi xato kiritish.
     */
    /*
     * Vazn har tekshiruvda ham kerak emas: kapsula endoskopiyasida
     * klinikaga YOSH kerak (u profilda/"kimga" qadamida bor), vazn emas.
     */
    if (test.needs_weight !== 0) {
      const w = Number(input.weightKg);
      if (!Number.isFinite(w) || w < 2 || w > 400) {
        throw badRequest('invalid_weight', 'Vaznni kilogrammda kiriting');
      }
      weightKg = Math.round(w);
    }

    /*
     * Qarshi ko'rsatmalar — bemor ularni ko'rib, "menda yo'q" deb
     * tasdiqlamaguncha so'rov ketmaydi. Eski ilova bu qadamni
     * bilmasa ham server o'tkazib yubormaydi.
     */
    if (test.contra_uz && input.contraindicationsAck !== true) {
      throw badRequest(
        'contraindications_required',
        'Qarshi ko‘rsatmalar bilan tanishib, ular sizda yo‘qligini tasdiqlang',
      );
    }
    contraAck = Boolean(test.contra_uz);
  } else {
    // "Bilmayman" yozuvi katalogda active=0 — u ro'yxatlarda ko'rinmaydi,
    // lekin so'rovda tanlanishi mumkin
    op = db
      .prepare(`SELECT * FROM operations WHERE id = ? AND (active = 1 OR slug = ?)`)
      .get(input.operationId ?? 0, UNKNOWN_OPERATION_SLUG) as { slug: string } | undefined ?? null;
    if (!op) throw badRequest('unknown_operation', 'Bunday operatsiya topilmadi');

    condition = (input.conditionText ?? '').trim();
    if (condition.length < 10) {
      throw badRequest('condition_required', 'Holatingizni kamida bir-ikki jumlada yozing');
    }
  }

  // Hujjatlar haqiqatan bemorga tegishlimi
  assertOwnedFiles(input.attachments ?? [], input.patientId);
  const city = db.prepare(`SELECT * FROM cities WHERE id = ?`).get(input.cityId);
  if (!city) throw badRequest('unknown_city', 'Bunday shahar topilmadi');
  const budgetUzs = resolveBudget(kind, input.operationId ?? null, input.budgetUzs);

  // Admin qo'shgan savollar: majburiylari to'ldirilganmi
  /*
   * Javoblar TEKSHIRUVGA qarab tekshiriladi: tahlilga bog'langan
   * savol boshqa tekshiruvda ham, operatsiya so'rovida ham
   * so'ralmaydi.
   */
  const extraAnswers = input.doctorCaseId ? null : validateAnswers(input.extraAnswers ?? null, { kind, labTestId });

  /*
   * Soha zaxirasi FAQAT operatsiya noma'lum bo'lganda ma'noga ega.
   * Aniq operatsiya tanlangan bo'lsa u kerak emas va saqlanmaydi —
   * aks holda ikkita manba paydo bo'lib, qaysi biri to'g'ri degan
   * savol chiqardi.
   */
  const unknownOp = op?.slug === UNKNOWN_OPERATION_SLUG;
  let fallbackCategoryId: number | null = null;
  if (unknownOp && input.fallbackCategoryId != null) {
    const cat = db
      .prepare(`SELECT id FROM operation_categories WHERE id = ?`)
      .get(input.fallbackCategoryId);
    if (cat) fallbackCategoryId = input.fallbackCategoryId;
  }

  const requestId = tx(() => {
    const info = db
      .prepare(
        `INSERT INTO requests (patient_id, kind, operation_id, lab_test_id, lab_organ_id, weight_kg,
                               city_id, budget_uzs, condition_text, note,
                               urgency, attachments, other_regions_ok, date_from, date_to, date_flexible,
                               ai_conversation, status, ai_suggested, expires_at, terms_version, terms_accepted_at,
                               for_self, subject_name, subject_birth_year, subject_gender, extra_answers,
                               fallback_category_id, referral_items)
         VALUES (@patientId, @kind, @operationId, @labTestId, NULL, @weightKg,
                 @cityId, @budgetUzs, @conditionText, @note,
                 @urgency, @attachments, @otherRegionsOk, @dateFrom, @dateTo, @dateFlexible,
                 @aiConversation, 'NEW', @aiSuggested, @expiresAt, @termsVersion, datetime('now'),
                 @forSelf, @subjectName, @subjectBirthYear, @subjectGender, @extraAnswers,
                 @fallbackCategoryId, @referralItems)`,
      )
      .run({
        patientId: input.patientId,
        kind,
        operationId: kind === 'operation' ? (input.operationId ?? null) : null,
        labTestId,
        // Bo'sh ro'yxat `null` bo'lib yozilsin: "yo'q" va "bo'sh" bir xil
        referralItems: referralItems.length ? JSON.stringify(referralItems) : null,
        weightKg,
        cityId: input.cityId,
        budgetUzs,
        conditionText: condition || null,
        note: input.note,
        urgency: input.urgency,
        attachments: JSON.stringify(input.attachments ?? []),
        otherRegionsOk: input.otherRegionsOk ? 1 : 0,
        // Tanishiga bo'lsa profil ma'lumotlari ishlatilmaydi
        forSelf: input.forSelf === false ? 0 : 1,
        subjectName: input.forSelf === false ? (input.subjectName?.trim()?.slice(0, 120) || null) : null,
        subjectBirthYear: input.forSelf === false ? (input.subjectBirthYear ?? null) : null,
        subjectGender: input.forSelf === false ? (input.subjectGender ?? null) : null,
        dateFrom: window.dateFrom,
        dateTo: window.dateTo,
        // Belgi hisoblanadi — zid holat yozib bo'lmaydi
        dateFlexible: window.dateFlexible ? 1 : 0,
        aiConversation: input.aiConversation?.length ? JSON.stringify(input.aiConversation) : null,
        aiSuggested: input.aiSuggested ? 1 : 0,
        expiresAt: hoursFromNow(config.rules.requestTtlHours),
        termsVersion: TERMS_VERSION,
        extraAnswers,
        fallbackCategoryId,
      });

    const id = Number(info.lastInsertRowid);

    /*
     * Vazn PROFILGA ham yoziladi — faqat o'ziga so'rov qoldirganda.
     *
     * Keyingi safar maydon o'zi to'ladi va odam uni qayta yozmaydi.
     * Tanishiga so'rov qoldirsa yozilmaydi: bu boshqa odamning vazni
     * va uni o'z profiliga saqlash xato bo'lardi.
     */
    if (weightKg && input.forSelf !== false) {
      db.prepare(`UPDATE users SET weight_kg = ? WHERE id = ?`).run(weightKg, input.patientId);
    }

    // Qabul alohida jadvalga ham yoziladi — so'rov o'chsa ham dalil qoladi
    recordAcceptance(input.patientId, id, input.userAgent ?? null);
    // Tarqatishdan OLDIN: klinika so'rovni birinchi ko'rganidayoq belgi tursin
    if (input.doctorCaseId) {
      db.prepare(`UPDATE requests SET doctor_case_id = ? WHERE id = ?`).run(input.doctorCaseId, id);
    }
    if (contraAck) db.prepare(`UPDATE requests SET contra_ack_at = datetime('now') WHERE id = ?`).run(id);
    return id;
  });

  broadcast(requestId);
  return getRequest(requestId);
}

/** So'rovni mos klinikalarga bir vaqtda tarqatish (2.2 → COLLECTING). */
export function broadcast(requestId: number): number {
  const req = getRequest(requestId);

  /*
   * Uch tur, uch yo'l: operatsiya so'rovi o'sha operatsiyani
   * qiladigan klinikalarga, tahlil so'rovi o'sha TEKSHIRUVNI
   * qiladiganlarga, yo'llanma esa shahardagi HAMMASIGA.
   *
   * Yo'llanmada torroq qilib bo'lmaydi: qog'ozda nima yozilganini
   * hali hech kim o'qimagan — server ham, bemor ham. Kimga
   * mos kelishini faqat klinikaning o'zi rasmni ko'rib hal qiladi.
   */
  const clinics =
    req.kind === 'referral'
      ? findAllClinicsInCity(req.cityId, { otherRegionsOk: req.otherRegionsOk })
      : req.kind === 'lab'
        ? req.labTestId
          ? findClinicsForLab(req.labTestId, req.cityId, { otherRegionsOk: req.otherRegionsOk })
          : []
        : req.operationId
          ? findMatchingClinics(req.operationId, req.cityId, {
              otherRegionsOk: req.otherRegionsOk,
              fallbackCategoryId: req.fallbackCategoryId,
            })
          : [];

  /*
   * Xabar faqat YANGI qo'shilgan klinikaga boradi. Qayta yuborishda
   * (admin "qayta yuborish" bosganda) oldin xabar olgan klinikaga
   * takroriy bildirishnoma ketmaydi — `INSERT OR IGNORE` o'zgarish
   * bo'lmagan qatorni shu yerda ko'rsatadi.
   */
  const added: typeof clinics = [];
  tx(() => {
    const ins = db.prepare(
      `INSERT OR IGNORE INTO request_broadcasts (request_id, clinic_id) VALUES (?, ?)`,
    );
    for (const c of clinics) if (ins.run(requestId, c.id).changes === 1) added.push(c);
    db.prepare(`UPDATE requests SET status = 'COLLECTING' WHERE id = ? AND status = 'NEW'`).run(requestId);
  });

  const fresh = getRequest(requestId);

  for (const c of added) {
    bus.publish(ch.clinic(c.id), { type: 'clinic:request', request: fresh });
    notifyClinic(
      c.id,
      'new_request',
      {
        operation: requestTitle(fresh),
        city: fresh.city.nameUz,
        budget: formatUzs(fresh.budgetUzs),
        requestId,
      },
      `/clinic/requests/${requestId}`,
    );
  }

  publishProgress(requestId);
  bus.publish(ch.request(requestId), { type: 'request:status', requestId, status: 'COLLECTING' });
  return added.length;
}

export function publishProgress(requestId: number) {
  const r = db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(requestId) as any;
  if (!r) return;
  bus.publish(ch.request(requestId), {
    type: 'request:progress',
    requestId,
    broadcastCount: r.broadcast_count ?? 0,
    viewedCount: r.viewed_count ?? 0,
    offersCount: r.offers_count ?? 0,
  });
}

/** Klinika so'rovni ochdi — radar vizuali uchun (4-ekran). */
export function markViewed(requestId: number, clinicId: number) {
  const res = db
    .prepare(
      `UPDATE request_broadcasts SET viewed_at = datetime('now')
        WHERE request_id = ? AND clinic_id = ? AND viewed_at IS NULL`,
    )
    .run(requestId, clinicId);
  if (res.changes > 0) publishProgress(requestId);
}

/** 2.4: TANLANGAN bo'lgunicha byudjet/izohni tahrirlash mumkin. */
export function updateRequest(
  requestId: number,
  patientId: number,
  patch: { budgetUzs?: number | null; note?: string | null; urgency?: Urgency },
): RequestWithMeta {
  const req = getRequest(requestId);
  if (req.patientId !== patientId) throw forbidden('Bu so‘rov sizniki emas');
  if (req.status !== 'NEW' && req.status !== 'COLLECTING') {
    throw conflict('request_locked', 'Tanlov qilingandan keyin so‘rovni tahrirlab bo‘lmaydi');
  }

  /*
   * Tahrirlashda ham AYNAN shu qoida. Aks holda oraliq chetlab
   * o'tilardi: to'g'ri byudjet bilan so'rov yuborib, keyin uni
   * tahrirlab oraliqdan chiqarib qo'yish mumkin bo'lardi.
   */
  const budgetUzs =
    patch.budgetUzs === undefined
      ? null
      : resolveBudget(req.kind, req.operationId, patch.budgetUzs);

  db.prepare(
    `UPDATE requests SET
       budget_uzs = COALESCE(@budgetUzs, budget_uzs),
       note       = COALESCE(@note, note),
       urgency    = COALESCE(@urgency, urgency)
     WHERE id = @id`,
  ).run({
    id: requestId,
    budgetUzs,
    note: patch.note ?? null,
    urgency: patch.urgency ?? null,
  });

  return getRequest(requestId);
}

/** 2.4: bekor qilinsa barcha faol takliflar avto rad etiladi + klinikalarga xabar. */
export function cancelRequest(requestId: number, patientId: number): RequestWithMeta {
  const req = getRequest(requestId);
  if (req.patientId !== patientId) throw forbidden('Bu so‘rov sizniki emas');
  assertTransition(req.status, 'CANCELLED');

  const affected = db
    .prepare(`SELECT id, clinic_id FROM offers WHERE request_id = ? AND status = 'SENT'`)
    .all(requestId) as { id: number; clinic_id: number }[];

  tx(() => {
    db.prepare(`UPDATE offers SET status = 'REJECTED', updated_at = datetime('now')
                 WHERE request_id = ? AND status = 'SENT'`).run(requestId);
    db.prepare(`UPDATE requests SET status = 'CANCELLED' WHERE id = ?`).run(requestId);
  });

  for (const o of affected) {
    notifyClinic(o.clinic_id, 'offer_rejected', { operation: requestTitle(req) }, `/clinic/offers`);
  }
  bus.publish(ch.request(requestId), { type: 'request:status', requestId, status: 'CANCELLED' });
  return getRequest(requestId);
}

/**
 * So'rovni butunlay o'chirish.
 *
 * Bekor qilishdan farqi: bekor qilingan so'rov ro'yxatda qoladi va
 * tarixda ko'rinadi, o'chirilgani esa yo'q bo'ladi. Bemor tibbiy
 * holati haqidagi yozuvni butunlay olib tashlay olishi kerak — bu
 * uning ma'lumoti.
 *
 * BITIM TUZILGAN so'rov o'chirilmaydi. Sabab texnik emas, adolat
 * masalasi: bitim ikki tomonning kelishuvi, unda klinikaning ishi,
 * to'lovi va komissiya hisobi bor. Bir tomon uni bir bosishda yo'q
 * qila olsa, ikkinchi tomon himoyasiz qolardi. Bunday so'rovni bekor
 * qilish yoki nizo ochish mumkin.
 *
 * Biriktirilgan fayllar ham o'chiriladi — diskdan ham, bazadan ham.
 * Aks holda o'chirilgan so'rovning tibbiy suratlari serverda qolib
 * ketardi va "o'chirdim" degan so'z yolg'on bo'lardi.
 */
export function deleteRequest(requestId: number, patientId: number): void {
  const req = getRequest(requestId);
  if (req.patientId !== patientId) throw forbidden('Bu so‘rov sizniki emas');

  const deal = db.prepare(`SELECT id FROM deals WHERE request_id = ?`).get(requestId);
  if (deal) {
    throw conflict(
      'request_has_deal',
      'Bitim tuzilgan so‘rovni o‘chirib bo‘lmaydi. Uni bekor qilishingiz mumkin.',
    );
  }

  // Takliflar bekor bo'lgani haqida klinikalarga xabar beramiz:
  // ular vaqt sarflagan va javob kutayotgan bo'lishi mumkin
  const affected = db
    .prepare(`SELECT clinic_id FROM offers WHERE request_id = ? AND status = 'SENT'`)
    .all(requestId) as { clinic_id: number }[];

  const attachments = req.attachments;

  tx(() => {
    /*
     * So'rov o'chirilsa `request_broadcasts` va `offers` kaskad bilan
     * ketadi. Fayllarni esa qo'lda olamiz: ular alohida jadvalda va
     * so'rovga faqat identifikator orqali bog'langan.
     */
    db.prepare(`DELETE FROM requests WHERE id = ?`).run(requestId);
    if (attachments.length > 0) deleteFiles(attachments, patientId);
  });

  for (const o of affected) {
    notifyClinic(o.clinic_id, 'offer_rejected', { operation: requestTitle(req) }, `/clinic/offers`);
  }

  bus.publish(ch.request(requestId), { type: 'request:status', requestId, status: 'CANCELLED' });
}

/**
 * Taymer (2.3) — planlashtiruvchi chaqiradi.
 *  - Muddat tugadi va taklif YO'Q  → BEKOR + "byudjetni oshiring" bildirishnomasi
 *  - Taklif BOR                    → so'rov faol qoladi, takliflar muddati uzayadi
 *  - Tugashiga 1 soat qolganda     → ogohlantirish
 */
export function processExpirations(): { expired: number; warned: number } {
  const soon = db
    .prepare(
      `${REQUEST_SELECT}
        WHERE r.status IN ('NEW','COLLECTING')
          AND r.expiring_notified = 0
          AND r.expires_at <= datetime('now', ?)
          AND r.expires_at > datetime('now')`,
    )
    .all(`+${config.rules.expiryWarningHours} hours`) as any[];

  for (const row of soon) {
    const req = hydrate(row);
    notify(req.patientId, 'request_expiring', { operation: requestTitle(req) }, `/request/${req.id}`);
    db.prepare(`UPDATE requests SET expiring_notified = 1 WHERE id = ?`).run(req.id);
  }

  const expired = db
    .prepare(`${REQUEST_SELECT} WHERE r.status IN ('NEW','COLLECTING') AND r.expires_at <= datetime('now')`)
    .all() as any[];

  let cancelled = 0;
  for (const row of expired) {
    const req = hydrate(row);
    if (req.offersCount > 0) {
      // Taklif kelgan — so'rov yopilmaydi, muddat uzaytiriladi (bemor tanlashi kerak)
      db.prepare(`UPDATE requests SET expires_at = datetime('now', '+24 hours') WHERE id = ?`).run(req.id);
      continue;
    }
    tx(() => {
      db.prepare(`UPDATE offers SET status = 'EXPIRED', updated_at = datetime('now')
                   WHERE request_id = ? AND status = 'SENT'`).run(req.id);
      db.prepare(`UPDATE requests SET status = 'CANCELLED' WHERE id = ?`).run(req.id);
    });
    notify(req.patientId, 'request_expired', { operation: requestTitle(req) }, `/new`);
    bus.publish(ch.request(req.id), { type: 'request:status', requestId: req.id, status: 'CANCELLED' });
    cancelled++;
  }

  return { expired: cancelled, warned: soon.length };
}

/** Klinikaning so'rovlar oqimi (5.3 / 10-ekran). */
export function listClinicRequests(clinicId: number, opts: { onlyNew?: boolean } = {}): RequestWithMeta[] {
  const rows = db
    .prepare(
      `${REQUEST_SELECT}
         JOIN request_broadcasts b ON b.request_id = r.id AND b.clinic_id = @clinicId
        WHERE r.status IN ('NEW','COLLECTING')
          ${opts.onlyNew ? `AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.request_id = r.id AND o.clinic_id = @clinicId AND o.status IN ('SENT','CHOSEN'))` : ''}
        ORDER BY r.id DESC`,
    )
    .all({ clinicId }) as any[];
  return rows.map(hydrate);
}
