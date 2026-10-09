import crypto from 'node:crypto';
import { config } from './config';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

/**
 * Telegram Mini App `initData` imzosini tekshirish (1.1).
 * Soxta kirishni bloklaydi — hash server tomonda bot tokeni bilan qayta hisoblanadi.
 */
export function verifyInitData(initData: string): { ok: true; user: TelegramUser } | { ok: false; reason: string } {
  if (!initData) return { ok: false, reason: 'initData bo‘sh' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'hash yo‘q' };

  /*
   * Hash shakli QAT'IY tekshiriladi: aynan 64 ta o'n oltilik belgi.
   *
   * Nima uchun kerak: Node'ning `Buffer.from(str, 'hex')` yaroqsiz belgiga
   * duch kelganda xato bermaydi — o'sha joygacha o'qib to'xtaydi. Shuning
   * uchun `hash=<to'g'ri 64 belgi>axlat` ham 32 baytga aylanardi va
   * `timingSafeEqual` uni to'g'ri deb topardi. Imzoni soxtalashtirish
   * imkonini bermasa ham, tekshiruv qat'iy bo'lishi kerak.
   */
  if (!/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'hash shakli noto‘g‘ri' };

  /*
   * Faqat `hash` chiqariladi — qolgan HAMMA maydon imzoga kiradi.
   *
   * Ilgari bu yerda `signature` ham chiqarilardi va shu sababli Telegram
   * mijozlaridan kelgan haqiqiy initData rad etilardi. `signature` —
   * uchinchi tomon tekshiruvi uchun qo'shilgan yangi maydon, lekin u ham
   * data-check-string ning bir qismi. Uni tashlab yuborish hisoblangan
   * hashni butunlay boshqa qiladi.
   */
  params.delete('hash');

  const checkString = [...params.entries()]
    .map(([k, v]) => [k, v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.telegram.botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(checkString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'imzo mos kelmadi' };
  }

  // Eskirgan initData (24 soatdan katta) qabul qilinmaydi
  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 86_400) {
    return { ok: false, reason: 'initData eskirgan' };
  }

  const rawUser = params.get('user');
  if (!rawUser) return { ok: false, reason: 'user yo‘q' };

  try {
    return { ok: true, user: JSON.parse(rawUser) as TelegramUser };
  } catch {
    return { ok: false, reason: 'user JSON buzuq' };
  }
}

/** Telegram push xabari. Token bo'lmasa jimgina o'tkazib yuboriladi (lokal ishlab chiqish). */
export async function sendTelegramMessage(
  telegramId: number,
  text: string,
  opts: { link?: string; linkLabel?: string } = {},
): Promise<boolean> {
  if (!config.telegram.botToken) return false;

  const body: Record<string, unknown> = {
    chat_id: telegramId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (opts.link) {
    body.reply_markup = {
      inline_keyboard: [[{ text: opts.linkLabel ?? 'Ochish', web_app: { url: opts.link } }]],
    };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn('[telegram] sendMessage muvaffaqiyatsiz', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[telegram] tarmoq xatosi', err);
    return false;
  }
}

export interface TgInlineButton {
  text: string;
  callback_data?: string;
  web_app?: { url: string };
  url?: string;
}

/**
 * Tugmali xabar (bir nechta qator). `sendTelegramMessage` faqat bitta
 * havola tugmasini beradi — tavsiyada esa sana tugmalari kerak.
 * Xato istisno tashlamaydi: xabar ketmasa ham asosiy amal bekor bo'lmaydi.
 */
export async function sendTelegramKeyboard(
  chatId: number,
  text: string,
  rows: TgInlineButton[][],
): Promise<boolean> {
  return telegramCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: rows },
  });
}

/** Telegram Bot API chaqiruvi — token bo'lmasa (lokal/test) jim o'tadi */
export async function telegramCall(method: string, body: unknown): Promise<boolean> {
  if (!config.telegram.botToken) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; description?: string };
    if (!data.ok) console.warn(`[telegram] ${method}: ${data.description ?? res.status}`);
    return data.ok;
  } catch (err) {
    console.warn(`[telegram] ${method} tarmoq xatosi`, err);
    return false;
  }
}
