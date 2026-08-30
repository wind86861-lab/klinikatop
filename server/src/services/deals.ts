/**
 * Tanlov va bitim (7-bo'lim) + tasdiqlash va komissiya (9-bo'lim).
 *
 * TANLANGAN → KELISHILGAN → BAJARILGAN → TASDIQLANGAN
 *      └──(bekor / nizo)──→ BEKOR / NIZO
 */
import { db, nowSql, tx } from '../db';
import { config } from '../lib/config';
import { commissionPercentFor, listSettings } from './terms.business';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { mapClinicPublic, mapDeal, mapOffer } from '../lib/mappers';
import {
  DEAL_TRANSITIONS,
  PAYMENT_METHODS,
  type DealDetail,
  type DealPriceChange,
  type DealStatus,
  type PaymentMethod,
} from '../../../shared/types';
import { bus, ch } from './events';
import { notify, notifyClinic } from './notifications';
import { getRequest, hydrate } from './requests';
import { systemMessage } from './chat';

export function getDeal(id: number): DealDetail {
  const row = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(id) as any;
  if (!row) throw notFound('Bitim topilmadi');
  return hydrateDeal(row);
}

function hydrateDeal(row: any): DealDetail {
  const requestRow = db
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM offers o WHERE o.request_id = r.id AND o.status IN ('SENT','CHOSEN')) AS offers_count
         FROM requests r WHERE r.id = ?`,
    )
    .get(row.request_id);
  const offerRow = db.prepare(`SELECT * FROM offers WHERE id = ?`).get(row.offer_id);
  const clinicRow = db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(row.clinic_id);
  const patient = db.prepare(`SELECT first_name, last_name FROM users WHERE id = ?`).get(row.patient_id) as any;
  const review = db.prepare(`SELECT 1 FROM reviews WHERE deal_id = ?`).get(row.id);

  return {
    ...mapDeal(row),
    request: hydrate(requestRow),
    offer: mapOffer(offerRow),
    clinic: mapClinicPublic(clinicRow),
    patientName: [patient?.first_name, patient?.last_name].filter(Boolean).join(' ') || 'Bemor',
    hasReview: !!review,
  };
}

/** Foydalanuvchi bu bitimning tomonimi — chat va amallar uchun. */
export function assertParticipant(dealId: number, userId: number, clinicId: number | null): DealDetail {
  const deal = getDeal(dealId);
  const isPatient = deal.patientId === userId;
  const isClinic = clinicId != null && deal.clinicId === clinicId;
  if (!isPatient && !isClinic) throw forbidden('Bu bitim sizga tegishli emas');
  return deal;
}

function assertTransition(from: DealStatus, to: DealStatus) {
  if (!DEAL_TRANSITIONS[from].includes(to)) {
    throw conflict('invalid_transition', `Bitim holatini ${from} → ${to} ga o‘zgartirib bo‘lmaydi`);
  }
}

/**
 * 7.1: bemor taklifni tanlaydi.
 *  - deal yaratiladi, so'rov CHOSEN ga o'tadi
 *  - chat AYNAN SHU PAYTDA ochiladi (8.1 — bundan oldin mumkin emas)
 *  - qolgan barcha takliflar avto RAD_ETILDI + klinikalarga bildirishnoma
 */
export function chooseOffer(requestId: number, offerId: number, patientId: number): DealDetail {
  const req = getRequest(requestId);
  if (req.patientId !== patientId) throw forbidden('Bu so‘rov sizniki emas');
  if (req.status !== 'NEW' && req.status !== 'COLLECTING') {
    throw conflict('request_closed', 'Bu so‘rovda tanlov allaqachon qilingan');
  }

  const offer = db.prepare(`SELECT * FROM offers WHERE id = ?`).get(offerId) as any;
  if (!offer || offer.request_id !== requestId) throw notFound('Taklif topilmadi');
  if (offer.status !== 'SENT') throw conflict('offer_unavailable', 'Bu taklif endi mavjud emas');

  const rejected = db
    .prepare(`SELECT id, clinic_id FROM offers WHERE request_id = ? AND id != ? AND status = 'SENT'`)
    .all(requestId, offerId) as { id: number; clinic_id: number }[];

  const dealId = tx(() => {
    db.prepare(`UPDATE offers SET status = 'CHOSEN', updated_at = datetime('now') WHERE id = ?`).run(offerId);
    db.prepare(`UPDATE offers SET status = 'REJECTED', updated_at = datetime('now')
                 WHERE request_id = ? AND id != ? AND status = 'SENT'`).run(requestId, offerId);
    db.prepare(`UPDATE requests SET status = 'CHOSEN', chosen_offer_id = ? WHERE id = ?`).run(offerId, requestId);

    const info = db
      .prepare(
        `INSERT INTO deals (request_id, offer_id, patient_id, clinic_id, agreed_price_uzs, status)
         VALUES (?, ?, ?, ?, ?, 'SELECTED')`,
      )
      .run(requestId, offerId, patientId, offer.clinic_id, offer.price_uzs);
    return Number(info.lastInsertRowid);
  });

  const deal = getDeal(dealId);

  systemMessage(
    dealId,
    `Bemor taklifni tanladi. Kelishilgan narx: ${offer.price_uzs.toLocaleString('ru-RU')} so‘m. ` +
      `Muloqot faqat shu chat orqali olib boriladi.`,
  );

  bus.publish(ch.request(requestId), { type: 'request:status', requestId, status: 'CHOSEN' });
  bus.publish(ch.deal(dealId), { type: 'deal:status', dealId, status: 'SELECTED' });

  notifyClinic(offer.clinic_id, 'offer_chosen', { operation: req.operation.nameUz }, `/clinic/deals/${dealId}`);
  for (const r of rejected) {
    notifyClinic(r.clinic_id, 'offer_rejected', { operation: req.operation.nameUz }, `/clinic/offers`);
  }

  return deal;
}

/** Sana kelishildi → KELISHILGAN. */
export function agreeSchedule(dealId: number, userId: number, clinicId: number | null, scheduledAt: string): DealDetail {
  const deal = assertParticipant(dealId, userId, clinicId);
  assertTransition(deal.status, 'AGREED');

  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) throw badRequest('invalid_date', 'Sana noto‘g‘ri');

  /*
   * Operatsiya o'tgan kunga belgilanmaydi.
   *
   * Ilgari bu tekshirilmasdi va bitimda kechagi sana turib qolardi —
   * bemor uni ko'rib, o'tkazib yuborganman deb o'ylardi.
   *
   * Bugun ruxsat etiladi: shoshilinch holatda operatsiya shu kuni
   * bo'lishi mumkin va uni kelishib bo'lgach yozib qo'yish kerak.
   */
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (when.getTime() < startOfToday.getTime()) {
    throw badRequest('date_in_past', 'O‘tgan sanaga operatsiya belgilab bo‘lmaydi');
  }

  db.prepare(`UPDATE deals SET scheduled_at = ?, status = 'AGREED' WHERE id = ?`).run(
    when.toISOString().replace('T', ' ').slice(0, 19),
    dealId,
  );

  systemMessage(dealId, `Operatsiya sanasi kelishildi: ${when.toLocaleDateString('uz-UZ')}`);
  bus.publish(ch.deal(dealId), { type: 'deal:status', dealId, status: 'AGREED' });
  return getDeal(dealId);
}

/** Operatsiya bajarildi — klinika belgilaydi (7.2). */
export function markPerformed(dealId: number, clinicId: number): DealDetail {
  const deal = getDeal(dealId);
  if (deal.clinicId !== clinicId) throw forbidden('Bu bitim sizniki emas');
  assertTransition(deal.status, 'PERFORMED');

  db.prepare(`UPDATE deals SET status = 'PERFORMED', performed_at = datetime('now'),
                               confirm_prompted_at = datetime('now') WHERE id = ?`).run(dealId);

  systemMessage(dealId, 'Klinika operatsiya bajarilganini belgiladi. Bemordan tasdiq so‘raldi.');
  bus.publish(ch.deal(dealId), { type: 'deal:status', dealId, status: 'PERFORMED' });

  // 9.1: platforma bemordan so'raydi — "Bo'ldimi? Qancha to'lading?"
  notify(deal.patientId, 'confirm_prompt', { clinic: deal.clinic.name }, `/deal/${dealId}/confirm`);
  return getDeal(dealId);
}

/**
 * 9.1: bemor to'lovni bildiradi → `PAID`.
 *
 * Bu bitimni YOPMAYDI. Ilgari shunday edi: bemor summani aytishi bilan
 * bitim `CONFIRMED` bo'lib, komissiya hisoblanardi. Klinika pulni
 * haqiqatan olganini hech kim tasdiqlamasdi — ya'ni unga faqat
 * bemorning gapiga asoslanib komissiya yozilardi.
 *
 * Summani AYNAN bemor aytadi va bu ataylab: summa komissiya bazasi,
 * shuning uchun klinikaga uni pasaytirish foydali bo'lardi, bemorda
 * esa oshirishga sabab yo'q. Klinika rozi bo'lmasa nizo ochadi.
 */
export function declarePayment(
  dealId: number,
  patientId: number,
  amountUzs: number,
  method: PaymentMethod | null = null,
): DealDetail {
  const deal = getDeal(dealId);
  if (deal.patientId !== patientId) throw forbidden('Bu bitim sizniki emas');
  if (deal.status !== 'PERFORMED' && deal.status !== 'AGREED') {
    throw conflict('not_payable', 'Bu bitim bo‘yicha hozir to‘lov bildirib bo‘lmaydi');
  }
  if (!Number.isFinite(amountUzs) || amountUzs < 100_000 || amountUzs > 2_000_000_000) {
    throw badRequest('invalid_amount', 'Summa noto‘g‘ri');
  }
  if (method !== null && !PAYMENT_METHODS.includes(method)) {
    throw badRequest('invalid_method', 'To‘lov usuli noto‘g‘ri');
  }

  db.prepare(
    `UPDATE deals SET status = 'PAID', confirmed_amount_uzs = ?, payment_method = ?,
                      paid_at = ? WHERE id = ?`,
  ).run(Math.round(amountUzs), method, nowSql(), dealId);

  systemMessage(dealId, `Bemor to‘lovni bildirdi: ${Math.round(amountUzs).toLocaleString('uz-UZ')} so‘m. Klinikaning tasdig‘i kutilmoqda.`);
  bus.publish(ch.deal(dealId), { type: 'deal:status', dealId, status: 'PAID' });
  notifyClinic(deal.clinicId, 'payment_declared', { dealId }, `/clinic/deals/${dealId}`);

  return getDeal(dealId);
}

/**
 * 9.2: klinika pulni olganini tasdiqlaydi → `CONFIRMED`.
 *
 * Shu yerda va faqat shu yerda komissiya hisoblanadi, bitim yopiladi
 * va bemor bonus oladi.
 *
 * Klinika SUMMANI o'zgartira olmaydi — u faqat "oldim" deydi. Rozi
 * bo'lmasa nizo ochadi va moderator qaraydi.
 */
export function confirmReceipt(dealId: number, clinicId: number): DealDetail {
  const deal = getDeal(dealId);
  if (deal.clinicId !== clinicId) throw forbidden('Bu bitim sizniki emas');
  if (deal.status !== 'PAID') {
    throw conflict('not_confirmable', 'Bu bitimni hozir tasdiqlab bo‘lmaydi');
  }

  const amount = deal.confirmedAmountUzs;
  if (amount == null) throw conflict('no_amount', 'To‘lov summasi yo‘q');

  closeDeal(dealId, amount, deal.clinicId, deal.requestId, deal.patientId, { bonus: true });
  systemMessage(dealId, 'Klinika to‘lovni olganini tasdiqladi. Bitim yopildi.');
  notify(deal.patientId, 'payment_confirmed', { clinic: deal.clinic.name }, `/deal/${dealId}`);

  return getDeal(dealId);
}

/**
 * Bitimni yopish — komissiya, statistika va bonus bitta joyda.
 *
 * Uch joydan chaqiriladi (klinika tasdig'i va ikkita avtomatik yopish),
 * shuning uchun mantiq takrorlanmasligi kerak: komissiya foizi qanday
 * olinishi va nima yangilanishi bitta joyda tursin.
 */
function closeDeal(
  dealId: number,
  amountUzs: number,
  clinicId: number,
  requestId: number,
  patientId: number,
  opts: { bonus: boolean; auto?: boolean },
): void {
  // Foiz shu klinika uchun amaldagi qiymatdan olinadi va bitimga YOZIB
  // qo'yiladi — keyin admin foizni o'zgartirsa eski bitim qayta hisoblanmaydi
  const percent = commissionPercentFor(clinicId);
  const commission = Math.round((amountUzs * percent) / 100);

  tx(() => {
    db.prepare(
      `UPDATE deals SET status = 'CONFIRMED', confirmed_amount_uzs = ?, commission_uzs = ?,
                        commission_percent = ?, confirmed_at = ?, receipt_confirmed_at = ?,
                        auto_confirmed = ?
        WHERE id = ?`,
    ).run(Math.round(amountUzs), commission, percent, nowSql(), nowSql(), opts.auto ? 1 : 0, dealId);

    db.prepare(`UPDATE requests SET status = 'COMPLETED' WHERE id = ?`).run(requestId);
    db.prepare(`UPDATE clinics SET deals_count = deals_count + 1 WHERE id = ?`).run(clinicId);

    // 9.3: tasdiqlaganlik uchun rag'bat — avtomatik yopishda berilmaydi
    if (opts.bonus) {
      db.prepare(`UPDATE users SET bonus_points = bonus_points + ? WHERE id = ?`).run(
        config.rules.confirmBonusPoints,
        patientId,
      );
    }
  });

  bus.publish(ch.deal(dealId), { type: 'deal:status', dealId, status: 'CONFIRMED' });
  bus.publish(ch.request(requestId), { type: 'request:status', requestId, status: 'COMPLETED' });
  if (opts.bonus) {
    notify(patientId, 'bonus_earned', { points: config.rules.confirmBonusPoints }, `/deal/${dealId}`);
  }
}

/** Bemor "yo'q" desa yoki kelishmovchilik bo'lsa → NIZO, moderatorga. */
export function openDispute(dealId: number, userId: number, clinicId: number | null, reason: string): DealDetail {
  const deal = assertParticipant(dealId, userId, clinicId);
  assertTransition(deal.status, 'DISPUTED');

  db.prepare(`UPDATE deals SET status = 'DISPUTED', dispute_reason = ? WHERE id = ?`).run(reason, dealId);
  systemMessage(dealId, 'Nizo ochildi. Moderator ko‘rib chiqadi.');
  bus.publish(ch.deal(dealId), { type: 'deal:status', dealId, status: 'DISPUTED' });

  notify(deal.patientId, 'dispute_opened', {}, `/deal/${dealId}`);
  notifyClinic(deal.clinicId, 'dispute_opened', {}, `/clinic/deals/${dealId}`);
  return getDeal(dealId);
}

/**
 * 7.3: klinika javob bermasa yoki bemor fikrini o'zgartirsa —
 * bitim bekor qilinadi va bemor qayta so'rov ocha oladi.
 */
export function cancelDeal(dealId: number, userId: number, clinicId: number | null, reason: string): DealDetail {
  const deal = assertParticipant(dealId, userId, clinicId);
  assertTransition(deal.status, 'CANCELLED');

  tx(() => {
    db.prepare(`UPDATE deals SET status = 'CANCELLED', dispute_reason = ? WHERE id = ?`).run(reason, dealId);
    db.prepare(`UPDATE offers SET status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`).run(deal.offerId);
    db.prepare(`UPDATE requests SET status = 'CANCELLED' WHERE id = ?`).run(deal.requestId);
  });

  systemMessage(dealId, `Bitim bekor qilindi. Sabab: ${reason}`);
  bus.publish(ch.deal(dealId), { type: 'deal:status', dealId, status: 'CANCELLED' });
  bus.publish(ch.request(deal.requestId), { type: 'request:status', requestId: deal.requestId, status: 'CANCELLED' });
  return getDeal(dealId);
}

export function listPatientDeals(patientId: number): DealDetail[] {
  const rows = db.prepare(`SELECT * FROM deals WHERE patient_id = ? ORDER BY id DESC`).all(patientId) as any[];
  return rows.map(hydrateDeal);
}

export function listClinicDeals(clinicId: number): DealDetail[] {
  const rows = db.prepare(`SELECT * FROM deals WHERE clinic_id = ? ORDER BY id DESC`).all(clinicId) as any[];
  return rows.map(hydrateDeal);
}

/**
 * 9.2 chekka holat: bemor N kun javob bermasa — avto eslatma.
 * (Keyingi qadam — klinika o'zi belgilaydi, moderator tekshiruvi bilan.)
 */
export function remindPendingConfirmations(): number {
  const rows = db
    .prepare(
      `SELECT * FROM deals
        WHERE status = 'PERFORMED'
          AND confirm_prompted_at <= datetime('now', ?)`,
    )
    .all(`-${config.rules.confirmReminderDays} days`) as any[];

  for (const row of rows) {
    const deal = hydrateDeal(row);
    notify(deal.patientId, 'confirm_prompt', { clinic: deal.clinic.name }, `/deal/${deal.id}/confirm`);
    db.prepare(`UPDATE deals SET confirm_prompted_at = datetime('now') WHERE id = ?`).run(row.id);
  }
  return rows.length;
}


/**
 * Javobsiz qolgan bitimlarni avtomatik yopish.
 *
 * Muammo: komissiya faqat bemor tasdiqlaganda olinadi. Shuning uchun
 * "tasdiqlamaslik" ikkala tomon uchun ham foydali bo'lib qolardi va
 * platforma bajarilgan operatsiyadan hech narsa olmasdi.
 *
 * Yechim: klinika "bajarildi" deb belgilagach soat ishlaydi. Belgilangan
 * kun ichida bemor tasdiqlamasa VA nizo ochmasa — bitim kelishilgan narx
 * bo'yicha avtomatik yopiladi.
 *
 * Bu adolatli, chunki:
 *   • bemor bir necha marta eslatma oladi
 *   • rozi bo'lmasa istalgan payt nizo ochishi mumkin
 *   • summa kelishilgan narxdan olinadi, klinika aytganidan emas
 *   • bitim `auto_confirmed` deb belgilanadi — statistikada ajratiladi
 *
 * Avtomatik yopilgan bitim sharh so'ramaydi va bonus ball bermaydi:
 * bemor hech narsa qilmagan, rag'batlantiradigan xatti-harakat yo'q.
 */
export function autoConfirmStaleDeals(): number {
  const settings = listSettings();
  const cutoff = `-${settings.autoConfirmDays} days`;
  let closed = 0;

  /*
   * 1-oyoq: bemor to'lovni bildirmadi.
   * Summa KELISHILGAN narxdan olinadi — klinika aytganidan emas.
   */
  const silentPatients = db
    .prepare(
      `SELECT id, clinic_id, request_id, agreed_price_uzs, patient_id
         FROM deals
        WHERE status = 'PERFORMED'
          AND performed_at IS NOT NULL
          AND performed_at <= datetime('now', ?)`,
    )
    .all(cutoff) as any[];

  for (const row of silentPatients) {
    closeDeal(row.id, row.agreed_price_uzs, row.clinic_id, row.request_id, row.patient_id, {
      bonus: false,
      auto: true,
    });
    notify(row.patient_id, 'deal_auto_confirmed', { dealId: row.id }, `/deal/${row.id}`);
    notifyClinic(row.clinic_id, 'deal_auto_confirmed', { dealId: row.id }, `/clinic/deals/${row.id}`);
    closed += 1;
  }

  /*
   * 2-oyoq: bemor to'ladi, lekin klinika tasdiqlamadi.
   *
   * Busiz jim turish klinikaga FOYDALI bo'lardi: tasdiqlamasa
   * komissiya ham hisoblanmasdi. Shuning uchun soat bu yerda ham
   * ishlaydi va summa bemor aytgan qiymatdan olinadi.
   */
  const silentClinics = db
    .prepare(
      `SELECT id, clinic_id, request_id, confirmed_amount_uzs, patient_id
         FROM deals
        WHERE status = 'PAID'
          AND paid_at IS NOT NULL
          AND paid_at <= datetime('now', ?)`,
    )
    .all(cutoff) as any[];

  for (const row of silentClinics) {
    if (row.confirmed_amount_uzs == null) continue;
    closeDeal(row.id, row.confirmed_amount_uzs, row.clinic_id, row.request_id, row.patient_id, {
      bonus: false,
      auto: true,
    });
    notify(row.patient_id, 'deal_auto_confirmed', { dealId: row.id }, `/deal/${row.id}`);
    notifyClinic(row.clinic_id, 'deal_auto_confirmed', { dealId: row.id }, `/clinic/deals/${row.id}`);
    closed += 1;
  }

  return closed;
}

/* ═════════════════  Narxning o'zgarishi  ═════════════════ */

/**
 * Klinika xodimlari — narx taklifiga kim javob bera oladi.
 *
 * Klinika nomidan har qanday xodimi ish ko'ra oladi: bitta odamga
 * bog'lab qo'yilsa, u ta'tilga chiqqanda bemor javob kutib qolardi.
 */
function clinicMemberIds(clinicId: number): number[] {
  return (
    db.prepare(`SELECT id FROM users WHERE clinic_id = ? AND blocked_at IS NULL`).all(clinicId) as {
      id: number;
    }[]
  ).map((r) => r.id);
}

/**
 * Bitim narxini o'zgartirish — IKKI TOMON roziligi bilan.
 *
 * ═══ Nima uchun alohida jarayon ═══
 *
 * Hayotda narx o'zgaradi: tekshiruvda qo'shimcha muammo chiqadi, yoki
 * aksincha, rejalashtirilgan bosqich kerak bo'lmay qoladi. Ilgari bunga
 * yagona yo'l bor edi — tasdiqlash paytida boshqa summa kiritish. U
 * yomon edi:
 *
 *   • kim rozi bo'lgani hech qayerda qolmasdi
 *   • bemor "shunday kelishgandik" deb, klinika "yo'q" deb aytardi va
 *     moderatorda dalil bo'lmasdi
 *   • avtomatik tasdiqlash eski narxda ishlab ketardi
 *
 * Endi o'zgarish taklif qilinadi, ikkinchi tomon qabul qiladi yoki rad
 * etadi, va har qadam yozib boriladi.
 *
 * ═══ Moliyaviy tomoni ═══
 *
 * Komissiya HAR DOIM oxirgi kelishilgan narxdan hisoblanadi. Foiz esa
 * tasdiqlash paytidagi qiymatdan olinadi va bitimga yozib qo'yiladi —
 * admin keyin foizni o'zgartirsa eski bitim qayta hisoblanmaydi.
 */
export interface ProposePriceChangeInput {
  dealId: number;
  /** Kim taklif qilyapti */
  actorId: number;
  newPriceUzs: number;
  reason: string;
}

export function proposePriceChange(input: ProposePriceChangeInput): DealPriceChange {
  const deal = getDeal(input.dealId);

  const isPatient = deal.patientId === input.actorId;
  const isClinic = clinicMemberIds(deal.clinicId).includes(input.actorId);
  if (!isPatient && !isClinic) throw forbidden('Bu bitim sizniki emas');

  /*
   * Narx faqat ish BAJARILGUNCHA o'zgaradi.
   *
   * Bajarilgandan keyin o'zgartirish — bu allaqachon qilingan ishning
   * narxini keyin ko'tarish demak. Agar haqiqatan farq bo'lsa, nizo
   * ochiladi va moderator hal qiladi.
   */
  if (deal.status !== 'SELECTED' && deal.status !== 'AGREED') {
    throw conflict('price_locked', 'Bu bosqichda narxni o‘zgartirib bo‘lmaydi');
  }

  const price = Math.round(input.newPriceUzs);
  if (!Number.isFinite(price) || price < 100_000 || price > 2_000_000_000) {
    throw badRequest('invalid_price', 'Narx noto‘g‘ri');
  }
  if (price === deal.agreedPriceUzs) {
    throw badRequest('same_price', 'Narx o‘zgarmadi');
  }

  const reason = (input.reason ?? '').trim();
  if (reason.length < 10) {
    throw badRequest('reason_required', 'Nima uchun o‘zgarayotganini tushuntiring');
  }

  // Bir vaqtda bitta kutilayotgan taklif — aks holda qaysi biri
  // qabul qilinishi noaniq bo'lardi (bazada ham noyob indeks bor)
  const pending = db
    .prepare(`SELECT id FROM deal_price_changes WHERE deal_id = ? AND status = 'pending'`)
    .get(input.dealId);
  if (pending) throw conflict('change_pending', 'Avvalgi taklif hali javobsiz');

  const proposedBy = isPatient ? 'patient' : 'clinic';

  const info = db
    .prepare(
      `INSERT INTO deal_price_changes (deal_id, from_uzs, to_uzs, reason, proposed_by)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.dealId, deal.agreedPriceUzs, price, reason.slice(0, 400), proposedBy);

  // Ikkinchi tomonga xabar — javob kutilyapti
  if (isPatient) {
    notifyClinic(deal.clinicId, 'price_change_proposed', { dealId: input.dealId }, `/clinic/deals/${input.dealId}`);
  } else {
    notify(deal.patientId, 'price_change_proposed', { dealId: input.dealId }, `/deal/${input.dealId}`);
  }

  bus.publish(ch.deal(input.dealId), { type: 'deal:status', dealId: input.dealId, status: deal.status });

  return getPriceChange(Number(info.lastInsertRowid));
}

