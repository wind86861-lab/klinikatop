/**
 * So'rov bosqichlarini boshqarish.
 *
 * Bemor so'rov qoldirayotganda qaysi bosqichlardan o'tishi, ular qanday
 * tartibda turishi va nima deb yozilgani admin panelidan o'zgaradi.
 * Nima uchun bazada: bu mahsulot qarori — matn tajriba qilinadi,
 * ortiqcha bosqich olib tashlanadi. Har safar deploy kutish noto'g'ri.
 *
 * Ikki chegara bor va ikkalasi ham SERVERDA turadi, chunki admin panel
 * — shunchaki mijoz, unga ishonib bo'lmaydi:
 *
 *   1. `builtin` bosqichni yaratib ham, o'chirib ham bo'lmaydi — u kod.
 *      Admin faqat tartibi, matni va yoqilganini o'zgartiradi.
 *   2. `locked` bosqichni o'chirish yoki ixtiyoriy qilish mumkin emas —
 *      `createRequest` ularsiz so'rovni baribir rad etadi, ya'ni admin
 *      o'zi bilmagan holda oqimni buzib qo'yardi.
 */
import { db } from '../db';
import { badRequest } from '../lib/errors';
import { tx } from '../db';
import {
  BUILTIN_STEPS,
  LOCKED_STEPS,
  REQUEST_KINDS,
  STEP_FLOWS,
  STEP_KINDS,
  type BuiltinStep,
  type Lang,
  type RequestStep,
  type StepKind,
  type StepOption,
  type WizardStep,
} from '../../../shared/types';

const MAX_STEPS = 24;
const MAX_OPTIONS = 20;
const MAX_ANSWER = 500;

interface Row {
  id: number;
  key: string;
  kind: string;
  position: number;
  enabled: number;
  required: number;
  locked: number;
  title_uz: string | null;
  title_ru: string | null;
  sub_uz: string | null;
  sub_ru: string | null;
  options: string | null;
}

function parseOptions(raw: string | null): StepOption[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StepOption[]) : null;
  } catch {
    // Buzuq JSON butun ekranni yiqitmasin — savol variantsiz ko'rinadi
    return null;
  }
}

function mapStep(r: Row): RequestStep {
  return {
    id: r.id,
    key: r.key,
    kind: r.kind as StepKind,
    position: r.position,
    enabled: r.enabled === 1,
    required: r.required === 1,
    locked: r.locked === 1,
    titleUz: r.title_uz,
    titleRu: r.title_ru,
    subUz: r.sub_uz,
    subRu: r.sub_ru,
    options: parseOptions(r.options),
  };
}

/** Admin paneli uchun — hammasi, o'chirilganlari ham. */
export function listSteps(): RequestStep[] {
  const rows = db
    .prepare(`SELECT * FROM request_steps ORDER BY position ASC, id ASC`)
    .all() as Row[];
  return rows.map(mapStep);
}

/** Bemor ilovasi uchun — faqat yoqilganlari, tanlangan tilda. */
export function wizardSteps(lang: Lang): WizardStep[] {
  return listSteps()
    .filter((s) => s.enabled)
    .map((s) => ({
      key: s.key,
      kind: s.kind,
      required: s.required,
      // Bo'sh bo'lsa `null` qaytadi va ilova o'z tarjimasini ishlatadi
      title: (lang === 'ru' ? s.titleRu : s.titleUz) || null,
      sub: (lang === 'ru' ? s.subRu : s.subUz) || null,
      options:
        s.options?.map((o) => ({ value: o.value, label: (lang === 'ru' ? o.ru : o.uz) || o.value })) ?? null,
      /*
       * Oqim KODDAN olinadi, bazadan emas. Admin bosqich matnini va
       * tartibini o'zgartiradi, lekin qaysi oqimga tegishli ekanini
       * emas: tahlil so'roviga operatsiya bosqichini qo'shib qo'ysa,
       * u yerda javob bo'lishi mumkin emas edi.
       */
      flows: STEP_FLOWS[s.key as BuiltinStep] ?? REQUEST_KINDS,
    }));
}

/** Admin yaratgan savollar — javob tekshiruvi shularga qarab qilinadi. */
export function customSteps(): RequestStep[] {
  return listSteps().filter((s) => s.enabled && s.kind !== 'builtin');
}

/* ─────────────────────────────  Saqlash  ───────────────────────────── */

export interface StepInput {
  /** Mavjud bosqich uchun kalit; yangi savol uchun ham kalit beriladi */
  key: string;
  kind: StepKind;
  enabled: boolean;
  required: boolean;
  titleUz?: string | null;
  titleRu?: string | null;
  subUz?: string | null;
  subRu?: string | null;
  options?: StepOption[] | null;
}

