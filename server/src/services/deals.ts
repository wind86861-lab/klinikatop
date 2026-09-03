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
export function chooseOffer(
  requestId: number,
  offerId: number,
  patientId: number,
  /**
   * Operatsiya sanasi — TANLASH PAYTIDA belgilanadi.
   *
   * Ilgari bitim sanasiz ochilar, keyin alohida "Sana belgilash"
   * bosqichi bo'lardi. Ya'ni bemor allaqachon tanlab bo'lgach,
   * kunni kelishish uchun yana muzokara boshlanardi — va sana
   * to'g'ri kelmasa bitimni buzishdan boshqa yo'l qolmasdi.
   *
   * Endi tartib teskari: klinika taklifida aniq kunlarni beradi,
   * bemor esa o'ziga qulayini TANLOV BILAN BIRGA belgilaydi.
   * Bitim boshidanoq kelishilgan sana bilan ochiladi.
   */
  scheduledAt: string,
): DealDetail {
  const req = getRequest(requestId);
  if (req.patientId !== patientId) throw forbidden('Bu so‘rov sizniki emas');
  if (req.status !== 'NEW' && req.status !== 'COLLECTING') {
    throw conflict('request_closed', 'Bu so‘rovda tanlov allaqachon qilingan');
  }

  const offer = db.prepare(`SELECT * FROM offers WHERE id = ?`).get(offerId) as any;
  if (!offer || offer.request_id !== requestId) throw notFound('Taklif topilmadi');
  if (offer.status !== 'SENT') throw conflict('offer_unavailable', 'Bu taklif endi mavjud emas');

  /*
   * Sana KLINIKA TAKLIF QILGANLARIDAN bo'lishi shart.
   *
   * Aks holda bemor ixtiyoriy kun yozib qo'yardi va klinika o'sha
   * kuni band bo'lishi mumkin edi — bu esa yana kelishuvga qaytarardi.
   */
  const proposed: string[] = JSON.parse(offer.proposed_dates ?? '[]');
  const day = (scheduledAt ?? '').slice(0, 10);
  if (!proposed.includes(day)) {
    throw badRequest('date_not_offered', 'Klinika taklif qilgan kunlardan birini tanlang');
  }

  const rejected = db
    .prepare(`SELECT id, clinic_id FROM offers WHERE request_id = ? AND id != ? AND status = 'SENT'`)
    .all(requestId, offerId) as { id: number; clinic_id: number }[];

  const dealId = tx(() => {
    db.prepare(`UPDATE offers SET status = 'CHOSEN', updated_at = datetime('now') WHERE id = ?`).run(offerId);
    db.prepare(`UPDATE offers SET status = 'REJECTED', updated_at = datetime('now')
                 WHERE request_id = ? AND id != ? AND status = 'SENT'`).run(requestId, offerId);
    db.prepare(`UPDATE requests SET status = 'CHOSEN', chosen_offer_id = ? WHERE id = ?`).run(offerId, requestId);

    /*
     * Operatsiya "noma'lum" bo'lgan so'rov SHU YERDA aniqlanadi.
     *
     * Bir necha klinika har xil operatsiya taklif qilgan bo'lishi
     * mumkin; qaysi biri to'g'ri ekanini bemor tanlovi hal qiladi.
     * Shundan keyin bitim summasi to'g'ri operatsiyaga yoziladi va
     * narx statistikasi uni ko'radi — busiz "bu operatsiya qanchaga
     * ketdi" degan savolga javob qolmasdi.
     */
    if (offer.resolved_operation_id) {
      db.prepare(
        `UPDATE requests SET operation_id = ?, fallback_category_id = NULL WHERE id = ?`,
      ).run(offer.resolved_operation_id, requestId);
    }

    const info = db
      .prepare(
        `INSERT INTO deals (request_id, offer_id, patient_id, clinic_id, agreed_price_uzs,
                            status, scheduled_at)
         VALUES (?, ?, ?, ?, ?, 'AGREED', ?)`,
      )
      .run(requestId, offerId, patientId, offer.clinic_id, offer.price_uzs, `${day} 09:00:00`);
    return Number(info.lastInsertRowid);
  });

  const deal = getDeal(dealId);

  systemMessage(
    dealId,
    `Bemor taklifni tanladi. Kelishilgan narx: ${offer.price_uzs.toLocaleString('ru-RU')} so‘m. ` +
      `Operatsiya sanasi: ${day}. Muloqot faqat shu chat orqali olib boriladi.`,
  );

  bus.publish(ch.request(requestId), { type: 'request:status', requestId, status: 'CHOSEN' });
  bus.publish(ch.deal(dealId), { type: 'deal:status', dealId, status: 'AGREED' });

  notifyClinic(offer.clinic_id, 'offer_chosen', { operation: req.operation.nameUz }, `/clinic/deals/${dealId}`);
  for (const r of rejected) {
    notifyClinic(r.clinic_id, 'offer_rejected', { operation: req.operation.nameUz }, `/clinic/offers`);
  }

  return deal;
}

