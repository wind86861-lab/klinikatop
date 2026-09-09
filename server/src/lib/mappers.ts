/** DB qatorlarini `shared/types` shakliga o'girish. */
import { parseJson } from '../db';
import type {
  City,
  Clinic,
  ClinicPublic,
  Deal,
  Lang,
  MedicalRequest,
  Notification,
  Offer,
  Operation,
  OperationCategory,
  Review,
  Role,
  User,
  ChatMessage,
} from '../../../shared/types';

const iso = (s: string | null): string | null => (s ? new Date(s.replace(' ', 'T') + 'Z').toISOString() : null);
const isoReq = (s: string): string => new Date(s.replace(' ', 'T') + 'Z').toISOString();

export function mapUser(r: any): User {
  return {
    id: r.id,
    telegramId: r.telegram_id,
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    photoUrl: r.photo_url,
    lang: r.lang as Lang,
    roles: parseJson<Role[]>(r.roles, ['patient']),
    clinicId: r.clinic_id,
    cityId: r.city_id ?? null,
    phone: r.phone ?? null,
    extraPhone: r.extra_phone ?? null,
    birthYear: r.birth_year ?? null,
    gender: r.gender ?? null,
    weightKg: r.weight_kg ?? null,
    profileCompletedAt: iso(r.profile_completed_at ?? null),
    onboardedAt: iso(r.onboarded_at),
    bonusPoints: r.bonus_points,
    blockedAt: iso(r.blocked_at),
    createdAt: isoReq(r.created_at),
  };
}

export function mapCity(r: any): City {
  return { id: r.id, slug: r.slug, nameUz: r.name_uz, nameRu: r.name_ru };
}

export function mapCategory(r: any): OperationCategory {
  return {
    id: r.id,
    parentId: r.parent_id ?? null,
    slug: r.slug,
    nameUz: r.name_uz,
    nameRu: r.name_ru,
    icon: r.icon,
  };
}

export function mapOperation(r: any): Operation {
  return {
    id: r.id,
    categoryId: r.category_id,
    subcategoryId: r.subcategory_id ?? null,
    slug: r.slug,
    nameUz: r.name_uz,
    nameRu: r.name_ru,
    aliasUz: r.alias_uz,
    aliasRu: r.alias_ru,
    descUz: r.desc_uz,
    descRu: r.desc_ru,
    keywords: parseJson<string[]>(r.keywords, []),
  };
}

const avgResponse = (r: any): number | null =>
  r.response_samples > 0 ? Math.round(r.response_minutes_sum / r.response_samples) : null;

/** JSON ustunini massivga aylantirish — buzuq qiymat bo'sh ro'yxat bo'ladi. */
function jsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function mapClinic(r: any): Clinic {
  return {
    id: r.id,
    externalId: r.external_id ?? null,
    name: r.name,
    cityId: r.city_id,
    address: r.address,
    about: r.about,
    logoUrl: r.logo_url,
    phone: r.phone ?? null,
    website: r.website ?? null,
    workHours: r.work_hours ?? null,
    beds: r.beds ?? null,
    foundedYear: r.founded_year ?? null,
    equipment: jsonArray(r.equipment),
    photos: jsonArray(r.photos),
    verification: r.verification,
    verificationNote: r.verification_note,
    licenseFileId: r.license_file_id,
    plan: r.plan,
    subscriptionStatus: r.subscription_status,
    subscriptionUntil: iso(r.subscription_until),
    ratingAvg: r.rating_avg,
    ratingCount: r.rating_count,
    dealsCount: r.deals_count,
    avgResponseMinutes: avgResponse(r),
    createdAt: isoReq(r.created_at),
  };
}

/** Bemorga ko'rinadigan qism — ichki maydonlarsiz. */
export function mapClinicPublic(r: any): ClinicPublic {
  return {
    id: r.id,
    name: r.name,
    cityId: r.city_id,
    logoUrl: r.logo_url,
    verified: r.verification === 'approved',
    plan: r.plan,
    ratingAvg: Math.round(r.rating_avg * 10) / 10,
    ratingCount: r.rating_count,
    dealsCount: r.deals_count,
    avgResponseMinutes: avgResponse(r),
  };
}

