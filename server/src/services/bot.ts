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
import { clinicStandingByPhone, type ClinicStanding } from './clinicIdentity';
import { config } from '../lib/config';
import { textSetting } from './terms.business';
import { upsertUser } from '../middleware/auth';
import { bindCasesByPhone, claimInvite } from './doctorCases';
import { handleRecommendationCallback, type CallbackQuery } from './doctorRecommendations';

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

<b>Qanday boshlanadi</b>
1. Quyidagi havolada ariza to'ldirasiz (Telegram kerak emas)
2. Moderator litsenziyangizni tekshiradi va bog'lanadi
3. Tasdiqlangach elektron pochtangizga kabinet havolasi keladi
4. Parolingizni qo'yasiz va brauzerdan ishlaysiz

Kabinet Telegramda emas, alohida veb-sahifada: kunlik ish uchun
kompyuter ekrani qulayroq.`;

const CLINIC_HINT = `Klinika kabineti brauzerda ochiladi — bu yerda emas.

Arizangiz tasdiqlangan bo'lsa, kirish havolasi ko'rsatgan pochtangizga
yuborilgan. Havola topilmasa moderator bilan bog'laning.`;

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
/**
 * Klinika holatiga qarab xabar va tugmalar.
 *
 * Klinika egasi botga kirganda birinchi navbatda O'Z ARIZASI qayerda
 * qolganini bilishi kerak. Ilgari u buni bilishning yo'li yo'q edi:
 * moderatordan qo'ng'iroq kutib o'tirardi. Endi bot raqamini tanib
 * oladi va holatini aytadi.
 */
function clinicMessage(standing: ClinicStanding): { text: string; rows: InlineButton[][] } | null {
  const base = config.telegram.webappUrl.replace(/\/$/, '');

  switch (standing.kind) {
    case 'none':
      return null;

    case 'pending':
      return {
        text:
          `🏥 <b>${standing.clinicName}</b>\n\n` +
          `Arizangiz ko‘rib chiqilmoqda (№${standing.applicationId}).\n` +
          `Moderator litsenziyangizni tekshiradi va shu raqamga qo‘ng‘iroq qiladi — ` +
          `odatda 1–2 ish kuni.`,
        rows: [],
      };

    case 'rejected':
      return {
        text:
          `🏥 <b>${standing.clinicName}</b>\n\n` +
          `Arizangiz rad etildi.\n` +
          (standing.note ? `<b>Sabab:</b> ${standing.note}\n\n` : '\n') +
          `Kamchilikni to‘g‘rilab qayta ariza qoldirishingiz mumkin.`,
        rows: [[{ text: '📝 Qayta ariza qoldirish', url: `${base}/klinika` }]],
      };

    case 'needs_password':
      /*
       * Havola BOTGA yuboriladi — pochtaga emas.
       *
       * Raqamni Telegram tasdiqlagan, ya'ni bu xabar aynan hisob
       * egasiga boradi. Pochta orqali yuborish esa qo'shimcha halqa
       * bo'lardi: klinika egasi pochtasini kamdan-kam ochadi.
       */
      return {
        text:
          `🏥 <b>${standing.clinicName}</b>\n\n` +
          `Arizangiz tasdiqlandi! Kabinetga kirish uchun parol qo‘ying.\n\n` +
          `Bundan keyin brauzerdan ham kira olasiz: raqamingiz va shu parol bilan.`,
        rows: [
          [
            {
              text: '🔑 Parol qo‘yish',
              url: `${base}/kabinet/parol?token=${standing.setupToken}`,
            },
          ],
        ],
      };

    case 'ready': {
      const verified = standing.verification === 'approved';
      return {
        text:
          `🏥 <b>${standing.clinicName}</b>\n\n` +
          (verified
            ? 'Kabinetingiz tayyor. So‘rovlar shu yerda ko‘rinadi.'
            : 'Kabinetingiz ochiq. Verifikatsiyani yakunlang — shundan keyin so‘rovlar kela boshlaydi.'),
        rows: [
          [{ text: '🏥 Klinika kabineti', web_app: { url: `${base}/clinic` } }],
          [{ text: '🌐 Brauzerda ochish', url: `${base}/kabinet` }],
        ],
      };
    }
  }
}

