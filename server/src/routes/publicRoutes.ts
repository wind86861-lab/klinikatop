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
import { bannerFilePath } from '../services/appBanners';
import express, { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../middleware/rateLimit';
import { submitApplication } from '../services/clinicApplications';
import { MAX_LICENSE_BYTES } from '../services/applicationFiles';
import { listLabTests } from '../services/labOrgans';
import { catalogTree, listCities, listOperations } from '../services/catalog';
import { getPublicStats } from '../services/publicStats';
import { asyncHandler } from '../lib/asyncHandler';
import { publicSiteMedia, siteMediaFilePath } from '../services/siteMedia';
import { partnerFilePath } from '../services/siteContent';

export const publicRouter = Router();

/**
 * Bosh sahifa uchun raqamlar — ochiq, jamlangan.
 *
 * Bu yerda maxfiy hech narsa yo'q: bemor ismi ham, klinika daromadi
 * ham, so'rov mazmuni ham chiqmaydi — faqat sonlar.
 */
publicRouter.get(
  '/stats',
  rateLimit({ name: 'public-stats', windowSec: 60, max: 120 }),
  asyncHandler(async (_req, res) => {
    res.json(await getPublicStats());
  }),
);

/**
 * Sayt media ro'yxati — klinikatop.uz sahifalari o'qiydi.
 * Faqat ochiq narsalar: rasm manzili, YouTube ID va alt-matn.
 */
publicRouter.get(
  '/site-media',
  rateLimit({ name: 'public-site-media', windowSec: 60, max: 120 }),
  (_req, res) => {
    res.setHeader('cache-control', 'public, max-age=60');
    res.json({ items: publicSiteMedia() });
  },
);

/**
 * Sayt rasmi. Fayl nomi har yuklashda yangi — shuning uchun uzoq kesh
 * xavfsiz: rasm almashsa, manzil ham almashadi.
 */
publicRouter.get('/media/:name', (req, res, next) => {
  const file = siteMediaFilePath(req.params.name);
  // `sendFile` Range so'rovlarini qo'llaydi — video bo'laklab yuklanadi
  res.sendFile(
    file.path,
    {
      headers: {
        'content-type': file.mimeType,
        'cache-control': 'public, max-age=31536000, immutable',
        'cross-origin-resource-policy': 'same-site',
      },
    },
    (err) => err && next(err),
  );
});

/** Ilova banneri rasmi — nomi har yuklashda yangi, shuning uchun uzoq kesh */
publicRouter.get('/banners/:name', (req, res, next) => {
  const file = bannerFilePath(req.params.name);
  res.sendFile(
    file.path,
    {
      headers: {
        'content-type': file.mimeType,
        'cache-control': 'public, max-age=31536000, immutable',
        'cross-origin-resource-policy': 'same-site',
      },
    },
    (err) => err && next(err),
  );
});

/** Hamkor logosi — nomi har yuklashda yangi, shuning uchun uzoq kesh */
publicRouter.get('/partners/:name', (req, res, next) => {
  const file = partnerFilePath(req.params.name);
  res.sendFile(
    file.path,
    {
      headers: {
        'content-type': file.mimeType,
        'cache-control': 'public, max-age=31536000, immutable',
        'cross-origin-resource-policy': 'same-site',
      },
    },
    (err) => err && next(err),
  );
});

/** Ariza formasi uchun ma'lumotnomalar — ochiq, maxfiy emas. */
publicRouter.get('/reference', (_req, res) => {
  res.json({
    cities: listCities(),
    operations: listOperations().filter((o) => o.slug !== 'unknown'),
    // Ariza formasi ham daraxt ko'rinishida ko'rsatadi
    tree: catalogTree(),
    // Tahlil katalogi — klinika arizada o'zi qiladiganini belgilaydi
    labTests: listLabTests(false),
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
  /*
   * Email IXTIYORIY. Kirish identifikatori — telefon raqami: klinika
   * egasi pochtadan kamdan-kam foydalanadi, telefon esa hammada bor
   * va uni moderator qo'ng'iroq qilib tekshiradi.
   */
  contactEmail: z.string().trim().email().max(160).nullable().default(null),
  operationIds: z.array(z.number().int().positive()).max(60).default([]),
  labTestIds: z.array(z.number().int().positive()).max(120).default([]),
  acceptsReferral: z.boolean().default(false),
  /** Litsenziya fayli — base64. Turi serverda faylning o'ziga qarab aniqlanadi */
  licenseFile: z.object({
    name: z.string().trim().min(1).max(200),
    dataBase64: z.string().min(1),
  }),
});

/*
 * Ariza tanasi fayl bilan keladi — umumiy 1 MB chegara yetmaydi.
 * `index.ts` bu yo'lni umumiy parserdan o'tkazib yuboradi; bu yerda
 * tezlik cheklovidan KEYIN o'qiladi, ya'ni cheklovdan oshgan so'rovning
 * katta tanasi umuman tahlil qilinmaydi.
 */
const applicationBody = express.json({ limit: `${Math.ceil((MAX_LICENSE_BYTES * 1.4) / 1024 / 1024)}mb` });

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
  applicationBody,
  (req, res) => {
    const body = applicationSchema.parse(req.body);

    const result = submitApplication({
      ...body,
      ip: req.ip ?? null,
    });

    res.status(201).json({ id: result.id, status: result.status });
  },
);
