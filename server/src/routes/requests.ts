import { Router } from 'express';
import { z } from 'zod';
import { forbidden } from '../lib/errors';
import {
  cancelRequest,
  createRequest,
  getRequest,
  listPatientRequests,
  updateRequest,
} from '../services/requests';
import { listRequestOffers } from '../services/offers';
import { getPriceStats } from '../services/priceStats';
import { chooseOffer } from '../services/deals';

export const requestsRouter = Router();

const createSchema = z.object({
  operationId: z.number().int().positive(),
  cityId: z.number().int().positive(),
  // Holat tavsifi majburiy: "bilmayman" tanlansa klinika shundan aniqlaydi
  conditionText: z.string().trim().min(10).max(2000),
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
});

requestsRouter.get('/', (req, res) => {
  res.json(listPatientRequests(req.user!.id));
});

requestsRouter.post('/', (req, res) => {
  const body = createSchema.parse(req.body);
  const request = createRequest({
    patientId: req.user!.id,
    operationId: body.operationId,
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
    stats: getPriceStats(request.operationId, request.cityId),
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

/** 7.1: taklifni tanlash → bitim yaratiladi va chat ochiladi. */
requestsRouter.post('/:id/choose', (req, res) => {
  const body = z.object({ offerId: z.number().int().positive() }).parse(req.body);
  const deal = chooseOffer(Number(req.params.id), body.offerId, req.user!.id);
  res.status(201).json(deal);
});
