/**
 * Shifokor tavsiyasi va botdan "tezkor qabul".
 *
 *   shifokor: taklif + izoh → doctor_recommendations (bitta FAOL)
 *        ↓
 *   bot: "Shifokoringiz X ni tavsiya qildi" + taklifdagi KUNLAR tugma
 *        bo'lib + "Barcha takliflarni ko'rish" (Mini App)
 *        ↓ kun bosildi
 *   bot: "12-okt, X klinika, N so'm — tasdiqlaysizmi?" [✅ Tasdiqlash] [↩️ Orqaga]
 *        ↓ tasdiq
 *   chooseOffer → bitim; xabar "Qabul qilindi" + [💬 Chatni ochish]
 *
 * Bemor tavsiyaga MAJBUR emas: ilovada hamma takliflar ko'rinadi,
 * tavsiya qilingani esa 🩺 belgi bilan. Qaysi birini tanlasa ham
 * shifokorga xabar boradi (`doctorCases.onOfferChosen`).
 *
 * Tugma bosilishi Telegram webhook orqali keladi (maxfiy sarlavha
 * bilan) va `from.id` bemorning o'zi bo'lishi SHART — tavsiya raqami
 * taxmin qilinsa ham boshqa odam qabul qila olmaydi.
 */
import { db, nowSql } from '../db';
import { config } from '../lib/config';
import { badRequest, conflict, notFound } from '../lib/errors';
import { sendTelegramKeyboard, telegramCall, type TgInlineButton } from '../lib/telegram';
import { chooseOffer } from './deals';
import { getDoctorCase } from './doctorCases';
import { notify } from './notifications';
import { assertApprovedDoctor } from './referringDoctors';
import type { DoctorCase, OfferWithClinic, PatientRecommendation } from '../../../shared/types';

/** Bitta so'rovda shifokor fikrini necha marta o'zgartira oladi — har biri bemorga xabar */
export const MAX_RECOMMENDATIONS_PER_CASE = 5;
/** Botda nechta kun tugmasi */
const MAX_DATE_BUTTONS = 6;

const MONTHS = {
  uz: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'],
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
};
const dayLabel = (iso: string, lang: 'uz' | 'ru') => {
  const [, m, d] = iso.split('-').map(Number);
  return lang === 'ru' ? `${d} ${MONTHS.ru[m - 1]}` : `${d}-${MONTHS.uz[m - 1]}`;
};
const money = (n: number, lang: 'uz' | 'ru') => `${n.toLocaleString('ru-RU')} ${lang === 'ru' ? 'сум' : 'so‘m'}`;
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const base = () => config.telegram.webappUrl.replace(/\/$/, '');

/* ─────────────────────────  Shifokor tomoni  ───────────────────────── */

