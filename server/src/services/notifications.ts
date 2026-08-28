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
import type { Lang, Notification, NotificationType } from '../../../shared/types';

type Params = Record<string, string | number>;

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
    uz: (p) => `❓ <b>Operatsiya bo'ldimi?</b>\n${p.clinic} bilan bitim. Bo'lgan bo'lsa, qancha to'laganingizni tasdiqlang — bu boshqa bemorlarga real narxni ko'rsatadi.`,
    ru: (p) => `❓ <b>Операция состоялась?</b>\nСделка с «${p.clinic}». Подтвердите сумму — это покажет реальную цену другим пациентам.`,
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
  price_change_proposed: {
    uz: () => `Bitim narxini o‘zgartirish taklif qilindi — ko‘rib chiqing`,
    ru: () => `Предложено изменить цену сделки — посмотрите`,
  },
  price_change_accepted: {
    uz: () => `Yangi narx qabul qilindi`,
    ru: () => `Новая цена принята`,
  },
  price_change_rejected: {
    uz: () => `Yangi narx rad etildi — eski narx kuchda qoladi`,
    ru: () => `Новая цена отклонена — действует прежняя`,
  },
};

export function notify(
  userId: number,
  type: NotificationType,
  params: Params = {},
  link: string | null = null,
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
  const text = PUSH[type]?.[user.lang]?.(params);
  if (text) {
    const url = link ? `${config.telegram.webappUrl}${link.startsWith('/') ? '' : '/'}${link}` : undefined;
    void sendTelegramMessage(user.telegram_id, text, {
      link: url,
      linkLabel: user.lang === 'ru' ? 'Открыть' : 'Ochish',
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
