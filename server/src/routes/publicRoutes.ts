/**
 * Ochiq marshrutlar — autentifikatsiyadan OLDIN turadi.
 *
 * Bu yerdagi hamma narsa internetdan ochiq, shuning uchun qat'iy qoidalar:
 *   • faqat YOZUV, hech qanday o'qish yo'q (ma'lumot sizib chiqmasin)
 *   • javob minimal: "qabul qilindi" dan boshqa hech narsa qaytmaydi
 *   • tezlik cheklovi IP bo'yicha
 *
 * Nima uchun kerak: klinika egasidan ariza qoldirish uchun Telegram
 * talab qilish keraksiz to'siq. U avval arizasini qoldiradi, tasdiqlangach
 * bot orqali hisobini biriktiradi.
 */
import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../middleware/rateLimit';
import { submitApplication } from '../services/clinicApplications';
import { listCities, listOperations } from '../services/catalog';

export const publicRouter = Router();

/** Ariza formasi uchun ma'lumotnomalar — ochiq, maxfiy emas. */
publicRouter.get('/reference', (_req, res) => {
  res.json({
    cities: listCities(),
    operations: listOperations().filter((o) => o.slug !== 'unknown'),
  });
});

const applicationSchema = z.object({
  name: z.string().trim().min(2).max(200),
  cityId: z.number().int().positive(),
  address: z.string().trim().min(3).max(300),
  about: z.string().trim().max(1500).default(''),
  licenseNo: z.string().trim().min(3).max(120),
  contactName: z.string().trim().min(2).max(120),
  contactPhone: z.string().trim().min(7).max(40),
  contactEmail: z.string().trim().email().max(160).nullable().default(null),
  operationIds: z.array(z.number().int().positive()).min(1).max(60),
});

/**
 * Ariza qoldirish.
 *
 * Javobda faqat ariza raqami qaytadi — boshqa hech narsa. Ariza holatini
 * ochiq so'rab olish yo'li YO'Q: aks holda raqamlarni ketma-ket sinab,
 * qaysi klinikalar ariza berganini bilib olish mumkin bo'lardi.
 */
publicRouter.post(
  '/clinic-application',
  rateLimit({ name: 'clinic-application', windowSec: 3600, max: 20 }),
  (req, res) => {
    const body = applicationSchema.parse(req.body);

    const result = submitApplication({
      ...body,
      ip: req.ip ?? null,
    });

    res.status(201).json({ id: result.id, status: result.status });
  },
);
