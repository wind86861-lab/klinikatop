/**
 * Telegram webhook.
 *
 * Bu marshrut autentifikatsiyadan OLDIN turadi — Telegram bizga `initData`
 * yubormaydi, u oddiy server. Shuning uchun himoya boshqacha:
 *
 *   • Telegram har so'rovda `X-Telegram-Bot-Api-Secret-Token` sarlavhasini
 *     yuboradi. Biz uni webhook o'rnatishda o'zimiz belgilaymiz va shu
 *     yerda tekshiramiz. Sir mos kelmasa — 401, ishlov berilmaydi.
 *   • Taqqoslash `timingSafeEqual` bilan: sirni belgi-belgi topib olishga
 *     yo'l qo'ymaslik uchun.
 *
 * Javob HAR DOIM 200 bo'ladi (sir noto'g'ri bo'lgan holatdan tashqari):
 * Telegram boshqa javob olsa xabarni qayta-qayta yuboraveradi va navbat
 * to'lib ketadi.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../lib/config';
import { handleUpdate } from '../services/bot';

export const telegramRouter = Router();

function secretMatches(received: string): boolean {
  const expected = config.telegram.webhookSecret;
  if (!expected) return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

telegramRouter.post('/webhook', (req, res) => {
  const secret = req.header('x-telegram-bot-api-secret-token') ?? '';

  if (!secretMatches(secret)) {
    // Begona so'rov — bu marshrut ochiq internetda turadi
    return res.status(401).json({ error: 'forbidden' });
  }

  // Telegram javobni kutib turmasin: ishlov fonda ketadi
  res.status(200).json({ ok: true });

  void handleUpdate(req.body).catch((err) => {
    console.error('[telegram] yangilanishga ishlov berishda xato:', err);
  });
});
