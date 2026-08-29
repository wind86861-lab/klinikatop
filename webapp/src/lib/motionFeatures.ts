/**
 * Animatsiya imkoniyatlari — BIRINCHI bo'yoqdan keyin yuklanadi.
 *
 * framer-motion to'liq holda ~39 KB (siqilgan) va u ilova ochilishini
 * kutib turardi. Aslida animatsiya birinchi lahzada kerak emas: odam
 * avval matnni ko'rishi kerak, silliq harakat esa keyin qo'shilsa ham
 * bo'ladi.
 *
 * `LazyMotion` shuni imkon beradi: `m` komponentlari darhol chiziladi,
 * imkoniyatlar esa fonda kelib ulanadi. Foydalanuvchi buni sezmaydi —
 * u faqat ilova tezroq ochilganini ko'radi.
 *
 * `domMax` tanlandi, chunki ilovada `layout` va `drag` ham ishlatiladi
 * (pastki menyu ko'rsatkichi, onboarding varaqlash). `domAnimation`
 * ularsiz keladi va o'sha joylar jimgina ishlamay qolardi.
 */
export { domMax } from 'framer-motion';
