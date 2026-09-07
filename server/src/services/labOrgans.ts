/**
 * Tahlil organlari katalogi.
 *
 * Operatsiyalar daraxti murakkab: soha → bo'lim → operatsiya, chunki
 * ularning soni yuzlab. Organlar esa o'nga yaqin va ular tabiiy
 * ravishda tekis ro'yxat — daraxt qurish faqat ortiqcha bosish
 * qo'shardi.
 */
import { db } from '../db';
import { mapLabOrgan } from '../lib/mappers';
import type { LabOrgan } from '../../../shared/types';

export function listLabOrgans(): LabOrgan[] {
  const rows = db
    .prepare(`SELECT * FROM lab_organs WHERE active = 1 ORDER BY position, id`)
    .all() as any[];
  return rows.map(mapLabOrgan);
}

/** Klinika qaysi organlar bo'yicha tahlil qiladi. */
export function clinicLabOrganIds(clinicId: number): number[] {
  return (
    db.prepare(`SELECT organ_id FROM clinic_lab_organs WHERE clinic_id = ?`).all(clinicId) as {
      organ_id: number;
    }[]
  ).map((r) => r.organ_id);
}

/**
 * Ro'yxatni to'liq almashtiradi.
 *
 * Bo'sh ro'yxat ham QABUL QILINADI: klinika tahlil xizmatini
 * butunlay o'chirib qo'yishi mumkin bo'lishi kerak. Operatsiyalarda
 * bu boshqacha — u yerda kamida bittasi shart, chunki operatsiyasiz
 * klinika platformada umuman ish ko'ra olmaydi.
 */
export function saveClinicLabOrgans(clinicId: number, organIds: number[]): number[] {
  const valid = new Set(listLabOrgans().map((o) => o.id));
  const clean = [...new Set(organIds)].filter((id) => valid.has(id));

  db.prepare(`DELETE FROM clinic_lab_organs WHERE clinic_id = ?`).run(clinicId);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO clinic_lab_organs (clinic_id, organ_id) VALUES (?, ?)`,
  );
  for (const id of clean) ins.run(clinicId, id);
  return clean;
}
