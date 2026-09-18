import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { configureBot } from './services/bot';
import { limits } from './middleware/rateLimit';
import { ZodError } from 'zod';
import { config, isProd } from './lib/config';
import { AppError } from './lib/errors';
import { migrate } from './db';
import { apiRouter } from './routes';
import { attachWebSocket, closeWebSocket } from './services/ws';
import { startScheduler, stopScheduler } from './services/scheduler';
import { aiProvider } from './services/aiProvider';

migrate();

const app = express();

app.disable('x-powered-by');
// Reverse-proxy ortida haqiqiy mijoz IP'sini ko'rish uchun (tezlik cheklovi shunga tayanadi)
app.set('trust proxy', 1);

/*
 * CORS.
 *
 * Ilgari `origin: true` edi — ya'ni HAR QANDAY sayt so'rov yuborib javobni
 * o'qiy olardi. Amalda ekspluatatsiya qilish qiyin edi (autentifikatsiya
 * cookie'da emas, sarlavhada), lekin bu himoyaga tayanish emas, omadga
 * tayanish. Endi ro'yxat aniq.
 */
const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Origin yo'q — Telegram WebView, mobil ilova yoki curl. Bularni
      // CORS himoya qilmaydi, ularni autentifikatsiya himoya qiladi.
      if (!origin) return callback(null, true);
      if (!isProd && origin.startsWith('http://localhost')) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: false,
  }),
);

/*
 * Xavfsizlik sarlavhalari. Bular API uchun ham kerak: brauzer javobni
 * noto'g'ri talqin qilmasin va sahifa ichiga joylab bo'lmasin.
 */
app.use((_req, res, next) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  // API hech qachon skript bermaydi — hammasini taqiqlaymiz
  res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  if (isProd) {
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

/*
 * JSON tanasi — 1 MB, FAYL YO'NALISHIDAN TASHQARI.
 *
 * Bu parser har so'rovda birinchi ishlaydi. Fayl yo'nalishida
 * (`routes/files.ts`) 12 MB lik o'z parseri bor, lekin ilgari u
 * hech qachon ishlamagan: 1 MB dan katta tana unga yetib bormasdan
 * shu yerda rad etilardi. Natijada 750 KB dan katta HAR QANDAY rasm
 * — kamera kadri ham, galereya surati ham — prodda 500 bilan
 * yiqilardi, sinovlar esa 70 baytlik PNG bilan o'tib ketgan.
 *
 * Fayl yo'nalishi o'tkazib yuboriladi: uning o'z chegarasi bor.
 */
const jsonBody = express.json({ limit: '1mb' });
app.use((req, res, next) => {
  if (req.path.startsWith('/api/files')) return next();
  jsonBody(req, res, next);
});
// Har so'rov uchun umumiy himoya — autentifikatsiyadan oldin, IP bo'yicha
app.use('/api', limits.global);

app.use('/api', apiRouter);

// Xatoliklarni bitta joyda klientga tushunarli shaklda qaytarish
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  }
  // express.json() buzuq tanani SyntaxError bilan rad etadi — bu klient xatosi, 500 emas
  if (err instanceof SyntaxError && 'body' in (err as any)) {
    return res.status(400).json({ error: 'JSON tanasi buzuq', code: 'malformed_json' });
  }
  /*
   * Tana chegaradan katta — bu ham klient xatosi va odam uchun
   * TUSHUNARLI bo'lishi kerak: "rasm juda katta" degan xabar bilan
   * u kichikroq oladi, "ichki xatolik" bilan esa ilova buzilgan deb
   * o'ylab ketadi.
   */
  if ((err as { type?: string })?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Fayl juda katta — 8 MB gacha bo‘lsin',
      code: 'file_too_large',
    });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Ma‘lumot noto‘g‘ri',
      code: 'validation_error',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  console.error('[server] kutilmagan xatolik:', err);
  res.status(500).json({
    error: 'Ichki xatolik',
    code: 'internal_error',
    ...(isProd ? {} : { details: err instanceof Error ? err.message : String(err) }),
  });
});

const server = http.createServer(app);
attachWebSocket(server);
startScheduler();

/**
 * Ishga tushishdan oldingi xavfsizlik tekshiruvi.
 * Noto'g'ri sozlangan server ishlamagani — jimgina ochiq turganidan yaxshi.
 */
if (!config.telegram.botToken) {
  console.error(
    '[server] XATO: TELEGRAM_BOT_TOKEN yo‘q.\n' +
      '         Autentifikatsiyaning yagona yo‘li — Telegram imzosi.\n' +
      '         Tokensiz hech kim kira olmaydi, shuning uchun server ishga tushmaydi.',
  );
  process.exit(1);
}

server.listen(config.port, config.host, () => {
  console.log(`[server] http://localhost:${config.port} (${config.env})`);
  console.log(`[server] websocket: ws://localhost:${config.port}/ws`);
  console.log('[server] telegram bot: ulangan');
  // Menyu tugmasi va buyruqlar ro'yxati — har ko'tarilishda tasdiqlanadi
  void configureBot();
  console.log(`[server] AI: ${aiProvider()?.name ?? 'lokal heuristika (API kaliti yo‘q)'}`);
});

/**
 * Toza to'xtash.
 *
 * `server.close()` faqat OCHIQ ulanishlar tugagach chaqiriladi.
 * WebSocket ulanishlari esa o'zi yopilmaydi va `keep-alive` HTTP
 * soketlari ham osilib turadi — shuning uchun ilgari to'xtatish
 * har safar 5 soniyalik taymerga borib `exit(1)` bilan tugardi.
 * systemd har qayta ishga tushirishni nosozlik deb yozib qo'yardi.
 *
 * Endi tartib aniq: fon vazifalari to'xtaydi, soketlar yopiladi,
 * keyin server o'zi yopiladi. Taymer o'z joyida qoladi, lekin endi
 * u haqiqiy nosozlik belgisi — normal holatda ishga tushmaydi.
 */
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\n[server] to‘xtatilmoqda…');
  stopScheduler();
  closeWebSocket();

  server.close(() => process.exit(0));

  // Bo'sh `keep-alive` soketlari ulanishni bekorga ushlab turmasin
  server.closeAllConnections?.();

  setTimeout(() => {
    console.error('[server] toza to‘xtab bo‘lmadi — majburiy chiqish');
    process.exit(1);
  }, 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
