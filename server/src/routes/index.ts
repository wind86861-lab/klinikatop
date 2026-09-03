import { Router } from 'express';
import { authenticate, requireDoor, requireWeb } from '../middleware/auth';
import { catalogRouter } from './catalog';
import { meRouter } from './me';
import { requestsRouter } from './requests';
import { offersRouter } from './offers';
import { dealsRouter } from './deals';
import { clinicRouter } from './clinic';
import { adminRouter } from './admin';
import { aiRouter } from './ai';
import { filesRouter } from './files';
import { telegramRouter } from './telegram';
import { publicRouter } from './publicRoutes';
import { webAuthRouter } from './webAuthRoutes';
import { limits } from '../middleware/rateLimit';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Katalog ochiq — bemor kirmasdan ham ko'ra oladi
apiRouter.use('/catalog', catalogRouter);

/*
 * Ochiq marshrutlar — autentifikatsiyadan OLDIN.
 * Klinika Telegramsiz ariza qoldira olishi uchun (publicRoutes.ts).
 */
apiRouter.use('/public', publicRouter);

/*
 * Veb kabinet kirishi — klinika va admin uchun.
 * Bu ham autentifikatsiyadan oldin: kirayotgan odamda hali sessiya yo'q.
 */
apiRouter.use('/web', webAuthRouter);

/*
 * Telegram webhook autentifikatsiyadan OLDIN turadi: Telegram bizga
 * `initData` yubormaydi. Uning himoyasi — maxfiy sarlavha (telegram.ts).
 */
apiRouter.use('/telegram', telegramRouter);

// Qolgan hammasi Telegram initData bilan himoyalangan
apiRouter.use(authenticate);

/*
 * Tezlik cheklovi autentifikatsiyadan KEYIN qo'yiladi: shunda hisob
 * foydalanuvchi bo'yicha yuritiladi, IP bo'yicha emas. Bitta uy internetidan
 * kirgan ikki bemor bir-birini bloklamaydi.
 */
apiRouter.use('/me', meRouter);
apiRouter.use('/ai', limits.ai, aiRouter);
apiRouter.use('/files', limits.upload, filesRouter);
apiRouter.use('/requests', limits.write, requestsRouter);
apiRouter.use('/offers', limits.write, offersRouter);
apiRouter.use('/deals', limits.write, dealsRouter);
/*
 * Klinika kabineti va admin paneli — FAQAT veb sessiya orqali.
 *
 * `requireWeb` Telegram orqali kirgan bemorni bu yerga qo'ymaydi, hatto
 * uning qatoriga qandaydir yo'l bilan rol yozilgan bo'lsa ham. Bemor
 * ilovasi va ish kabineti ikki alohida dunyo.
 */
/*
 * ESHIK ham majburlanadi, rol bilan birga.
 *
 * Rol hisobga biriktirilgan, sessiyaga emas — shuning uchun yolg'iz
 * rol tekshiruvi "admin qaysi sahifadan kirdi" degan savolga javob
 * bermasdi. Endi sessiyaning o'zi qaysi eshikdan ochilganini biladi
 * va admin bo'limiga faqat admin sessiyasi o'tadi.
 */
apiRouter.use('/clinic', requireWeb, requireDoor('clinic'), clinicRouter);
apiRouter.use('/admin', requireWeb, requireDoor('admin'), adminRouter);
