/**
 * Bildirishnoma (13-bo'lim).
 * Ikki kanal: ichki markaz (o'qilgan/o'qilmagan) + Telegram push.
 * Matn foydalanuvchi tilida — kalitlar `i18n/notifications` dan.
 */
import { db, toJson } from '../db';
import { config } from '../lib/config';
import { mapNotification } from '../lib/mappers';
import { sendTelegramMessage } from '../lib/telegram';
import { bus, ch } from './events';
import { normalizePhone } from './webAuth';
import type { Lang, Notification, NotificationType } from '../../../shared/types';

type Params = Record<string, string | number>;

/** Odam yozgan matn HTML rejimdagi xabarga — Telegram `<` ni teg deb o'qiydi */
const escHtml = (v: string | number | undefined) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Tugma yozuvi — umumiy "Ochish" o'rniga aniq harakat.
 * Odam xabarni o'qib, keyingi qadam nima ekanini tugmadan bilishi kerak.
 */
const LINK_LABEL: Partial<Record<NotificationType, Record<Lang, (p: Params) => string>>> = {
  doctor_review: {
    uz: (p) => (p.approved ? '🩺 Kabinetga o‘tish' : '📄 Hujjat yuklash'),
    ru: (p) => (p.approved ? '🩺 Перейти в кабинет' : '📄 Загрузить документ'),
  },
  doctor_case: { uz: () => '👀 Ko‘rish va tasdiqlash', ru: () => '👀 Посмотреть и подтвердить' },
  doctor_case_update: { uz: () => '🩺 Kabinetda ko‘rish', ru: () => '🩺 Открыть в кабинете' },
  doctor_recommendation: { uz: () => '👀 Takliflarni ko‘rish', ru: () => '👀 Посмотреть предложения' },
};