export function recommendOffer(
  userId: number,
  caseId: number,
  offerId: number,
  rawComment: string | null,
): DoctorCase & { offers: OfferWithClinic[] } {
  const doctor = assertApprovedDoctor(userId);
  const c = db.prepare(`SELECT * FROM doctor_cases WHERE id = ? AND doctor_id = ?`).get(caseId, doctor.id) as any;
  if (!c) throw notFound('So‘rov topilmadi');
  if (c.status !== 'approved' || !c.request_id) throw badRequest('not_approved', 'Bemor hali so‘rovni tasdiqlamagan');

  const req = db.prepare(`SELECT status FROM requests WHERE id = ?`).get(c.request_id) as { status: string } | undefined;
  if (!req || (req.status !== 'NEW' && req.status !== 'COLLECTING')) {
    throw conflict('already_chosen', 'Bemor allaqachon klinikani tanlagan — tavsiyani o‘zgartirib bo‘lmaydi');
  }

  const offer = db
    .prepare(`SELECT id, clinic_id, price_uzs, status FROM offers WHERE id = ? AND request_id = ?`)
    .get(offerId, c.request_id) as { id: number; clinic_id: number; price_uzs: number; status: string } | undefined;
  if (!offer || offer.status !== 'SENT') throw notFound('Taklif topilmadi yoki endi mavjud emas');

  const active = db
    .prepare(`SELECT offer_id FROM doctor_recommendations WHERE case_id = ? AND superseded_at IS NULL`)
    .get(caseId) as { offer_id: number } | undefined;
  if (active?.offer_id === offerId) throw conflict('already_recommended', 'Bu taklif allaqachon tavsiya qilingan');

  const total = db.prepare(`SELECT COUNT(*) AS n FROM doctor_recommendations WHERE case_id = ?`).get(caseId) as { n: number };
  if (total.n >= MAX_RECOMMENDATIONS_PER_CASE) {
    throw badRequest('too_many_changes', 'Tavsiyani bu so‘rovda boshqa o‘zgartirib bo‘lmaydi');
  }

  const comment = (rawComment ?? '').trim().slice(0, 500) || null;
  const recId = db.transaction(() => {
    db.prepare(`UPDATE doctor_recommendations SET superseded_at = ? WHERE case_id = ? AND superseded_at IS NULL`).run(
      nowSql(),
      caseId,
    );
    return Number(
      db
        .prepare(
          `INSERT INTO doctor_recommendations (case_id, doctor_id, request_id, offer_id, clinic_id, price_uzs, comment)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(caseId, doctor.id, c.request_id, offerId, offer.clinic_id, offer.price_uzs, comment).lastInsertRowid,
    );
  })();

  void sendRecommendation(recId);
  return getDoctorCase(userId, caseId);
}

/** Bemorning so'rovida faol tavsiya (ilovadagi 🩺 belgi uchun) */
export function recommendationForRequest(requestId: number): PatientRecommendation | null {
  const r = db
    .prepare(
      `SELECT rec.offer_id, rec.comment, rec.created_at, d.first_name, d.last_name, d.specialty
         FROM doctor_recommendations rec JOIN referring_doctors d ON d.id = rec.doctor_id
        WHERE rec.request_id = ? AND rec.superseded_at IS NULL`,
    )
    .get(requestId) as any;
  if (!r) return null;
  return {
    offerId: r.offer_id,
    comment: r.comment ?? null,
    doctorName: `${r.first_name} ${r.last_name}`,
    specialty: r.specialty,
    createdAt: new Date(r.created_at.replace(' ', 'T') + 'Z').toISOString(),
  };
}

/* ─────────────────────────  Bot xabari  ───────────────────────── */

interface RecContext {
  recId: number;
  active: boolean;
  requestId: number;
  requestStatus: string;
  offerId: number;
  offerStatus: string;
  priceUzs: number;
  dates: string[];
  clinic: string;
  comment: string | null;
  doctor: string;
  patientId: number;
  telegramId: number;
  lang: 'uz' | 'ru';
}

function context(recId: number): RecContext | null {
  const r = db
    .prepare(
      `SELECT rec.id, rec.superseded_at, rec.comment, rec.request_id, rq.status AS request_status,
              o.id AS offer_id, o.status AS offer_status, o.price_uzs, o.proposed_dates, cl.name AS clinic,
              d.first_name, d.last_name, u.id AS patient_id, u.telegram_id, u.lang
         FROM doctor_recommendations rec
         JOIN requests rq ON rq.id = rec.request_id
         JOIN offers o ON o.id = rec.offer_id
         JOIN clinics cl ON cl.id = rec.clinic_id
         JOIN referring_doctors d ON d.id = rec.doctor_id
         JOIN users u ON u.id = rq.patient_id
        WHERE rec.id = ?`,
    )
    .get(recId) as any;
  if (!r) return null;
  const today = new Date().toISOString().slice(0, 10);
  return {
    recId: r.id,
    active: r.superseded_at == null,
    requestId: r.request_id,
    requestStatus: r.request_status,
    offerId: r.offer_id,
    offerStatus: r.offer_status,
    priceUzs: r.price_uzs,
    // O'tib ketgan kun tugma bo'lib chiqmasin
    dates: (JSON.parse(r.proposed_dates ?? '[]') as string[]).filter((d) => d >= today).sort(),
    clinic: r.clinic,
    comment: r.comment ?? null,
    doctor: `${r.first_name} ${r.last_name}`,
    patientId: r.patient_id,
    telegramId: r.telegram_id,
    lang: r.lang === 'ru' ? 'ru' : 'uz',
  };
}

function recText(c: RecContext): string {
  const ru = c.lang === 'ru';
  return (
    (ru ? '🩺 <b>Рекомендация вашего врача</b>\n' : '🩺 <b>Shifokoringiz tavsiyasi</b>\n') +
    (ru
      ? `${esc(c.doctor)} рекомендует клинику <b>${esc(c.clinic)}</b>.\n`
      : `${esc(c.doctor)} sizga <b>${esc(c.clinic)}</b> klinikasini tavsiya qildi.\n`) +
    `💰 ${money(c.priceUzs, c.lang)}\n` +
    (c.comment ? `💬 «${esc(c.comment)}»\n` : '') +
    '\n' +
    (ru
      ? 'Выбор за вами — можно принять рекомендацию или сравнить все предложения.\nЧтобы принять, выберите удобный день:'
      : 'Tanlov o‘zingizda — tavsiyani qabul qilishingiz yoki barcha takliflarni taqqoslashingiz mumkin.\nQabul qilish uchun qulay kunni tanlang:')
  );
}

function dateRows(c: RecContext): TgInlineButton[][] {
  const buttons = c.dates.slice(0, MAX_DATE_BUTTONS).map((d) => ({
    text: `📅 ${dayLabel(d, c.lang)}`,
    callback_data: `rd:${c.recId}:${d.replace(/-/g, '')}`,
  }));
  const rows: TgInlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  rows.push([
    {
      text: c.lang === 'ru' ? '👀 Все предложения' : '👀 Barcha takliflarni ko‘rish',
      web_app: { url: `${base()}/request/${c.requestId}` },
    },
  ]);
  return rows;
}

async function sendRecommendation(recId: number): Promise<void> {
  const c = context(recId);
  if (!c) return;
  // Ichki markazga ham — lekin push'siz: Telegram xabarini shu yerda o'zimiz yuboramiz
  notify(
    c.patientId,
    'doctor_recommendation',
    { doctor: c.doctor, clinic: c.clinic, price: money(c.priceUzs, c.lang) },
    `/request/${c.requestId}`,
    { push: false },
  );
  if (c.telegramId > 0) await sendTelegramKeyboard(c.telegramId, recText(c), dateRows(c));
}

/* ─────────────────────────  Tugma bosildi  ───────────────────────── */

export interface CallbackQuery {
  id: string;
  from: { id: number };
  data?: string;
  message?: { chat: { id: number }; message_id: number };
}

const ymd = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/** Bot `callback_query` ni shu yerga beradi. `true` — tavsiya tugmasi edi */
export async function handleRecommendationCallback(q: CallbackQuery): Promise<boolean> {
  const m = /^r([dyb]):(\d+)(?::(\d{8}))?$/.exec(q.data ?? '');
  if (!m) return false;
  const [, action, recIdRaw, dateRaw] = m;

  const answer = (text?: string, alert = false) =>
    telegramCall('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text, show_alert: alert } : {}) });
  const edit = (text: string, rows: TgInlineButton[][]) =>
    q.message
      ? telegramCall('editMessageText', {
          chat_id: q.message.chat.id,
          message_id: q.message.message_id,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: rows },
        })
      : Promise.resolve(false);

  const c = context(Number(recIdRaw));
  // Boshqa odam (masalan xabar forward qilingan) — hech narsa ochilmaydi
  if (!c || c.telegramId !== q.from.id) {
    await answer('Bu tugma siz uchun emas', true);
    return true;
  }
  const ru = c.lang === 'ru';

  if (c.requestStatus !== 'NEW' && c.requestStatus !== 'COLLECTING') {
    await answer(ru ? 'Вы уже выбрали клинику по этой заявке' : 'Bu so‘rov bo‘yicha klinika allaqachon tanlangan', true);
    return true;
  }
  if (!c.active || c.offerStatus !== 'SENT') {
    await answer(ru ? 'Рекомендация устарела — откройте все предложения' : 'Bu tavsiya eskirgan — barcha takliflarni oching', true);
    return true;
  }

  if (action === 'b') {
    await edit(recText(c), dateRows(c));
    await answer();
    return true;
  }

  const day = dateRaw ? ymd(dateRaw) : '';
  if (!c.dates.includes(day)) {
    await answer(ru ? 'Эта дата больше недоступна' : 'Bu kun endi mavjud emas', true);
    return true;
  }

  if (action === 'd') {
    await edit(
      (ru ? '❓ <b>Подтвердите выбор</b>\n' : '❓ <b>Tanlovni tasdiqlang</b>\n') +
        `🏥 ${esc(c.clinic)}\n💰 ${money(c.priceUzs, c.lang)}\n📅 ${dayLabel(day, c.lang)}\n\n` +
        (ru
          ? 'После подтверждения откроется чат с клиникой, остальные предложения будут закрыты.'
          : 'Tasdiqlagach klinika bilan chat ochiladi, qolgan takliflar yopiladi.'),
      [
        [
          { text: ru ? '✅ Подтвердить' : '✅ Tasdiqlash', callback_data: `ry:${c.recId}:${dateRaw}` },
          { text: ru ? '↩️ Назад' : '↩️ Orqaga', callback_data: `rb:${c.recId}` },
        ],
      ],
    );
    await answer();
    return true;
  }

  // action === 'y' — qabul
  try {
    const deal = chooseOffer(c.requestId, c.offerId, c.patientId, day);
    await edit(
      (ru ? '✅ <b>Принято!</b>\n' : '✅ <b>Qabul qilindi!</b>\n') +
        `🏥 ${esc(c.clinic)}\n💰 ${money(c.priceUzs, c.lang)}\n📅 ${dayLabel(day, c.lang)}\n\n` +
        (ru ? 'Чат с клиникой открыт — там же оплата и подтверждение.' : 'Klinika bilan chat ochildi — to‘lov va tasdiq ham shu yerda.'),
      [[{ text: ru ? '💬 Открыть чат' : '💬 Chatni ochish', web_app: { url: `${base()}/deal/${deal.id}` } }]],
    );
    await answer(ru ? 'Готово' : 'Tayyor');
  } catch (err: any) {
    await answer(err?.message ?? (ru ? 'Не удалось' : 'Bajarib bo‘lmadi'), true);
  }
  return true;
}

/** Test uchun: bot xabari matni va tugmalari */
export const _testing = { context, recText, dateRows };
