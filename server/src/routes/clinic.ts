import { Router } from 'express';
import { z } from 'zod';
import { requireClinic } from '../middleware/auth';
import {
  activateSubscription,
  getClinic,
  getClinicOperations,
  getDashboard,
  registerClinic,
  updateClinicOperations,
  updateClinicProfile,
} from '../services/clinics';
import { listClinicRequests, markViewed, getRequest } from '../services/requests';
import { listClinicDeals } from '../services/deals';
import { listClinicReviews } from '../services/reviews';
import { getPriceStats } from '../services/priceStats';
import {
  acceptInvite,
  addDocument,
  createDoctor,
  createInvite,
  createTemplate,
  deleteDoctor,
  deleteSlot,
  deleteTemplate,
  getAnalytics,
  getRevenue,
  listDoctors,
  listInvites,
  listOperators,
  listSlots,
  listTemplates,
  markTemplateUsed,
  removeDocument,
  removeOperator,
  replyToReview,
  setOperatorRole,
  setSlot,
  updateDoctor,
  updateTemplate,
  recordCommissionPayment,
  verificationChecklist,
} from '../services/clinicCabinet';
import { useConnectCode } from '../services/clinicApplications';
import { CLINIC_DOC_KINDS } from '../../../shared/types';
import { forbidden } from '../lib/errors';

/** Faqat klinika administratori: pul, jamoa va profil qarorlari. */
function requireClinicAdmin(req: any): number {
  const clinicId = requireClinic(req);
  if (!req.user.roles.some((r: string) => r === 'clinic_admin' || r === 'admin')) {
    throw forbidden('Bu amal faqat klinika administratori uchun');
  }
  return clinicId;
}

export const clinicRouter = Router();

/** Ariza: litsenziya yuklanadi → moderator tekshiradi. */
clinicRouter.post('/register', (req, res) => {
  const body = z
    .object({
      name: z.string().min(2).max(200),
      cityId: z.number().int().positive(),
      address: z.string().max(300).default(''),
      about: z.string().max(1500).default(''),
      licenseFileId: z.string().max(300).nullable().optional(),
      operationIds: z.array(z.number().int().positive()).min(1),
    })
    .parse(req.body);

  res.status(201).json(
    registerClinic({
      userId: req.user!.id,
      name: body.name,
      cityId: body.cityId,
      address: body.address,
      about: body.about,
      licenseFileId: body.licenseFileId ?? null,
      operationIds: body.operationIds,
    }),
  );
});

clinicRouter.get('/', (req, res) => {
  const clinicId = requireClinic(req);
  res.json({ clinic: getClinic(clinicId), operationIds: getClinicOperations(clinicId) });
});

clinicRouter.patch('/', (req, res) => {
  const clinicId = requireClinic(req);
  const body = z
    .object({
      name: z.string().min(2).max(200).optional(),
      address: z.string().max(300).optional(),
      about: z.string().max(1500).optional(),
      logoUrl: z.string().max(500).nullable().optional(),
      phone: z.string().trim().max(40).nullable().optional(),
      website: z.string().trim().max(200).nullable().optional(),
      workHours: z.string().trim().max(120).nullable().optional(),
      beds: z.number().int().min(0).max(10000).nullable().optional(),
      foundedYear: z.number().int().min(1800).max(new Date().getFullYear()).nullable().optional(),
      equipment: z.array(z.string().trim().min(1).max(120)).max(24).optional(),
      photos: z.array(z.string().min(1).max(200)).max(12).optional(),
      operationIds: z.array(z.number().int().positive()).min(1).optional(),
    })
    .parse(req.body);

  if (body.operationIds) updateClinicOperations(clinicId, body.operationIds);
  res.json(updateClinicProfile(clinicId, body));
});

clinicRouter.get('/dashboard', (req, res) => {
  res.json(getDashboard(requireClinic(req)));
});

/** So'rovlar oqimi — faqat mos (operatsiya + shahar + obuna + tasdiq). */
clinicRouter.get('/requests', (req, res) => {
  const clinicId = requireClinic(req);
  const onlyNew = req.query.onlyNew === 'true';
  res.json(listClinicRequests(clinicId, { onlyNew }));
});