/** Push matnlari — ichki bildirishnoma sarlavhasi klientda tarjima qilinadi. */
const PUSH: Record<NotificationType, Record<Lang, (p: Params) => string>> = {
  new_request: {
    uz: (p) => `🩺 <b>Yangi so'rov</b>\n${p.operation} — ${p.city}\nByudjet: ${p.budget}\nTaklif yuboring, birinchi javob bergan ko'proq ko'riladi.`,
    ru: (p) => `🩺 <b>Новая заявка</b>\n${p.operation} — ${p.city}\nБюджет: ${p.budget}\nОтправьте предложение — быстрый ответ заметнее.`,
  },
  new_offer: {
    uz: (p) => `💬 <b>Yangi taklif keldi</b>\n${p.clinic} — ${p.price}\nTakliflarni taqqoslab ko'ring.`,
    ru: (p) => `💬 <b>Новое предложение</b>\n${p.clinic} — ${p.price}\nСравните предложения.`,
  },
  offer_chosen: {
    uz: (p) => `🎉 <b>Sizni tanlashdi!</b>\n${p.operation} bo'yicha bemor sizning taklifingizni tanladi. Chat ochildi.`,
    ru: (p) => `🎉 <b>Вас выбрали!</b>\nПациент выбрал ваше предложение по «${p.operation}». Чат открыт.`,
  },
  offer_rejected: {
    uz: (p) => `Bemor boshqa taklifni tanladi (${p.operation}). Keyingi so'rovlarda omad!`,
    ru: (p) => `Пациент выбрал другое предложение (${p.operation}). Удачи в следующих заявках!`,
  },
  new_message: {
    uz: (p) => `✉️ <b>${p.from}</b>\n${p.preview}`,
    ru: (p) => `✉️ <b>${p.from}</b>\n${p.preview}`,
  },
  confirm_prompt: {
    uz: (p) => `💳 <b>To'lovni bildirdingizmi?</b>\n${p.clinic} bilan bitim. To'laganingizdan keyin summani yozing — klinika shundan so'ng operatsiyani yakunlaydi va bu boshqa bemorlarga real narxni ko'rsatadi.`,
    ru: (p) => `💳 <b>Вы указали оплату?</b>\nСделка с «${p.clinic}». Укажите сумму — после этого клиника завершит операцию, а другие пациенты увидят реальную цену.`,
  },
  payment_declared: {
    uz: () => `💵 <b>Bemor to'lovni bildirdi</b>\nSummani tekshiring va operatsiya bajarilgach bitimni yakunlang.`,
    ru: () => `💵 <b>Пациент указал оплату</b>\nПроверьте сумму и завершите сделку после операции.`,
  },
  commission_confirmed: {
    uz: (p) => `✅ <b>Komissiya to'lovi tasdiqlandi</b>\n${p.amount} so'm hisobga olindi.`,
    ru: (p) => `✅ <b>Оплата комиссии подтверждена</b>\n${p.amount} сум зачтено.`,
  },
  commission_rejected: {
    uz: (p) => `⚠️ <b>Komissiya to'lovi qaytarildi</b>\n${p.note || 'Sabab ko\'rsatilmagan'}. Iltimos, tekshirib qayta yuboring.`,
    ru: (p) => `⚠️ <b>Оплата комиссии отклонена</b>\n${p.note || 'Причина не указана'}. Проверьте и отправьте снова.`,
  },
  payment_confirmed: {
    uz: (p) => `✅ <b>Bitim yakunlandi</b>\n${p.clinic} to'lovni olganini va operatsiya bajarilganini tasdiqladi.`,
    ru: (p) => `✅ <b>Сделка завершена</b>\n«${p.clinic}» подтвердила оплату и выполнение операции.`,
  },
  request_expiring: {
    uz: (p) => `⏳ So'rovingiz muddati 1 soatdan keyin tugaydi (${p.operation}). Takliflarni ko'rib chiqing.`,
    ru: (p) => `⏳ Срок заявки истекает через час (${p.operation}). Посмотрите предложения.`,
  },
  request_expired: {
    uz: (p) => `So'rovingiz muddati tugadi (${p.operation}) va birorta taklif kelmadi. Byudjetni oshirib qayta urinib ko'ring.`,
    ru: (p) => `Срок заявки истёк (${p.operation}), предложений не поступило. Попробуйте увеличить бюджет.`,
  },
  subscription_expiring: {
    uz: (p) => `📅 Obunangiz ${p.days} kundan keyin tugaydi. To'lovni yangilang, aks holda yangi so'rovlar kelmaydi.`,
    ru: (p) => `📅 Подписка заканчивается через ${p.days} дн. Продлите, иначе новые заявки перестанут приходить.`,
  },
  verification_result: {
    uz: (p) => (p.approved ? `✅ Klinikangiz tasdiqlandi. Endi so'rovlarni olishingiz mumkin.` : `❌ Verifikatsiya rad etildi.\nSabab: ${p.note}`),
    ru: (p) => (p.approved ? `✅ Клиника подтверждена. Заявки уже поступают.` : `❌ Верификация отклонена.\nПричина: ${p.note}`),
  },
  doctor_review: {
    uz: (p) =>
      p.approved
        ? `✅ <b>Arizangiz tasdiqlandi</b>\nTabriklaymiz! Endi bemorlaringizga klinika xizmatlarini tavsiya qila olasiz.`
        : `❌ <b>Arizangiz rad etildi</b>\nShifokor arizangiz tasdiqlanmadi. Sabab: ${escHtml(p.note)}\n\nYangi hujjat yuklasangiz, ariza qayta ko‘rib chiqiladi.`,
    ru: (p) =>
      p.approved
        ? `✅ <b>Заявка одобрена</b>\nПоздравляем! Теперь вы можете рекомендовать пациентам услуги клиник.`
        : `❌ <b>Заявка отклонена</b>\nЗаявка врача не одобрена. Причина: ${escHtml(p.note)}\n\nЗагрузите новый документ — заявка уйдёт на повторную проверку.`,
  },
  doctor_case: {
    uz: (p) =>
      `🩺 <b>Shifokoringiz siz uchun so‘rov yaratdi</b>\n${escHtml(p.doctor)} — ${escHtml(p.specialty)}\n\n` +
      `Ko‘rib chiqing va tasdiqlang. Siz tasdiqlamaguningizcha so‘rov hech bir klinikaga ko‘rinmaydi.`,
    ru: (p) =>
      `🩺 <b>Ваш врач создал для вас заявку</b>\n${escHtml(p.doctor)} — ${escHtml(p.specialty)}\n\n` +
      `Посмотрите и подтвердите. Пока вы не подтвердите, заявку не увидит ни одна клиника.`,
  },
  doctor_case_update: {
    uz: (p) =>
      ({
        approved: `✅ <b>Bemor tasdiqladi</b>\n${escHtml(p.patient)} — ${escHtml(p.service)}\nSo‘rov klinikalarga yuborildi, takliflar kelishi bilan kabinetda ko‘rinadi.`,
        declined: `❌ <b>Bemor rad etdi</b>\n${escHtml(p.service)} (+${p.phone})`,
        not_me: `⚠️ <b>Raqam egasi “Bu men emasman” dedi</b>\n${escHtml(p.service)} (+${p.phone})\nRaqamni tekshiring.`,
        expired: `⌛ <b>Bemor javob bermadi</b>\n${escHtml(p.service)} (+${p.phone}) — taklifnoma muddati tugadi.`,
        chosen:
          `🎉 <b>Bemor klinikani tanladi</b>\n${escHtml(p.patient)} — ${escHtml(p.service)}\n` +
          `${escHtml(p.clinic)} · ${escHtml(p.price)}\n` +
          (p.recommended ? '✅ Sizning tavsiyangiz qabul qilindi.' : 'Bemor boshqa klinikani tanladi.'),
      })[String(p.status)] ?? '',
    ru: (p) =>
      ({
        approved: `✅ <b>Пациент подтвердил</b>\n${escHtml(p.patient)} — ${escHtml(p.service)}\nЗаявка отправлена клиникам, предложения появятся в кабинете.`,
        declined: `❌ <b>Пациент отказался</b>\n${escHtml(p.service)} (+${p.phone})`,
        not_me: `⚠️ <b>Владелец номера ответил «Это не я»</b>\n${escHtml(p.service)} (+${p.phone})\nПроверьте номер.`,
        expired: `⌛ <b>Пациент не ответил</b>\n${escHtml(p.service)} (+${p.phone}) — срок приглашения истёк.`,
        chosen:
          `🎉 <b>Пациент выбрал клинику</b>\n${escHtml(p.patient)} — ${escHtml(p.service)}\n` +
          `${escHtml(p.clinic)} · ${escHtml(p.price)}\n` +
          (p.recommended ? '✅ Ваша рекомендация принята.' : 'Пациент выбрал другую клинику.'),
      })[String(p.status)] ?? '',
  },
  doctor_recommendation: {
    uz: (p) => `🩺 <b>Shifokoringiz tavsiyasi</b>\n${escHtml(p.doctor)} sizga <b>${escHtml(p.clinic)}</b> klinikasini tavsiya qildi (${escHtml(p.price)}).`,
    ru: (p) => `🩺 <b>Рекомендация врача</b>\n${escHtml(p.doctor)} рекомендует клинику <b>${escHtml(p.clinic)}</b> (${escHtml(p.price)}).`,
  },
  dispute_opened: {
    uz: () => `⚠️ Bitim bo'yicha nizo ochildi. Moderator ko'rib chiqadi.`,
    ru: () => `⚠️ По сделке открыт спор. Модератор рассмотрит его.`,
  },
  bonus_earned: {
    uz: (p) => `🎁 Tasdiqlaganingiz uchun +${p.points} ball. Rahmat — sharhingiz boshqalarga yordam beradi.`,
    ru: (p) => `🎁 +${p.points} баллов за подтверждение. Спасибо — ваш отзыв помогает другим.`,
  },
  // Bemorga ham, klinikaga ham boradi. Matn nizo yo'li ochiqligini aytadi —
  // avtomatik yopilish yakuniy qaror emas.
  deal_auto_confirmed: {
    uz: () => `Bitim javob kelmagani uchun avtomatik yakunlandi. Rozi bo‘lmasangiz nizo ochishingiz mumkin.`,
    ru: () => `Сделка закрыта автоматически из-за отсутствия ответа. Если вы не согласны — откройте спор.`,
  },
};