export function mapRequest(r: any): MedicalRequest {
  return {
    id: r.id,
    patientId: r.patient_id,
    kind: (r.kind ?? 'operation') as any,
    operationId: r.operation_id,
    labTestId: r.lab_test_id ?? null,
    labOrganId: r.lab_organ_id ?? null,
    weightKg: r.weight_kg ?? null,
    cityId: r.city_id,
    budgetUzs: r.budget_uzs,
    conditionText: r.condition_text ?? null,
    note: r.note,
    urgency: r.urgency,
    attachments: parseJson<string[]>(r.attachments, []),
    otherRegionsOk: Boolean(r.other_regions_ok),
    dateFrom: iso(r.date_from ?? null),
    dateTo: iso(r.date_to ?? null),
    dateFlexible: r.date_flexible === undefined ? true : Boolean(r.date_flexible),
    forSelf: r.for_self !== 0,
    subjectName: r.subject_name ?? null,
    subjectBirthYear: r.subject_birth_year ?? null,
    subjectGender: r.subject_gender ?? null,
    aiConversation: parseJson<any>(r.ai_conversation ?? null, null),
    fallbackCategoryId: r.fallback_category_id ?? null,
    // Admin qo'shgan savollarga javoblar. Bu yerda XOM holida qoladi:
    // yorliqlarni mijoz bosqichlar ro'yxatidan oladi. Aks holda har bir
    // qatorda `request_steps` o'qilardi — ro'yxatlarda bu N+1 bo'lardi.
    extraAnswers: parseJson<Record<string, unknown>>(r.extra_answers ?? null, null as any),
    status: r.status,
    aiSuggested: !!r.ai_suggested,
    expiresAt: isoReq(r.expires_at),
    chosenOfferId: r.chosen_offer_id,
    broadcastCount: r.broadcast_count ?? 0,
    viewedCount: r.viewed_count ?? 0,
    termsVersion: r.terms_version ?? null,
    termsAcceptedAt: iso(r.terms_accepted_at ?? null),
    createdAt: isoReq(r.created_at),
  };
}

export function mapOffer(r: any): Offer {
  return {
    id: r.id,
    requestId: r.request_id,
    clinicId: r.clinic_id,
    resolvedOperationId: r.resolved_operation_id ?? null,
    priceUzs: r.price_uzs,
    includes: parseJson<string[]>(r.includes, []),
    advantages: parseJson<string[]>(r.advantages, []),
    proposedDates: parseJson<string[]>(r.proposed_dates, []),
    aboveBudgetReason: r.above_budget_reason ?? null,
    note: r.note,
    status: r.status,
    createdAt: isoReq(r.created_at),
    updatedAt: isoReq(r.updated_at),
  };
}

export function mapDeal(r: any): Deal {
  return {
    id: r.id,
    requestId: r.request_id,
    offerId: r.offer_id,
    patientId: r.patient_id,
    clinicId: r.clinic_id,
    agreedPriceUzs: r.agreed_price_uzs,
    scheduledAt: iso(r.scheduled_at),
    status: r.status,
    confirmedAmountUzs: r.confirmed_amount_uzs,
    commissionUzs: r.commission_uzs,
    commissionPercent: r.commission_percent ?? null,
    confirmedAt: iso(r.confirmed_at),
    paidAt: iso(r.paid_at ?? null),
    paymentMethod: r.payment_method ?? null,
    receiptConfirmedAt: iso(r.receipt_confirmed_at ?? null),
    disputeReason: r.dispute_reason,
    createdAt: isoReq(r.created_at),
  };
}

export function mapMessage(r: any): ChatMessage {
  return {
    id: r.id,
    dealId: r.deal_id,
    senderId: r.sender_id,
    senderRole: r.sender_role,
    body: r.body,
    attachment: r.attachment,
    kind: r.kind,
    readAt: iso(r.read_at),
    redacted: !!r.redacted,
    createdAt: isoReq(r.created_at),
  };
}

export function mapReview(r: any): Review {
  return {
    id: r.id,
    dealId: r.deal_id,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    patientName: r.patient_name ?? 'Bemor',
    scores: {
      quality: r.quality,
      attitude: r.attitude,
      cleanliness: r.cleanliness,
      result: r.result,
    },
    average: Math.round(r.average * 10) / 10,
    body: r.body,
    reply: r.reply_body ? { body: r.reply_body, createdAt: isoReq(r.reply_at) } : null,
    createdAt: isoReq(r.created_at),
  };
}

export function mapNotification(r: any): Notification {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    titleKey: r.title_key,
    params: parseJson<Record<string, string | number>>(r.params, {}),
    link: r.link,
    readAt: iso(r.read_at),
    createdAt: isoReq(r.created_at),
  };
}

/** Tekshiruv turi — katalog qatoridan. */
export function mapLabTest(r: any, hasChildren = false) {
  return {
    id: r.id,
    slug: r.slug,
    nameUz: r.name_uz,
    nameRu: r.name_ru,
    icon: r.icon ?? '',
    parentId: r.parent_id ?? null,
    hasChildren,
    durationMin: r.duration_min ?? null,
  };
}

/** Tahlil organi — katalog qatoridan. */
export function mapLabOrgan(r: any) {
  return {
    id: r.id,
    slug: r.slug,
    nameUz: r.name_uz,
    nameRu: r.name_ru,
    icon: r.icon ?? '',
  };
}
