/**
 * Yangi bron — hisobot guruhiga Telegram xabari.
 *
 * Bemor taklifni tanlab bitim ochilgan zahoti (`chooseOffer`) KlinikaTop
 * boti guruhga qisqa xabar yozadi: qaysi klinika, qanday xizmat, narx
 * va sana. Shifokor yo'naltirgan bo'lsa — qaysi shifokor.
 *
 * Guruhda bir necha kishi bor, shuning uchun bemor haqida MINIMUM:
 * ism va familiyaning bosh harfi, yosh. Telefon, kasallik tavsifi,
 * hujjatlar — yo'q. Ular admin panelda, kirish nazorati bilan.
 *
 * Xabar ketmasa bitim baribir ochiladi — bu hisobot, jarayon qismi emas.
 */
import { db } from '../db';
import { config } from '../lib/config';
import { sendTelegramMessage } from '../lib/telegram';
import { ageFromBirthYear } from '../../../shared/types';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "Alisher Valiyev" → "Alisher V." */
function shortName(first: string | null, last: string | null): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  return [f, l ? `${l[0]}.` : ''].filter(Boolean).join(' ') || '—';
}

function reportChat(): number | null {
  const raw = config.telegram.reportChatId || config.telegram.adminAlertChatId;
  const id = Number(raw);
  return raw && Number.isFinite(id) && id !== 0 ? id : null;
}

/** Xabar matni — alohida, sinash uchun */
export function bookingReportText(dealId: number, serviceTitle: string): string | null {
  const row = db
    .prepare(
      `SELECT d.id, d.agreed_price_uzs, d.scheduled_at,
              c.name AS clinic_name, ci.name_uz AS city_name,
              u.first_name, u.last_name, u.birth_year,
              r.for_self, r.subject_name, r.subject_birth_year, r.kind,
              rd.first_name AS doc_first, rd.last_name AS doc_last
         FROM deals d
         JOIN clinics c ON c.id = d.clinic_id
         LEFT JOIN cities ci ON ci.id = c.city_id
         JOIN users u ON u.id = d.patient_id
         JOIN requests r ON r.id = d.request_id
         LEFT JOIN doctor_cases dc ON dc.id = r.doctor_case_id
         LEFT JOIN referring_doctors rd ON rd.id = dc.doctor_id
        WHERE d.id = ?`,
    )
    .get(dealId) as any;
  if (!row) return null;

  const forOther = row.for_self === 0;
  const age = ageFromBirthYear(forOther ? row.subject_birth_year : row.birth_year);
  const patient = forOther
    ? `${esc(row.subject_name ?? '—')} (yaqini uchun — ${esc(shortName(row.first_name, row.last_name))})`
    : esc(shortName(row.first_name, row.last_name));
  const day = String(row.scheduled_at ?? '').slice(0, 10);
  const date = day ? day.split('-').reverse().join('.') : '—';
  const price = Number(row.agreed_price_uzs ?? 0).toLocaleString('ru-RU').replace(/,/g, ' ');

  const lines = [
    `🆕 <b>Yangi bron #${row.id}</b>`,
    '',
    `🏥 Klinika: <b>${esc(row.clinic_name)}</b>${row.city_name ? ` (${esc(row.city_name)})` : ''}`,
    `🩺 Xizmat: ${esc(serviceTitle)}`,
    `💰 Narx: <b>${price} so‘m</b>`,
    `📅 Sana: ${date}`,
    `👤 Bemor: ${patient}${age != null ? `, ${age} yosh` : ''}`,
  ];
  if (row.doc_first || row.doc_last) {
    lines.push(`👨‍⚕️ Shifokor tavsiyasi: ${esc(`${row.doc_first ?? ''} ${row.doc_last ?? ''}`.trim())}`);
  }
  return lines.join('\n');
}

export function reportNewBooking(dealId: number, serviceTitle: string): void {
  const chat = reportChat();
  if (!chat || !config.telegram.botToken) return;
  try {
    const text = bookingReportText(dealId, serviceTitle);
    if (text) void sendTelegramMessage(chat, text);
  } catch (err) {
    console.error('[booking-report] xabar tayyorlanmadi:', err);
  }
}