export function notify(
  userId: number,
  type: NotificationType,
  params: Params = {},
  link: string | null = null,
  /** `push: false` — faqat ichki markaz; Telegram xabarini chaqiruvchi o'zi yuboradi */
  opts: { push?: boolean } = {},
): Notification | null {
  const user = db.prepare(`SELECT id, telegram_id, lang FROM users WHERE id = ?`).get(userId) as
    | { id: number; telegram_id: number; lang: Lang }
    | undefined;
  if (!user) return null;

  const info = db
    .prepare(`INSERT INTO notifications (user_id, type, title_key, params, link) VALUES (?, ?, ?, ?, ?)`)
    .run(userId, type, `notif.${type}`, toJson(params), link);

  const row = db.prepare(`SELECT * FROM notifications WHERE id = ?`).get(Number(info.lastInsertRowid));
  const notification = mapNotification(row);

  // Ichki markaz — darhol (WebSocket)
  bus.publish(ch.user(userId), { type: 'notification', notification });

  // Telegram push — fon rejimida, xatolik oqimni to'xtatmaydi
  const chatId = opts.push === false ? null : telegramChatFor(user);
  const text = chatId ? PUSH[type]?.[user.lang]?.(params) : null;
  if (text && chatId) {
    const url = link ? `${config.telegram.webappUrl}${link.startsWith('/') ? '' : '/'}${link}` : undefined;
    void sendTelegramMessage(chatId, text, {
      link: url,
      linkLabel: LINK_LABEL[type]?.[user.lang]?.(params) ?? (user.lang === 'ru' ? 'Открыть' : 'Ochish'),
    });
  }

  return notification;
}

