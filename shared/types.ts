/**
 * KlinikaTop — umumiy tiplar (server va webapp uchun bitta manba).
 * Funksional spetsifikatsiyaning yadro mantig'i shu yerda kodlangan.
 */

/* ─────────────────────────  Rollar  ───────────────────────── */

export const ROLES = ['patient', 'clinic_admin', 'clinic_operator', 'moderator', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export type Lang = 'uz' | 'ru';

/* ─────────────────────────  Lifecycle  ───────────────────────── */

/** So'rov: YANGI → TAKLIFLAR_KELMOQDA → TANLANGAN → YAKUNLANGAN | BEKOR */
export const REQUEST_STATUSES = ['NEW', 'COLLECTING', 'CHOSEN', 'COMPLETED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Taklif: YUBORILGAN → TANLANGAN | RAD_ETILDI | MUDDATI_TUGADI */
export const OFFER_STATUSES = ['SENT', 'CHOSEN', 'REJECTED', 'EXPIRED', 'WITHDRAWN'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Bitim: TANLANGAN → KELISHILGAN → BAJARILGAN → TASDIQLANGAN | BEKOR | NIZO */
export const DEAL_STATUSES = ['SELECTED', 'AGREED', 'PERFORMED', 'CONFIRMED', 'CANCELLED', 'DISPUTED'] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const DEAL_STEPS: DealStatus[] = ['SELECTED', 'AGREED', 'PERFORMED', 'CONFIRMED'];

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
  AGREED: ['PERFORMED', 'CANCELLED', 'DISPUTED'],
  PERFORMED: ['CONFIRMED', 'DISPUTED'],
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
  /** Ism, familiya va viloyat to'ldirilgan payt. Bo'sh bo'lsa — ro'yxatdan o'tish tugallanmagan */
  profileCompletedAt: string | null;
  onboardedAt: string | null;
  bonusPoints: number;
  blockedAt: string | null;
  createdAt: string;
}

/** Profil to'liq to'ldirilganmi — so'rov yuborish uchun shart. */
export function isProfileComplete(user: User | null | undefined): boolean {
  return Boolean(
    user && user.firstName.trim() && user.lastName?.trim() && user.cityId,
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
  slug: string;
  nameUz: string;
  nameRu: string;
  icon: string;
}

export interface Operation {
  id: number;
  categoryId: number;
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
  note: string | null;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
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
  confirmedAt: string | null;
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

/** Taklifnoma — yangi operator shu kod bilan klinikaga qo'shiladi. */
export interface ClinicInvite {
  code: string;
  role: OperatorRole;
  createdAt: string;
  expiresAt: string;
  usedByUserId: number | null;
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
  /** To'langan komissiya — hisob-kitob tarixi bilan */
  paidCommissionUzs: number;
  commissionPayments: {
    id: number;
    amountUzs: number;
    method: string;
    reference: string | null;
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