/**
 * Taklifga javob.
 *
 * Qabul qilinsa bitim narxi yangilanadi. Rad etilsa eski narx qoladi —
 * bitim bekor bo'lmaydi: tomonlar yana gaplashishi mumkin.
 */
export function respondToPriceChange(
  changeId: number,
  actorId: number,
  accept: boolean,
): DealPriceChange {
  const change = getPriceChange(changeId);
  if (change.status !== 'pending') throw conflict('already_decided', 'Bu taklifga javob berilgan');

  const deal = getDeal(change.dealId);
  const isPatient = deal.patientId === actorId;
  const isClinic = clinicMemberIds(deal.clinicId).includes(actorId);
  if (!isPatient && !isClinic) throw forbidden('Bu bitim sizniki emas');

  /*
   * Javobni faqat IKKINCHI tomon beradi. Aks holda taklif qilgan
   * tomon o'zi qabul qilib, narxni bir tomonlama o'zgartirardi —
   * butun jarayonning ma'nosi shunda yo'qolardi.
   */
  const responderSide = isPatient ? 'patient' : 'clinic';
  if (responderSide === change.proposedBy) {
    throw forbidden('Javobni ikkinchi tomon beradi');
  }

  tx(() => {
    db.prepare(
      `UPDATE deal_price_changes SET status = ?, decided_at = datetime('now') WHERE id = ?`,
    ).run(accept ? 'accepted' : 'rejected', changeId);

    if (accept) {
      db.prepare(`UPDATE deals SET agreed_price_uzs = ? WHERE id = ?`).run(change.toUzs, change.dealId);
    }
  });

  const target = change.proposedBy === 'patient' ? deal.patientId : null;
  if (target) {
    notify(target, accept ? 'price_change_accepted' : 'price_change_rejected', { dealId: change.dealId }, `/deal/${change.dealId}`);
  } else {
    notifyClinic(
      deal.clinicId,
      accept ? 'price_change_accepted' : 'price_change_rejected',
      { dealId: change.dealId },
      `/clinic/deals/${change.dealId}`,
    );
  }

  bus.publish(ch.deal(change.dealId), { type: 'deal:status', dealId: change.dealId, status: deal.status });

  return getPriceChange(changeId);
}

export function getPriceChange(id: number): DealPriceChange {
  const row = db.prepare(`SELECT * FROM deal_price_changes WHERE id = ?`).get(id) as any;
  if (!row) throw notFound('Narx taklifi topilmadi');
  return mapPriceChange(row);
}

/** Bitim bo'yicha narx tarixi — eng yangisi birinchi. */
export function listPriceChanges(dealId: number): DealPriceChange[] {
  return (
    db.prepare(`SELECT * FROM deal_price_changes WHERE deal_id = ? ORDER BY id DESC`).all(dealId) as any[]
  ).map(mapPriceChange);
}

function mapPriceChange(r: any): DealPriceChange {
  return {
    id: r.id,
    dealId: r.deal_id,
    fromUzs: r.from_uzs,
    toUzs: r.to_uzs,
    reason: r.reason,
    proposedBy: r.proposed_by,
    status: r.status,
    createdAt: new Date(r.created_at.replace(' ', 'T') + 'Z').toISOString(),
    decidedAt: r.decided_at ? new Date(r.decided_at.replace(' ', 'T') + 'Z').toISOString() : null,
  };
}
