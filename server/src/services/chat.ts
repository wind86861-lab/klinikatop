/**
 * Chat (8-bo'lim).
 *
 * Kirish nazorati: chat FAQAT bitim yaratilgandan keyin ochiladi — bundan oldin mumkin emas.
 * Bypass himoyasi: telefon raqam / tashqi havola / messenger username avtomatik yashiriladi,
 * chunki bemor va klinika platformadan tashqarida kelishib olmasligi kerak (7-bo'lim).
 */
import { db } from '../db';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { mapMessage } from '../lib/mappers';
import type { ChatMessage } from '../../../shared/types';
import { bus, ch } from './events';
import { notify, notifyClinic } from './notifications';

/**
 * Telefon raqamini narxdan ajratish — bu yerdagi eng nozik joy.
 * Chatda summalar doimo yoziladi ("10800000 so'm"), shuning uchun
 * "uzun son = telefon" qoidasi ishlamaydi: u narxni ham yashirib qo'yadi.
 *
 * Shuning uchun telefon deb faqat quyidagilar hisoblanadi:
 *   1. Xalqaro prefiks: +998901234567
 *   2. Ajratgichli guruhlar: 90 123 45 67 / 90-123-45-67 / (90) 123-45-67
 *   3. Ajratgichsiz 9 xonali, O'zbekiston operator kodi bilan boshlanuvchi son
 * Yalang'och boshqa sonlar (narx, sana, yosh) tegilmaydi.
 */
const UZ_OPERATOR_CODES = ['33', '55', '77', '71', '88', '90', '91', '93', '94', '95', '97', '98', '99'];

const PHONE_PATTERNS: RegExp[] = [
  // +998 90 123 45 67 (ajratgichli yoki ajratgichsiz)
  /\+\d[\d\s\-()]{7,}\d/g,
  // 90 123 45 67 — kamida bitta ajratgich bo'lgan, 7+ raqamli guruh
  /\b\d{2,4}[\s\-()]+\d{2,4}(?:[\s\-()]+\d{2,4}){1,3}\b/g,
];

const LINK_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /(?:https?:\/\/)?(?:t\.me|telegram\.me|wa\.me|instagram\.com)\/\S+/gi, label: '[havola yashirildi]' },
  { re: /https?:\/\/\S+/gi, label: '[havola yashirildi]' },
  { re: /@[a-zA-Z0-9_]{4,}/g, label: '[username yashirildi]' },
];

const PHONE_LABEL = '[raqam yashirildi]';

export function redact(text: string): { body: string; redacted: boolean } {
  let out = text;
  let hit = false;

  for (const { re, label } of LINK_PATTERNS) {
    out = out.replace(re, () => {
      hit = true;
      return label;
    });
  }

  for (const re of PHONE_PATTERNS) {
    out = out.replace(re, (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) return match;
      // "10 800 000" — mingliklarga ajratilgan summa, telefon emas:
      // birinchidan keyingi barcha guruhlar aynan 3 xonali bo'lsa, bu son.
      const groups = match.match(/\d+/g) ?? [];
      if (groups.length >= 2 && groups.slice(1).every((g) => g.length === 3) && !match.includes('+')) {
        return match;
      }
      hit = true;
      return PHONE_LABEL;
    });
  }

  // Ajratgichsiz yalang'och raqam: faqat operator kodi bilan boshlangan 9 xonali
  out = out.replace(/\b\d{9}\b/g, (match) => {
    if (!UZ_OPERATOR_CODES.includes(match.slice(0, 2))) return match;
    hit = true;
    return PHONE_LABEL;
  });

  // "nol to'qson bir..." kabi so'z bilan yozilgan raqamlar bu yerda ushlanmaydi —
  // ularni moderator shikoyat asosida ko'radi.
  return { body: out, redacted: hit };
}

interface DealParties {
  id: number;
  patient_id: number;
  clinic_id: number;
  status: string;
}

function loadDeal(dealId: number): DealParties {
  const row = db.prepare(`SELECT id, patient_id, clinic_id, status FROM deals WHERE id = ?`).get(dealId) as
    | DealParties
    | undefined;
  if (!row) throw notFound('Bitim topilmadi');
  return row;
}

