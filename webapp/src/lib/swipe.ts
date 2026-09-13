/**
 * Ekranni chapga/o'ngga surish.
 *
 * Telefonda yuqoridagi bo'limlar (Javob kutmoqda · Muddati yaqin ·
 * Hammasi) faqat barmoq bilan bosib almashtirilardi. Ekranni surish
 * esa tanish harakat — Telegram, Instagram, brauzer varaqlari hammasi
 * shunday ishlaydi, va odam buni o'zi sinab ko'radi.
 *
 * ── Qachon SURISH deb hisoblanadi ──
 *
 * Har qanday gorizontal harakat emas. Odam ro'yxatni pastga aylantirib
 * ketayotganda barmog'i biroz qiyshiq yurishi tabiiy — shuni surish
 * deb tushunsak, bo'lim odam xohlamagan holda almashib ketardi.
 * Shuning uchun uch shart birga:
 *
 *   • gorizontal yo'l kamida 56px
 *   • gorizontal yo'l vertikaldan 1,6 barobar ko'p (ya'ni aniq yonga)
 *   • harakat gorizontal aylanadigan element ichida boshlanmagan
 *     (segment chiziqi, kanban) — u yerda surish o'sha elementniki
 */
import type { TouchEvent } from 'react';

const MIN_DISTANCE = 56;
const DOMINANCE = 1.6;

/** Ichida gorizontal aylanadigan elementlar: surish ularniki */
const OWN_SCROLL = '.segment, .kanban, .chips--scroll, [data-own-swipe]';

export interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
}

export function swipeHandlers(
  onLeft: (() => void) | undefined,
  onRight: (() => void) | undefined,
): SwipeHandlers | Record<string, never> {
  if (!onLeft && !onRight) return {};

  let startX = 0;
  let startY = 0;
  let owned = false;

  return {
    onTouchStart: (e) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      owned = Boolean((e.target as Element | null)?.closest?.(OWN_SCROLL));
    },
    onTouchEnd: (e) => {
      if (owned) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (Math.abs(dx) < MIN_DISTANCE) return;
      if (Math.abs(dx) < Math.abs(dy) * DOMINANCE) return;

      // Chapga surish — KEYINGI bo'lim (varaqlarni ag'darishdek)
      if (dx < 0) onLeft?.();
      else onRight?.();
    },
  };
}

/**
 * Ro'yxatdagi qiymatlar orasida oldinga/orqaga yurish.
 *
 * Chekkada to'xtaydi, aylanmaydi: oxirgi bo'limdan yana chapga
 * surganda birinchisiga sakrash odamni chalg'itardi.
 */
export function stepWithin<T>(options: readonly T[], current: T, delta: 1 | -1): T {
  const i = options.indexOf(current);
  if (i === -1) return current;
  const next = Math.min(options.length - 1, Math.max(0, i + delta));
  return options[next];
}
