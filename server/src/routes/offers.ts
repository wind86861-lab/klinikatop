import { Router } from 'express';
import { z } from 'zod';
import { requireClinic } from '../middleware/auth';
import { createOffer, getOffer, listClinicOffers, updateOffer, withdrawOffer } from '../services/offers';

export const offersRouter = Router();

const offerBody = z.object({
  requestId: z.number().int().positive(),
  priceUzs: z.number().int().positive(),
  // Shaffoflik siyosati: nima kirishi ko'rsatilishi shart
  includes: z.array(z.string().min(1).max(120)).min(1).max(12),
  advantages: z.array(z.string().min(1).max(120)).max(8).default([]),
  leadTimeDays: z.number().int().min(0).max(365),
  note: z.string().max(600).nullable().optional(),
});

offersRouter.get('/', (req, res) => {
  res.json(listClinicOffers(requireClinic(req)));
});

offersRouter.post('/', (req, res) => {
  const clinicId = requireClinic(req);
  const body = offerBody.parse(req.body);
  res.status(201).json(createOffer({ ...body, clinicId, note: body.note ?? null }));
});

offersRouter.get('/:id', (req, res) => {
  res.json(getOffer(Number(req.params.id)));
});

offersRouter.patch('/:id', (req, res) => {
  const clinicId = requireClinic(req);
  const body = offerBody.partial().omit({ requestId: true }).parse(req.body);
  res.json(updateOffer(Number(req.params.id), clinicId, { ...body, note: body.note ?? undefined }));
});

offersRouter.delete('/:id', (req, res) => {
  withdrawOffer(Number(req.params.id), requireClinic(req));
  res.json({ ok: true });
});
