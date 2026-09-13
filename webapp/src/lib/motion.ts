/**
 * Motion tizimi — bitta easing, maqsadli harakat.
 * Har bir variant shu yerdan olinadi, shunda ilova yaxlit his qiladi.
 */
import type { Transition, Variants } from 'framer-motion';

export const EASE = [0.22, 1, 0.36, 1] as const;

export const DUR = {
  micro: 0.12,
  base: 0.24,
  sheet: 0.36,
  page: 0.5,
} as const;

export const spring: Transition = { type: 'spring', stiffness: 400, damping: 30, mass: 0.8 };
export const softSpring: Transition = { type: 'spring', stiffness: 260, damping: 26 };
export const ease: Transition = { duration: DUR.base, ease: EASE };

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Sahifa o'tishi — chapdan/o'ngdan silliq surilish. */
export const pageVariants: Variants = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0, transition: { duration: DUR.base, ease: EASE } },
  exit: { opacity: 0, x: -12, transition: { duration: DUR.micro, ease: EASE } },
};

/** Ro'yxat: bolalar ketma-ket (stagger) chiqadi. */
export const listVariants: Variants = {
  animate: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

export const itemVariants: Variants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: spring },
  exit: { opacity: 0, y: -8, scale: 0.97, transition: { duration: DUR.micro, ease: EASE } },
};

/** Yangi taklif yuqoridan sirg'alib kiradi. */
export const incomingVariants: Variants = {
  initial: { opacity: 0, y: -24, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1, transition: spring },
  exit: { opacity: 0, scale: 0.96, transition: { duration: DUR.micro } },
};

/** Pastdan chiqadigan varaq. */
export const sheetVariants: Variants = {
  initial: { y: '100%' },
  animate: { y: 0, transition: { duration: DUR.sheet, ease: EASE } },
  exit: { y: '100%', transition: { duration: DUR.base, ease: EASE } },
};

/**
 * Keng ekranda varaq — MARKAZDAGI OYNA.
 *
 * Pastdan chiqadigan varaq telefon uchun to'g'ri: barmoq pastda va
 * harakat tabiiy. Ish stolida esa u butun enni egallagan tasma bo'lib
 * qolardi — maydonlar chapda ingichka ustunda, "Saqlash" tugmasi esa
 * ikki metr. Shuning uchun u yerda oyna markazda turadi va
 * harakati ham boshqacha: pastdan uchib kelish emas, joyida paydo
 * bo'lish.
 */
export const dialogVariants: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.base, ease: EASE } },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: DUR.micro, ease: EASE } },
};

export const scrimVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.base } },
  exit: { opacity: 0, transition: { duration: DUR.base } },
};

/** Tasdiq/muvaffaqiyat "pop". */
export const popVariants: Variants = {
  initial: { opacity: 0, scale: 0.86 },
  animate: { opacity: 1, scale: 1, transition: spring },
  exit: { opacity: 0, scale: 0.9, transition: { duration: DUR.micro } },
};

/** Tugma bosilganda javob beradi. */
export const tapProps = {
  whileTap: { scale: 0.97 },
  transition: spring,
};
