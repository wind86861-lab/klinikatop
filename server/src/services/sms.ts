/**
 * SMS yuborish — Telegramda bo'lmagan odam uchun yagona kanal.
 *
 * Bu faqat BITTA narsa uchun kerak: brauzerdan nolda ro'yxatdan
 * o'tayotgan odamga kirish kodini yetkazish. Telegram hisobi bor
 * odamga kod baribir botdan boradi — u tekin va bir zumda.
 * Shuning uchun SMS eng arzon yo'l emas, eng OXIRGI yo'l.
 *
 * ── Provayder ──
 *
 * Eskiz.uz — O'zbekistonda eng ko'p ishlatiladigani. Interfeys
 * ataylab kichik (`sendSms` bitta funksiya): boshqasiga o'tish
 * kerak bo'lsa shu faylning ichi almashadi, chaqiruv joylari
 * tegilmaydi.
 *
 * ── Sozlanmagan bo'lsa ──
 *
 * Xato BERILMAYDI va ish to'xtamaydi: kod jurnalga yoziladi va
 * `false` qaytadi. Ishlab chiqishda aynan shu kerak — provayder
 * hisobisiz ham butun oqimni sinab ko'rish mumkin. Prodda esa
 * chaqiruvchi `false` ni ko'rib, odamga "kod yuborib bo'lmadi"
 * deydi va uni kutib qoldirmaydi.
 */
import { config } from '../lib/config';

const LOGIN_URL = 'https://notify.eskiz.uz/api/auth/login';
const SEND_URL = 'https://notify.eskiz.uz/api/message/sms/send';

/** Sozlangan bo'lsa SMS yuborish mumkin */
export function smsEnabled(): boolean {
  return Boolean(config.sms.email && config.sms.password);
}

/*
 * Token xotirada saqlanadi.
 *
 * Eskiz tokeni uzoq yashaydi, lekin abadiy emas. Har SMS uchun
 * qaytadan kirish ikki barobar so'rov va ikki barobar kechikish
 * bo'lardi; shuning uchun token saqlanadi va faqat 401 kelganda
 * yangilanadi.
 */
let cachedToken: string | null = null;

async function login(): Promise<string | null> {
  try {
    const res = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: config.sms.email, password: config.sms.password }),
    });

    if (!res.ok) {
      console.warn('[sms] kirish muvaffaqiyatsiz', res.status, await res.text().catch(() => ''));
      return null;
    }

    const body = (await res.json()) as { data?: { token?: string } };
    cachedToken = body?.data?.token ?? null;
    return cachedToken;
  } catch (err) {
    console.warn('[sms] kirishda tarmoq xatosi', err);
    return null;
  }
}

async function post(token: string, phone: string, text: string): Promise<Response | null> {
  try {
    return await fetch(SEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mobile_phone: phone, message: text, from: config.sms.from }),
    });
  } catch (err) {
    console.warn('[sms] yuborishda tarmoq xatosi', err);
    return null;
  }
}

/**
 * SMS yuboradi. Muvaffaqiyat — `true`.
 *
 * `phone` — faqat raqamlar, `998…` ko'rinishida (`normalizePhone`
 * shuni beradi).
 */
export async function sendSms(phone: string, text: string): Promise<boolean> {
  if (!smsEnabled()) {
    /*
     * Ishlab chiqish rejimi: kodni ko'rsatamiz, aks holda oqimni
     * sinab bo'lmaydi. Prodda bu holat bo'lmasligi kerak va
     * jurnalda darhol ko'rinadi.
     */
    console.warn(`[sms] SOZLANMAGAN — ${phone} ga yuborilmadi. Matn: ${text}`);
    return false;
  }

  let token = cachedToken ?? (await login());
  if (!token) return false;

  let res = await post(token, phone, text);

  // Token eskirgan bo'lsa — bir marta qayta kiramiz
  if (res && res.status === 401) {
    cachedToken = null;
    token = await login();
    if (!token) return false;
    res = await post(token, phone, text);
  }

  if (!res || !res.ok) {
    console.warn('[sms] yuborilmadi', res?.status, await res?.text().catch(() => ''));
    return false;
  }

  return true;
}