const KEY_RE = /^[a-z][a-z0-9_]{1,38}$/;

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s.length ? s : null;
}

function validateOptions(kind: StepKind, options: StepOption[] | null | undefined): string | null {
  if (kind !== 'choice' && kind !== 'multichoice') return null;
  if (!Array.isArray(options) || options.length < 2) {
    throw badRequest('options_required', 'Tanlov savolida kamida ikkita variant bo‘lishi kerak');
  }
  if (options.length > MAX_OPTIONS) {
    throw badRequest('too_many_options', `Variantlar soni ${MAX_OPTIONS} tadan oshmasin`);
  }
  const seen = new Set<string>();
  const cleaned = options.map((o, i) => {
    const value = clean(o.value, 40) ?? `v${i + 1}`;
    if (seen.has(value)) throw badRequest('duplicate_option', 'Variant qiymatlari takrorlanmasin');
    seen.add(value);
    const uz = clean(o.uz, 80);
    if (!uz) throw badRequest('option_label_required', 'Har bir variantning o‘zbekcha matni bo‘lsin');
    return { value, uz, ru: clean(o.ru, 80) ?? uz };
  });
  return JSON.stringify(cleaned);
}

/**
 * Butun ro'yxatni bir marta yozamiz.
 *
 * Nima uchun bittalab emas: tartib — ro'yxatning o'zi haqidagi fakt.
 * Bittalab yozilsa, ikki bosqich orasida baza vaqtincha zid holatda
 * qoladi (ikkita bosqich bir xil o'rinda). Bitta tranzaksiya bunga
 * yo'l qo'ymaydi.
 */
