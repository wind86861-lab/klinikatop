import { Router } from 'express';
import { z } from 'zod';
import { AUCTION_MODES, REQUEST_KINDS, STEP_KINDS } from '../../../shared/types';
import { listSteps, saveSteps } from '../services/requestSteps';
import { getRequestKinds, setRequestKinds } from '../services/requestKinds';
import { adminDoctorStats } from '../services/doctorCases';
import { createBanner, deleteBanner, listBanners, reorderBanners, updateBanner } from '../services/appBanners';
import { listPendingCommissionPayments, reviewCommissionPayment } from '../services/clinicCabinet';
import {
  applyBotFace,
  BOT_DEFAULTS,
  getBotFace,
  SETTING_BOT_DESCRIPTION,
  SETTING_BOT_MENU,
  SETTING_BOT_SHORT,
} from '../services/bot';
import { setTextSetting } from '../services/terms.business';
import { addAiKey, deleteAiKey, listAiKeys, setAiKeyActive } from '../services/aiKeys';
import { resetAiProvider } from '../services/aiProvider';
import { listSyncLog, planSync, runSync, sourceConfigured } from '../services/catalogSync';
import { listOperationsForPricing, setOperationPriceRange } from '../services/operationPricing';
import { rateLimit } from '../middleware/rateLimit';
import express from 'express';
import { MAX_SITE_UPLOAD_BYTES, clearSiteMedia, listSiteMedia, setSiteImage, setSiteVideo } from '../services/siteMedia';
import { SITE_MEDIA_SLOTS } from '../../../shared/siteMedia';
import { forbidden } from '../lib/errors';
import { asyncHandler } from '../lib/asyncHandler';
import { db } from '../db';
import { listDocumentsForModeration, setDocumentStatus } from '../services/clinicCabinet';
import {
  SETTING_AUCTION_MODE,
  SETTING_AUTO_CONFIRM_DAYS,
  SETTING_COMMISSION,
  SETTING_TRIAL_MONTHS,
  grantTrial,
  listSettings,
  setClinicCommission,
  setSetting,
} from '../services/terms.business';
import {
  approveApplication,
  getApplicationLicense,
  deleteApplication,
  listApplications,
  rejectApplication,
} from '../services/clinicApplications';
import { ADMIN_CLINIC_FILTERS, type AdminClinicFilter } from '../../../shared/types';
import { getAdminClinicDetail } from '../services/adminClinicDetail';
import {
  addPartner,
  deletePartner,
  invalidateSite,
  listPartners,
  listSiteTexts,
  reorderPartners,
  setSiteText,
  updatePartner,
} from '../services/siteContent';
import { ADMIN_REQUEST_FILTERS, getAdminRequest, listAdminRequests, rebroadcastRequest } from '../services/adminRequests';
import {
  approveDoctor,
  getDoctorForAdmin,
  listDoctorsForAdmin,
  readDoctorDocumentForAdmin,
  rejectDoctor,
} from '../services/referringDoctors';
import { REFERRING_DOCTOR_STATUSES } from '../../../shared/types';

