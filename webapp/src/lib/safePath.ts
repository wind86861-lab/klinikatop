/**
 * Ilova ichidagi yo'lni tekshiradi.
 *
 * `navigate()` ga faqat o'z sahifamizga olib boradigan yo'l tushishi
 * kerak. Bu ehtiyot chorasi: bugun bu yerga faqat serverimiz yasagan
 * havolalar keladi, lekin ular vaqt o'tib o'zgaradi va tekshiruv
 * chaqiruv joyida emas, bir joyda turgani ma'qul.
 *
 * Teskari chiziq alohida tekshiriladi: `\\evil.com` ba'zi brauzer va
 * marshrutlash kutubxonalarida tashqi manzil sifatida talqin qilinadi
 * (React Router'dagi CVE-2025-68470 shu haqda). `//evil.com` ham
 * shunday — protokolsiz tashqi havola.
 */
export function safePath(path: string | null | undefined, fallback = '/'): string {
  if (!path) return fallback;

  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) return fallback;
  // `//host` va `/\host` — tashqariga chiqish yo'llari
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return fallback;
  if (trimmed.includes('\\')) return fallback;

  return trimmed;
}
