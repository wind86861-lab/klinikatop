import { Router } from 'express';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { DOCTOR_DOC_KINDS, REQUEST_KINDS } from '../../../shared/types';
import { createDoctorCase, doctorStats, getDoctorCase, listDoctorCases } from '../services/doctorCases';
import { recommendOffer } from '../services/doctorRecommendations';
import { forbidden } from '../lib/errors';
import { MAX_LICENSE_BYTES } from '../services/applicationFiles';
import {
  addDoctorDocument,
  deleteDoctorDocument,
  getMyDoctor,
  readMyDoctorDocument,
  registerDoctor,
} from '../services/referringDoctors';

export const doctorRouter = Router();

/**
 * Shifokor kabineti FAQAT Telegram orqali.
 *
 * Telefon botda kontakt bilan tasdiqlangan va shaxs Telegram imzosi
 * bilan aniqlanadi. Brauzerdagi bemor sessiyasi (SMS/parol) ham,
 * klinika/admin veb sessiyasi ham bu yerga kirmaydi.
 */
function requireTelegram(req: Request, _res: Response, next: NextFunction) {
  if (req.web || !(req.header('x-init-data') ?? '').trim()) {
    return next(forbidden('Shifokor kabineti Telegram orqali ochiladi: botda /shifokor'));
  }
  next();
}

doctorRouter.use(requireTelegram);

/*
 * Diplom base64 bo'lib keladi — umumiy 1 MB chegara yetmaydi.
 * Ro'yxatdan o'tishda ikkita diplom birga kelishi mumkin.
 */
const bigJson = express.json({ limit: `${Math.ceil((MAX_LICENSE_BYTES * 2 * 1.4) / 1024 / 1024) + 1}mb` });

const docSchema = z.object({
  kind: z.enum(DOCTOR_DOC_KINDS),
  name: z.string().trim().min(1).max(200),
  dataBase64: z.string().min(1),
});

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  specialty: z.string().trim().min(1).max(120),
  workplace: z.string().trim().min(1).max(200),
  bio: z.string().max(1500).nullable().optional(),
  documents: z.array(docSchema).max(2).optional(),
});

/** Kabinet holati: profil (bo'lmasa `null`) va telefon tasdiqlanganmi */
doctorRouter.get('/me', (req, res) => {
  res.json({ doctor: getMyDoctor(req.user!.id), phoneVerified: Boolean(req.user!.phone) });
});

doctorRouter.post('/register', bigJson, (req, res) => {
  const body = profileSchema.parse(req.body);
  res.json(registerDoctor(req.user!.id, body));
});

doctorRouter.post('/documents', bigJson, (req, res) => {
  res.json(addDoctorDocument(req.user!.id, docSchema.parse(req.body)));
});

doctorRouter.delete('/documents/:id', (req, res) => {
  res.json(deleteDoctorDocument(req.user!.id, Number(req.params.id)));
});

doctorRouter.get('/documents/:id', (req, res) => {
  const file = readMyDoctorDocument(req.user!.id, Number(req.params.id));
  res.setHeader('content-type', file.mime);
  res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
  res.setHeader('cache-control', 'private, no-store');
  res.send(file.buffer);
});

/* ── Bemor uchun so'rovlar ── */

const caseSchema = z.object({
  patientPhone: z.string().trim().min(9).max(20),
  kind: z.enum(REQUEST_KINDS),
  operationId: z.number().int().positive().nullable().optional(),
  labTestId: z.number().int().positive().nullable().optional(),
  referralItems: z.array(z.string().max(200)).max(30).nullable().optional(),
  cityId: z.number().int().positive(),
  note: z.string().max(1500).nullable().optional(),
});

doctorRouter.get('/stats', (req, res) => res.json(doctorStats(req.user!.id)));
doctorRouter.get('/cases', (req, res) => res.json(listDoctorCases(req.user!.id)));
doctorRouter.get('/cases/:id', (req, res) => res.json(getDoctorCase(req.user!.id, Number(req.params.id))));
doctorRouter.post('/cases', (req, res) => res.status(201).json(createDoctorCase(req.user!.id, caseSchema.parse(req.body))));

/** Bemorga klinika taklifini tavsiya qilish (izoh bilan) — bemorga botda xabar boradi */
doctorRouter.post('/cases/:id/recommend', (req, res) => {
  const body = z
    .object({ offerId: z.number().int().positive(), comment: z.string().max(500).nullable().optional() })
    .parse(req.body);
  res.json(recommendOffer(req.user!.id, Number(req.params.id), body.offerId, body.comment ?? null));
});
