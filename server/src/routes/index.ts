import { Router } from 'express';
import { authenticate } from '../middleware/auth';
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
import { limits } from '../middleware/rateLimit';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Katalog ochiq — bemor kirmasdan ham ko'ra oladi
apiRouter.use('/catalog', catalogRouter);

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
apiRouter.use('/clinic', clinicRouter);
apiRouter.use('/admin', adminRouter);
