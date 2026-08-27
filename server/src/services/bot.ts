/**
 * Telegram bot — Mini App'ga kirish nuqtasi.
 *
 * Bot murakkab suhbat yuritmaydi: butun mahsulot Mini App ichida. Uning
 * yagona vazifasi — odam `/start` bosganda ilovani ochadigan tugmani
 * ko'rsatish va nima uchun kelganini tushuntirish.
 *
 * Shuning uchun bu yerda holat mashinasi ham, sessiya ham yo'q: har xabar
 * mustaqil ko'rib chiqiladi.
 */
import { db } from '../db';
import { config } from '../lib/config';
import { upsertUser } from '../middleware/auth';

const API = () => `https://api.telegram.org/bot${config.telegram.botToken}`;

interface InlineButton {
  text: string;
  web_app?: { url: string };
  url?: string;
}

/** Pastdagi klaviatura tugmasi — kontakt so'rash uchun. */
interface ReplyButton {
  text: string;
  request_contact?: boolean;
}

/**
 * Telegram API chaqiruvi.
 *
 * Xatolik istisno tashlamaydi — botning javob bera olmasligi butun
 * so'rovni yiqitmasligi kerak. Jurnalga yoziladi va davom etadi.
 */
async function call(method: string, body: unknown): Promise<boolean> {
  if (!config.telegram.botToken) return false;

  try {
    const res = await fetch(`${API()}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    if (!data.ok) console.error(`[bot] ${method}: ${data.description}`);
    return data.ok;
  } catch (err) {
    console.error(`[bot] ${method} xatosi:`, err);
    return false;
  }
}

export function sendMessage(
  chatId: number,
  text: string,
  markup?: { inline_keyboard: InlineButton[][] } | { keyboard: ReplyButton[][]; resize_keyboard: true; one_time_keyboard: true } | { remove_keyboard: true },
): Promise<boolean> {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    // Havolalarning oldindan ko'rinishi xabarni cho'zadi — kerak emas
    link_preview_options: { is_disabled: true },
    ...(markup ? { reply_markup: markup } : {}),
  });
}

/* ─────────────────────────  Matnlar  ───────────────────────── */

const INTRO = `<b>KlinikaTop</b> — tibbiy tender platformasi

Bitta so'rov qoldiring — shahringizdagi mos klinikalar narx taklif qiladi. Taqqoslab, o'zingizga qulayini tanlaysiz.

• Narxlar ochiq: nima kirishi ro'yxat bilan ko'rsatiladi
• Tanlagunizcha hech kim sizga qo'ng'iroq qilmaydi
• Xizmat bemor uchun bepul`;

const ASK_CONTACT = `Boshlashdan oldin telefon raqamingizni tasdiqlang.

Bu <b>klinikaga ko'rsatilmaydi</b> — faqat siz bilan bog'lana olmay qolgan holatda zaxira aloqa uchun saqlanadi.

Quyidagi tugmani bosing.`;

const READY = `Raqamingiz saqlandi.`;

const CHOOSE = `Nima qilmoqchisiz?`;

const CLINIC_INTRO = `<b>Klinika uchun</b>

So'rovlar shahringizdagi mos klinikalarga boradi. Siz narx taklif qilasiz, bemor tanlaydi.

• Birinchi oylar bepul — obuna to'lovi yo'q
• Komissiya faqat bemor tasdiqlagan bitimdan olinadi
• So'rovlarni ko'rish har doim bepul

Ro'yxatdan o'tish uchun litsenziya va yo'nalishlaringiz kerak bo'ladi.`;

const HELP = `<b>Qanday ishlaydi</b>

1. So'rov qoldirasiz — operatsiya, holatingiz, shahar
2. Mos klinikalar taklif yuboradi
3. Narx va shartlarni taqqoslab tanlaysiz
4. Tanlagandan keyin klinika bilan yozishasiz

Savol bo'lsa shu yerga yozing.`;

/**
 * Asosiy tugmalar.
 *
 * Ikki xil odam keladi: bemor va klinika egasi. Ikkalasiga ham botning
 * o'zida yo'l ko'rsatiladi — klinika egasi bemor profilini kavlab, uning
 * ichidan ro'yxatdan o'tish havolasini qidirmasligi kerak.
 *
 * `web_app` tugmasi Mini App'ni ANIQ ekrandan ochadi, shuning uchun
 * klinika to'g'ridan-to'g'ri ariza formasiga tushadi.
 */
function openButton(hasClinic = false) {
  const base = config.telegram.webappUrl.replace(/\/$/, '');

  const rows: InlineButton[][] = [
    [{ text: '🩺 Ilovani ochish', web_app: { url: base } }],
  ];

  // Klinikasi bor odamga qayta ro'yxatdan o'tish taklif qilinmaydi
  rows.push(
    hasClinic
      ? [{ text: '🏥 Klinika paneli', web_app: { url: `${base}/clinic` } }]
      : [{ text: '🏥 Klinikani ro‘yxatdan o‘tkazish', web_app: { url: `${base}/clinic/register` } }],
  );

  return { inline_keyboard: rows };
}

/** Kontakt so'rash klaviaturasi — Telegram raqamni o'zi tasdiqlab beradi. */
function contactKeyboard() {
  return {
    keyboard: [[{ text: '📱 Raqamni yuborish', request_contact: true }]],
    resize_keyboard: true as const,
    one_time_keyboard: true as const,
  };
}

/** Foydalanuvchi allaqachon klinikaga biriktirilganmi. */
function hasClinic(telegramId: number): boolean {
  const row = db
    .prepare(`SELECT clinic_id FROM users WHERE telegram_id = ? AND clinic_id IS NOT NULL`)
    .get(telegramId);
  return Boolean(row);
}

/** Foydalanuvchining raqami allaqachon saqlanganmi. */
function hasPhone(telegramId: number): boolean {
  const row = db
    .prepare(`SELECT phone FROM users WHERE telegram_id = ? AND phone IS NOT NULL AND phone <> ''`)
    .get(telegramId);
  return Boolean(row);
}

/* ─────────────────────────  Yangilanishlar  ───────────────────────── */

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    from?: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string };
    contact?: { phone_number: string; user_id?: number; first_name?: string; last_name?: string };
  };
}

