/**
 * Test uchun HAQIQIY imzolangan `initData` yasash.
 *
 * Imzosiz kirish (`x-dev-user`) olib tashlangandan keyin testlar ham
 * production yo'lidan o'tishi kerak bo'ldi. Bu yaxshilanish: ilgari testlar
 * autentifikatsiyani chetlab o'tardi va imzo mantiqi sinalmasdan qolardi.
 *
 * Sinov boti tokeni `TELEGRAM_BOT_TOKEN` dan olinadi — u faqat mahalliy
 * mashinada va CI'da beriladi, haqiqiy bot tokeni bilan aloqasi yo'q.
 */
import crypto from 'node:crypto';

export interface FakeUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Telegram algoritmi bo'yicha imzo:
 *   secret = HMAC_SHA256("WebAppData", botToken)
 *   hash   = HMAC_SHA256(secret, "k=v\n..." kalitlar bo'yicha saralangan)
 */
export function signInitData(
  user: FakeUser,
  botToken: string,
  authDate = Math.floor(Date.now() / 1000),
  /**
   * Telegramning yangi mijozlari `signature` maydonini ham yuboradi.
   * U data-check-string ga KIRADI — shuni sinash uchun qo'shiladi.
   */
  withSignature = false,
): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', `test_${user.id}`);
  params.set('user', JSON.stringify(user));
  if (withSignature) params.set('signature', 'AAHt3st_sign4ture_v4lue');

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');

  params.set('hash', hash);
  return params.toString();
}

/** Testda ishlatiladigan sinov boti tokeni. */
export const TEST_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
