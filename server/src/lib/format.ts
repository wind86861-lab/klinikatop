/** Pul formati: 14 000 000 → "14 mln so'm". */
export function formatUzs(amount: number | null, lang: 'uz' | 'ru' = 'uz'): string {
  if (amount == null) return lang === 'ru' ? 'не указан' : 'ko‘rsatilmagan';
  const suffix = lang === 'ru' ? 'сум' : 'so‘m';
  if (amount >= 1_000_000) {
    const mln = amount / 1_000_000;
    const s = mln % 1 === 0 ? String(mln) : mln.toFixed(1);
    return `${s} ${lang === 'ru' ? 'млн' : 'mln'} ${suffix}`;
  }
  if (amount >= 1_000) return `${Math.round(amount / 1000)} ${lang === 'ru' ? 'тыс' : 'ming'} ${suffix}`;
  return `${amount} ${suffix}`;
}

/** So'zlarni normallashtirish: kirill/lotin apostroflar, registr. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matndan URL uchun yaroqli slug yasaydi.
 *
 * O'zbek va rus harflari lotinga o'giriladi: slug manzil satrida va
 * jadval kalitida ishlatiladi, u yerda faqat ASCII ishonchli.
 */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, '')
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