/**
 * Bitta yangilanishni ko'rib chiqish.
 *
 * Har doim muvaffaqiyatli tugaydi: Telegram 200 dan boshqa javob olsa
 * xabarni qayta-qayta yuboraveradi va navbat to'lib ketadi.
 */
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const from = message.from;

  /*
   * Kontakt keldi — ro'yxatdan o'tishning asosiy qadami.
   *
   * Raqamni Telegramning o'zi tasdiqlaydi, ya'ni bu qo'lda yozilgan
   * raqamdan ishonchliroq. Boshqa odamning kontaktini yuborish mumkin
   * bo'lgani uchun `user_id` tekshiriladi.
   */
  if (message.contact) {
    if (from && message.contact.user_id !== from.id) {
      await sendMessage(chatId, 'Iltimos, <b>o‘z</b> raqamingizni yuboring.', contactKeyboard());
      return;
    }

    if (from) {
      // Foydalanuvchi hali bazada bo'lmasligi mumkin — avval yaratamiz
      const user = upsertUser({
        id: from.id,
        first_name: from.first_name ?? 'Foydalanuvchi',
        last_name: from.last_name,
        username: from.username,
        language_code: from.language_code,
      });
      db.prepare(`UPDATE users SET phone = ? WHERE id = ?`).run(
        message.contact.phone_number.slice(0, 32),
        user.id,
      );
    }

    // Klaviaturani olib tashlaymiz — kerak emas, joyni egallaydi
    await sendMessage(chatId, READY, { remove_keyboard: true });
    await sendMessage(chatId, CHOOSE, openButton(from ? hasClinic(from.id) : false));
    return;
  }

  if (!message.text) return;
  const text = message.text.trim();

  // `/start payload` shaklida ham kelishi mumkin — faqat buyruqni olamiz
  const command = text.split(/\s+/)[0].toLowerCase();

  if (command === '/start') {
    await sendMessage(chatId, INTRO);

    // Raqam allaqachon bo'lsa qayta so'ramaymiz — bir marta yetarli
    if (from && hasPhone(from.id)) {
      await sendMessage(chatId, CHOOSE, openButton(hasClinic(from.id)));
    } else {
      await sendMessage(chatId, ASK_CONTACT, contactKeyboard());
    }
    return;
  }

  if (command === '/help') {
    await sendMessage(chatId, HELP, openButton(from ? hasClinic(from.id) : false));
    return;
  }

  // Klinika egasi uchun to'g'ridan-to'g'ri yo'l
  if (command === '/clinic' || command === '/klinika') {
    await sendMessage(chatId, CLINIC_INTRO, openButton(from ? hasClinic(from.id) : false));
    return;
  }

  // Boshqa har qanday matn — odam nimadir yozmoqchi. Uni ilovaga yo'naltiramiz.
  await sendMessage(
    chatId,
    'Savolingizni ilova ichidagi chatda yozsangiz, klinika ko‘radi va javob beradi.',
    openButton(from ? hasClinic(from.id) : false),
  );
}

/* ─────────────────────────  Sozlash  ───────────────────────── */

/**
 * Botni ishga tayyorlash: menyu tugmasi va buyruqlar ro'yxati.
 * Server ko'tarilganda bir marta chaqiriladi.
 */
export async function configureBot(): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.webappUrl) return;

  // Yozuv maydoni yonidagi doimiy tugma — ilovaga eng qisqa yo'l
  await call('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: 'KlinikaTop',
      web_app: { url: config.telegram.webappUrl },
    },
  });

  await call('setMyCommands', {
    commands: [
      { command: 'start', description: 'Ilovani ochish' },
      { command: 'clinic', description: 'Klinika uchun' },
      { command: 'help', description: 'Qanday ishlaydi' },
    ],
  });

  await call('setMyDescription', {
    description:
      'Bitta so‘rov — ko‘p klinika, ko‘p taklif. Operatsiya narxlarini taqqoslang va o‘zingizga qulayini tanlang.',
  });
}
