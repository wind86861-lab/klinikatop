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
import { attachWebSocket } from './services/ws';
import { startScheduler } from './services/scheduler';
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

app.use(express.json({ limit: '1mb' }));
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

const shutdown = () => {
  console.log('\n[server] to‘xtatilmoqda…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