/*
 * Alohida "Sana belgilash" bosqichi OLIB TASHLANDI.
 *
 * U bitim tuzilgandan KEYIN turardi: bemor tanlab bo'lgach, kunni
 * kelishish uchun yana muzokara boshlanar va sana to'g'ri kelmasa
 * bitimni buzishdan boshqa yo'l qolmasdi.
 *
 * Endi sana tanlov bilan birga belgilanadi (`chooseOffer`), ya'ni
 * bitim boshidanoq kelishilgan kun bilan ochiladi.
 */

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
  if (deal.status !== 'AGREED') {
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
 * 9.2: klinika bitimni yakunlaydi → `CONFIRMED`.
 *
 * Bu OXIRGI bosqich va u ikki narsani birdan tasdiqlaydi: pul olindi
 * va operatsiya bajarildi. Ilgari bular alohida ikki bosqich edi —
 * klinika avval "bajarildi" deb belgilar, oxirida yana "pulni oldim"
 * derdi. Ish tugagandan keyin ikki marta tasdiqlash ortiqcha.
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
  systemMessage(dealId, 'Klinika to‘lovni olganini va operatsiya bajarilganini tasdiqladi. Bitim yopildi.');
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
 * 9.2 chekka holat: to'lov bildirilmagan bitimlarga eslatma.
 *
 * Operatsiya sanasi kelib o'tdi, lekin bemor to'lovni bildirmadi.
 * Ilgari soat klinikaning "bajarildi" belgisidan boshlanardi; endi
 * bunday belgi yo'q, shuning uchun KELISHILGAN SANA boshlaydi.
 *
 * `confirm_prompted_at` bo'sh bo'lishi mumkin — birinchi eslatma hali
 * yuborilmagan. `NULL <= …` har doim yolg'on bo'lgani uchun uni alohida
 * hisobga olish kerak, aks holda birinchi eslatma hech qachon
 * ketmasdi.
 */
export function remindPendingConfirmations(): number {
  const rows = db
    .prepare(
      `SELECT * FROM deals
        WHERE status = 'AGREED'
          AND scheduled_at IS NOT NULL
          AND scheduled_at <= datetime('now')
          AND (confirm_prompted_at IS NULL OR confirm_prompted_at <= datetime('now', ?))`,
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
 * Muammo: komissiya faqat bitim yopilganda olinadi. Shuning uchun
 * jim turish tomonlarga foydali bo'lib qolardi va platforma
 * bajarilgan operatsiyadan hech narsa olmasdi.
 *
 * Yechim: bemor to'lovni bildirgach soat ishlaydi. Belgilangan kun
 * ichida klinika tasdiqlamasa VA nizo ochmasa — bitim bemor aytgan
 * summa bo'yicha avtomatik yopiladi.
 *
 * ILGARI ikkinchi oyoq ham bor edi: klinika "bajarildi" deb
 * belgilagandan keyin bemor jim qolsa, bitim kelishilgan narx bo'yicha
 * yopilardi. Endi bunday belgi yo'q — to'lov birinchi bosqich bo'lib
 * qoldi. To'lovi bildirilmagan bitimni avtomatik yopish esa hech kim
 * "bo'ldi" demagan ish uchun komissiya yozish bo'lardi. Bunday
 * holatlar uchun NIZO yo'li bor: klinika ochadi, moderator qaraydi.
 *
 * Avtomatik yopilgan bitim sharh so'ramaydi va bonus ball bermaydi:
 * bemor hech narsa qilmagan, rag'batlantiradigan xatti-harakat yo'q.
 */
export function autoConfirmStaleDeals(): number {
  const settings = listSettings();
  const cutoff = `-${settings.autoConfirmDays} days`;
  let closed = 0;

  /*
   * Bemor to'ladi, lekin klinika tasdiqlamadi.
   *
   * Busiz jim turish klinikaga FOYDALI bo'lardi: tasdiqlamasa
   * komissiya ham hisoblanmasdi. Shuning uchun soat ishlaydi va
   * summa bemor aytgan qiymatdan olinadi.
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

/*
 * Narxni o'zgartirish bo'limi OLIB TASHLANDI.
 *
 * U ikki tomon roziligi bilan ishlardi va o'zi to'g'ri qurilgan edi,
 * lekin oqimda o'rni yo'q: bemor taklifni AYNAN narxiga qarab
 * tanlaydi. Tanlangandan keyin narxni qayta muhokama qilish — o'sha
 * tanlovning asosini olib tashlash bo'lardi.
 *
 * Kelishmovchilik bo'lsa NIZO yo'li bor: moderator qaraydi.
 * Tanlashdan oldingi savollar esa chat orqali hal bo'ladi.
 */
