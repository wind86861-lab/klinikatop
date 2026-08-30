import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : v === 'true' || v === '1');

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: num(process.env.PORT, 8080),
  /**
   * Tinglash manzili. Ishlab chiqarishda 127.0.0.1 — server to'g'ridan-to'g'ri
   * internetga ochilmaydi, oldida nginx turadi. Bu bitta mashinada boshqa
   * saytlar bilan yonma-yon ishlashning shartli qoidasi.
   */
  host: process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0'),

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    webappUrl: process.env.WEBAPP_URL ?? 'http://localhost:5173',
    /**
     * Webhook siri — Telegram har so'rovda sarlavhada qaytaradi.
     * Marshrut ochiq internetda turgani uchun yagona himoya shu.
     */
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  },

  db: {
    path: process.env.DATABASE_PATH ?? path.resolve(__dirname, '../../../data/klinikatop.db'),
  },

  ai: {
    /**
     * Qaysi provayder: 'anthropic' | 'gemini' | 'auto'.
     *
     * `auto` — qaysi kalit sozlangan bo'lsa, o'shanisi. Ikkalasi ham
     * bo'lsa Anthropic ustun; boshqacha kerak bo'lsa ochiq yoziladi.
     */
    provider: (process.env.AI_PROVIDER ?? 'auto') as 'anthropic' | 'gemini' | 'auto',
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    geminiKey: process.env.GEMINI_API_KEY ?? '',
    /*
     * Model nomi provayderga bog'liq, shuning uchun sukut bo'yicha
     * qiymat ham shunga qarab tanlanadi. Ochiq ko'rsatilsa — o'sha.
     */
    model:
      process.env.AI_MODEL ??
      (process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY
        ? 'gemini-3.6-flash'
        : 'claude-opus-5'),
  },

  rules: {
    commissionPercent: num(process.env.COMMISSION_PERCENT, 5),
    requestTtlHours: num(process.env.REQUEST_TTL_HOURS, 24),
    maxActiveRequestsPerPatient: num(process.env.MAX_ACTIVE_REQUESTS_PER_PATIENT, 3),
    /** 4.2: bundan kam bitim bo'lsa "hali kam ma'lumot" deb ko'rsatiladi */
    minDealsForPriceStats: num(process.env.MIN_DEALS_FOR_PRICE_STATS, 5),
    /** Statistika oynasi */
    priceWindowDays: 30,
    /** 9.2: bemor javob bermasa necha kundan keyin eslatma */
    confirmReminderDays: 3,
    /** Tasdiqlash uchun bonus ball */
    confirmBonusPoints: 50,
    /**
     * Bemor javob bermasa necha kundan keyin bitim avtomatik tasdiqlanadi.
     *
     * Buning sababi moliyaviy: komissiya faqat tasdiqlangan bitimdan olinadi,
     * shuning uchun "tasdiqlamaslik" ikkala tomon uchun ham foydali bo'lib
     * qolardi va platforma daromadsiz qolardi. Endi klinika "bajarildi" deb
     * belgilagach soat ishlaydi; bemor rozi bo'lmasa shu muddat ichida nizo
     * ochadi va moderator qarorini beradi.
     */
    autoConfirmDays: num(process.env.AUTO_CONFIRM_DAYS, 14),
    /** Ishga tushirish davri — tasdiqlangandan keyin necha oy bepul */
    trialMonths: num(process.env.TRIAL_MONTHS, 6),
    /** So'rov tugashiga qancha qolganda ogohlantirish */
    expiryWarningHours: 1,
  },

  /**
   * Tashqi katalog manbasi — operatsiyalar ro'yxati shu yerdan olinadi.
   *
   * Bo'sh bo'lsa sinxronizatsiya o'chiq va katalog qo'lda yuritiladi.
   * Ulanish satri faqat O'QISH huquqiga ega rol bilan bo'lishi kerak;
   * buni baza darajasida ta'minlash lozim, kod bunga tayanmaydi
   * (deploy/setup-catalog-source.sh ga qarang).
   */
  catalogSource: {
    url: process.env.CATALOG_SOURCE_URL ?? '',
  },

  /**
   * banisa.uz bilan ulanish.
   *
   * `partnerKey` — katalog va klinika ma'lumotlarini o'qish uchun.
   * `linkTicketSecret` — klinika "ulanish" tugmasini bosganda
   * banisa beradigan biletning imzosi. Ikkisi ALOHIDA sir: biri
   * sizib chiqsa ikkinchisi hali ham himoya qiladi.
   */
  banisa: {
    url: (process.env.BANISA_URL ?? '').replace(/\/$/, ''),
    partnerKey: process.env.BANISA_PARTNER_KEY ?? '',
    linkTicketSecret: process.env.LINK_TICKET_SECRET ?? '',
  },
} as const;

export const isProd = config.env === 'production';
