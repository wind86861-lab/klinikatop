/** REST klienti — autentifikatsiya sarlavhalari bir joyda. */
import { tg } from './telegram';
import { isCabinetPath, webToken } from './session';
import type { CatalogBranch } from '@/components/CatalogBrowser';
import type {
  AdminClinicFilter,
  AdminClinicRow,
  AdminMetrics,
  AiResult,
  CapacitySlot,
  City,
  Gender,
  MedicalProfile,
  Clinic,
  ClinicAnalytics,
  ClinicDashboard,
  ClinicDocKind,
  ClinicDocument,
  ClinicOperator,
  ClinicRevenue,
  Doctor,
  NotificationPrefs,
  OfferTemplate,
  OperatorRole,
  PlatformSettings,
  ClinicPublic,
  Deal,
  DealDetail,
  Lang,
  MedicalRequest,
  Notification,
  Offer,
  OfferWithClinic,
  Operation,
  OperationCategory,
  DealPriceChange,
  PatientCase,
  PriceStats,
  RequestStatus,
  RequestWithMeta,
  Review,
  StoredFile,
  FileKind,
  ChatTurn,
  AiChatResult,
  SubscriptionPlan,
  TermsDocument,
  Urgency,
  User,
  ChatMessage,
} from '@shared/types';

const BASE = import.meta.env.VITE_API_URL ?? '';

export interface SyncChange {
  kind: 'add' | 'update' | 'deactivate' | 'reactivate';
  externalId: string;
  nameUz: string;
  fields?: string[];
}

export interface SyncPlan {
  categories: { add: number; update: number };
  operations: SyncChange[];
  sourceTotal: number;
  manualHidden: number;
  skippedDuplicates: number;
}

