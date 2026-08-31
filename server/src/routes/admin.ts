import { Router } from 'express';
import { z } from 'zod';
import { STEP_KINDS } from '../../../shared/types';
import { listSteps, saveSteps } from '../services/requestSteps';
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
import { listSyncLog, planSync, runSync, sourceConfigured } from '../services/catalogSync';
import { rateLimit } from '../middleware/rateLimit';
import { forbidden } from '../lib/errors';
import { asyncHandler } from '../lib/asyncHandler';
import { db } from '../db';
import { listDocumentsForModeration, setDocumentStatus } from '../services/clinicCabinet';
import {
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
  deleteApplication,
  listApplications,
  rejectApplication,
} from '../services/clinicApplications';
import { ADMIN_CLINIC_FILTERS, type AdminClinicFilter } from '../../../shared/types';

/** Moderator amalini mavjud audit jurnaliga yozadi. */
function logModeration(userId: number, entity: string, entityId: number, action: string, note: string | null) {
  db.prepare(
    `INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note) VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, entity, entityId, action, note);
}
import { requireRole } from '../middleware/auth';
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
import { listPendingVerifications, setVerification, suspendSubscription } from '../services/clinics';
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