function openButton() {
  const base = config.telegram.webappUrl.replace(/\/$/, '');

  const rows: InlineButton[][] = [
    // Mini App /app da — "/" endi ochiq sayt
    [{ text: '🩺 Ilovani ochish', web_app: { url: `${base}/app` } }],
  ];

  /*
   * Klinika yo'li butunlay Telegramdan TASHQARIDA.
   *
   * Ariza ham, kabinet ham oddiy veb-sahifa. Shuning uchun bular
   * `web_app` emas, oddiy `url` tugmalari — brauzerda ochiladi.
   *
   * Bot bemor uchun. Klinika xodimi shu botga kirsa ham bemor
   * ilovasidan boshqa hech narsa ko'rmaydi: rollar aralashmaydi.
   */
  rows.push([{ text: '🏥 Klinika sifatida ro‘yxatdan o‘tish', url: `${base}/klinika` }]);
  rows.push([{ text: '🔐 Klinika kabineti', url: `${base}/kabinet` }]);

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

/** Foydalanuvchining saqlangan raqami. */
function phoneOf(telegramId: number): string | null {
  const row = db
    .prepare(`SELECT phone FROM users WHERE telegram_id = ? AND phone IS NOT NULL AND phone <> ''`)
    .get(telegramId) as { phone: string } | undefined;
  return row?.phone ?? null;
}

/**
 * Raqam ma'lum bo'lgach ko'rsatiladigan xabar.
 *
 * Agar bu raqam klinikaga tegishli bo'lsa — uning holati ko'rsatiladi
 * va bemor menyusi umuman chiqmaydi. Klinika egasiga "so'rov qoldirish"
 * tugmasini taklif qilish mantiqsiz: u boshqa ish bilan kelgan.
 */
async function greet(chatId: number, phone: string) {
  const standing = clinicStandingByPhone(phone);
  const clinic = clinicMessage(standing);

  if (clinic) {
    await sendMessage(chatId, clinic.text, { inline_keyboard: clinic.rows });
    return;
  }

  await sendMessage(chatId, CHOOSE, openButton());
}

/* ─────────────────────────  Shifokor  ───────────────────────── */

/**
 * `/shifokor` — yo'naltiruvchi shifokor kabineti.
 *
 * Telefon birinchi: u botda kontakt bilan tasdiqlanmaguncha kabinet
 * tugmasi berilmaydi. Server ham xuddi shuni tekshiradi — bu yerda
 * odam formani to'ldirib bo'lgach rad javobini olmasligi uchun.
 */
async function doctorEntry(chatId: number, telegramId: number) {
  const base = config.telegram.webappUrl.replace(/\/$/, '');

  if (!phoneOf(telegramId)) {
    await sendMessage(
      chatId,
      '🩺 <b>Shifokor kabineti</b>\n\nAvval 📱 telefon raqamingizni ulashing — pastdagi tugmani bosing. ' +
        'Keyin /shifokor ni qayta bosing.',
      contactKeyboard(),
    );
    return;
  }

  const doctor = db
    .prepare(
      `SELECT d.status, d.reject_reason FROM referring_doctors d
         JOIN users u ON u.id = d.user_id
        WHERE u.telegram_id = ?`,
    )
    .get(telegramId) as { status: string; reject_reason: string | null } | undefined;

  const open = (label: string) => ({ inline_keyboard: [[{ text: label, web_app: { url: `${base}/doctor` } }]] });

  if (!doctor) {
    await sendMessage(
      chatId,
      '🩺 <b>Shifokor sifatida ro‘yxatdan o‘ting</b>\n\n' +
        'Bemorlaringiz uchun so‘rov yarating — klinikalar taklif yuboradi, siz eng maqbulini tavsiya qilasiz.\n\n' +
        'Kerak bo‘ladi: ism, mutaxassislik, ish joyi va bakalavr diplomi (rasm yoki PDF).',
      open('📝 Ro‘yxatdan o‘tish'),
    );
    return;
  }

  const text: Record<string, string> = {
    pending: '⏳ Arizangiz admin tasdig‘ini kutmoqda. Natija shu yerga keladi.',
    in_review: '⏳ Yangi hujjatlaringiz yuborildi — ariza qayta ko‘rib chiqilmoqda.',
    approved: '✅ Kabinetingiz tayyor.',
    rejected:
      '❌ Arizangiz rad etilgan.' +
      (doctor.reject_reason ? `\n<b>Sabab:</b> ${escHtml(doctor.reject_reason)}` : '') +
      '\n\nYangi hujjat yuklasangiz, ariza qayta ko‘rib chiqiladi.',
  };
  await sendMessage(chatId, `🩺 <b>Shifokor kabineti</b>\n\n${text[doctor.status] ?? ''}`, open('🩺 Kabinetni ochish'));
}

/** Shifokor havolasi bo'yicha javoblar */
const INVITE_ASK_CONTACT =
  '🩺 <b>Shifokoringiz siz uchun so‘rov yaratdi.</b>\n\n' +
  'Bu siz ekaningizni tasdiqlash uchun pastdagi tugma orqali 📱 telefon raqamingizni yuboring.';

const INVITE_TEXT: Record<'mismatch' | 'gone' | 'no_phone', string> = {
  mismatch:
    'Bu havola boshqa telefon raqami uchun yaratilgan. Shifokoringizdan raqamingizni tekshirib, qayta yuborishni so‘rang.',
  gone: 'Bu havola eskirgan yoki so‘rov bo‘yicha qaror allaqachon qabul qilingan.',
  no_phone: 'Avval 📱 telefon raqamingizni yuboring.',
};

const escHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ─────────────────────────  Yangilanishlar  ───────────────────────── */

interface TelegramUpdate {
  /** Inline tugma bosildi (shifokor tavsiyasidagi kunlar) */
  callback_query?: CallbackQuery;
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
  if (update.callback_query) {
    const handled = await handleRecommendationCallback(update.callback_query);
    // Noma'lum tugma — baribir javob beramiz, aks holda Telegram'da "yuklanmoqda" aylanib qoladi
    if (!handled) await call('answerCallbackQuery', { callback_query_id: update.callback_query.id });
    return;
  }

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

      // Klaviaturani olib tashlaymiz — kerak emas, joyni egallaydi
      await sendMessage(chatId, READY, { remove_keyboard: true });

      /*
       * Shifokor taklifnomasi. Bemor havolani ochib, raqamini hozir
       * ulashdi — kutib turgan taklifnomani endi tekshiramiz. Havolasiz
       * kelgan bo'lsa ham, shu raqamga yozilganlari topiladi.
       */
      const pending = db
        .prepare(`SELECT token FROM bot_pending_invites WHERE telegram_id = ?`)
        .get(from.id) as { token: string } | undefined;
      if (pending) {
        db.prepare(`DELETE FROM bot_pending_invites WHERE telegram_id = ?`).run(from.id);
        const result = claimInvite(user.id, pending.token);
        if (result === 'ok') return;
        await sendMessage(chatId, INVITE_TEXT[result]);
      }
      if (bindCasesByPhone(user.id) > 0) return;

      await greet(chatId, message.contact.phone_number);
      return;
    }

    await sendMessage(chatId, READY, { remove_keyboard: true });
    await sendMessage(chatId, CHOOSE, openButton());
    return;
  }

  if (!message.text) return;
  const text = message.text.trim();

  // `/start payload` shaklida ham kelishi mumkin — faqat buyruqni olamiz
  const command = text.split(/\s+/)[0].toLowerCase();

  if (command === '/start') {
    /*
     * `/start inv_XXXX` — shifokor bergan havola. Xabar (tugmasi bilan)
     * `claimInvite` ichida yuboriladi; bu yerda faqat muammoni aytamiz.
     */
    const payload = text.split(/\s+/)[1] ?? '';
    if (payload.startsWith('inv_') && from) {
      const token = payload.slice(4).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
      const user = upsertUser({
        id: from.id,
        first_name: from.first_name ?? 'Foydalanuvchi',
        last_name: from.last_name,
        username: from.username,
        language_code: from.language_code,
      });
      const result = claimInvite(user.id, token);
      if (result === 'ok') return;
      if (result === 'no_phone') {
        db.prepare(
          `INSERT INTO bot_pending_invites (telegram_id, token) VALUES (?, ?)
           ON CONFLICT(telegram_id) DO UPDATE SET token = excluded.token, created_at = datetime('now')`,
        ).run(from.id, token);
        await sendMessage(chatId, INVITE_ASK_CONTACT, contactKeyboard());
        return;
      }
      await sendMessage(chatId, INVITE_TEXT[result]);
      return;
    }

    await sendMessage(chatId, INTRO);

    // Raqam allaqachon bo'lsa qayta so'ramaymiz — bir marta yetarli
    const phone = from ? phoneOf(from.id) : null;
    if (phone) {
      await greet(chatId, phone);
    } else {
      await sendMessage(chatId, ASK_CONTACT, contactKeyboard());
    }
    return;
  }

  if (command === '/help') {
    await sendMessage(chatId, HELP, openButton());
    return;
  }

  /*
   * `/parol` — saytdan (klinikatop.uz/kirish/) kirish uchun parol.
   * Parol Mini App ichida qo'yiladi: shaxs Telegram imzosi bilan
   * tasdiqlangan, ya'ni SMS kod kerak emas.
   */
  if ((command === '/parol' || command === '/password') && from) {
    const base = config.telegram.webappUrl.replace(/\/$/, '');
    if (!phoneOf(from.id)) {
      await sendMessage(chatId, '🔑 Avval 📱 telefon raqamingizni ulashing — saytga shu raqam bilan kirasiz.', contactKeyboard());
      return;
    }
    await sendMessage(
      chatId,
      '🔑 <b>Saytdan kirish uchun parol</b>\n\nParol qo‘ying yoki o‘zgartiring — keyin klinikatop.uz/kirish/ sahifasida raqamingiz va shu parol bilan kirasiz.',
      { inline_keyboard: [[{ text: '🔑 Parolni sozlash', web_app: { url: `${base}/profile/password` } }]] },
    );
    return;
  }

  if ((command === '/shifokor' || command === '/doctor') && from) {
    await doctorEntry(chatId, from.id);
    return;
  }

  // Klinika egasi uchun to'g'ridan-to'g'ri yo'l
  if (command === '/clinic' || command === '/klinika') {
    await sendMessage(chatId, CLINIC_INTRO, openButton());
    return;
  }

  // Kodga o'xshash matn — odam eski ulanish kodini yubormoqchi bo'lgan
  if (/^[0-9A-Za-z]{4,16}$/.test(text) && !text.startsWith('/')) {
    await sendMessage(chatId, CLINIC_HINT, openButton());
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

/* ─────────────────  Botning "yuzi" — admin boshqaradi  ───────────────── */

export const SETTING_BOT_DESCRIPTION = 'bot_description';
export const SETTING_BOT_SHORT = 'bot_short_description';
export const SETTING_BOT_MENU = 'bot_menu_button';

/**
 * Zaxira qiymatlar.
 *
 * Bazada hech narsa bo'lmasa shular ishlatiladi — ya'ni yangi
 * o'rnatishda bot baribir bo'sh qolmaydi.
 */
export const BOT_DEFAULTS = {
  description:
    'Bitta so‘rov — ko‘p klinika, ko‘p taklif. Operatsiya narxlarini taqqoslang va o‘zingizga qulayini tanlang.',
  shortDescription: 'Operatsiya narxlarini taqqoslang — bitta so‘rov, ko‘p klinika.',
  menuButton: 'KlinikaTop',
};

export interface BotFace {
  /** Suhbat bo'sh bo'lganda, /start BOSILMASDAN oldin ko'rinadi */
  description: string;
  /** Bot profilida ko'rinadi */
  shortDescription: string;
  /** Yozuv maydoni yonidagi tugma matni — ilovani ochadi */
  menuButton: string;
}

export function getBotFace(): BotFace {
  return {
    description: textSetting(SETTING_BOT_DESCRIPTION, BOT_DEFAULTS.description),
    shortDescription: textSetting(SETTING_BOT_SHORT, BOT_DEFAULTS.shortDescription),
    menuButton: textSetting(SETTING_BOT_MENU, BOT_DEFAULTS.menuButton),
  };
}

/**
 * Botni ishga tayyorlash: menyu tugmasi, buyruqlar va tavsiflar.
 *
 * Matnlar bazadan olinadi — admin ularni panelidan o'zgartiradi va
 * o'zgarish darhol Telegram'ga yuboriladi (`applyBotFace`). Bu yerda
 * esa server ko'tarilganda bir marta qo'llanadi.
 */
export async function configureBot(): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.webappUrl) return;

  await call('setMyCommands', {
    commands: [
      { command: 'start', description: 'Ilovani ochish' },
      { command: 'clinic', description: 'Klinika uchun' },
      { command: 'shifokor', description: 'Shifokor kabineti / Кабинет врача' },
      { command: 'parol', description: 'Saytga kirish paroli / Пароль для сайта' },
      { command: 'help', description: 'Qanday ishlaydi' },
    ],
  });

  await applyBotFace(getBotFace());
  await ensureWebhookUpdates();
}

