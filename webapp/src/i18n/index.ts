import { uz, type TranslationKey } from './uz';
import { ru } from './ru';
import type { Lang, Operation, City, OperationCategory } from '@shared/types';

const dictionaries = { uz, ru } as const;

export type { TranslationKey };

/** `{n}` kabi joy egallovchilarni almashtiradi. */
export function translate(
  lang: Lang,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const raw = (dictionaries[lang] as Record<string, string>)[key] ?? (uz as Record<string, string>)[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] !== undefined ? String(params[name]) : `{${name}}`,
  );
}

/** Katalog yozuvlari ikkala tilda saqlanadi — tanlab olamiz. */
export const opName = (op: Operation, lang: Lang) => (lang === 'ru' ? op.nameRu : op.nameUz);
export const opAlias = (op: Operation, lang: Lang) => (lang === 'ru' ? op.aliasRu : op.aliasUz);
export const opDesc = (op: Operation, lang: Lang) => (lang === 'ru' ? op.descRu : op.descUz);
export const cityName = (city: City, lang: Lang) => (lang === 'ru' ? city.nameRu : city.nameUz);
export const categoryName = (c: OperationCategory, lang: Lang) => (lang === 'ru' ? c.nameRu : c.nameUz);
