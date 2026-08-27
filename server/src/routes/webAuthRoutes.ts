/**
 * Veb kabinet autentifikatsiyasi — klinika va admin uchun.
 *
 * Bu marshrutlar Telegram tekshiruvidan OLDIN turadi: kirayotgan odamda
 * hali hech qanday sessiya yo'q.
 *
 * Tezlik cheklovi bu yerda alohida qattiq: kirish sahifasi parol tanlash
 * hujumining asosiy nishoni. Hisob darajasidagi qulf (5 xato → 15 daqiqa)
 * bitta hisobni himoya qiladi, IP darajasidagi cheklov esa ko'p hisobni
 * ketma-ket sinashni to'xtatadi — ikkalasi ham kerak.
 */
import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../middleware/rateLimit';
import { requireWeb, resolveWebUser } from '../middleware/auth';
import { unauthorized } from '../lib/errors';
import {
  completeSetup,
  confirmTotp,
  login,
  loginByVerifiedPhone,
  logout,
  passMfa,
  resolveSession,
  startTotpSetup,
} from '../services/webAuth';
import { resolveUser } from '../middleware/auth';
import { clinicStandingByPhone } from '../services/clinicIdentity';

export const webAuthRouter = Router();

const bearer = (req: { header(name: string): string | undefined }) => {
  const h = req.header('authorization') ?? '';
  if (!h.toLowerCase().startsWith('bearer ')) throw unauthorized();
  return h.slice(7).trim();
};

const loginSchema = z.object({
  /** Telefon raqami. Eski hisoblar uchun email ham qabul qilinadi. */
  login: z.string().trim().min(4).max(160),
  password: z.string().min(1).max(200),
});

webAuthRouter.post(
  '/login',
  rateLimit({ name: 'web-login', windowSec: 300, max: 20 }),
  (req, res) => {
    const body = loginSchema.parse(req.body);
    const result = login(body.login, body.password, req.ip ?? null, req.header('user-agent') ?? null);
    res.json(result);
  },
);

webAuthRouter.post('/logout', (req, res) => {
  logout(bearer(req));
  res.json({ ok: true });
});

/** Joriy sessiya — sahifa yangilanganda kim kirganini bilish uchun. */
webAuthRouter.get('/me', (req, res) => {
  const session = resolveSession(bearer(req));
  if (!session) throw unauthorized();
  const person = resolveWebUser(req);
  res.json({
    account: session.user,
    mfaPassed: session.mfaPassed,
    // Klinika kabineti va admin paneli shu shaxs nomidan ish ko'radi
    person: person?.user ?? null,
  });
});

/**
 * Telegram ichidan kabinetga kirish.
 *
 * Mini App `initData` yuboradi; biz undan foydalanuvchini aniqlaymiz,
 * uning TASDIQLANGAN raqamini olamiz va shu raqamli klinika hisobiga
 * sessiya beramiz. Parol so'ralmaydi — sabab `loginByVerifiedPhone`
 * izohida.
 *
 * Raqam bo'lmasa yoki unga hisob biriktirilmagan bo'lsa, javobda
 * ARIZA HOLATI qaytadi: ilova nima ko'rsatishni bilishi kerak —
 * "arizangiz ko'rilmoqda" yoki "parol qo'ying".
 */
webAuthRouter.post(
  '/telegram',
  rateLimit({ name: 'web-telegram', windowSec: 60, max: 20 }),
  (req, res) => {
    const user = resolveUser(req);
    if (!user) throw unauthorized('Telegram imzosi yaroqsiz');

    if (!user.phone) {
      res.json({ standing: { kind: 'no_phone' } });
      return;
    }

    const standing = clinicStandingByPhone(user.phone);

    if (standing.kind === 'ready') {
      const session = loginByVerifiedPhone(
        user.phone,
        req.ip ?? null,
        req.header('user-agent') ?? null,
      );
      if (session) {
        res.json({ standing, ...session });
        return;
      }
    }

    // Kirish hali mumkin emas — ilova holatni ko'rsatadi
    res.json({ standing });
  },
);

/* ── Birinchi kirish: parol o'rnatish ── */

const setupSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(1).max(200),
});

webAuthRouter.post(
  '/setup',
  rateLimit({ name: 'web-setup', windowSec: 3600, max: 20 }),
  (req, res) => {
    const body = setupSchema.parse(req.body);
    res.json(completeSetup(body.token, body.password));
  },
);

/* ── Ikki bosqichli tasdiq ── */

const codeSchema = z.object({ code: z.string().trim().min(6).max(10) });

/** Kirish paytida — sessiyani to'liq qiladi. */
webAuthRouter.post(
  '/mfa',
  rateLimit({ name: 'web-mfa', windowSec: 300, max: 15 }),
  (req, res) => {
    passMfa(bearer(req), codeSchema.parse(req.body).code);
    res.json({ ok: true });
  },
);

/** 2FA sozlash — allaqachon kirgan hisob uchun. */
webAuthRouter.post('/totp/start', requireWeb, (req, res) => {
  res.json(startTotpSetup(req.web!.id));
});

webAuthRouter.post('/totp/confirm', (req, res) => {
  const session = resolveSession(bearer(req));
  if (!session) throw unauthorized();
  confirmTotp(session.user.id, codeSchema.parse(req.body).code);
  res.json({ ok: true });
});
