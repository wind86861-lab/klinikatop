/**
 * Bemorning brauzerdan kirishi — telefon + Telegramga kelgan kod.
 *
 * OCHIQ marshrutlar: kirish uchun kirish talab qilib bo'lmaydi.
 * Himoya chastota chegarasi bilan — IP bo'yicha shu yerda, telefon
 * raqami bo'yicha esa xizmat ichida (`patientAuth`). Ikkovi ham
 * kerak: bitta IP ko'p raqamni sinashi ham, bitta raqamga ko'p kod
 * so'rashi ham mumkin.
 */
import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../middleware/rateLimit';
import { asyncHandler } from '../lib/asyncHandler';
import {
  endPatientSession,
  requestLoginCode,
  verifyLoginCode,
} from '../services/patientAuth';

export const patientAuthRouter = Router();

const phoneSchema = z.object({ phone: z.string().trim().min(6).max(30) });

/**
 * Kod so'rash.
 *
 * Hisob topilmasa ham 200 qaytadi (`found: false`): ilova
 * "avval Telegram botdan ro'yxatdan o'ting" deb yo'l ko'rsatadi.
 * Xato qaytarilsa, ilova buni nosozlik deb ko'rsatardi.
 */
patientAuthRouter.post(
  '/request-code',
  rateLimit({ name: 'patient-code', windowSec: 600, max: 10 }),
  asyncHandler(async (req, res) => {
    const { phone } = phoneSchema.parse(req.body);
    res.json(await requestLoginCode(phone, req.ip ?? null));
  }),
);

patientAuthRouter.post(
  '/verify-code',
  rateLimit({ name: 'patient-verify', windowSec: 600, max: 20 }),
  (req, res) => {
    const body = phoneSchema.extend({ code: z.string().trim().min(4).max(10) }).parse(req.body);
    res.json(
      verifyLoginCode(body.phone, body.code, req.ip ?? null, req.header('user-agent') ?? null),
    );
  },
);

/** Chiqish — token darhol kuyadi, muddatini kutmaydi. */
patientAuthRouter.post('/logout', (req, res) => {
  const header = req.header('authorization') ?? '';
  if (header.toLowerCase().startsWith('bearer ')) endPatientSession(header.slice(7).trim());
  res.json({ ok: true });
});