/**
 * Webhook tugma bosilishlarini ham qabul qilsin.
 *
 * Shifokor tavsiyasidagi kun tugmalari `callback_query` bo'lib keladi.
 * Webhook `allowed_updates: ["message"]` bilan o'rnatilgan bo'lsa
 * Telegram ularni umuman yubormaydi — tugma bosilganda hech narsa
 * bo'lmaydi va "yuklanmoqda" aylanib qoladi. Har ko'tarilishda
 * tekshiriladi: kimdir webhook'ni qayta o'rnatsa ham o'zi tuzaladi.
 * Manzil va maxfiy kalit O'ZGARMAYDI — faqat ro'yxat kengaytiriladi.
 */
const REQUIRED_UPDATES = ['message', 'callback_query'];

async function ensureWebhookUpdates(): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.webhookSecret) return;
  try {
    const res = await fetch(`${API()}/getWebhookInfo`, { signal: AbortSignal.timeout(10_000) });
    const info = (await res.json()) as { ok: boolean; result?: { url?: string; allowed_updates?: string[] } };
    const url = info.result?.url;
    if (!info.ok || !url) return;
    const allowed = info.result?.allowed_updates;
    // Ro'yxat berilmagan bo'lsa Telegram hammasini yuboradi — tegmaymiz
    if (!allowed || REQUIRED_UPDATES.every((u) => allowed.includes(u))) return;
    const ok = await call('setWebhook', {
      url,
      secret_token: config.telegram.webhookSecret,
      allowed_updates: [...new Set([...allowed, ...REQUIRED_UPDATES])],
    });
    console.log(`[bot] webhook yangilandi (callback_query qo'shildi): ${ok ? 'ok' : 'XATO'}`);
  } catch (err) {
    console.error('[bot] webhook tekshiruvi xatosi:', err);
  }
}