export function saveSteps(input: StepInput[], adminId: number | null): RequestStep[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw badRequest('empty_steps', 'Bosqichlar ro‘yxati bo‘sh bo‘lmaydi');
  }
  if (input.length > MAX_STEPS) {
    throw badRequest('too_many_steps', `Bosqichlar soni ${MAX_STEPS} tadan oshmasin`);
  }

  const existing = new Map(listSteps().map((s) => [s.key, s]));
  const seen = new Set<string>();

  // Avval hammasini tekshiramiz — yarim yozilgan holat bo'lmasligi uchun
  const prepared = input.map((raw, i) => {
    const key = String(raw.key ?? '').trim();
    if (!KEY_RE.test(key)) {
      throw badRequest('invalid_step_key', `Noto‘g‘ri bosqich kaliti: ${key}`);
    }
    if (seen.has(key)) throw badRequest('duplicate_step', `Bosqich ikki marta keldi: ${key}`);
    seen.add(key);

    if (!STEP_KINDS.includes(raw.kind)) {
      throw badRequest('invalid_step_kind', `Noma'lum bosqich turi: ${raw.kind}`);
    }

    const prev = existing.get(key);
    const isBuiltinKey = (BUILTIN_STEPS as readonly string[]).includes(key);

    // Kodda ekrani bo'lmagan `builtin` yaratib bo'lmaydi
    if (raw.kind === 'builtin' && !isBuiltinKey) {
      throw badRequest('unknown_builtin', `Bunday tayyor bosqich yo‘q: ${key}`);
    }
    // Tayyor bosqichning turini o'zgartirib ham bo'lmaydi
    if (isBuiltinKey && raw.kind !== 'builtin') {
      throw badRequest('builtin_kind_locked', `${key} — tayyor bosqich, turi o‘zgarmaydi`);
    }
    if (prev && prev.kind !== raw.kind) {
      throw badRequest('kind_change_forbidden', `${key} bosqichining turini o‘zgartirib bo‘lmaydi`);
    }

    const locked = (LOCKED_STEPS as readonly string[]).includes(key);
    if (locked && (!raw.enabled || !raw.required)) {
      throw badRequest('step_locked', `${key} bosqichi majburiy — o‘chirib bo‘lmaydi`);
    }

    return {
      key,
      kind: raw.kind,
      position: i * 10,
      enabled: locked || raw.enabled ? 1 : 0,
      required: locked || raw.required ? 1 : 0,
      locked: locked ? 1 : 0,
      titleUz: clean(raw.titleUz, 120),
      titleRu: clean(raw.titleRu, 120),
      subUz: clean(raw.subUz, 240),
      subRu: clean(raw.subRu, 240),
      options: validateOptions(raw.kind, raw.options),
    };
  });

  // Tayyor bosqichlarning hammasi ro'yxatda qolishi shart
  for (const b of BUILTIN_STEPS) {
    if (!seen.has(b)) throw badRequest('builtin_missing', `Tayyor bosqich yo‘qolgan: ${b}`);
  }

  tx(() => {
    // Ro'yxatdan chiqarilgan admin savollari o'chiriladi
    const drop = db.prepare(`DELETE FROM request_steps WHERE key NOT IN (${prepared.map(() => '?').join(',')})`);
    drop.run(...prepared.map((p) => p.key));

    const upsert = db.prepare(
      `INSERT INTO request_steps (key, kind, position, enabled, required, locked,
                                  title_uz, title_ru, sub_uz, sub_ru, options, updated_by, updated_at)
       VALUES (@key, @kind, @position, @enabled, @required, @locked,
               @titleUz, @titleRu, @subUz, @subRu, @options, @adminId, datetime('now'))
       ON CONFLICT (key) DO UPDATE SET
         position = excluded.position, enabled = excluded.enabled, required = excluded.required,
         title_uz = excluded.title_uz, title_ru = excluded.title_ru,
         sub_uz   = excluded.sub_uz,   sub_ru   = excluded.sub_ru,
         options  = excluded.options,  updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
    );
    for (const p of prepared) upsert.run({ ...p, adminId });
  });

  return listSteps();
}

/* ────────────────────────────  Javoblar  ──────────────────────────── */

/**
 * Bemor bergan qo'shimcha javoblarni tekshiradi va saqlashga tayyorlaydi.
 *
 * Noma'lum kalitlar tashlab yuboriladi: admin savolni o'chirgan bo'lishi
 * mumkin, lekin bemorning ilovasi hali eski ro'yxat bilan ochiq turgan.
 * Bu holatda so'rovni rad etish emas, ortiqchasini e'tiborsiz qoldirish
 * to'g'ri — bemor aybdor emas.
 */
export function validateAnswers(raw: unknown): string | null {
  const steps = customSteps();
  if (steps.length === 0) return null;

  const input: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string | string[] | number | boolean> = {};

  for (const step of steps) {
    const value = input[step.key];
    const missing = value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0);

    if (missing) {
      if (step.required) {
        throw badRequest('answer_required', `"${step.titleUz ?? step.key}" savoliga javob bering`);
      }
      continue;
    }

    const allowed = new Set(step.options?.map((o) => o.value) ?? []);

    switch (step.kind) {
      case 'text':
      case 'longtext': {
        const s = String(value).trim().slice(0, MAX_ANSWER);
        if (s) out[step.key] = s;
        break;
      }
      case 'number': {
        const n = Number(value);
        if (!Number.isFinite(n)) throw badRequest('answer_invalid', `"${step.key}" — raqam kiriting`);
        out[step.key] = n;
        break;
      }
      case 'boolean':
        out[step.key] = value === true || value === 'true' || value === 1;
        break;
      case 'choice': {
        const s = String(value);
        if (!allowed.has(s)) throw badRequest('answer_invalid', `"${step.key}" — noma'lum variant`);
        out[step.key] = s;
        break;
      }
      case 'multichoice': {
        const list = (Array.isArray(value) ? value : [value]).map(String).filter((v) => allowed.has(v));
        if (list.length === 0 && step.required) {
          throw badRequest('answer_required', `"${step.titleUz ?? step.key}" savoliga javob bering`);
        }
        if (list.length) out[step.key] = list;
        break;
      }
      default:
        break;
    }
  }

  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** Saqlangan javoblarni klinikaga ko'rsatish uchun ochib beradi. */
export function readAnswers(rawJson: string | null, lang: Lang): { label: string; value: string }[] {
  if (!rawJson) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [];
  }
  const byKey = new Map(listSteps().map((s) => [s.key, s]));
  const out: { label: string; value: string }[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    const step = byKey.get(key);
    if (!step) continue;
    const label = (lang === 'ru' ? step.titleRu : step.titleUz) || key;

    const optLabel = (v: string) => {
      const o = step.options?.find((x) => x.value === v);
      return o ? (lang === 'ru' ? o.ru : o.uz) || o.value : v;
    };

    let text: string;
    if (Array.isArray(value)) text = value.map((v) => optLabel(String(v))).join(', ');
    else if (typeof value === 'boolean') text = value ? (lang === 'ru' ? 'Да' : 'Ha') : (lang === 'ru' ? 'Нет' : 'Yo‘q');
    else if (step.kind === 'choice') text = optLabel(String(value));
    else text = String(value);

    if (text) out.push({ label, value: text });
  }
  return out;
}