clinicRouter.get('/requests/:id', (req, res) => {
  const clinicId = requireClinic(req);
  const requestId = Number(req.params.id);
  const request = getRequest(requestId);

  const visible = listClinicRequests(clinicId).some((r) => r.id === requestId);
  if (!visible) throw forbidden('Bu so‘rov sizga yuborilmagan');

  // Ko'rildi belgisi — bemor radarida klinika avatari "yonadi"
  markViewed(requestId, clinicId);
  res.json({ request, stats: getPriceStats(request.operationId, request.cityId) });
});

clinicRouter.get('/deals', (req, res) => {
  res.json(listClinicDeals(requireClinic(req)));
});

clinicRouter.get('/reviews', (req, res) => {
  res.json(listClinicReviews(requireClinic(req), 50));
});

/** Obuna to'lovi (MVP: to'lov provayderisiz, admin/klinika tasdiqlaydi). */
clinicRouter.post('/subscription', (req, res) => {
  const clinicId = requireClinic(req);
  const body = z
    .object({ plan: z.enum(['basic', 'pro']), months: z.number().int().min(1).max(12).default(1) })
    .parse(req.body);
  res.json(activateSubscription(clinicId, body.plan, body.months));
});


/* ═════════════════  Verifikatsiya hujjatlari  ═════════════════ */

clinicRouter.get('/verification', (req, res) => {
  res.json(verificationChecklist(requireClinic(req)));
});

clinicRouter.post('/documents', (req, res) => {
  const clinicId = requireClinicAdmin(req);
  const body = z
    .object({
      kind: z.enum(CLINIC_DOC_KINDS).default('other'),
      label: z.string().trim().max(120).nullable().optional(),
      fileId: z.string().min(1).max(200),
    })
    .parse(req.body);

  res.status(201).json(
    addDocument({
      clinicId,
      ownerId: req.user!.id,
      kind: body.kind,
      label: body.label ?? null,
      fileId: body.fileId,
    }),
  );
});

clinicRouter.delete('/documents/:id', (req, res) => {
  removeDocument(requireClinicAdmin(req), Number(req.params.id));
  res.status(204).end();
});

/* ═════════════════  Taklif shablonlari  ═════════════════ */

const templateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  operationId: z.number().int().positive().nullable().default(null),
  priceUzs: z.number().int().positive().nullable().default(null),
  includes: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  advantages: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  leadTimeDays: z.number().int().min(1).max(365).default(7),
  note: z.string().trim().max(500).nullable().default(null),
});

clinicRouter.get('/templates', (req, res) => {
  const operationId = req.query.operationId ? Number(req.query.operationId) : null;
  res.json(listTemplates(requireClinic(req), operationId));
});

clinicRouter.post('/templates', (req, res) => {
  res.status(201).json(createTemplate(requireClinic(req), templateSchema.parse(req.body)));
});

clinicRouter.patch('/templates/:id', (req, res) => {
  res.json(updateTemplate(requireClinic(req), Number(req.params.id), templateSchema.partial().parse(req.body)));
});

clinicRouter.delete('/templates/:id', (req, res) => {
  deleteTemplate(requireClinic(req), Number(req.params.id));
  res.status(204).end();
});

clinicRouter.post('/templates/:id/used', (req, res) => {
  markTemplateUsed(requireClinic(req), Number(req.params.id));
  res.status(204).end();
});

/* ═════════════════  Shifokorlar  ═════════════════ */

const doctorSchema = z.object({
  fullName: z.string().trim().min(3).max(160),
  specialty: z.string().trim().max(120).default(''),
  experienceYears: z.number().int().min(0).max(70).nullable().default(null),
  photoFileId: z.string().max(200).nullable().default(null),
  bio: z.string().trim().max(1000).nullable().default(null),
  operationIds: z.array(z.number().int().positive()).max(40).default([]),
  active: z.boolean().default(true),
});

clinicRouter.get('/doctors', (req, res) => {
  res.json(listDoctors(requireClinic(req)));
});

clinicRouter.post('/doctors', (req, res) => {
  res.status(201).json(createDoctor(requireClinic(req), doctorSchema.parse(req.body)));
});

clinicRouter.patch('/doctors/:id', (req, res) => {
  res.json(updateDoctor(requireClinic(req), Number(req.params.id), doctorSchema.partial().parse(req.body)));
});

clinicRouter.delete('/doctors/:id', (req, res) => {
  deleteDoctor(requireClinic(req), Number(req.params.id));
  res.status(204).end();
});

/* ═════════════════  Kalendar / bo'sh slot  ═════════════════ */