/**
 * Matnlarni Telegram'ga yuborish.
 *
 * Telegram ularni o'zi keshlaydi: mavjud suhbatlarda o'zgarish
 * darrov ko'rinmasligi mumkin, yangi (bo'sh) suhbatda esa darhol
 * chiqadi. Shuning uchun saqlash "ishlamadi" degan taassurot
 * bermasligi uchun buni admin panelida ham aytamiz.
 */
export async function applyBotFace(face: BotFace): Promise<boolean> {
  if (!config.telegram.botToken || !config.telegram.webappUrl) return false;

  /*
   * `call` xatoni YUTMAYDI, `false` qaytaradi — shuning uchun natija
   * tekshiriladi. Aks holda admin panelida "Telegram'ga yuborildi"
   * deb turar, aslida bot o'zgarmagan bo'lardi.
   */
  const results = await Promise.all([
    // Yozuv maydoni yonidagi doimiy tugma — ilovaga eng qisqa yo'l
    call('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: face.menuButton.slice(0, 30),
        web_app: { url: `${config.telegram.webappUrl.replace(/\/$/, '')}/app` },
      },
    }),
    call('setMyDescription', { description: face.description.slice(0, 512) }),
    call('setMyShortDescription', { short_description: face.shortDescription.slice(0, 120) }),
  ]);

  return results.every(Boolean);
}
