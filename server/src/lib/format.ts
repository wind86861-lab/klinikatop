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
