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
import { config } from '../lib/config';

const API = () => `https://api.telegram.org/bot${config.telegram.botToken}`;

interface InlineButton {
  text: string;
  web_app?: { url: string };
  url?: string;
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
  buttons?: InlineButton[][],
): Promise<boolean> {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    // Havolalarning oldindan ko'rinishi xabarni cho'zadi — kerak emas
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/* ─────────────────────────  Matnlar  ───────────────────────── */

const WELCOME = `<b>KlinikaTop</b> — tibbiy tender platformasi

Bitta so'rov qoldiring — shahringizdagi mos klinikalar narx taklif qiladi. Taqqoslab, o'zingizga qulayini tanlaysiz.

• Narxlar ochiq: nima kirishi ro'yxat bilan ko'rsatiladi
• Tanlagunizcha hech kim sizga qo'ng'iroq qilmaydi
• Xizmat bemor uchun bepul

Boshlash uchun quyidagi tugmani bosing.`;

const HELP = `<b>Qanday ishlaydi</b>

1. So'rov qoldirasiz — operatsiya, holatingiz, shahar
2. Mos klinikalar taklif yuboradi
3. Narx va shartlarni taqqoslab tanlaysiz
4. Tanlagandan keyin klinika bilan yozishasiz

Savol bo'lsa shu yerga yozing.`;

/** Ilovani ochadigan tugma — Mini App shu orqali ishga tushadi. */
function openButton(): InlineButton[][] {
  const url = config.telegram.webappUrl;
  return [[{ text: '🩺 Ilovani ochish', web_app: { url } }]];
}

/* ─────────────────────────  Yangilanishlar  ───────────────────────── */

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    from?: { first_name?: string };
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
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  // `/start payload` shaklida ham kelishi mumkin — faqat buyruqni olamiz
  const command = text.split(/\s+/)[0].toLowerCase();

  if (command === '/start') {
    await sendMessage(chatId, WELCOME, openButton());
    return;
  }

  if (command === '/help') {
    await sendMessage(chatId, HELP, openButton());
    return;
  }

  // Boshqa har qanday matn — odam nimadir yozmoqchi. Uni ilovaga yo'naltiramiz.
  await sendMessage(
    chatId,
    'Savolingizni ilova ichidagi chatda yozsangiz, klinika ko‘radi va javob beradi.',
    openButton(),
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
      { command: 'help', description: 'Qanday ishlaydi' },
    ],
  });

  await call('setMyDescription', {
    description:
      'Bitta so‘rov — ko‘p klinika, ko‘p taklif. Operatsiya narxlarini taqqoslang va o‘zingizga qulayini tanlang.',
  });
}
