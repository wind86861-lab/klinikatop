import { Router } from 'express';
import { z } from 'zod';
import { approveInvite, declineInvite, getInvite } from '../services/doctorCases';

/**
 * Bemor tomoni: shifokor yaratgan so'rovni ko'rish va qaror qilish.
 *
 * Taklifnoma faqat raqami mos bemorga ochiladi (servisda tekshiriladi) —
 * begona odam havolani qo'lga kiritsa ham `404` oladi.
 */
export const doctorInvitesRouter = Router();

doctorInvitesRouter.get('/:token', (req, res) => {
  res.json(getInvite(req.user!.id, req.params.token));
});

doctorInvitesRouter.post('/:token/approve', (req, res) => {
  const body = z
    .object({
      acceptTerms: z.boolean(),
      weightKg: z.number().min(2).max(400).nullable().optional(),
      contraindicationsAck: z.boolean().optional(),
    })
    .parse(req.body);
  res.json(approveInvite(req.user!.id, req.params.token, { ...body, userAgent: req.header('user-agent') ?? null }));
});

doctorInvitesRouter.post('/:token/decline', (req, res) => {
  declineInvite(req.user!.id, req.params.token, false);
  res.status(204).end();
});

doctorInvitesRouter.post('/:token/not-me', (req, res) => {
  declineInvite(req.user!.id, req.params.token, true);
  res.status(204).end();
});