/** Chatga kirish huquqi: faqat bitim tomonlari. */
export function assertChatAccess(dealId: number, userId: number, clinicId: number | null): DealParties {
  const deal = loadDeal(dealId);
  const isPatient = deal.patient_id === userId;
  const isClinic = clinicId != null && deal.clinic_id === clinicId;
  if (!isPatient && !isClinic) throw forbidden('Bu chat sizga ochiq emas');
  return deal;
}

export function listMessages(dealId: number, userId: number, clinicId: number | null, afterId = 0): ChatMessage[] {
  assertChatAccess(dealId, userId, clinicId);
  const rows = db
    .prepare(`SELECT * FROM messages WHERE deal_id = ? AND id > ? ORDER BY id ASC LIMIT 500`)
    .all(dealId, afterId) as any[];
  return rows.map(mapMessage);
}

export interface SendMessageInput {
  dealId: number;
  userId: number;
  clinicId: number | null;
  body: string;
  attachment?: string | null;
  kind?: 'text' | 'image' | 'file';
}

export function sendMessage(input: SendMessageInput): ChatMessage {
  const deal = assertChatAccess(input.dealId, input.userId, input.clinicId);
  if (deal.status === 'CANCELLED') throw forbidden('Bitim bekor qilingan — chat yopiq');

  const raw = (input.body ?? '').trim();
  if (!raw && !input.attachment) throw badRequest('empty_message', 'Xabar bo‘sh');
  if (raw.length > 4000) throw badRequest('message_too_long', 'Xabar juda uzun');

  const { body, redacted } = redact(raw);
  const senderRole = deal.patient_id === input.userId ? 'patient' : 'clinic';

  const info = db
    .prepare(
      `INSERT INTO messages (deal_id, sender_id, sender_role, body, attachment, kind, redacted)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.dealId, input.userId, senderRole, body, input.attachment ?? null, input.kind ?? 'text', redacted ? 1 : 0);

  const message = mapMessage(db.prepare(`SELECT * FROM messages WHERE id = ?`).get(Number(info.lastInsertRowid)));
  bus.publish(ch.deal(input.dealId), { type: 'chat:message', dealId: input.dealId, message });

  const preview = body.length > 60 ? `${body.slice(0, 60)}…` : body || '📎 Fayl';
  if (senderRole === 'patient') {
    const clinic = db.prepare(`SELECT name FROM clinics WHERE id = ?`).get(deal.clinic_id) as { name: string };
    notifyClinic(deal.clinic_id, 'new_message', { from: 'Bemor', preview, clinic: clinic.name }, `/clinic/deals/${input.dealId}`);
  } else {
    const clinic = db.prepare(`SELECT name FROM clinics WHERE id = ?`).get(deal.clinic_id) as { name: string };
    notify(deal.patient_id, 'new_message', { from: clinic.name, preview }, `/deal/${input.dealId}`);
  }

  return message;
}

/** Tizim xabari — bitim bosqichlari chatda ko'rinib tursin. */
export function systemMessage(dealId: number, body: string): void {
  const deal = db.prepare(`SELECT patient_id FROM deals WHERE id = ?`).get(dealId) as { patient_id: number } | undefined;
  if (!deal) return;
  const info = db
    .prepare(`INSERT INTO messages (deal_id, sender_id, sender_role, body, kind) VALUES (?, ?, 'system', ?, 'system')`)
    .run(dealId, deal.patient_id, body);
  const message = mapMessage(db.prepare(`SELECT * FROM messages WHERE id = ?`).get(Number(info.lastInsertRowid)));
  bus.publish(ch.deal(dealId), { type: 'chat:message', dealId, message });
}

export function markMessagesRead(dealId: number, userId: number, clinicId: number | null): number {
  const deal = assertChatAccess(dealId, userId, clinicId);
  const otherRole = deal.patient_id === userId ? 'clinic' : 'patient';
  const res = db
    .prepare(`UPDATE messages SET read_at = datetime('now')
               WHERE deal_id = ? AND sender_role = ? AND read_at IS NULL`)
    .run(dealId, otherRole);
  if (res.changes > 0) bus.publish(ch.deal(dealId), { type: 'chat:read', dealId, userId });
  return res.changes;
}

export function unreadMessageCount(dealId: number, userId: number): number {
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE deal_id = ? AND sender_id != ? AND read_at IS NULL AND kind != 'system'`)
    .get(dealId, userId) as { n: number };
  return r.n;
}
