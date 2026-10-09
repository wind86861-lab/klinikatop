/**
 * So'rov turlari: qaysilari qabul qilinadi va qaysi tartibda.
 *
 * Biznes qarori — deploy'siz o'zgarishi kerak, shuning uchun
 * `platform_settings` da JSON bo'lib turadi. Server ham majburlaydi:
 * o'chirilgan turdagi so'rovni eski ilova yoki qo'lda yuborilgan
 * so'rov ham o'tkaza olmaydi.
 */
import { REQUEST_KINDS, type RequestKind, type RequestKindSetting } from '../../../shared/types';
import { badRequest } from '../lib/errors';
import { setTextSetting, textSetting } from './terms.business';

export const SETTING_REQUEST_KINDS = 'request_kinds';

/** Sozlama hali yo'q bo'lsa — avvalgi xatti-harakat: uchalasi, shu tartibda */
const DEFAULT: RequestKindSetting[] = [
  { kind: 'referral', enabled: true },
  { kind: 'operation', enabled: true },
  { kind: 'lab', enabled: true },
];

/**
 * Har doim uchala tur, har biri bir marta. Bazadagi buzuq yoki eski
 * qiymat (yangi tur qo'shilgan, biri tushib qolgan) ekranni yiqitmaydi:
 * yetishmagani oxiriga o'chirilgan holda qo'shiladi.
 */
export function getRequestKinds(): RequestKindSetting[] {
  let raw: unknown;
  try {
    raw = JSON.parse(textSetting(SETTING_REQUEST_KINDS, ''));
  } catch {
    return DEFAULT.map((k) => ({ ...k }));
  }
  if (!Array.isArray(raw)) return DEFAULT.map((k) => ({ ...k }));

  const seen = new Set<RequestKind>();
  const out: RequestKindSetting[] = [];
  for (const item of raw) {
    const kind = item?.kind as RequestKind;
    if (!REQUEST_KINDS.includes(kind) || seen.has(kind)) continue;
    seen.add(kind);
    out.push({ kind, enabled: item.enabled !== false });
  }
  for (const k of DEFAULT) if (!seen.has(k.kind)) out.push({ kind: k.kind, enabled: false });
  // Hammasi o'chiq bo'lib qolsa so'rov qoldirib bo'lmasdi — birinchisini yoqamiz
  if (!out.some((k) => k.enabled)) out[0].enabled = true;
  return out;
}

/** Bemorga ko'rsatiladigan turlar, tartib bilan */
export function enabledRequestKinds(): RequestKind[] {
  return getRequestKinds()
    .filter((k) => k.enabled)
    .map((k) => k.kind);
}

export function setRequestKinds(list: RequestKindSetting[], adminId: number | null): RequestKindSetting[] {
  const kinds = list.map((k) => k.kind);
  if (kinds.length !== REQUEST_KINDS.length || REQUEST_KINDS.some((k) => !kinds.includes(k))) {
    throw badRequest('invalid_kinds', 'Har bir so‘rov turi bir martadan bo‘lishi kerak');
  }
  if (!list.some((k) => k.enabled)) {
    throw badRequest('no_kind_enabled', 'Kamida bitta so‘rov turi yoqilgan bo‘lishi kerak');
  }
  setTextSetting(
    SETTING_REQUEST_KINDS,
    JSON.stringify(list.map((k) => ({ kind: k.kind, enabled: k.enabled }))),
    adminId,
  );
  return getRequestKinds();
}

export function assertKindEnabled(kind: RequestKind): void {
  if (!enabledRequestKinds().includes(kind)) {
    throw badRequest('kind_disabled', 'Bu turdagi so‘rov hozircha qabul qilinmaydi');
  }
}
