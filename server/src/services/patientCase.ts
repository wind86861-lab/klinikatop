/**
 * Bemorning klinikaga ko'rinadigan tibbiy tavsifi.
 *
 * ═══ Nima uchun kerak ═══
 *
 * Narx holatga bog'liq. 70 yoshli bemorda va 30 yoshlida bir xil
 * operatsiya boshqacha: anesteziya xavfi, yotoq kunlari, tiklanish
 * muddati farq qiladi. Ortiqcha vazn, diabet, qon suyultiruvchi dori —
 * bularning har biri jarrohlik rejasini o'zgartiradi.
 *
 * Klinika buni taklif berishdan OLDIN ko'rmasa, narx taxminiy bo'ladi
 * va bemor kelganda o'zgaradi. Aynan shundan nizolar chiqadi.
 *
 * ═══ Nima KO'RINMAYDI ═══
 *
 * Ism, familiya, telefon — hech biri. Klinika HOLATNI ko'radi, odamni
 * emas. Tanishish tanlangandan keyin, chatda bo'ladi.
 *
 * Bu ataylab shunday: taklif bosqichida klinika bemorni tanisa,
 * u bilan platformadan tashqarida bog'lanish vasvasasi paydo bo'ladi
 * va bemor platformaning himoyasisiz qoladi.
 */
import { db } from '../db';
import { ageFromBirthYear, type Gender, type PatientCase } from '../../../shared/types';
import { getMedicalProfile } from './medicalProfile';

/**
 * So'rov bo'yicha bemor holati.
 *
 * Ikki manba bor va ular aralashmaydi:
 *   • so'rov O'ZIGA bo'lsa — bemor profili va tibbiy anketasi
 *   • TANISHIGA bo'lsa — so'rovda ko'rsatilgan yosh va jins
 *
 * Ikkinchi holatda anketa ISHLATILMAYDI: u so'rov qoldirgan odamniki,
 * operatsiya esa boshqa odamga. Birovning surunkali kasalligini
 * ikkinchisiga yozib qo'yish xavfli xato bo'lardi.
 */
export function patientCaseForRequest(requestId: number): PatientCase {
  const req = db
    .prepare(
      `SELECT patient_id, for_self, subject_birth_year, subject_gender, condition_text
         FROM requests WHERE id = ?`,
    )
    .get(requestId) as any;

  if (!req) {
    return emptyCase();
  }

  const forSelf = req.for_self !== 0;

  if (!forSelf) {
    return {
      ...emptyCase(),
      forSelf: false,
      ageYears: req.subject_birth_year ? ageFromBirthYear(req.subject_birth_year) : null,
      gender: (req.subject_gender ?? null) as Gender | null,
      conditionText: req.condition_text ?? null,
    };
  }

  const user = db
    .prepare(`SELECT birth_year, gender FROM users WHERE id = ?`)
    .get(req.patient_id) as any;

  const medical = getMedicalProfile(req.patient_id);

  return {
    forSelf: true,
    ageYears: user?.birth_year ? ageFromBirthYear(user.birth_year) : null,
    gender: (user?.gender ?? null) as Gender | null,
    heightCm: medical.heightCm,
    weightKg: medical.weightKg,
    bmi: bodyMassIndex(medical.heightCm, medical.weightKg),
    bloodType: medical.bloodType,
    chronicConditions: medical.chronicConditions,
    pastSurgeries: medical.pastSurgeries,
    allergies: medical.allergies,
    medications: medical.medications,
    conditionText: req.condition_text ?? null,
  };
}

/**
 * Tana massasi indeksi.
 *
 * Klinika buni o'zi ham hisoblay olardi, lekin har safar qo'lda
 * hisoblash xato manbai. Bir joyda hisoblanadi va bir xil ko'rinadi.
 */
function bodyMassIndex(heightCm: number | null, weightKg: number | null): number | null {
  if (!heightCm || !weightKg || heightCm < 50) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

function emptyCase(): PatientCase {
  return {
    ageYears: null,
    gender: null,
    heightCm: null,
    weightKg: null,
    bmi: null,
    bloodType: null,
    chronicConditions: [],
    pastSurgeries: [],
    allergies: [],
    medications: [],
    conditionText: null,
    forSelf: true,
  };
}