export function listNotifications(userId: number, limit = 50): Notification[] {
  const rows = db
    .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
    .all(userId, limit);
  return rows.map(mapNotification);
}

export function unreadCount(userId: number): number {
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`)
    .get(userId) as { n: number };
  return r.n;
}

export function markRead(userId: number, ids?: number[]) {
  if (ids && ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`,
    ).run(userId, ...ids);
  } else {
    db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`).run(userId);
  }
}

/** Klinikaning barcha xodimlariga bildirishnoma. */
/**
 * Xabar QAYSI Telegram chatiga ketadi.
 *
 * Bemorda javob oddiy: uning `telegram_id` si haqiqiy.
 *
 * Klinika xodimi va administratorda esa yo'q. Ularning `users`
 * qatoridagi `telegram_id` MANFIY — u haqiqiy identifikator emas,
 * veb hisob raqamidan yasalgan (webAuth.ts). Shu sababli ularga
 * yuborilgan har bir xabar Telegramdan 400 "chat not found" olib
 * qaytardi, ya'ni klinika botdan HECH QANDAY xabar olmasdi. Yangi
 * so'rov kelganini u faqat kabinetni ochganda bilardi — takliflar
 * kechikishining sabablaridan biri shu.
 *
 * Bog'lovchi halqa — TELEFON RAQAMI. Klinika egasi botga o'z
 * kontaktini ulashgan, ya'ni o'sha raqamli haqiqiy Telegram
 * foydalanuvchisi bazada bor. Shu raqam orqali uning chatini
 * topamiz.
 *
 * `users.phone` xom holda saqlanadi (`+998…`), `admin_users.phone`
 * esa normallashtirilgan — shuning uchun ikkala shakl ham
 * so'raladi. Bu indeks bo'yicha qidiruv: jadvalni to'liq ko'rib
 * chiqmaydi.
 */
function telegramChatFor(user: { telegram_id: number }): number | null {
  if (user.telegram_id > 0) return user.telegram_id;

  const account = db
    .prepare(`SELECT phone FROM admin_users WHERE id = ?`)
    .get(-user.telegram_id) as { phone: string | null } | undefined;
  if (!account?.phone) return null;

  const normalized = normalizePhone(account.phone);
  if (normalized.length < 9) return null;

  const row = db
    .prepare(
      `SELECT telegram_id FROM users
        WHERE telegram_id > 0 AND phone IN (?, ?)
        ORDER BY id DESC LIMIT 1`,
    )
    .get(normalized, `+${normalized}`) as { telegram_id: number } | undefined;

  return row?.telegram_id ?? null;
}

/** Testlar uchun ochiq — chat qanday topilishi alohida tekshiriladi. */
export const telegramChatForTest = telegramChatFor;

export function notifyClinic(
  clinicId: number,
  type: NotificationType,
  params: Params = {},
  link: string | null = null,
) {
  const staff = db.prepare(`SELECT id FROM users WHERE clinic_id = ? AND blocked_at IS NULL`).all(clinicId) as {
    id: number;
  }[];
  for (const s of staff) notify(s.id, type, params, link);
}
