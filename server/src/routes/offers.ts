import { Router } from 'express';
import { z } from 'zod';
import { requireClinic } from '../middleware/auth';
import { createOffer, getOffer, listClinicOffers, updateOffer, withdrawOffer } from '../services/offers';

export const offersRouter = Router();

const offerBody = z.object({
  requestId: z.number().int().positive(),
  priceUzs: z.number().int().positive(),
  /*
   * Bandlar ERKIN matn. Tayyor variantlar hamma holatni qamrab
   * ololmaydi: har klinikaning o'z xizmati bor va uni ro'yxatga
   * sig'dirishga majburlash shaffoflikni kamaytiradi.
   */
  includes: z.array(z.string().min(1).max(120)).min(1).max(12),
  advantages: z.array(z.string().min(1).max(120)).max(12).default([]),
  leadTimeDays: z.number().int().min(0).max(365),
  /** Klinika taklif qilgan aniq sanalar */
  proposedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(6).default([]),
  /** Budjetdan yuqori narx uchun izoh — servis majburlaydi */
  aboveBudgetReason: z.string().trim().max(300).nullable().optional(),
  /** So'rovda operatsiya noma'lum bo'lsa — klinika aniqlagani (servis majburlaydi) */
  resolvedOperationId: z.number().int().positive().nullable().optional(),
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