/** Moderator amalini mavjud audit jurnaliga yozadi. */
function logModeration(userId: number, entity: string, entityId: number, action: string, note: string | null) {
  db.prepare(
    `INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note) VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, entity, entityId, action, note);
}
import { requireRole } from '../middleware/auth';
import { createLabTest, deleteLabTest, listLabTests, updateLabTest } from '../services/labOrgans';
import {
  getMetrics,
  listDisputes,
  listFlaggedReviews,
  listUsers,
  moderateReview,
  resolveDispute,
  setUserBlocked,
  setUserRoles,
  upsertManualPrice,
  listClinicsForAdmin,
} from '../services/admin';
import {
  clinicDeletionImpact,
  deleteClinic,
  listPendingVerifications,
  resetClinicPassword,
  setVerification,
  suspendSubscription,
  updateClinicByAdmin,
} from '../services/clinics';
import { getDeal } from '../services/deals';
import { listMessages } from '../services/chat';

export const adminRouter = Router();

// Moderator — verifikatsiya va nizolar; admin — hammasi
adminRouter.use(requireRole('admin'));

adminRouter.get('/metrics', (_req, res) => res.json(getMetrics()));

/* ── Verifikatsiya (12.1) ── */

adminRouter.get('/verifications', (_req, res) => res.json(listPendingVerifications()));

adminRouter.post('/verifications/:clinicId', (req, res) => {
  const body = z
    .object({
      status: z.enum(['approved', 'rejected']),
      note: z.string().max(600).nullable().optional(),
    })
    .parse(req.body);
  res.json(setVerification(Number(req.params.clinicId), req.user!.id, body.status, body.note ?? null));
});

/* ── Nizolar (12.2) ── */

adminRouter.get('/disputes', (_req, res) => res.json(listDisputes()));

/** Moderator chat, summa va hujjatlar asosida ko'radi. */
adminRouter.get('/disputes/:dealId', (req, res) => {
  const dealId = Number(req.params.dealId);
  const deal = getDeal(dealId);
  res.json({ deal, messages: listMessages(dealId, deal.patientId, deal.clinicId) });
});

adminRouter.post('/disputes/:dealId/resolve', (req, res) => {
  const body = z
    .object({
      resolution: z.enum(['confirm', 'cancel']),
      amountUzs: z.number().int().positive().nullable().optional(),
      note: z.string().max(600).default(''),
    })
    .parse(req.body);
  res.json(
    resolveDispute(Number(req.params.dealId), req.user!.id, body.resolution, body.amountUzs ?? null, body.note),
  );
});

/* ── Sharh moderatsiyasi (10.3) ── */

adminRouter.get('/reviews/flagged', (_req, res) => res.json(listFlaggedReviews()));

adminRouter.post('/reviews/:id', (req, res) => {
  const body = z
    .object({ action: z.enum(['approve', 'remove']), note: z.string().max(600).default('') })
    .parse(req.body);
  moderateReview(Number(req.params.id), req.user!.id, body.action, body.note);
  res.json({ ok: true });
});

/* ── Foydalanuvchilar (faqat admin) ── */

adminRouter.get('/users', requireRole('admin'), (req, res) => {
  const search = typeof req.query.q === 'string' ? req.query.q : '';
  res.json(listUsers({ search }));
});

adminRouter.post('/users/:id/roles', requireRole('admin'), (req, res) => {
  const body = z
    .object({ roles: z.array(z.enum(['patient', 'clinic_admin', 'clinic_operator', 'admin'])).min(1) })
    .parse(req.body);
  res.json(setUserRoles(Number(req.params.id), body.roles, req.user!.id));
});

adminRouter.post('/users/:id/block', requireRole('admin'), (req, res) => {
  const body = z.object({ blocked: z.boolean(), note: z.string().max(600).default('') }).parse(req.body);
  res.json(setUserBlocked(Number(req.params.id), body.blocked, req.user!.id, body.note));
});

/**
 * Klinikani tahrirlash — kimlik maydonlari.
 *
 * Tarif, komissiya va verifikatsiya o'z amallarida qoladi: ular
 * boshqa qaror va boshqa jurnal yozuvi.
 */
adminRouter.patch('/clinics/:id', requireRole('admin'), (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2).max(200).optional(),
      cityId: z.number().int().positive().optional(),
      phone: z.string().trim().max(40).nullable().optional(),
      address: z.string().trim().max(300).optional(),
      website: z.string().trim().max(200).nullable().optional(),
    })
    .parse(req.body);

  res.json(updateClinicByAdmin(Number(req.params.id), body, req.user!.id));
});

/**
 * O'chirishdan OLDIN: nima yo'qoladi.
 *
 * Ekran shu sonlarni ko'rsatadi — odam nimani yo'qotayotganini
 * bilib turib tasdiqlasin.
 */
/** Bitta klinika — to'liq ma'lumot (jadval va so'rov varag'idan ochiladi) */
adminRouter.get('/clinics/:id/detail', requireRole('admin'), (req, res) => {
  res.json(getAdminClinicDetail(Number(req.params.id)));
});

adminRouter.get('/clinics/:id/deletion-impact', requireRole('admin'), (req, res) => {
  res.json(clinicDeletionImpact(Number(req.params.id)));
});

/**
 * Klinikani butunlay o'chirish.
 *
 * `force` bo'lmasa tarixi bor klinika o'chmaydi — xizmat 409 qaytaradi.
 */
adminRouter.delete('/clinics/:id', requireRole('admin'), (req, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  res.json(deleteClinic(Number(req.params.id), req.user!.id, { force }));
});

/**
 * Parolni tiklash — bir martalik havola.
 *
 * Javob BIR MARTA qaytadi va hech qayerda saqlanmaydi: administrator
 * uni klinikaga yetkazadi, parolni klinikaning o'zi qo'yadi.
 */
adminRouter.post('/clinics/:id/reset-password', requireRole('admin'), (req, res) => {
  res.json(resetClinicPassword(Number(req.params.id), req.user!.id));
});

adminRouter.post('/clinics/:id/suspend', requireRole('admin'), (req, res) => {
  const body = z.object({ note: z.string().max(600).default('') }).parse(req.body);
  res.json(suspendSubscription(Number(req.params.id), req.user!.id, body.note));
});

/* ── Cold-start narx (14-bo'lim) ── */

adminRouter.post('/prices', (req, res) => {
  const body = z
    .object({
      operationId: z.number().int().positive(),
      cityId: z.number().int().positive(),
      min: z.number().int().positive(),
      p25: z.number().int().positive(),
      median: z.number().int().positive(),
      p75: z.number().int().positive(),
      max: z.number().int().positive(),
      note: z.string().max(300).optional(),
    })
    .parse(req.body);
  upsertManualPrice(body);
  res.json({ ok: true });
});


/* ═════════════════  Klinika hujjatlarini tekshirish  ═════════════════ */

/** Moderator klinikaning barcha hujjatlarini ko'radi. */
adminRouter.get('/clinics/:id/documents', (req, res) => {
  res.json(listDocumentsForModeration(Number(req.params.id)));
});

/**
 * Hujjatni tasdiqlash yoki rad etish.
 * Rad etishda sabab majburiy — klinika nimani tuzatishini bilishi kerak.
 */
adminRouter.post('/documents/:id', (req, res) => {
  const body = z
    .object({
      status: z.enum(['approved', 'rejected']),
      note: z.string().trim().max(500).nullable().default(null),
    })
    .parse(req.body);

  res.json(setDocumentStatus(Number(req.params.id), body.status, body.note));
});


/* ═════════════════  Biznes shartlari  ═════════════════ */

/** Platforma bo'yicha umumiy qiymatlar. */
adminRouter.get('/settings', (_req, res) => {
  res.json(listSettings());
});

adminRouter.patch('/settings', (req, res) => {
  const body = z
    .object({
      commissionPercent: z.number().min(0).max(50).optional(),
      trialMonths: z.number().int().min(0).max(36).optional(),
      autoConfirmDays: z.number().int().min(1).max(90).optional(),
      auctionMode: z.enum(AUCTION_MODES).optional(),
    })
    .parse(req.body);

  /*
   * `platform_settings.updated_by` alohida admin panel jadvaliga bog'langan,
   * bugungi moderator esa oddiy `users` yozuvi. Shuning uchun bu yerda null
   * beriladi, kim o'zgartirgani esa mavjud `moderation_log` ga yoziladi —
   * u allaqachon `users` ga bog'langan va audit uchun aynan shu kerak.
   */
  const before = listSettings();
  if (body.commissionPercent !== undefined) setSetting(SETTING_COMMISSION, body.commissionPercent, null);
  if (body.trialMonths !== undefined) setSetting(SETTING_TRIAL_MONTHS, body.trialMonths, null);
  if (body.autoConfirmDays !== undefined) setSetting(SETTING_AUTO_CONFIRM_DAYS, body.autoConfirmDays, null);
  // Auksion turi — matnli sozlama, `setSetting` faqat raqam oladi
  if (body.auctionMode !== undefined) setTextSetting(SETTING_AUCTION_MODE, body.auctionMode, null);

  const after = listSettings();
  logModeration(req.user!.id, 'platform', 0, 'settings:update', JSON.stringify({ before, after }));

  res.json(after);
});

/**
 * Alohida klinikaga komissiya foizi.
 * `null` — platforma bo'yicha umumiy qiymatga qaytarish.
 */
adminRouter.post('/clinics/:id/commission', (req, res) => {
  const body = z.object({ percent: z.number().min(0).max(50).nullable() }).parse(req.body);
  setClinicCommission(Number(req.params.id), body.percent);
  logModeration(req.user!.id, 'clinic', Number(req.params.id), 'commission:set', String(body.percent));
  res.json({ clinicId: Number(req.params.id), percent: body.percent });
});

/**
 * Klinikaga sinov davri berish.
 * `months` berilmasa platforma bo'yicha umumiy muddat ishlatiladi.
 */
adminRouter.post('/clinics/:id/trial', (req, res) => {
  const body = z.object({ months: z.number().int().min(0).max(36).nullable().default(null) }).parse(req.body);
  const result = grantTrial(Number(req.params.id), body.months);
  logModeration(req.user!.id, 'clinic', Number(req.params.id), 'trial:grant', result.until);
  res.json(result);
});


/** Klinikalar ro'yxati — filtr bilan. */
adminRouter.get('/clinics', (req, res) => {
  const filter = ADMIN_CLINIC_FILTERS.includes(req.query.filter as any)
    ? (req.query.filter as AdminClinicFilter)
    : 'all';
  res.json(listClinicsForAdmin(filter));
});


/* ═════════════════  Klinika arizalari  ═════════════════ */

adminRouter.get('/applications', (req, res) => {
  const status = (req.query.status as any) ?? 'pending';
  res.json(listApplications(['pending', 'approved', 'rejected', 'all'].includes(status) ? status : 'pending'));
});

/**
 * Tasdiqlash: klinika yaratiladi va ulanish kodi beriladi.
 * Parol o'rnatish havolasi javobda BIR MARTA qaytadi — moderator uni
 * klinikaning pochtasiga yuboradi.
 */
/**
 * Bemor so'rovlari: kim so'radi va so'rov qaysi klinikalarga ketdi.
 * Bemor telefon raqami ko'rinadi — bu ekran faqat admin eshigida.
 */
adminRouter.get('/requests', requireRole('admin'), (req, res) => {
  const filter = z.enum(ADMIN_REQUEST_FILTERS).catch('all').parse(req.query.filter);
  res.json(listAdminRequests(filter));
});

adminRouter.get('/requests/:id', requireRole('admin'), (req, res) => {
  res.json(getAdminRequest(Number(req.params.id)));
});

adminRouter.post('/requests/:id/rebroadcast', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const result = rebroadcastRequest(id);
  logModeration(req.user!.id, 'request', id, 'rebroadcast', String(result.added));
  res.json(result);
});

/**
 * Arizadagi litsenziya fayli. Fayl ochiq manzilda emas — faqat admin
 * sessiyasi bilan, keshlanmasdan beriladi.
 */
adminRouter.get('/applications/:id/license', (req, res) => {
  const file = getApplicationLicense(Number(req.params.id));
  res.setHeader('content-type', file.mime);
  res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
  res.setHeader('cache-control', 'private, no-store');
  res.send(file.buffer);
});

adminRouter.post('/applications/:id/approve', (req, res) => {
  const app = approveApplication(Number(req.params.id), req.user!.id);
  /*
   * Jurnalga TOKEN YOZILMAYDI, faqat qaysi klinika yaratilgani.
   * Token — parolga teng sir: jurnalni ko'ra oladigan har kim uni
   * ishlatib klinika kabinetini egallab olardi.
   */
  logModeration(req.user!.id, 'application', app.id, 'approve', `clinic:${app.clinicId}`);
  res.json(app);
});

adminRouter.post('/applications/:id/reject', (req, res) => {
  const body = z.object({ note: z.string().trim().min(3).max(500) }).parse(req.body);
  const app = rejectApplication(Number(req.params.id), req.user!.id, body.note);
  logModeration(req.user!.id, 'application', app.id, 'reject', body.note);
  res.json(app);
});


/** Spam arizani o'chirish. Tasdiqlangani o'chirilmaydi. */
adminRouter.delete('/applications/:id', (req, res) => {
  deleteApplication(Number(req.params.id));
  logModeration(req.user!.id, 'application', Number(req.params.id), 'delete', null);
  res.status(204).end();
});

/* ═════════════════  Yo'naltiruvchi shifokorlar  ═════════════════ */

adminRouter.get('/doctors', (req, res) => {
  const filter = z.enum([...REFERRING_DOCTOR_STATUSES, 'all']).catch('all').parse(req.query.status);
  res.json(listDoctorsForAdmin(filter));
});

/** Shifokorlar statistikasi: tavsiyalar, klinikalar kesimi, summalar */
adminRouter.get('/doctors/stats', (_req, res) => res.json(adminDoctorStats()));

adminRouter.get('/doctors/:id', (req, res) => {
  res.json(getDoctorForAdmin(Number(req.params.id)));
});

/** Diplom fayli — ochiq manzil yo'q, faqat admin sessiyasi bilan, keshlanmasdan */
adminRouter.get('/doctors/:id/documents/:docId', (req, res) => {
  const file = readDoctorDocumentForAdmin(Number(req.params.id), Number(req.params.docId));
  res.setHeader('content-type', file.mime);
  res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
  res.setHeader('cache-control', 'private, no-store');
  res.send(file.buffer);
});

/*
 * Qaror — faqat to'liq huquqli administrator. Tasdiqlangan shifokor
 * bemorlar nomidan so'rov yarata oladi, ya'ni bu platformaga kimni
 * kiritish haqidagi qaror.
 */
adminRouter.post('/doctors/:id/approve', (req, res) => {
  requireFullAdmin(req);
  res.json(approveDoctor(Number(req.params.id), req.user!.id));
});

adminRouter.post('/doctors/:id/reject', (req, res) => {
  requireFullAdmin(req);
  const body = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
  res.json(rejectDoctor(Number(req.params.id), req.user!.id, body.reason));
});

/* ═════════════════  Katalog manbasi (banisa.uz)  ═════════════════ */

/**
 * Katalogga tegish — platformadagi eng ta'sirchan amal: u barcha
 * klinikalarning ko'radigan so'rovlarini o'zgartiradi. Shuning uchun
 * faqat to'liq huquqli admin va daqiqada bir necha marta.
 */
function requireFullAdmin(req: any): void {
  if (req.web?.level !== 'full') {
    throw forbidden('Bu amal faqat to‘liq huquqli administrator uchun');
  }
}

adminRouter.get('/catalog/status', (_req, res) => {
  res.json({ configured: sourceConfigured(), log: listSyncLog(20) });
});

/**
 * Reja — hech narsa yozmaydi.
 *
 * Admin avval nima o'zgarishini ko'radi. 105 ta yozuvni ko'rmasdan
 * almashtirish katalogni bir zumda buzishi mumkin.
 */
adminRouter.post(
  '/catalog/preview',
  rateLimit({ name: 'catalog-preview', windowSec: 60, max: 6 }),
  asyncHandler(async (req, res) => {
    requireFullAdmin(req);
    res.json(await planSync());
  }),
);

adminRouter.post(
  '/catalog/sync',
  rateLimit({ name: 'catalog-sync', windowSec: 300, max: 3 }),
  asyncHandler(async (req, res) => {
    requireFullAdmin(req);
    const result = await runSync(req.user!.id);
    logModeration(req.user!.id, 'platform', 0, 'catalog:sync', JSON.stringify(result));
    res.json(result);
  }),
);

/* ═════════════════  So'rov bosqichlari  ═════════════════ */

/**
 * Bemor so'rov qoldirayotgandagi bosqichlar.
 *
 * Tartib, matn va yoqilgan-yoqilmagani — mahsulot qarori. Admin ularni
 * shu yerdan o'zgartiradi va o'zining savolini qo'sha oladi.
 */
/* ── So'rov turlari: yoqish/o'chirish va tartib ── */

adminRouter.get('/request-kinds', (_req, res) => res.json(getRequestKinds()));

adminRouter.put('/request-kinds', (req, res) => {
  const body = z
    .object({ kinds: z.array(z.object({ kind: z.enum(REQUEST_KINDS), enabled: z.boolean() })).length(REQUEST_KINDS.length) })
    .parse(req.body);
  const before = getRequestKinds();
  // `updated_by` — admin_users jadvali (veb hisob), users emas
  const after = setRequestKinds(body.kinds, req.web?.id ?? null);
  logModeration(req.user!.id, 'platform', 0, 'request-kinds:update', JSON.stringify({ before, after }));
  res.json(after);
});

adminRouter.get('/request-steps', (_req, res) => {
  res.json(listSteps());
});

const stepOption = z.object({
  value: z.string().min(1).max(40),
  uz: z.string().min(1).max(80),
  ru: z.string().max(80).optional().default(''),
});

adminRouter.put('/request-steps', (req, res) => {
  const body = z
    .object({
      steps: z
        .array(
          z.object({
            key: z.string().min(2).max(40),
            kind: z.enum(STEP_KINDS),
            enabled: z.boolean(),
            required: z.boolean(),
            titleUz: z.string().max(120).nullable().optional(),
            titleRu: z.string().max(120).nullable().optional(),
            subUz: z.string().max(240).nullable().optional(),
            subRu: z.string().max(240).nullable().optional(),
            options: z.array(stepOption).nullable().optional(),
            /* Savol qamrovi: tur va daraxt shoxi; ikkalasi ham null — hammasida */
            requestKind: z.enum(REQUEST_KINDS).nullable().optional(),
            labTestId: z.number().int().positive().nullable().optional(),
          }),
        )
        .min(1)
        .max(24),
    })
    .parse(req.body);

  const before = listSteps();
  const after = saveSteps(body.steps, null);
  logModeration(req.user!.id, 'platform', 0, 'request-steps:update', JSON.stringify({ before, after }));

  res.json(after);
});

/* ═════════════════  Komissiya to'lovlari  ═════════════════ */

/**
 * Klinikalar topshirgan, lekin hali tasdiqlanmagan to'lovlar.
 *
 * Qarz FAQAT admin tasdiqlagach kamayadi — shuning uchun bu navbat
 * bo'sh turishi kerak emas.
 */
adminRouter.get('/commission-payments', (_req, res) => {
  res.json(listPendingCommissionPayments());
});

adminRouter.post('/commission-payments/:id', (req, res) => {
  const body = z
    .object({
      decision: z.enum(['confirmed', 'rejected']),
      note: z.string().trim().max(300).nullable().default(null),
    })
    .parse(req.body);

  const list = reviewCommissionPayment(Number(req.params.id), req.user!.id, body.decision, body.note);
  logModeration(
    req.user!.id,
    'platform',
    Number(req.params.id),
    `commission:${body.decision}`,
    body.note ?? '',
  );
  res.json(list);
});

/* ═════════════════  Bot matnlari  ═════════════════ */

/**
 * Botning "yuzi": /start bosilishidan OLDIN ko'rinadigan matn,
 * profildagi qisqa tavsif va ilovani ochadigan tugma nomi.
 *
 * Ilgari ular kodda qattiq yozilgan edi — o'zgartirish uchun deploy
 * kerak bo'lardi. Bu marketing matni, mahsulot qarori.
 */
adminRouter.get('/bot', (_req, res) => {
  res.json({ ...getBotFace(), defaults: BOT_DEFAULTS });
});

adminRouter.put('/bot', async (req, res) => {
  const body = z
    .object({
      // Telegram chegaralari: tavsif 512, qisqasi 120, tugma 30 belgi
      description: z.string().trim().max(512),
      shortDescription: z.string().trim().max(120),
      menuButton: z.string().trim().min(1).max(30),
    })
    .parse(req.body);

  setTextSetting(SETTING_BOT_DESCRIPTION, body.description, null);
  setTextSetting(SETTING_BOT_SHORT, body.shortDescription, null);
  setTextSetting(SETTING_BOT_MENU, body.menuButton, null);
  logModeration(req.user!.id, 'platform', 0, 'bot:update', JSON.stringify(body));

  /*
   * Telegram'ga DARHOL yuboriladi. Saqlab qo'yib, keyingi qayta
   * ishga tushishni kutish — admin uchun "saqladim, lekin
   * o'zgarmadi" degan holat bo'lardi.
   */
  let applied = false;
  try {
    applied = await applyBotFace(body);
  } catch (err) {
    console.warn('[bot] matnlarni qo\'llab bo\'lmadi:', err);
  }

  res.json({ ...getBotFace(), applied });
});

/* ═════════════════  AI kalitlari  ═════════════════ */

/**
 * Kalitlar ro'yxati — NIQOBLANGAN holda.
 *
 * To'liq kalit hech qachon qaytarilmaydi: panelga kirish huquqi
 * kalitni nusxalab olish huquqini bermasligi kerak.
 */
adminRouter.get('/ai-keys', requireRole('admin'), (_req, res) => {
  res.json(listAiKeys());
});

adminRouter.post('/ai-keys', requireRole('admin'), (req, res) => {
  const body = z
    .object({
      provider: z.enum(['gemini', 'anthropic']),
      apiKey: z.string().trim().min(12).max(400),
      label: z.string().trim().max(60).nullable().default(null),
    })
    .parse(req.body);

  const list = addAiKey(body);
  // Yangi kalit darhol ishlatilsin — keshdagi provayder eskirgan
  resetAiProvider();
  // Kalitning O'ZI jurnalga tushmaydi
  logModeration(req.user!.id, 'platform', 0, 'ai-key:add', body.provider);
  res.status(201).json(list);
});

adminRouter.post('/ai-keys/:id', requireRole('admin'), (req, res) => {
  const body = z.object({ active: z.boolean() }).parse(req.body);
  const list = setAiKeyActive(Number(req.params.id), body.active);
  resetAiProvider();
  logModeration(req.user!.id, 'platform', Number(req.params.id), `ai-key:${body.active ? 'on' : 'off'}`, '');
  res.json(list);
});

adminRouter.delete('/ai-keys/:id', requireRole('admin'), (req, res) => {
  const list = deleteAiKey(Number(req.params.id));
  resetAiProvider();
  logModeration(req.user!.id, 'platform', Number(req.params.id), 'ai-key:delete', '');
  res.json(list);
});

/* ═════════════════  Tahlil katalogi  ═════════════════ */

/**
 * Tekshiruvlar va ularga mos organlar — ADMIN belgilaydi.
 *
 * Bu mahsulot qarori, kod emas: yangi tekshiruv qo'shish yoki
 * organni ro'yxatdan olib tashlash uchun deploy kutish noto'g'ri
 * bo'lardi. Bemorga faqat shu yerda ruxsat berilgan juftliklar
 * ko'rsatiladi.
 */
adminRouter.get('/lab-tests', requireRole('admin'), (_req, res) => {
  res.json({ tests: listLabTests(true) });
});

const labTestSchema = z.object({
  nameUz: z.string().trim().min(2).max(120),
  nameRu: z.string().trim().max(120).optional().default(''),
  icon: z.string().trim().max(8).optional().default(''),
  position: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
  /* Qaysi guruhga kiradi (MRT, MSKT); null — o'zi guruh */
  parentId: z.number().int().positive().nullable().optional(),
  durationMin: z.number().int().min(0).max(600).nullable().optional(),
  needsWeight: z.boolean().optional(),
  contraUz: z.string().max(2000).nullable().optional(),
  contraRu: z.string().max(2000).nullable().optional(),
  minAge: z.number().int().min(0).max(120).nullable().optional(),
  maxAge: z.number().int().min(0).max(120).nullable().optional(),
});

adminRouter.post('/lab-tests', requireRole('admin'), (req, res) => {
  res.status(201).json(createLabTest(labTestSchema.parse(req.body)));
});

adminRouter.patch('/lab-tests/:id', requireRole('admin'), (req, res) => {
  const body = labTestSchema.partial().parse(req.body);
  res.json(updateLabTest(Number(req.params.id), body));
});

adminRouter.delete('/lab-tests/:id', requireRole('admin'), (req, res) => {
  deleteLabTest(Number(req.params.id));
  res.status(204).end();
});

/**
 * Operatsiyalarning narx oralig'i.
 *
 * Katalogning o'zi bu yerdan tahrirlanmaydi — operatsiyalar banisa
 * importidan keladi. Faqat narx: u bizning ma'lumotimiz va importda
 * yo'q.
 */
adminRouter.get('/operations', requireRole('admin'), (_req, res) => {
  res.json({ operations: listOperationsForPricing() });
});

adminRouter.patch('/operations/:id/price-range', requireRole('admin'), (req, res) => {
  const body = z
    .object({
      /*
       * `null` — chegarani olib tashlash, shuning uchun `nullable`
       * va `optional` emas: admin maydonni bo'shatganda buni aniq
       * yuborish kerak.
       */
      minPriceUzs: z.number().int().min(0).max(2_000_000_000).nullable(),
      maxPriceUzs: z.number().int().min(0).max(2_000_000_000).nullable(),
    })
    .parse(req.body);
  res.json(setOperationPriceRange(Number(req.params.id), body.minPriceUzs, body.maxPriceUzs));
});

/* ═════════════════  Sayt media (klinikatop.uz)  ═════════════════ */

/*
 * Rasm base64 bilan keladi — umumiy 1 MB chegara yetmaydi. Shuning
 * uchun bu yo'l `index.ts` dagi umumiy parserdan o'tkazib yuboriladi
 * va o'z chegarasi shu yerda.
 */
const siteMediaBody = express.json({ limit: `${Math.ceil((MAX_SITE_UPLOAD_BYTES * 1.4) / 1024 / 1024)}mb` });

adminRouter.get('/site-media', requireRole('admin'), (_req, res) => {
  res.json({ slots: SITE_MEDIA_SLOTS, items: listSiteMedia() });
});

const siteMediaSchema = z.union([
  z.object({
    mimeType: z.string().min(3).max(40),
    dataBase64: z.string().min(1),
    altUz: z.string().trim().max(200).default(''),
    altRu: z.string().trim().max(200).default(''),
  }),
  z.object({
    youtubeUrl: z.string().trim().min(5).max(300),
    altUz: z.string().trim().max(200).default(''),
    altRu: z.string().trim().max(200).default(''),
  }),
]);

adminRouter.put(
  '/site-media/:key',
  requireRole('admin'),
  rateLimit({ name: 'site-media', windowSec: 60, max: 30 }),
  siteMediaBody,
  (req, res) => {
    const body = siteMediaSchema.parse(req.body);
    const key = String(req.params.key);
    const item =
      'youtubeUrl' in body
        ? setSiteVideo(key, { url: body.youtubeUrl, altUz: body.altUz, altRu: body.altRu })
        : setSiteImage(key, body);
    invalidateSite();
    logModeration(req.user!.id, 'platform', 0, 'site-media:set', key);
    res.json(item);
  },
);

adminRouter.delete('/site-media/:key', requireRole('admin'), (req, res) => {
  clearSiteMedia(String(req.params.key));
  invalidateSite();
  logModeration(req.user!.id, 'platform', 0, 'site-media:clear', String(req.params.key));
  res.status(204).end();
});

/* ═════════════════  Sayt matnlari va hamkorlar  ═════════════════ */

const langSchema = z.enum(['uz', 'ru']);

adminRouter.get('/site-texts', requireRole('admin'), (req, res) => {
  res.json(listSiteTexts(langSchema.catch('uz').parse(req.query.lang)));
});

adminRouter.put('/site-texts', requireRole('admin'), (req, res) => {
  const body = z
    .object({ lang: langSchema, id: z.string().min(1).max(200), value: z.string().max(4000).nullable() })
    .parse(req.body);
  setSiteText(body.lang, body.id, body.value);
  logModeration(req.user!.id, 'platform', 0, body.value === null ? 'site-text:reset' : 'site-text:set', `${body.lang}:${body.id}`);
  res.json({ ok: true });
});

/* ── Ilova bannerlari (bemor bosh sahifasi) ── */

const bannerSchema = z.object({
  titleUz: z.string().max(80).optional(),
  titleRu: z.string().max(80).optional(),
  subUz: z.string().max(140).nullable().optional(),
  subRu: z.string().max(140).nullable().optional(),
  link: z.string().max(300).optional(),
  active: z.boolean().optional(),
  mimeType: z.string().max(40).optional(),
  dataBase64: z.string().optional(),
  removeImage: z.boolean().optional(),
  videoMimeType: z.string().max(40).optional(),
  videoBase64: z.string().optional(),
  videoLink: z.string().max(500).optional(),
  removeVideo: z.boolean().optional(),
  overlay: z.boolean().optional(),
});

adminRouter.get('/app-banners', requireRole('admin'), (_req, res) => res.json(listBanners()));

adminRouter.post('/app-banners', requireRole('admin'), siteMediaBody, (req, res) => {
  const b = createBanner(bannerSchema.parse(req.body));
  logModeration(req.user!.id, 'platform', 0, 'app-banner:add', String(b.id));
  res.status(201).json(b);
});

adminRouter.put('/app-banners/:id', requireRole('admin'), siteMediaBody, (req, res) => {
  const b = updateBanner(Number(req.params.id), bannerSchema.parse(req.body));
  logModeration(req.user!.id, 'platform', 0, 'app-banner:update', String(b.id));
  res.json(b);
});

adminRouter.delete('/app-banners/:id', requireRole('admin'), (req, res) => {
  deleteBanner(Number(req.params.id));
  logModeration(req.user!.id, 'platform', 0, 'app-banner:delete', String(req.params.id));
  res.status(204).end();
});

adminRouter.post('/app-banners/reorder', requireRole('admin'), (req, res) => {
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(100) }).parse(req.body);
  res.json(reorderBanners(ids));
});

adminRouter.get('/site-partners', requireRole('admin'), (_req, res) => res.json(listPartners()));

const partnerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().max(300).nullable().optional(),
  mimeType: z.string().max(40).optional(),
  dataBase64: z.string().optional(),
});

adminRouter.post('/site-partners', requireRole('admin'), siteMediaBody, (req, res) => {
  const body = partnerSchema.parse(req.body);
  if (!body.mimeType || !body.dataBase64) throw forbidden('Logo faylini tanlang');
  const p = addPartner({ name: body.name, url: body.url, mimeType: body.mimeType, dataBase64: body.dataBase64 });
  logModeration(req.user!.id, 'platform', 0, 'site-partner:add', p.name);
  res.status(201).json(p);
});

adminRouter.put('/site-partners/:id', requireRole('admin'), siteMediaBody, (req, res) => {
  const body = partnerSchema.partial().parse(req.body);
  res.json(updatePartner(Number(req.params.id), body));
});

adminRouter.delete('/site-partners/:id', requireRole('admin'), (req, res) => {
  deletePartner(Number(req.params.id));
  logModeration(req.user!.id, 'platform', 0, 'site-partner:delete', String(req.params.id));
  res.status(204).end();
});

adminRouter.post('/site-partners/reorder', requireRole('admin'), (req, res) => {
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(500) }).parse(req.body);
  res.json(reorderPartners(ids));
});
