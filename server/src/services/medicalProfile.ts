/**
 * Bemorning tibbiy anketasi.
 *
 * To'liq ixtiyoriy: bemor uni to'ldirmasdan ham so'rov yubora oladi.
 * To'ldirilgan bo'lsa — klinika aniqroq taklif bera oladi, chunki
 * surunkali kasallik va qabul qilinayotgan dorilar operatsiya
 * tayyorgarligiga ham, narxiga ham ta'sir qiladi.
 *
 * Maxfiylik: bu ma'lumot bemorning O'ZIGA tegishli va faqat u yuborgan
 * so'rovga biriktirilganda klinika ko'radi. Alohida so'rab olish yo'li yo'q.
 */
import { db } from '../db';
import { badRequest } from '../lib/errors';
import { EMPTY_MEDICAL_PROFILE, type MedicalProfile } from '../../../shared/types';

const iso = (v: string | null) => (v ? new Date(v.replace(' ', 'T') + 'Z').toISOString() : null);

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string' && v.trim()) : [];
  } catch {
    return [];
  }
}

/** Ro'yxatni tozalash: bo'shlar olib tashlanadi, uzunlik cheklanadi. */
function cleanList(list: string[] | undefined, fallback: string[]): string {
  const source = list ?? fallback;
  return JSON.stringify(
    source
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((v) => v.slice(0, 200)),
  );
}

export function getMedicalProfile(userId: number): MedicalProfile {
  const row = db.prepare(`SELECT * FROM medical_profiles WHERE user_id = ?`).get(userId) as any;
  if (!row) return { ...EMPTY_MEDICAL_PROFILE };

  return {
    chronicConditions: parseList(row.chronic_conditions),
    pastSurgeries: parseList(row.past_surgeries),
    allergies: parseList(row.allergies),
    medications: parseList(row.medications),
    bloodType: row.blood_type ?? null,
    heightCm: row.height_cm ?? null,
    weightKg: row.weight_kg ?? null,
    notes: row.notes ?? null,
    updatedAt: iso(row.updated_at),
  };
}

export type MedicalProfileInput = Partial<Omit<MedicalProfile, 'updatedAt'>>;

export function saveMedicalProfile(userId: number, input: MedicalProfileInput): MedicalProfile {
  const current = getMedicalProfile(userId);

  // Bo'y va vazn — tibbiy jihatdan ma'noli oraliqda bo'lishi kerak
  const height = input.heightCm !== undefined ? input.heightCm : current.heightCm;
  const weight = input.weightKg !== undefined ? input.weightKg : current.weightKg;
  if (height != null && (height < 40 || height > 250)) {
    throw badRequest('bad_height', 'Bo‘y 40 dan 250 sm gacha bo‘lishi kerak');
  }
  if (weight != null && (weight < 2 || weight > 400)) {
    throw badRequest('bad_weight', 'Vazn 2 dan 400 kg gacha bo‘lishi kerak');
  }

  db.prepare(
    `INSERT INTO medical_profiles
       (user_id, chronic_conditions, past_surgeries, allergies, medications,
        blood_type, height_cm, weight_kg, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (user_id) DO UPDATE SET
       chronic_conditions = excluded.chronic_conditions,
       past_surgeries     = excluded.past_surgeries,
       allergies          = excluded.allergies,
       medications        = excluded.medications,
       blood_type         = excluded.blood_type,
       height_cm          = excluded.height_cm,
       weight_kg          = excluded.weight_kg,
       notes              = excluded.notes,
       updated_at         = excluded.updated_at`,
  ).run(
    userId,
    cleanList(input.chronicConditions, current.chronicConditions),
    cleanList(input.pastSurgeries, current.pastSurgeries),
    cleanList(input.allergies, current.allergies),
    cleanList(input.medications, current.medications),
    input.bloodType !== undefined ? input.bloodType : current.bloodType,
    height,
    weight,
    input.notes !== undefined ? input.notes?.trim()?.slice(0, 2000) || null : current.notes,
  );

  return getMedicalProfile(userId);
}
