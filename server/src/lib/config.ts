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
  },

  db: {
    path: process.env.DATABASE_PATH ?? path.resolve(__dirname, '../../../data/klinikatop.db'),
  },

  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'claude-opus-5',
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
} as const;

export const isProd = config.env === 'production';
