import { Router } from 'express';
import { z } from 'zod';
import { forbidden } from '../lib/errors';
import {
  agreeSchedule,
  cancelDeal,
  confirmDeal,
  getDeal,
  listPatientDeals,
  markPerformed,
  openDispute,
} from '../services/deals';
import { listMessages, markMessagesRead, sendMessage, unreadMessageCount } from '../services/chat';
import { createReview } from '../services/reviews';

export const dealsRouter = Router();

const clinicOf = (req: any): number | null => req.user?.clinicId ?? null;

dealsRouter.get('/', (req, res) => {
  res.json(listPatientDeals(req.user!.id));
});

dealsRouter.get('/:id', (req, res) => {
  const dealId = Number(req.params.id);
  const deal = getDeal(dealId);
  const isParty = deal.patientId === req.user!.id || deal.clinicId === clinicOf(req);
  if (!isParty) throw forbidden('Bu bitim sizga tegishli emas');
  res.json({
    deal,
    messages: listMessages(dealId, req.user!.id, clinicOf(req)),
    unread: unreadMessageCount(dealId, req.user!.id),
  });
});

/* ── Chat (8-bo'lim) — faqat bitim tomonlariga ochiq ── */

dealsRouter.get('/:id/messages', (req, res) => {
  const afterId = Number(req.query.after ?? 0);
  res.json(listMessages(Number(req.params.id), req.user!.id, clinicOf(req), afterId));
});

dealsRouter.post('/:id/messages', (req, res) => {
  const body = z
    .object({
      body: z.string().max(4000).default(''),
      attachment: z.string().max(500).nullable().optional(),
      kind: z.enum(['text', 'image', 'file']).default('text'),
    })
    .parse(req.body);

  res.status(201).json(
    sendMessage({
      dealId: Number(req.params.id),
      userId: req.user!.id,
      clinicId: clinicOf(req),
      body: body.body,
      attachment: body.attachment ?? null,
      kind: body.kind,
    }),
  );
});

dealsRouter.post('/:id/messages/read', (req, res) => {
  const changed = markMessagesRead(Number(req.params.id), req.user!.id, clinicOf(req));
  res.json({ marked: changed });
});

/* ── Bitim bosqichlari (7.2) ── */

dealsRouter.post('/:id/schedule', (req, res) => {
  const body = z.object({ scheduledAt: z.string().min(4) }).parse(req.body);
  res.json(agreeSchedule(Number(req.params.id), req.user!.id, clinicOf(req), body.scheduledAt));
});

/** Operatsiya bajarildi — faqat klinika belgilaydi. */
dealsRouter.post('/:id/performed', (req, res) => {
  const clinicId = clinicOf(req);
  if (!clinicId) throw forbidden('Bu amalni klinika bajaradi');
  res.json(markPerformed(Number(req.params.id), clinicId));
});

/** 9.1: bemor tasdiqlaydi — real summa narx statistikasiga tushadi. */
dealsRouter.post('/:id/confirm', (req, res) => {
  const body = z.object({ amountUzs: z.number().int().positive() }).parse(req.body);
  res.json(confirmDeal(Number(req.params.id), req.user!.id, body.amountUzs));
});

dealsRouter.post('/:id/dispute', (req, res) => {
  const body = z.object({ reason: z.string().min(3).max(600) }).parse(req.body);
  res.json(openDispute(Number(req.params.id), req.user!.id, clinicOf(req), body.reason));
});

dealsRouter.post('/:id/cancel', (req, res) => {
  const body = z.object({ reason: z.string().min(3).max(600) }).parse(req.body);
  res.json(cancelDeal(Number(req.params.id), req.user!.id, clinicOf(req), body.reason));
});

/** 10.1: sharh faqat tasdiqlangan bitimdan. */
dealsRouter.post('/:id/review', (req, res) => {
  const body = z
    .object({
      quality: z.number().int().min(1).max(5),
      attitude: z.number().int().min(1).max(5),
      cleanliness: z.number().int().min(1).max(5),
      result: z.number().int().min(1).max(5),
      body: z.string().max(2000).nullable().optional(),
    })
    .parse(req.body);

  res.status(201).json(
    createReview({
      dealId: Number(req.params.id),
      patientId: req.user!.id,
      scores: {
        quality: body.quality,
        attitude: body.attitude,
        cleanliness: body.cleanliness,
        result: body.result,
      },
      body: body.body ?? null,
    }),
  );
});
