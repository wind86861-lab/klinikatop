/**
 * Sayt bo'ylab umumiy qiymatlar.
 *
 * Biznes raqamlari server sozlamalarida ham bor (`COMMISSION_PERCENT`,
 * `TRIAL_MONTHS`). Sahifa statik bo'lgani uchun bu yerda nusxasi
 * turadi — ular o'zgarsa, shu faylni ham yangilang.
 */
export const site = {
  url: 'https://klinikatop.uz',
  name: 'KlinikaTop',
  commissionPercent: 5,
  trialMonths: 6,
  /** Brauzerdagi bemor ilovasi; bot manzili sahifada serverdan olinadi */
  appPath: '/app',
  clinicSignupPath: '/klinika',
  cabinetPath: '/kabinet',
  /*
   * Aloqa ma'lumotlari. Bo'sh qiymat — footer'da ko'rsatilmaydi.
   * Egasi to'ldiradi; o'ylab topilgan raqam qo'yilmaydi.
   */
  contacts: {
    phone: '',
    email: '',
    telegram: '',
    instagram: '',
    address: '',
  },
};