export interface SyncLogRow {
  id: number;
  status: 'ok' | 'failed';
  added: number;
  updated: number;
  deactivated: number;
  categories: number;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Kirish belgisi. Ikki yo'l bor va ular BIR VAQTDA yuborilmaydi:
 *
 *   veb kabinet (klinika, admin) → `Authorization: Bearer`
 *   Telegram ilovasi (bemor)     → `x-init-data`
 *
 * Veb token bo'lsa Telegram imzosi umuman qo'shilmaydi. Aks holda bitta
 * so'rovda ikki shaxs kelib, server qaysi birini tanlashi noaniq
 * bo'lardi — bu esa rollar chalkashishining eng oson yo'li.
 */
export function authHeaders(): Record<string, string> {
  /*
   * Belgini MANZIL tanlaydi, "qaysinisi bor" degan savol emas.
   *
   * Ilgari veb token bo'lsa u har doim ustun edi. Natijada klinika
   * xodimi kabinetga kirgan brauzerda bemor ilovasini ochsa, ilova
   * uning KLINIKA shaxsi bilan ochilardi — rollarni ajratish shu
   * yerda buzilardi.
   *
   * Endi qaysi ildiz yuklangan bo'lsa (main.tsx shu manzil bo'yicha
   * hal qiladi), o'sha ildizning belgisi yuboriladi. Ikkisi bir
   * so'rovda hech qachon uchrashmaydi.
   */
  if (isCabinetPath(window.location.pathname)) {
    const token = webToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  return tg?.initData ? { 'x-init-data': tg.initData } : {};
}

/**
 * So'rov qancha kutiladi.
 *
 * Chegarasiz `fetch` MANGU osilib turadi: mobil tarmoq uzilganda
 * brauzer xato bermaydi, shunchaki javob kelmaydi. Natijada ilova
 * yuklanish ekranida qotib qolardi va odam oq ekranga qarab
 * o'tirardi — aynan shundan "ochilmayapti" degan tuyg'u paydo
 * bo'ladi.
 *
 * 20 soniya: sekin 3G da og'ir so'rov ham ulguradi, lekin uzilgan
 * ulanish shuncha vaqtda ma'lum bo'ladi.
 */
const REQUEST_TIMEOUT_MS = 20_000;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      signal: abort.signal,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...authHeaders(),
        ...(init.headers as Record<string, string>),
      },
    });
  } catch (err: any) {
    /*
     * Tarmoq xatosi ham ApiError bo'lib chiqadi: chaqiruvchi kod
     * ikki xil xato shaklini ajratib o'tirmasin va foydalanuvchi
     * "Xatolik" o'rniga nima bo'lganini o'qisin.
     */
    throw new ApiError(
      0,
      err?.name === 'AbortError' ? 'timeout' : 'network',
      err?.name === 'AbortError'
        ? 'Server javob bermadi. Internetni tekshirib, qayta urinib ko‘ring.'
        : 'Internet aloqasi yo‘q. Ulanishni tekshiring.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let payload: any = {};
    try {
      payload = await res.json();
    } catch {
      /* bo'sh javob */
    }
    throw new ApiError(res.status, payload.code ?? 'unknown', payload.error ?? res.statusText, payload.details);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, body?: unknown) =>
  request<T>(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(p: string, body: unknown) =>
  request<T>(p, { method: 'PATCH', body: JSON.stringify(body) });
const put = <T>(p: string, body: unknown) =>
  request<T>(p, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(p: string) => request<T>(p, { method: 'DELETE' });

/* ── Sessiya ── */

export interface Bootstrap {
  user: User;
  clinic: Clinic | null;
  clinicOperationIds: number[];
  unread: number;
  /** Ism, familiya va viloyat to'ldirilganmi */
  profileComplete: boolean;
  termsVersion: string;
  features: {
    ai: boolean;
    commissionPercent: number;
    requestTtlHours: number;
    maxActiveRequests: number;
  };
}

export interface PricePulse {
  operationId: number;
  operationName: string;
  minUzs: number;
  maxUzs: number;
  sampleSize: number;
  windowDays: number;
  source: 'deals' | 'manual';
}

export interface Testimonial {
  id: number;
  patientName: string;
  operationName: string;
  rating: number;
  body: string;
  paidUzs: number;
  createdAt: string;
}

export interface Highlights {
  pulse: PricePulse | null;
  testimonials: Testimonial[];
}

export const api = {
  me: () => get<Bootstrap>('/me'),
  setLang: (lang: Lang) => patch<User>('/me', { lang }),
  updateProfile: (body: {
    firstName?: string;
    lastName?: string;
    cityId?: number;
    birthYear?: number | null;
    gender?: Gender | null;
    /** Telegram raqami o'zgartirilmaydi — bu qo'shimcha aloqa uchun */
    extraPhone?: string | null;
    lang?: Lang;
  }) => patch<User>('/me', body),

  /* Tibbiy anketa — ixtiyoriy, faqat o'ziniki */
  medicalProfile: () => get<MedicalProfile>('/me/medical'),
  saveMedicalProfile: (body: Partial<Omit<MedicalProfile, 'updatedAt'>>) =>
    patch<MedicalProfile>('/me/medical', body),
  terms: () => get<TermsDocument>('/me/terms'),
  markOnboarded: () => post<{ ok: true }>('/me/onboarded'),

  notifications: () => get<{ items: Notification[]; unread: number }>('/me/notifications'),
  readNotifications: (ids?: number[]) => post<{ unread: number }>('/me/notifications/read', { ids }),

  /* ── Katalog ── */
  cities: () => get<City[]>('/catalog/cities'),
  categories: () => get<OperationCategory[]>('/catalog/categories'),
  /** Katalog daraxti: soha → bo'lim → operatsiya */
  catalogTree: () => get<CatalogBranch[]>('/catalog/tree'),
  operations: (params: { q?: string; categoryId?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.categoryId) qs.set('categoryId', String(params.categoryId));
    return get<Operation[]>(`/catalog/operations${qs.toString() ? `?${qs}` : ''}`);
  },
  priceStats: (operationId: number, cityId: number) =>
    get<{ stats: PriceStats; matchingClinics: number }>(
      `/catalog/price-stats?operationId=${operationId}&cityId=${cityId}`,
    ),
  highlights: () => get<Highlights>('/catalog/highlights'),
  unknownOperation: () => get<Operation | null>('/catalog/unknown-operation'),
  clinicProfile: (id: number) => get<{ clinic: ClinicPublic; reviews: Review[] }>(`/catalog/clinics/${id}`),

  /* ── So'rovlar ── */
  requests: () => get<RequestWithMeta[]>('/requests'),
  request: (id: number) =>
    get<{ request: RequestWithMeta; offers: OfferWithClinic[]; stats: PriceStats }>(`/requests/${id}`),
  createRequest: (body: {
    operationId: number;
    cityId: number;
    conditionText: string;
    budgetUzs: number | null;
    note: string | null;
    urgency: Urgency;
    attachments?: string[];
    otherRegionsOk?: boolean;
    dateFrom?: string | null;
    dateTo?: string | null;
    dateFlexible?: boolean;
    aiConversation?: ChatTurn[] | null;
    aiSuggested?: boolean;
    /** So'rov kimga: o'ziga (true) yoki tanishiga */
    forSelf?: boolean;
    subjectName?: string | null;
    subjectBirthYear?: number | null;
    subjectGender?: Gender | null;
    /** Ommaviy oferta qabuli — serverda majburiy */
    acceptTerms: true;
  }) => post<RequestWithMeta>('/requests', body),

  /** Tibbiy hujjat yuklash — base64, qo'shimcha kutubxona kerak emas */
  uploadFile: (body: {
    name: string;
    mimeType: string;
    kind: FileKind;
    label?: string | null;
    dataBase64: string;
  }) => post<StoredFile>('/files', body),

  /** AI suhbati — butun tarix har safar yuboriladi (server holat saqlamaydi) */
  aiChat: (turns: ChatTurn[]) => post<AiChatResult>('/ai/chat', { turns }),
  fileUrl: (id: string) => `${BASE}/api/files/${id}`,
  updateRequest: (id: number, body: { budgetUzs?: number | null; note?: string | null; urgency?: Urgency }) =>
    patch<RequestWithMeta>(`/requests/${id}`, body),
  cancelRequest: (id: number) => post<RequestWithMeta>(`/requests/${id}/cancel`),

  /* ── Bitim narxining o'zgarishi ── */
  priceChanges: (dealId: number) => get<DealPriceChange[]>(`/deals/${dealId}/price-changes`),
  proposePriceChange: (dealId: number, newPriceUzs: number, reason: string) =>
    post<DealPriceChange>(`/deals/${dealId}/price-change`, { newPriceUzs, reason }),
  respondToPriceChange: (changeId: number, accept: boolean) =>
    post<DealPriceChange>(`/deals/price-change/${changeId}/respond`, { accept }),
  /** So'rovni butunlay o'chirish — fayllari bilan birga. Qaytarib bo'lmaydi. */
  deleteRequest: (id: number) => del<void>(`/requests/${id}`),
  chooseOffer: (requestId: number, offerId: number) =>
    post<DealDetail>(`/requests/${requestId}/choose`, { offerId }),

  /* ── Bitim va chat ── */
  deals: () => get<DealDetail[]>('/deals'),
  deal: (id: number) =>
    get<{ deal: DealDetail; messages: ChatMessage[]; unread: number }>(`/deals/${id}`),
  messages: (id: number, after = 0) => get<ChatMessage[]>(`/deals/${id}/messages?after=${after}`),
  sendMessage: (id: number, body: string, attachment?: string | null) =>
    post<ChatMessage>(`/deals/${id}/messages`, { body, attachment: attachment ?? null }),
  readMessages: (id: number) => post<{ marked: number }>(`/deals/${id}/messages/read`),
  schedule: (id: number, scheduledAt: string) => post<DealDetail>(`/deals/${id}/schedule`, { scheduledAt }),
  markPerformed: (id: number) => post<DealDetail>(`/deals/${id}/performed`),
  confirmDeal: (id: number, amountUzs: number) => post<DealDetail>(`/deals/${id}/confirm`, { amountUzs }),
  disputeDeal: (id: number, reason: string) => post<DealDetail>(`/deals/${id}/dispute`, { reason }),
  cancelDeal: (id: number, reason: string) => post<DealDetail>(`/deals/${id}/cancel`, { reason }),
  review: (
    id: number,
    body: { quality: number; attitude: number; cleanliness: number; result: number; body: string | null },
  ) => post<Review>(`/deals/${id}/review`, body),

  /* ── Katalog manbasi (banisa.uz) ── */
  catalogStatus: () => get<{ configured: boolean; log: SyncLogRow[] }>('/admin/catalog/status'),
  /** Reja — hech narsa o'zgartirmaydi, faqat nima bo'lishini aytadi */
  catalogPreview: () => post<SyncPlan>('/admin/catalog/preview', {}),
  catalogSync: () =>
    post<{
      added: number;
      updated: number;
      deactivated: number;
      categories: number;
      skippedDuplicates: number;
    }>('/admin/catalog/sync', {}),

  /* ── Klinika ── */
  clinic: () => get<{ clinic: Clinic; operationIds: number[] }>('/clinic'),
  updateClinic: (body: Partial<ClinicProfileBody>) => patch<Clinic>('/clinic', body),
  dashboard: () => get<ClinicDashboard>('/clinic/dashboard'),
  clinicReviews: () => get<Review[]>('/clinic/reviews'),
  clinicRequests: (onlyNew = false) => get<RequestWithMeta[]>(`/clinic/requests?onlyNew=${onlyNew}`),
  clinicRequest: (id: number) =>
    get<{ request: RequestWithMeta; patientCase: PatientCase; stats: PriceStats }>(`/clinic/requests/${id}`),
  clinicDeals: () => get<DealDetail[]>('/clinic/deals'),
  clinicOffers: () =>
    get<(OfferWithClinic & { requestStatus: RequestStatus; operationName: string })[]>('/offers'),
  createOffer: (body: {
    requestId: number;
    priceUzs: number;
    includes: string[];
    advantages: string[];
    leadTimeDays: number;
    /** Klinika taklif qilgan aniq sanalar (YYYY-MM-DD) */
    proposedDates?: string[];
    /** Budjetdan yuqori narx uchun izoh — server majburlaydi */
    aboveBudgetReason?: string | null;
    note: string | null;
  }) => post<OfferWithClinic>('/offers', body),
  updateOffer: (id: number, body: Partial<Omit<Offer, 'id' | 'requestId' | 'clinicId' | 'status'>>) =>
    patch<OfferWithClinic>(`/offers/${id}`, body),
  withdrawOffer: (id: number) => del<{ ok: true }>(`/offers/${id}`),
  subscribe: (plan: SubscriptionPlan, months = 1) => post<Clinic>('/clinic/subscription', { plan, months }),

  /* ── Moderator / admin ── */
  metrics: () => get<AdminMetrics>('/admin/metrics'),
  /* Moderator: klinikalar va platforma sozlamalari */
  /* Klinika arizalari (ochiq veb-formadan keladi) */
  applications: (status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') =>
    get<ClinicApplication[]>(`/admin/applications?status=${status}`),
  approveApplication: (id: number) => post<ClinicApplication>(`/admin/applications/${id}/approve`),
  rejectApplication: (id: number, note: string) =>
    post<ClinicApplication>(`/admin/applications/${id}/reject`, { note }),
  /* Ulanish kodi bilan klinikaga biriktirilish */
  connectClinic: (code: string) => post<{ clinic: Clinic }>('/clinic/connect', { code }),

  adminClinics: (filter: AdminClinicFilter = 'all') =>
    get<AdminClinicRow[]>(`/admin/clinics?filter=${filter}`),
  platformSettings: () => get<PlatformSettings>('/admin/settings'),
  savePlatformSettings: (body: Partial<PlatformSettings>) =>
    patch<PlatformSettings>('/admin/settings', body),
  setClinicCommission: (clinicId: number, percent: number | null) =>
    post<{ clinicId: number; percent: number | null }>(`/admin/clinics/${clinicId}/commission`, { percent }),
  grantTrial: (clinicId: number, months: number | null) =>
    post<{ until: string }>(`/admin/clinics/${clinicId}/trial`, { months }),

  verifications: () => get<Clinic[]>('/admin/verifications'),
  decideVerification: (clinicId: number, status: 'approved' | 'rejected', note: string | null) =>
    post<Clinic>(`/admin/verifications/${clinicId}`, { status, note }),
  disputes: () => get<Deal[]>('/admin/disputes'),
  dispute: (dealId: number) => get<{ deal: DealDetail; messages: ChatMessage[] }>(`/admin/disputes/${dealId}`),
  resolveDispute: (dealId: number, resolution: 'confirm' | 'cancel', amountUzs: number | null, note: string) =>
    post<Deal>(`/admin/disputes/${dealId}/resolve`, { resolution, amountUzs, note }),
};

/* ── AI: SSE oqimi ── */

export interface AiStreamCallbacks {
  onStart?: (disclaimer: string) => void;
  onProgress?: (chars: number) => void;
  onResult: (result: AiResult) => void;
  onError?: (message: string) => void;
}

/**
 * `POST /api/ai/suggest` oqimini o'qiydi.
 * `fetch` + ReadableStream ishlatiladi, chunki EventSource POST'ni qo'llab-quvvatlamaydi.
 */
export async function streamAiSuggestion(
  text: string,
  callbacks: AiStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/api/ai/suggest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!res.ok || !res.body) {
    callbacks.onError?.('AI hozircha javob bermadi');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const eventLine = frame.split('\n').find((l) => l.startsWith('event: '));
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) continue;

      const event = eventLine.slice(7).trim();
      let data: any;
      try {
        data = JSON.parse(dataLine.slice(6));
      } catch {
        continue;
      }

      if (event === 'start') callbacks.onStart?.(data.disclaimer);
      else if (event === 'progress') callbacks.onProgress?.(data.chars);
      else if (event === 'result') callbacks.onResult(data as AiResult);
      else if (event === 'error') callbacks.onError?.(data.message);
    }
  }
}

export type { MedicalRequest };


/**
 * Himoyalangan faylni blob sifatida olish.
 *
 * `<img src>` maxsus sarlavha yubormaydi, shuning uchun faylni fetch bilan
 * (auth sarlavhalari bilan) olib, object URL yasaymiz. Shu URL rasm ko'rsatish
 * uchun ham, yangi oynada ochish uchun ham ishlaydi.
 */
/* ═════════════════  Klinika kabineti  ═════════════════ */

export const clinicApi = {
  /* Verifikatsiya */
  verification: () => get<VerificationChecklist>('/clinic/verification'),
  addDocument: (body: { kind: ClinicDocKind; label: string | null; fileId: string }) =>
    post<ClinicDocument>('/clinic/documents', body),
  removeDocument: (id: number) => del<void>(`/clinic/documents/${id}`),

  /* Shablonlar */
  templates: (operationId?: number | null) =>
    get<OfferTemplate[]>(`/clinic/templates${operationId ? `?operationId=${operationId}` : ''}`),
  createTemplate: (body: TemplateBody) => post<OfferTemplate>('/clinic/templates', body),
  updateTemplate: (id: number, body: Partial<TemplateBody>) =>
    patch<OfferTemplate>(`/clinic/templates/${id}`, body),
  deleteTemplate: (id: number) => del<void>(`/clinic/templates/${id}`),
  useTemplate: (id: number) => post<void>(`/clinic/templates/${id}/used`),

  /* Shifokorlar */
  doctors: () => get<Doctor[]>('/clinic/doctors'),
  createDoctor: (body: DoctorBody) => post<Doctor>('/clinic/doctors', body),
  updateDoctor: (id: number, body: Partial<DoctorBody>) => patch<Doctor>(`/clinic/doctors/${id}`, body),
  deleteDoctor: (id: number) => del<void>(`/clinic/doctors/${id}`),

  /* Kalendar */
  slots: (from?: string, to?: string) =>
    get<CapacitySlot[]>(`/clinic/slots${from ? `?from=${from}&to=${to ?? from}` : ''}`),
  setSlot: (date: string, capacity: number, note: string | null) =>
    put<CapacitySlot>(`/clinic/slots/${date}`, { capacity, note }),
  deleteSlot: (date: string) => del<void>(`/clinic/slots/${date}`),

  /* Jamoa */
  operators: () => get<{ operators: ClinicOperator[] }>('/clinic/operators'),
  /** Xodimga ish hisobi ochish — javobda parol o'rnatish tokeni bir marta keladi. */
  addOperator: (body: { phone: string; email: string | null; fullName: string; role: OperatorRole }) =>
    post<{ setupToken: string }>('/clinic/operators', body),
  setOperatorRole: (userId: number, role: OperatorRole) =>
    patch<{ operators: ClinicOperator[] }>(`/clinic/operators/${userId}`, { role }),
  removeOperator: (userId: number) => del<void>(`/clinic/operators/${userId}`),

  /* Analitika va moliya */
  analytics: (days = 30) => get<ClinicAnalytics>(`/clinic/analytics?days=${days}`),
  revenue: () => get<ClinicRevenue>('/clinic/revenue'),

  /* Sharhlar */
  replyReview: (id: number, body: string) => post<Review[]>(`/clinic/reviews/${id}/reply`, { body }),

  /* Komissiya to'lovi */
  payCommission: (amountUzs: number, method: 'bank' | 'cash' | 'payme' | 'click', reference: string | null) =>
    post<ClinicRevenue>('/clinic/commission/pay', { amountUzs, method, reference }),

  /* Moderator: hujjat tekshiruvi */
  moderationDocuments: (clinicId: number) => get<ClinicDocument[]>(`/admin/clinics/${clinicId}/documents`),
  setDocumentStatus: (id: number, status: 'approved' | 'rejected', note: string | null) =>
    post<ClinicDocument>(`/admin/documents/${id}`, { status, note }),

  /* Bildirishnoma sozlamalari */
  notificationPrefs: () => get<NotificationPrefs>('/me/notification-prefs'),
  setNotificationPrefs: (body: Partial<NotificationPrefs>) =>
    patch<NotificationPrefs>('/me/notification-prefs', body),
};

export interface VerificationChecklist {
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  items: { key: string; done: boolean }[];
  complete: boolean;
  documents: ClinicDocument[];
}

export interface TemplateBody {
  title: string;
  operationId: number | null;
  priceUzs: number | null;
  includes: string[];
  advantages: string[];
  leadTimeDays: number;
  note: string | null;
}

export interface ClinicApplication {
  id: number;
  name: string;
  cityId: number;
  address: string;
  about: string;
  licenseNo: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  operationIds: number[];
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  clinicId: number | null;
  connectCode: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface ClinicProfileBody {
  name: string;
  address: string;
  about: string;
  logoUrl: string | null;
  phone: string | null;
  website: string | null;
  workHours: string | null;
  beds: number | null;
  foundedYear: number | null;
  equipment: string[];
  photos: string[];
  operationIds: number[];
}

export interface DoctorBody {
  fullName: string;
  specialty: string;
  experienceYears: number | null;
  photoFileId: string | null;
  bio: string | null;
  operationIds: number[];
  active: boolean;
}

export async function fetchFileObjectUrl(id: string): Promise<string> {
  const res = await fetch(`${BASE}/api/files/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new ApiError(res.status, 'file_error', 'Faylni ochib bo‘lmadi');
  return URL.createObjectURL(await res.blob());
}
