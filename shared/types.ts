/**
 * KlinikaTop — umumiy tiplar (server va webapp uchun bitta manba).
 * Funksional spetsifikatsiyaning yadro mantig'i shu yerda kodlangan.
 */

/* ─────────────────────────  Rollar  ───────────────────────── */

export const ROLES = ['patient', 'clinic_admin', 'clinic_operator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export type Lang = 'uz' | 'ru';

export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

/** Tug'ilgan yildan yosh. Yosh saqlanmaydi — u har yili eskiradi. */
export function ageFromBirthYear(birthYear: number | null | undefined): number | null {
  if (!birthYear) return null;
  const age = new Date().getFullYear() - birthYear;
  return age >= 0 && age <= 130 ? age : null;
}

/* ─────────────────────────  Lifecycle  ───────────────────────── */

/** So'rov: YANGI → TAKLIFLAR_KELMOQDA → TANLANGAN → YAKUNLANGAN | BEKOR */
export const REQUEST_STATUSES = ['NEW', 'COLLECTING', 'CHOSEN', 'COMPLETED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Taklif: YUBORILGAN → TANLANGAN | RAD_ETILDI | MUDDATI_TUGADI */
export const OFFER_STATUSES = ['SENT', 'CHOSEN', 'REJECTED', 'EXPIRED', 'WITHDRAWN'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Bitim: TANLANGAN → KELISHILGAN → BAJARILGAN → TASDIQLANGAN | BEKOR | NIZO */
export const DEAL_STATUSES = [
  'SELECTED',
  'AGREED',
  'PERFORMED',
  /** Bemor to'lovni bildirdi — klinikaning tasdig'i kutilmoqda */
  'PAID',
  'CONFIRMED',
  'CANCELLED',
  'DISPUTED',
] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const DEAL_STEPS: DealStatus[] = ['SELECTED', 'AGREED', 'PERFORMED', 'PAID', 'CONFIRMED'];

/** To'lov usuli — bemor bildirganda tanlaydi, ixtiyoriy. */
export const PAYMENT_METHODS = ['cash', 'card', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Ruxsat etilgan o'tishlar — server tomonda majburlanadi. */
export const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  NEW: ['COLLECTING', 'CANCELLED'],
  COLLECTING: ['CHOSEN', 'CANCELLED'],
  CHOSEN: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const DEAL_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  SELECTED: ['AGREED', 'CANCELLED', 'DISPUTED'],
  /*
   * `AGREED → PAID` ham bor: bemor klinika "bajarildi" deb
   * belgilashidan oldin to'lagan bo'lishi mumkin. Uni kutib
   * o'tirishga majburlash mantiqsiz.
   */
  AGREED: ['PERFORMED', 'PAID', 'CANCELLED', 'DISPUTED'],
  PERFORMED: ['PAID', 'CONFIRMED', 'DISPUTED'],
  PAID: ['CONFIRMED', 'DISPUTED'],
  CONFIRMED: ['DISPUTED'],
  CANCELLED: [],
  DISPUTED: ['CONFIRMED', 'CANCELLED'],
};

/* ─────────────────────────  Obuna / verifikatsiya  ───────────────────────── */

/**
 * 'trial' — ishga tushirish davri.
 *
 * Birinchi klinikalar to'lovsiz to'liq imkoniyat bilan ishlaydi: platformada
 * hali so'rov oqimi yo'q ekan, obuna so'rash ma'nosiz. Muddat KLINIKA
 * tasdiqlangan kundan boshlanadi — 5-oyda qo'shilgan klinika ham to'liq
 * olti oy oladi.
 */
export const SUBSCRIPTION_PLANS = ['trial', 'basic', 'pro'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_STATUSES = ['active', 'suspended', 'expired', 'none'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const VERIFICATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const PLAN_LIMITS: Record<SubscriptionPlan, { monthlyOffers: number; boosted: boolean; analytics: boolean; priceUzs: number }> = {
  // Sinov davrida to'liq imkoniyat: klinika mahsulotni haqiqiy holida ko'rsin.
  // Taklif chegarasi baribir bor — spamning oldini oladi.
  trial: { monthlyOffers: 250, boosted: false, analytics: true, priceUzs: 0 },
  basic: { monthlyOffers: 40, boosted: false, analytics: false, priceUzs: 300_000 },
  pro: { monthlyOffers: 250, boosted: true, analytics: true, priceUzs: 900_000 },
};

/** Ishga tushirish davri — tasdiqlangan kundan boshlab necha oy bepul. */
export const TRIAL_MONTHS = 6;

/* ─────────────────────────  Modellar  ───────────────────────── */

export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  lang: Lang;
  roles: Role[];
  clinicId: number | null;
  /** Bemorning viloyati — so'rovda standart shahar sifatida ishlatiladi */
  cityId: number | null;
  phone: string | null;
  /** Telegram tasdiqlagan raqam o'zgartirilmaydi; bu qo'shimchasi */
  extraPhone: string | null;
  birthYear: number | null;
  gender: Gender | null;
  /** Ism, familiya va viloyat to'ldirilgan payt. Bo'sh bo'lsa — ro'yxatdan o'tish tugallanmagan */
  profileCompletedAt: string | null;
  onboardedAt: string | null;
  bonusPoints: number;
  blockedAt: string | null;
  createdAt: string;
}

/** Profil to'liq to'ldirilganmi — so'rov yuborish uchun shart. */
/**
 * Profil so'rov yuborish uchun yetarlimi.
 *
 * Yosh va jins tibbiy jihatdan muhim: bir xil operatsiya 30 va 70 yoshda
 * boshqacha narxlanadi va ba'zilari jinsga bog'liq. Shuning uchun ular
 * ixtiyoriy emas.
 */
export function isProfileComplete(user: User | null | undefined): boolean {
  return Boolean(
    user &&
      user.firstName.trim() &&
      user.lastName?.trim() &&
      user.cityId &&
      user.birthYear &&
      user.gender,
  );
}

export interface City {
  id: number;
  slug: string;
  nameUz: string;
  nameRu: string;
}

export interface OperationCategory {
  id: number;
  /**
   * Ota soha. `null` bo'lsa bu sohaning o'zi, aks holda uning bo'limi.
   *
   * Bir jadval, ikki daraja: alohida jadval qilinsa har so'rovda
   * ikkovini birlashtirish kerak bo'lardi.
   */
  parentId: number | null;
  slug: string;
  nameUz: string;
  nameRu: string;
  icon: string;
}

export interface Operation {
  id: number;
  categoryId: number;
  /** Soha ichidagi bo'lim. Bo'lmasa operatsiya to'g'ridan-to'g'ri sohada. */
  subcategoryId: number | null;
  slug: string;
  nameUz: string;
  nameRu: string;
  /** Xalq tilidagi nom — AI va qidiruv uchun */
  aliasUz: string;
  aliasRu: string;
  descUz: string;
  descRu: string;
  keywords: string[];
}

export interface Clinic {
  id: number;
  /**
   * banisa.uz'dagi identifikator. To'ldirilgan bo'lsa — klinika
   * o'sha yerdan keladi va yo'nalishlari shu yerda tahrirlanmaydi.
   */
  externalId: string | null;
  name: string;
  cityId: number;
  address: string;
  about: string;
  logoUrl: string | null;
  phone: string | null;
  website: string | null;
  workHours: string | null;
  beds: number | null;
  foundedYear: number | null;
  /** Jihozlar ro'yxati — bemor uchun ishonch belgisi */
  equipment: string[];
  /** Klinika suratlari (fayl id'lari) */
  photos: string[];
  verification: VerificationStatus;
  verificationNote: string | null;
  licenseFileId: string | null;
  plan: SubscriptionPlan | null;
  subscriptionStatus: SubscriptionStatus;
  subscriptionUntil: string | null;
  ratingAvg: number;
  ratingCount: number;
  dealsCount: number;
  avgResponseMinutes: number | null;
  createdAt: string;
}

export interface ClinicPublic {
  id: number;
  name: string;
  cityId: number;
  logoUrl: string | null;
  verified: boolean;
  plan: SubscriptionPlan | null;
  ratingAvg: number;
  ratingCount: number;
  dealsCount: number;
  avgResponseMinutes: number | null;
}

/** Bemor operatsiyani bilmasa — katalogdagi maxsus yozuv ishlatiladi */
export const UNKNOWN_OPERATION_SLUG = 'unknown';

export const FILE_KINDS = ['uzi', 'mrt', 'analiz', 'xulosa', 'other'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: FileKind;
  /** "Boshqa" turi tanlanganda bemor yozgan nom */
  label: string | null;
  createdAt: string;
}

/* ─────────────────────────  AI suhbati  ───────────────────────── */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatSuggestion {
  operationId: number;
  operationName: string;
  confidence: number;
  reason: string;
}

export interface AiChatResult {
  reply: string;
  needsMoreInfo: boolean;
  suggestions: AiChatSuggestion[];
  urgentWarning: string | null;
  /** Aniqlab bo'lmadi — "klinika aytsin" bilan davom etiladi */
  fallbackToClinic: boolean;
  disclaimer: string;
}

export const URGENCY = ['normal', 'soon', 'urgent'] as const;
export type Urgency = (typeof URGENCY)[number];

export interface MedicalRequest {
  id: number;
  patientId: number;
  operationId: number;
  cityId: number;
  budgetUzs: number | null;
  /** Bemor holatini o'z so'zi bilan tavsiflaydi — majburiy */
  conditionText: string | null;
  note: string | null;
  urgency: Urgency;
  attachments: string[];
  /** Viloyatdan tashqaridagi klinikalar ham taklif bera oladimi */
  otherRegionsOk: boolean;
  /** Operatsiya uchun qulay sana oralig'i */
  dateFrom: string | null;
  dateTo: string | null;
  dateFlexible: boolean;
  /** AI bilan bo'lgan suhbat — klinika bemor nima yozganini to'liq ko'radi */
  aiConversation: ChatTurn[] | null;
  /**
   * Admin qo'shgan savollarga javoblar, xom holida (kalit → qiymat).
   * Yorliqlar bosqichlar ro'yxatidan olinadi, shu sababli bu yerda
   * matn takrorlanmaydi.
   */
  extraAnswers: Record<string, unknown> | null;
  /**
   * So'rov kimga tegishli. O'ziga bo'lsa bemorning profil ma'lumotlari
   * ishlatiladi; tanishiga bo'lsa shu yerdagi qiymatlar.
   */
  forSelf: boolean;
  subjectName: string | null;
  subjectBirthYear: number | null;
  subjectGender: Gender | null;
  status: RequestStatus;
  aiSuggested: boolean;
  expiresAt: string;
  chosenOfferId: number | null;
  broadcastCount: number;
  viewedCount: number;
  /** Yuborishda qabul qilingan ommaviy oferta versiyasi */
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  createdAt: string;
}

/* ─────────────────────────  Ommaviy oferta  ───────────────────────── */

export interface TermsDocument {
  version: string;
  title: string;
  updatedAt: string;
  /** Qisqa mohiyat — bemor to'liq matnni ochmasa ham asosiyni ko'radi */
  summary: string[];
  sections: { title: string; body: string[] }[];
}

export interface RequestWithMeta extends MedicalRequest {
  operation: Operation;
  city: City;
  offersCount: number;
  /** Ilova qilingan hujjatlar (faqat ko'rish huquqi bo'lganda to'ladi) */
  files?: StoredFile[];
}

/** Operatsiya "bilmayman" yozuvimi — matching va UI shunga qaraydi. */
export const isUnknownOperation = (op: { slug: string }) => op.slug === UNKNOWN_OPERATION_SLUG;

export interface Offer {
  id: number;
  requestId: number;
  clinicId: number;
  priceUzs: number;
  /** Narxga nima kiradi — shaffoflik siyosati bo'yicha majburiy */
  includes: string[];
  advantages: string[];
  /** Necha kun ichida bajaradi */
  leadTimeDays: number;
  /**
   * Klinika taklif qilgan aniq sanalar (YYYY-MM-DD).
   *
   * "Necha kun ichida" mo'ljal beradi, sana esa qaror qildiradi: bemor
   * ishdan ta'til olishi, qarindoshini chaqirishi kerak. Bo'sh bo'lsa —
   * klinika sanani keyin kelishadi.
   */
  proposedDates: string[];
  /**
   * Bemor budjetidan yuqori narx uchun izoh — MAJBURIY.
   *
   * Klinika yaxshiroq shart bilan qimmatroq taklif bera oladi, lekin
   * bemor nima uchun qimmatroq ekanini bilishi kerak: aks holda u
   * shunchaki eng arzonini tanlaydi va tafovutni tushunmaydi.
   */
  aboveBudgetReason: string | null;
  note: string | null;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Bemorning KLINIKAGA ko'rinadigan tibbiy tavsifi.
 *
 * Narx holatga bog'liq: 70 yoshli va 30 yoshli bemorda bir xil
 * operatsiya boshqacha, ortiqcha vazn va surunkali kasallik xavfni
 * oshiradi. Klinika buni taklif berishdan OLDIN bilishi kerak, aks
 * holda narx taxminiy bo'ladi va keyin o'zgaradi.
 *
 * Shaxsni aniqlaydigan hech narsa yo'q: ism ham, raqam ham. Klinika
 * holatni ko'radi, odamni emas — tanlangandan keyin tanishadi.
 */
export interface PatientCase {
  ageYears: number | null;
  gender: Gender | null;
  heightCm: number | null;
  weightKg: number | null;
  /** Bo'y va vazndan hisoblanadi; ikkalasi bo'lmasa null */
  bmi: number | null;
  bloodType: string | null;
  chronicConditions: string[];
  pastSurgeries: string[];
  allergies: string[];
  medications: string[];
  /** Bemor o'z so'zi bilan yozgan holat */
  conditionText: string | null;
  /** So'rov o'ziga emas, tanishiga bo'lsa — anketa ishlatilmaydi */
  forSelf: boolean;
}

/** Bitim narxining o'zgarishi — ikki tomon roziligi bilan. */
export type PriceChangeStatus = 'pending' | 'accepted' | 'rejected';

export interface DealPriceChange {
  id: number;
  dealId: number;
  fromUzs: number;
  toUzs: number;
  reason: string;
  /** Kim taklif qildi */
  proposedBy: 'clinic' | 'patient';
  status: PriceChangeStatus;
  createdAt: string;
  decidedAt: string | null;
}

export interface OfferWithClinic extends Offer {
  clinic: ClinicPublic;
  badges: OfferBadge[];
}

export type OfferBadge = 'cheapest' | 'top_rated' | 'fastest' | 'new';

export interface Deal {
  id: number;
  requestId: number;
  offerId: number;
  patientId: number;
  clinicId: number;
  agreedPriceUzs: number;
  scheduledAt: string | null;
  status: DealStatus;
  confirmedAmountUzs: number | null;
  commissionUzs: number | null;
  /**
   * Tasdiqlash paytidagi foiz — bitimga YOZIB qo'yiladi.
   *
   * Admin keyin foizni o'zgartirsa eski bitim qayta hisoblanmaydi.
   * Klinika o'zidan qancha olinganini ko'ra olishi kerak: bu uning
   * pulidan chiqadi va "qancha oldingiz" degan savol albatta keladi.
   */
  commissionPercent: number | null;
  confirmedAt: string | null;
  /** Bemor to'lovni bildirgan payt */
  paidAt: string | null;
  paymentMethod: PaymentMethod | null;
  /** Klinika pulni olganini tasdiqlagan payt */
  receiptConfirmedAt: string | null;
  disputeReason: string | null;
  createdAt: string;
}

export interface DealDetail extends Deal {
  request: RequestWithMeta;
  offer: Offer;
  clinic: ClinicPublic;
  patientName: string;
  hasReview: boolean;
}

export interface ChatMessage {
  id: number;
  dealId: number;
  senderId: number;
  senderRole: 'patient' | 'clinic';
  body: string;
  attachment: string | null;
  kind: 'text' | 'image' | 'file' | 'system';
  readAt: string | null;
  /** Aloqa ma'lumoti tozalanganmi (bypass himoyasi) */
  redacted: boolean;
  createdAt: string;
}

export const REVIEW_ASPECTS = ['quality', 'attitude', 'cleanliness', 'result'] as const;
export type ReviewAspect = (typeof REVIEW_ASPECTS)[number];

export interface Review {
  id: number;
  dealId: number;
  clinicId: number;
  patientId: number;
  patientName: string;
  scores: Record<ReviewAspect, number>;
  average: number;
  body: string | null;
  /** Klinika javobi — bitta marta yoziladi, munozara chatda davom etadi */
  reply: ReviewReply | null;
  createdAt: string;
}

export const NOTIFICATION_TYPES = [
  'new_request',
  'new_offer',
  'offer_chosen',
  'offer_rejected',
  'new_message',
  'confirm_prompt',
  'request_expiring',
  'request_expired',
  'subscription_expiring',
  'verification_result',
  'dispute_opened',
  'bonus_earned',
  /** Bemor javob bermagani uchun bitim avtomatik yopildi */
  'deal_auto_confirmed',
  /** Bemor to'lovni bildirdi — klinika olganini tasdiqlashi kerak */
  'payment_declared',
  /** Klinika to'lovni olganini tasdiqladi — bitim yopildi */
  'payment_confirmed',
  /** Admin klinikaning komissiya to'lovini tasdiqladi */
  'commission_confirmed',
  /** Admin komissiya to'lovini rad etdi */
  'commission_rejected',
  /** Ikkinchi tomon narxni o'zgartirishni taklif qildi */
  'price_change_proposed',
  'price_change_accepted',
  'price_change_rejected',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: number;
  userId: number;
  type: NotificationType;
  titleKey: string;
  params: Record<string, string | number>;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/* ─────────────────────────  Narx statistikasi  ───────────────────────── */

export interface PriceStats {
  operationId: number;
  cityId: number;
  /** 'manual' — cold start (qo'lda kiritilgan), 'deals' — real tasdiqlangan bitimlar */
  source: 'manual' | 'deals';
  /** Ma'lumot yetarli emasmi (< MIN_DEALS_FOR_PRICE_STATS) */
  lowConfidence: boolean;
  sampleSize: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  avg: number | null;
  /** Grafik uchun taqsimot */
  histogram: { from: number; to: number; count: number }[];
  windowDays: number;
}

/* ─────────────────────────  AI  ───────────────────────── */

export interface AiSuggestion {
  operationId: number;
  operationName: string;
  /** 0..1 */
  confidence: number;
  reason: string;
}

export interface AiResult {
  suggestions: AiSuggestion[];
  /** Har javobda ko'rsatiladigan ogohlantirish */
  disclaimer: string;
  /** Hech narsa aniqlanmasa — katalogga yo'naltiriladi */
  fallbackToCatalog: boolean;
}

/* ─────────────────────────  Realtime  ───────────────────────── */

export type ServerEvent =
  | { type: 'offer:new'; requestId: number; offer: OfferWithClinic }
  | { type: 'offer:updated'; requestId: number; offer: OfferWithClinic }
  | { type: 'request:progress'; requestId: number; broadcastCount: number; viewedCount: number; offersCount: number }
  | { type: 'request:status'; requestId: number; status: RequestStatus }
  | { type: 'deal:status'; dealId: number; status: DealStatus }
  | { type: 'chat:message'; dealId: number; message: ChatMessage }
  | { type: 'chat:typing'; dealId: number; userId: number }
  | { type: 'chat:read'; dealId: number; userId: number }
  | { type: 'notification'; notification: Notification }
  | { type: 'clinic:request'; request: RequestWithMeta }
  | { type: 'pong' };

export type ClientEvent =
  | { type: 'subscribe'; channel: string }
  | { type: 'unsubscribe'; channel: string }
  | { type: 'typing'; dealId: number }
  | { type: 'ping' };

/* ─────────────────────────  API yordamchi  ───────────────────────── */

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export interface ClinicDashboard {
  kpi: {
    incomingRequests: number;
    offersSent: number;
    offersWon: number;
    winRatePercent: number;
    revenueUzs: number;
    commissionUzs: number;
    avgResponseMinutes: number | null;
  };
  weekly: { date: string; requests: number; offers: number; wins: number }[];
  subscription: {
    plan: SubscriptionPlan | null;
    status: SubscriptionStatus;
    until: string | null;
    offersUsed: number;
    offersLimit: number;
  };
}

export interface AdminMetrics {
  users: number;
  patients: number;
  clinics: number;
  pendingVerifications: number;
  requests: number;
  offers: number;
  deals: number;
  confirmedDeals: number;
  commissionUzs: number;
  subscriptionRevenueUzs: number;
  conversionPercent: number;
  disputes: number;
}

/* ═══════════════════════  Klinika kabineti  ═══════════════════════
 *
 * Klinika tomonining to'liq modeli. Bemor tomoni "bitta so'rov yuborish"
 * atrofida qurilgan bo'lsa, klinika tomoni takrorlanuvchi ish oqimi:
 * so'rov keladi → taklif ketadi → bitim yuritiladi → pul hisoblanadi.
 * Shuning uchun bu yerda shablon, kalendar, jamoa va hisob-kitob bor.
 */

/** Verifikatsiya uchun talab qilinadigan hujjat turlari. */
export const CLINIC_DOC_KINDS = ['license', 'registration', 'sanitary', 'tax', 'other'] as const;
export type ClinicDocKind = (typeof CLINIC_DOC_KINDS)[number];

/** Moderator ko'rmaguncha hujjat 'pending' turadi. */
export type ClinicDocStatus = 'pending' | 'approved' | 'rejected';

export interface ClinicDocument {
  id: number;
  clinicId: number;
  kind: ClinicDocKind;
  /** "Boshqa" tanlanganda klinika yozgan nom */
  label: string | null;
  fileId: string;
  fileName: string;
  fileMimeType: string;
  status: ClinicDocStatus;
  note: string | null;
  createdAt: string;
}

/** Verifikatsiya uchun majburiy hujjatlar — bularsiz ariza to'liq emas. */
export const REQUIRED_DOC_KINDS: ClinicDocKind[] = ['license', 'registration'];

export interface OfferTemplate {
  id: number;
  clinicId: number;
  title: string;
  /** null — har qanday operatsiyaga mos, aks holda faqat shu operatsiyaga */
  operationId: number | null;
  priceUzs: number | null;
  includes: string[];
  advantages: string[];
  leadTimeDays: number;
  note: string | null;
  /** Necha marta ishlatilgan — eng foydalisi yuqorida turadi */
  usedCount: number;
  createdAt: string;
}

export interface Doctor {
  id: number;
  clinicId: number;
  fullName: string;
  specialty: string;
  experienceYears: number | null;
  photoFileId: string | null;
  bio: string | null;
  /** Shifokor qaysi operatsiyalarni bajaradi */
  operationIds: number[];
  active: boolean;
  createdAt: string;
}

/** Bo'sh slot — klinika qaysi kunda nechta operatsiya qila oladi. */
export interface CapacitySlot {
  id: number;
  clinicId: number;
  /** YYYY-MM-DD */
  date: string;
  capacity: number;
  /** Shu kunga kelishilgan bitimlar soni — avtomatik hisoblanadi */
  booked: number;
  note: string | null;
}

export interface ReviewReply {
  body: string;
  createdAt: string;
}

export type OperatorRole = Extract<Role, 'clinic_admin' | 'clinic_operator'>;

export interface ClinicOperator {
  userId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  role: OperatorRole;
  lastSeenAt: string | null;
  createdAt: string;
}


/** Bildirishnoma sozlamalari — foydalanuvchi bo'yicha. */
export interface NotificationPrefs {
  newRequest: boolean;
  offerChosen: boolean;
  dealUpdate: boolean;
  message: boolean;
  review: boolean;
  subscription: boolean;
  /** Sokin soatlar — HH:MM, ikkalasi ham null bo'lsa o'chirilgan */
  quietFrom: string | null;
  quietTo: string | null;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  newRequest: true,
  offerChosen: true,
  dealUpdate: true,
  message: true,
  review: true,
  subscription: true,
  quietFrom: null,
  quietTo: null,
};

/** Analitika — konversiya va javob tezligi. */
export interface ClinicAnalytics {
  windowDays: number;
  requestsSeen: number;
  offersSent: number;
  offersWon: number;
  /** offersSent / requestsSeen */
  responseRate: number;
  /** offersWon / offersSent */
  winRate: number;
  avgResponseMinutes: number | null;
  avgOfferUzs: number | null;
  avgWinningOfferUzs: number | null;
  /** Kunlik qator — grafik uchun */
  daily: { date: string; requests: number; offers: number; wins: number }[];
  /** Eng ko'p so'ralgan yo'nalishlar */
  topOperations: { operationId: number; name: string; requests: number; wins: number }[];
  /** Yutqazilgan takliflarda g'olib narx qanchaga arzon edi */
  lostByPercent: number | null;
}

/** Daromad va platforma komissiyasi. */
export const COMMISSION_PAYMENT_STATUSES = ['declared', 'confirmed', 'rejected'] as const;
export type CommissionPaymentStatus = (typeof COMMISSION_PAYMENT_STATUSES)[number];

/** Admin navbatidagi komissiya to'lovi. */
export interface PendingCommissionPayment {
  id: number;
  clinicId: number;
  clinicName: string;
  amountUzs: number;
  method: string;
  reference: string | null;
  createdAt: string;
}

export interface ClinicRevenue {
  commissionPercent: number;
  totals: {
    confirmedDeals: number;
    grossUzs: number;
    commissionUzs: number;
    netUzs: number;
  };
  /** Oylar bo'yicha, eng yangisi birinchi */
  months: {
    month: string;
    deals: number;
    grossUzs: number;
    commissionUzs: number;
    netUzs: number;
  }[];
  /** Hali to'lanmagan komissiya */
  outstandingUzs: number;
  /** Tasdiqlangan komissiya to'lovlari — faqat shular qarzni kamaytiradi */
  paidCommissionUzs: number;
  /** Topshirilgan, lekin admin hali ko'rmagan summa */
  pendingCommissionUzs: number;
  commissionPayments: {
    id: number;
    amountUzs: number;
    method: string;
    reference: string | null;
    status: CommissionPaymentStatus;
    /** Rad etilgan bo'lsa — sababi */
    reviewNote: string | null;
    reviewedAt: string | null;
    createdAt: string;
  }[];
  subscription: {
    plan: SubscriptionPlan | null;
    status: SubscriptionStatus;
    until: string | null;
    paidUzs: number;
  };
}

/** Bitimlar kanban ustunlari — bitim holatiga to'g'ridan-to'g'ri mos keladi. */
export const DEAL_BOARD_COLUMNS = ['SELECTED', 'AGREED', 'PERFORMED', 'CONFIRMED'] as const;
export type DealBoardColumn = (typeof DEAL_BOARD_COLUMNS)[number];

/* ═══════════════════  Admin: klinikalar boshqaruvi  ═══════════════════ */

/**
 * Admin ro'yxatidagi klinika qatori.
 *
 * `Clinic` dan farqi: bu yerda ADMIN uchun kerakli qo'shimchalar bor —
 * amaldagi komissiya foizi (klinikaga xosmi yoki umumiymi), sinov davri
 * va hujjatlar holati. Bemor bu ma'lumotni hech qachon ko'rmaydi.
 */
export interface AdminClinicRow {
  id: number;
  name: string;
  cityId: number;
  verification: VerificationStatus;
  plan: SubscriptionPlan | null;
  subscriptionStatus: SubscriptionStatus;
  subscriptionUntil: string | null;
  trialUntil: string | null;
  /** null — platforma bo'yicha umumiy foiz ishlatiladi */
  commissionPercent: number | null;
  /** Shu klinika uchun amalda qo'llanadigan foiz */
  effectiveCommissionPercent: number;
  ratingAvg: number;
  dealsCount: number;
  offersCount: number;
  /** Moderator ko'rib chiqishi kutilayotgan hujjatlar */
  pendingDocuments: number;
  createdAt: string;
}

/** Klinikalar ro'yxatini saralash. */
export const ADMIN_CLINIC_FILTERS = ['all', 'pending', 'approved', 'no_subscription'] as const;
export type AdminClinicFilter = (typeof ADMIN_CLINIC_FILTERS)[number];

/** Platforma sozlamalari — admin kod'siz o'zgartiradi. */
export interface PlatformSettings {
  commissionPercent: number;
  trialMonths: number;
  autoConfirmDays: number;
}


/* ═══════════════════════  Tibbiy anketa  ═══════════════════════
 *
 * To'liq ixtiyoriy. To'ldirilgan bo'lsa so'rovga biriktiriladi va klinika
 * aniqroq taklif bera oladi — masalan surunkali kasallik operatsiya
 * narxiga va tayyorgarlikka ta'sir qiladi.
 */
export interface MedicalProfile {
  chronicConditions: string[];
  pastSurgeries: string[];
  allergies: string[];
  medications: string[];
  bloodType: string | null;
  heightCm: number | null;
  weightKg: number | null;
  notes: string | null;
  updatedAt: string | null;
}

export const EMPTY_MEDICAL_PROFILE: MedicalProfile = {
  chronicConditions: [],
  pastSurgeries: [],
  allergies: [],
  medications: [],
  bloodType: null,
  heightCm: null,
  weightKg: null,
  notes: null,
  updatedAt: null,
};

export const BLOOD_TYPES = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] as const;

/** Anketa qanchalik to'ldirilgan — profil ekranida ko'rsatiladi. */
export function medicalProfileFilled(p: MedicalProfile | null | undefined): boolean {
  if (!p) return false;
  return (
    p.chronicConditions.length > 0 ||
    p.pastSurgeries.length > 0 ||
    p.allergies.length > 0 ||
    p.medications.length > 0 ||
    Boolean(p.bloodType || p.heightCm || p.weightKg || p.notes)
  );
}

/**
 * So'rov kimga tegishli.
 *
 * O'ziga bo'lsa profil ma'lumotlari ishlatiladi. Tanishiga bo'lsa
 * ISHLATILMAYDI — klinika noto'g'ri odamning yoshini ko'rmasligi kerak.
 */
export interface RequestSubject {
  forSelf: boolean;
  name: string | null;
  birthYear: number | null;
  gender: Gender | null;
}

/* ─────────────────────────  So'rov bosqichlari  ───────────────────────── */

/**
 * Bemor so'rov qoldirayotgandagi bosqichlar admin panelidan boshqariladi.
 *
 * `builtin` — kodda yozilgan maxsus ekran (katalog, byudjet, sana, hujjat).
 * Qolgan turlar — admin o'zi yaratadigan oddiy savollar; javoblari
 * so'rovning `extraAnswers` maydonida saqlanadi.
 */
export const STEP_KINDS = ['builtin', 'text', 'longtext', 'choice', 'multichoice', 'number', 'boolean'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Kodda ekrani bor bosqichlar — admin bularni yarata olmaydi, faqat sozlaydi. */
export const BUILTIN_STEPS = [
  'who',
  'operation',
  'condition',
  'documents',
  'region',
  'budget',
  'date',
  'note',
  'review',
] as const;
export type BuiltinStep = (typeof BUILTIN_STEPS)[number];

/**
 * O'chirib bo'lmaydigan bosqichlar: serverdagi `createRequest` ularsiz
 * so'rovni rad etadi, ya'ni o'chirish oqimni butunlay buzardi.
 */
export const LOCKED_STEPS: readonly BuiltinStep[] = ['operation', 'condition', 'region', 'review'];

export interface StepOption {
  value: string;
  uz: string;
  ru: string;
}

export interface RequestStep {
  id: number;
  key: string;
  kind: StepKind;
  position: number;
  enabled: boolean;
  required: boolean;
  /** Qulflangan bosqichni o'chirib ham, ixtiyoriy qilib ham bo'lmaydi */
  locked: boolean;
  /** Bo'sh bo'lsa ilova o'zining tarjimasini ishlatadi */
  titleUz: string | null;
  titleRu: string | null;
  subUz: string | null;
  subRu: string | null;
  /** Faqat `choice` va `multichoice` uchun */
  options: StepOption[] | null;
}

/** Bemor ilovasiga beriladigan ko'rinish — faqat yoqilganlari, tili tanlangan. */
export interface WizardStep {
  key: string;
  kind: StepKind;
  required: boolean;
  title: string | null;
  sub: string | null;
  options: { value: string; label: string }[] | null;
}
