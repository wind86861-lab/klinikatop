import { Router } from 'express';
import { z } from 'zod';
import { getNotificationPrefs, setNotificationPrefs } from '../services/clinicCabinet';

/** Sokin soatlar uchun haqiqiy vaqt: 00:00–23:59. Shakl emas, qiymat tekshiriladi. */
const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
import { db } from '../db';
import { badRequest } from '../lib/errors';
import { mapUser } from '../lib/mappers';
import { touchOnboarded } from '../middleware/auth';
import { listNotifications, markRead, unreadCount } from '../services/notifications';
import { getClinic, getClinicOperations } from '../services/clinics';
import { aiEnabled } from '../services/ai';
import { getTerms, TERMS_VERSION } from '../services/terms';
import { isProfileComplete } from '../../../shared/types';
import { config } from '../lib/config';

export const meRouter = Router();

/** Ilova ochilishida bitta so'rov: profil + kontekst + sozlamalar. */
meRouter.get('/', (req, res) => {
  const user = req.user!;
  const clinic = user.clinicId ? getClinic(user.clinicId) : null;
  res.json({
    user,
    clinic,
    clinicOperationIds: user.clinicId ? getClinicOperations(user.clinicId) : [],
    unread: unreadCount(user.id),
    profileComplete: isProfileComplete(user),
    termsVersion: TERMS_VERSION,
    features: {
      ai: aiEnabled(),
      commissionPercent: config.rules.commissionPercent,
      requestTtlHours: config.rules.requestTtlHours,
      maxActiveRequests: config.rules.maxActiveRequestsPerPatient,
    },
  });
});

meRouter.post('/onboarded', (req, res) => {
  touchOnboarded(req.user!.id);
  res.json({ ok: true });
});

/**
 * Profil: ism, familiya, viloyat — so'rov yuborishdan oldin to'ldiriladi.
 * Uchalasi to'lganda `profile_completed_at` belgilanadi.
 */
meRouter.patch('/', (req, res) => {
  const body = z
    .object({
      lang: z.enum(['uz', 'ru']).optional(),
      firstName: z.string().trim().min(2).max(80).optional(),
      lastName: z.string().trim().min(2).max(80).optional(),
      cityId: z.number().int().positive().optional(),
      phone: z.string().trim().max(30).nullable().optional(),
    })
    .parse(req.body);

  if (body.cityId && !db.prepare(`SELECT 1 FROM cities WHERE id = ?`).get(body.cityId)) {
    throw badRequest('unknown_city', 'Bunday viloyat topilmadi');
  }

  db.prepare(
    `UPDATE users SET
       lang       = COALESCE(@lang, lang),
       first_name = COALESCE(@firstName, first_name),
       last_name  = COALESCE(@lastName, last_name),
       city_id    = COALESCE(@cityId, city_id),
       phone      = COALESCE(@phone, phone)
     WHERE id = @id`,
  ).run({
    id: req.user!.id,
    lang: body.lang ?? null,
    firstName: body.firstName ?? null,
    lastName: body.lastName ?? null,
    cityId: body.cityId ?? null,
    phone: body.phone ?? null,
  });

  const updated = mapUser(db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id));

  // Uchala maydon to'lgan payt bir marta belgilanadi
  if (isProfileComplete(updated) && !updated.profileCompletedAt) {
    db.prepare(`UPDATE users SET profile_completed_at = datetime('now') WHERE id = ?`).run(req.user!.id);
    return res.json(mapUser(db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id)));
  }

  res.json(updated);
});

/** Ommaviy oferta matni — so'rov yuborishdan oldin o'qiladi. */
meRouter.get('/terms', (req, res) => {
  res.json(getTerms(req.user!.lang));
});

meRouter.get('/notifications', (req, res) => {
  res.json({ items: listNotifications(req.user!.id), unread: unreadCount(req.user!.id) });
});

meRouter.post('/notifications/read', (req, res) => {
  const body = z.object({ ids: z.array(z.number()).optional() }).parse(req.body ?? {});
  markRead(req.user!.id, body.ids);
  res.json({ unread: unreadCount(req.user!.id) });
});


/* Bildirishnoma sozlamalari — qaysi hodisada xabar kelsin. */
meRouter.get('/notification-prefs', (req, res) => {
  res.json(getNotificationPrefs(req.user!.id));
});

meRouter.patch('/notification-prefs', (req, res) => {
  const body = z
    .object({
      newRequest: z.boolean().optional(),
      offerChosen: z.boolean().optional(),
      dealUpdate: z.boolean().optional(),
      message: z.boolean().optional(),
      review: z.boolean().optional(),
      subscription: z.boolean().optional(),
      quietFrom: z.string().regex(TIME_HHMM).nullable().optional(),
      quietTo: z.string().regex(TIME_HHMM).nullable().optional(),
    })
    .parse(req.body);
  res.json(setNotificationPrefs(req.user!.id, body));
});
