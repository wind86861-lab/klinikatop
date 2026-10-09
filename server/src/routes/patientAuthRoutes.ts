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
  loginWithPassword,
  requestLoginCode,
  setPatientPassword,
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
    const { phone, purpose } = phoneSchema
      .extend({ purpose: z.enum(['login', 'register', 'reset']).default('login') })
      .parse(req.body);
    res.json(await requestLoginCode(phone, req.ip ?? null, purpose));
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

/**
 * Telefon + parol bilan kirish — SMS'siz.
 *
 * IP bo'yicha cheklov shu yerda; hisob bo'yicha bloklash (5 xato →
 * 15 daqiqa) xizmat ichida. Ikkovi birga: bitta IP ko'p raqamni,
 * ko'p IP bitta raqamni sinay olmaydi.
 */
patientAuthRouter.post(
  '/login',
  rateLimit({ name: 'patient-login', windowSec: 600, max: 30 }),
  (req, res) => {
    const body = phoneSchema.extend({ password: z.string().min(1).max(200) }).parse(req.body);
    res.json(loginWithPassword(body.phone, body.password, req.ip ?? null, req.header('user-agent') ?? null));
  },
);

/**
 * Parol o'rnatish / tiklash. Sessiya tokeni sarlavhada — va u KOD
 * bilan yaqinda ochilgan bo'lishi shart (xizmat tekshiradi).
 */
patientAuthRouter.post(
  '/set-password',
  rateLimit({ name: 'patient-set-password', windowSec: 600, max: 10 }),
  (req, res) => {
    const header = req.header('authorization') ?? '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
    setPatientPassword(token, password);
    res.json({ ok: true });
  },
);

/** Chiqish — token darhol kuyadi, muddatini kutmaydi. */
patientAuthRouter.post('/logout', (req, res) => {
  const header = req.header('authorization') ?? '';
  if (header.toLowerCase().startsWith('bearer ')) endPatientSession(header.slice(7).trim());
  res.json({ ok: true });
});
