/**
 * Sayt matnlarining ASL qiymatlari — admin tahrirlovchisi va server uchun.
 *
 * Server sahifani berayotganda admin o'zgartirgan matnni shu asl qiymat
 * turgan joyga qo'yadi (`server/src/services/siteRender.ts`). Ya'ni
 * komponentlarga tegilmaydi: build chiqargan HTML — shablon, bu fayl —
 * undagi matnlar lug'ati.
 *
 * Kalit — lug'atdagi yo'l: `home.hero.title`, `home.faq.items.0.q`.
 * Texnik maydonlar (til, manzillar) tahrirlanmaydi.
 */
import { uz } from '../../i18n/uz';
import { ru } from '../../i18n/ru';

const SKIP = new Set(['lang', 'locale', 'paths', 'alt']);

function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof obj === 'string') {
    out[prefix] = obj;
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (!prefix && SKIP.has(k)) continue;
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

export function GET() {
  return new Response(JSON.stringify({ uz: flatten(uz), ru: flatten(ru) }), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
