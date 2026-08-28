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
import { resolveWebUser } from '../middleware/auth';
import { forbidden, unauthorized } from '../lib/errors';
import {
  changePassword,
  completeSetup,
  confirmTotp,
  disableTotp,
  listSessions,
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

/**
 * Bu marshrutlardagi sessiyani O'ZIMIZ aniqlaymiz.
 *
 * `requireWeb` bu yerda ishlamaydi: u `req.web` ga tayanadi, uni esa
 * `authenticate` to'ldiradi — va u `/web` dan KEYIN ishga tushadi
 * (routes/index.ts). Bu marshrutlar ataylab autentifikatsiyadan oldin
 * turadi, chunki kirish sahifasining o'zi ham shu yerda.
 *
 * Natijada `requireWeb` har doim 403 qaytarardi va 2FA ni yoqib
 * bo'lmasdi. Shuning uchun sessiya shu yerda, ochiq holda olinadi.
 */
function session(req: { header(name: string): string | undefined }) {
  const token = bearer(req);
  const found = resolveSession(token);
  if (!found) throw unauthorized();
  return { token, user: found.user, mfaPassed: found.mfaPassed };
}

/**
 * To'liq sessiya — 2FA o'tilgan bo'lishi shart.
 *
 * Parol o'g'irlangan bo'lsa, uni bilgan odam 2FA ni o'chirib yoki
 * parolni almashtirib qo'ya olmasligi kerak.
 */
function fullSession(req: { header(name: string): string | undefined }) {
  const s = session(req);
  if (!s.mfaPassed) throw forbidden('Ikki bosqichli tasdiqni yakunlang');
  return s;
}

const loginSchema = z.object({
  /** Telefon raqami. Eski hisoblar uchun email ham qabul qilinadi. */
  login: z.string().trim().min(4).max(160),
  password: z.string().min(1).max(200),
});

/*
 * IP bo'yicha cheklov — toshqinga qarshi ikkinchi qatlam, asosiysi
 * emas. Parol tanlashdan asosiy himoya HISOB darajasida: 5 ta xato
 * urinishdan keyin hisob 15 daqiqaga qulflanadi (webAuth.ts).
 *
 * Shuning uchun bu yerdagi son keng: butun klinika ofisi bitta NAT
 * ortida bo'lishi mumkin va ertalab bir necha xodim ketma-ket kirsa,
 * tor chegara ularni o'z kabinetidan qamab qo'yardi. Hujumchi uchun
 * esa baribir foydasiz — u qulflangan hisobga urinaveradi.
 */
webAuthRouter.post(
  '/login',
  rateLimit({ name: 'web-login', windowSec: 300, max: 60 }),
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
  const current = session(req);
  const person = resolveWebUser(req);
  res.json({
    account: current.user,
    mfaPassed: current.mfaPassed,
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
webAuthRouter.post('/totp/start', (req, res) => {
  res.json(startTotpSetup(fullSession(req).user.id));
});

/*
 * Tasdiqlash `fullSession` talab QILMAYDI: 2FA hali yoqilmagan, ya'ni
 * o'tadigan ikkinchi bosqich ham yo'q. Aks holda uni hech qachon
 * yoqib bo'lmasdi.
 */
webAuthRouter.post('/totp/confirm', (req, res) => {
  confirmTotp(session(req).user.id, codeSchema.parse(req.body).code);
  res.json({ ok: true });
});

/** 2FA ni o'chirish — parol bilan tasdiqlanadi. */
webAuthRouter.post('/totp/disable', (req, res) => {
  const body = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
  disableTotp(fullSession(req).user.id, body.password);
  res.json({ ok: true });
});

/* ── Parol va sessiyalar ── */

webAuthRouter.post(
  '/password',
  rateLimit({ name: 'web-password', windowSec: 300, max: 10 }),
  (req, res) => {
    const body = z
      .object({
        currentPassword: z.string().min(1).max(200),
        newPassword: z.string().min(1).max(200),
      })
      .parse(req.body);

    const s = fullSession(req);
    // Joriy sessiya saqlanadi, qolganlari yopiladi
    changePassword(s.user.id, body.currentPassword, body.newPassword, s.token);
    res.json({ ok: true });
  },
);

/** Ochiq sessiyalar — qayerdan kirilgani ko'rinsin. */
webAuthRouter.get('/sessions', (req, res) => {
  const s = fullSession(req);
  res.json(listSessions(s.user.id, s.token));
});