clinicRouter.get('/slots', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const from = typeof req.query.from === 'string' ? req.query.from : today;
  const to =
    typeof req.query.to === 'string'
      ? req.query.to
      : new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
  res.json(listSlots(requireClinic(req), from, to));
});

clinicRouter.put('/slots/:date', (req, res) => {
  const body = z
    .object({
      capacity: z.number().int().min(0).max(50),
      note: z.string().trim().max(200).nullable().default(null),
    })
    .parse(req.body);
  res.json(setSlot(requireClinic(req), req.params.date, body.capacity, body.note));
});

clinicRouter.delete('/slots/:date', (req, res) => {
  deleteSlot(requireClinic(req), req.params.date);
  res.status(204).end();
});

/* ═════════════════  Jamoa  ═════════════════ */

clinicRouter.get('/operators', (req, res) => {
  const clinicId = requireClinic(req);
  res.json({ operators: listOperators(clinicId), invites: listInvites(clinicId) });
});

clinicRouter.post('/operators/invite', (req, res) => {
  const clinicId = requireClinicAdmin(req);
  const body = z.object({ role: z.enum(['clinic_admin', 'clinic_operator']).default('clinic_operator') }).parse(req.body);
  res.status(201).json(createInvite(clinicId, body.role));
});

clinicRouter.patch('/operators/:userId', (req, res) => {
  const clinicId = requireClinicAdmin(req);
  const body = z.object({ role: z.enum(['clinic_admin', 'clinic_operator']) }).parse(req.body);
  setOperatorRole(clinicId, Number(req.params.userId), body.role);
  res.json({ operators: listOperators(clinicId) });
});

clinicRouter.delete('/operators/:userId', (req, res) => {
  const clinicId = requireClinicAdmin(req);
  removeOperator(clinicId, req.user!.id, Number(req.params.userId));
  res.status(204).end();
});

/** Taklifnomani qabul qilish — klinikaga biriktirilmagan foydalanuvchi ham chaqiradi. */
clinicRouter.post('/join', (req, res) => {
  const body = z.object({ code: z.string().trim().min(4).max(32) }).parse(req.body);
  res.json(acceptInvite(req.user!.id, body.code));
});

/* ═════════════════  Analitika va moliya  ═════════════════ */

clinicRouter.get('/analytics', (req, res) => {
  const days = req.query.days ? Math.min(90, Math.max(7, Number(req.query.days))) : 30;
  res.json(getAnalytics(requireClinic(req), days));
});

clinicRouter.get('/revenue', (req, res) => {
  res.json(getRevenue(requireClinicAdmin(req)));
});

/* ═════════════════  Sharhga javob  ═════════════════ */

clinicRouter.post('/reviews/:id/reply', (req, res) => {
  const clinicId = requireClinic(req);
  const body = z.object({ body: z.string().trim().min(5).max(1000) }).parse(req.body);
  replyToReview(clinicId, Number(req.params.id), body.body);
  res.json(listClinicReviews(clinicId));
});


/* ═════════════════  Komissiya to'lovi  ═════════════════ */

/**
 * To'lov shlyuzi hali ulanmagan. Bu marshrut to'lov FAKTINI yozadi —
 * bank o'tkazmasi yoki naqd. Payme/Click ulanganda uning callback'i shu
 * yerga tushadi va hisob-kitob mantiqi o'zgarmaydi.
 */
clinicRouter.post('/commission/pay', (req, res) => {
  const clinicId = requireClinicAdmin(req);
  const body = z
    .object({
      amountUzs: z.number().int().positive(),
      method: z.enum(['bank', 'cash', 'payme', 'click']).default('bank'),
      reference: z.string().trim().max(120).nullable().default(null),
    })
    .parse(req.body);

  res.status(201).json(
    recordCommissionPayment({
      clinicId,
      amountUzs: body.amountUzs,
      method: body.method,
      reference: body.reference,
    }),
  );
});


/**
 * Ulanish kodi bilan klinikaga biriktirilish.
 *
 * Klinika veb-sahifada ariza qoldirgan, moderator tasdiqlagan va kod
 * bergan. Endi egasi Telegram orqali kirib, shu kodni kiritadi.
 * Rol shu paytda beriladi — oldin emas.
 */
clinicRouter.post('/connect', (req, res) => {
  const body = z.object({ code: z.string().trim().min(4).max(32) }).parse(req.body);
  res.json(useConnectCode(body.code, req.user!.id));
});
