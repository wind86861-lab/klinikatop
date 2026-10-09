import { recommendationForRequest } from '../services/doctorRecommendations';
import { Router } from 'express';
import { z } from 'zod';
import { forbidden } from '../lib/errors';
import { REQUEST_KINDS } from '../../../shared/types';
import {
  cancelRequest,
  deleteRequest,
  createRequest,
  getRequest,
  listPatientRequests,
  updateRequest,
} from '../services/requests';
import { listRequestOffers } from '../services/offers';
import { statsForRequest } from '../services/priceStats';
import { chooseOffer } from '../services/deals';

export const requestsRouter = Router();

const createSchema = z.object({
  /*
   * So'rov turi. Berilmasa — operatsiya: eski mijozlar buni
   * yubormaydi va ular uchun hech narsa o'zgarmasligi kerak.
   */
  kind: z.enum(REQUEST_KINDS).default('operation'),
  /* Operatsiya so'rovida majburiy, tahlilda bo'lmaydi */
  operationId: z.number().int().positive().nullable().optional(),
  /* Tahlil so'rovida majburiy */
  labTestId: z.number().int().positive().nullable().optional(),
  /* Yo'llanmada qo'lda yozilgan analizlar; tozalash xizmatda */
  referralItems: z.array(z.string().max(200)).max(60).optional(),
  weightKg: z.number().int().min(2).max(400).nullable().optional(),
  /** Qarshi ko'rsatmalar yo'qligi tasdiqlandi (ular bor tekshiruvda majburiy) */
  contraindicationsAck: z.boolean().optional(),
  cityId: z.number().int().positive(),
  /*
   * Holat tavsifi — OPERATSIYA so'rovida majburiy ("bilmayman"
   * tanlansa klinika shundan aniqlaydi). Tahlilda esa so'ralmaydi:
   * u yerda savol "qaysi organ", tavsif emas. Majburiyligini
   * `createRequest` turga qarab tekshiradi.
   */
  conditionText: z.string().trim().max(2000).optional().default(''),
  budgetUzs: z.number().int().positive().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  urgency: z.enum(['normal', 'soon', 'urgent']).default('normal'),
  attachments: z.array(z.string().max(64)).max(5).default([]),
  otherRegionsOk: z.boolean().default(false),
  dateFrom: z.string().max(40).nullable().optional(),
  dateTo: z.string().max(40).nullable().optional(),
  dateFlexible: z.boolean().default(true),
  aiConversation: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
    .max(12)
    .nullable()
    .optional(),
  aiSuggested: z.boolean().default(false),
  /*
   * So'rov kimga. O'ziga bo'lsa profil ma'lumotlari ishlatiladi;
   * tanishiga bo'lsa quyidagi maydonlar to'ldiriladi.
   */
  forSelf: z.boolean().default(true),
  subjectName: z.string().trim().min(2).max(120).nullable().default(null),
  subjectBirthYear: z
    .number()
    .int()
    .min(new Date().getFullYear() - 120)
    .max(new Date().getFullYear())
    .nullable()
    .default(null),
  subjectGender: z.enum(['male', 'female']).nullable().default(null),
  // Ommaviy oferta — har so'rovda aniq qabul qilinishi kerak
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: 'Ommaviy oferta shartlarini qabul qiling' }),
  }),
  termsVersion: z.string().max(40).optional(),
  /*
   * Admin qo'shgan savollarga javoblar. Shakli oldindan ma'lum emas —
   * savollarni admin yaratadi. Shuning uchun bu yerda faqat "obyekt"
   * deb qabul qilinadi, mazmuni esa `validateAnswers` da amaldagi
   * savollarga solishtirib tekshiriladi.
   */
  extraAnswers: z.record(z.unknown()).nullable().optional(),
  /** Operatsiya noma'lum bo'lsa — AI aniqlagan soha */
  fallbackCategoryId: z.number().int().positive().nullable().optional(),
});

requestsRouter.get('/', (req, res) => {
  res.json(listPatientRequests(req.user!.id));
});

requestsRouter.post('/', (req, res) => {
  const body = createSchema.parse(req.body);
  const request = createRequest({
    contraindicationsAck: body.contraindicationsAck,
    patientId: req.user!.id,
    kind: body.kind,
    operationId: body.operationId ?? null,
    labTestId: body.labTestId ?? null,
    referralItems: body.referralItems ?? null,
    weightKg: body.weightKg ?? null,
    cityId: body.cityId,
    conditionText: body.conditionText,
    budgetUzs: body.budgetUzs ?? null,
    note: body.note ?? null,
    urgency: body.urgency,
    attachments: body.attachments,
    otherRegionsOk: body.otherRegionsOk,
    dateFrom: body.dateFrom ?? null,
    dateTo: body.dateTo ?? null,
    dateFlexible: body.dateFlexible,
    aiConversation: body.aiConversation ?? null,
    aiSuggested: body.aiSuggested,
    forSelf: body.forSelf,
    subjectName: body.subjectName,
    subjectBirthYear: body.subjectBirthYear,
    subjectGender: body.subjectGender,
    acceptTerms: body.acceptTerms,
    extraAnswers: body.extraAnswers ?? null,
    fallbackCategoryId: body.fallbackCategoryId ?? null,
    userAgent: req.header('user-agent') ?? null,
  });
  res.status(201).json(request);
});

/** Bitta ekran uchun to'liq holat: so'rov + takliflar + narx statistikasi. */
requestsRouter.get('/:id', (req, res) => {
  const request = getRequest(Number(req.params.id));
  if (request.patientId !== req.user!.id) throw forbidden('Bu so‘rov sizniki emas');
  res.json({
    request,
    offers: listRequestOffers(request.id),
    stats: statsForRequest(request),
    // Shifokor yo'naltirgan so'rovda — qaysi taklifni tavsiya qilgani (🩺 belgi)
    recommendation: recommendationForRequest(request.id),
  });
});

requestsRouter.patch('/:id', (req, res) => {
  const body = z
    .object({
      budgetUzs: z.number().int().positive().nullable().optional(),
      note: z.string().max(1000).nullable().optional(),
      urgency: z.enum(['normal', 'soon', 'urgent']).optional(),
    })
    .parse(req.body);
  res.json(updateRequest(Number(req.params.id), req.user!.id, body));
});

requestsRouter.post('/:id/cancel', (req, res) => {
  res.json(cancelRequest(Number(req.params.id), req.user!.id));
});

/**
 * So'rovni butunlay o'chirish.
 *
 * Bekor qilishdan farqi: bekor qilingani ro'yxatda qoladi, o'chirilgani
 * yo'q bo'ladi. Bitim tuzilgan so'rov o'chirilmaydi — servis buni
 * tekshiradi va 409 qaytaradi.
 */
requestsRouter.delete('/:id', (req, res) => {
  deleteRequest(Number(req.params.id), req.user!.id);
  res.status(204).end();
});

/**
 * 7.1: taklifni tanlash → bitim yaratiladi va chat ochiladi.
 *
 * Sana ham SHU YERDA belgilanadi: bemor klinika taklif qilgan
 * kunlardan birini tanlaydi va bitim shu sana bilan ochiladi.
 */
requestsRouter.post('/:id/choose', (req, res) => {
  const body = z
    .object({
      offerId: z.number().int().positive(),
      scheduledAt: z.string().min(10).max(30),
    })
    .parse(req.body);
  const deal = chooseOffer(Number(req.params.id), body.offerId, req.user!.id, body.scheduledAt);
  res.status(201).json(deal);
});
