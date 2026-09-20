/**
 * Klinika: ro'yxatdan o'tish, verifikatsiya (12-bo'lim), obuna (11-bo'lim), dashboard (10-ekran).
 */
import crypto from 'node:crypto';
import { db, toJson, tx } from '../db';
import { config } from '../lib/config';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { mapClinic, mapClinicPublic } from '../lib/mappers';
import {
  PLAN_LIMITS,
  type Clinic,
  type ClinicDashboard,
  type ClinicPublic,
  type SubscriptionPlan,
  type VerificationStatus,
} from '../../../shared/types';
import { notify, notifyClinic } from './notifications';
import { monthlyOfferCount } from './offers';

export function getClinic(id: number): Clinic {
  const row = db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(id);
  if (!row) throw notFound('Klinika topilmadi');
  return mapClinic(row);
}

export function getClinicPublic(id: number): ClinicPublic {
  const row = db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(id);
  if (!row) throw notFound('Klinika topilmadi');
  return mapClinicPublic(row);
}

export function getClinicOperations(clinicId: number): number[] {
  const rows = db.prepare(`SELECT operation_id FROM clinic_operations WHERE clinic_id = ?`).all(clinicId) as {
    operation_id: number;
  }[];
  return rows.map((r) => r.operation_id);
}

export interface RegisterClinicInput {
  userId: number;
  name: string;
  cityId: number;
  address: string;
  about: string;
  licenseFileId: string | null;
  operationIds: number[];
}

/** 5.1 klinika oqimi: ariza → moderator tekshiradi → "Tasdiqlangan" belgisi. */
export function registerClinic(input: RegisterClinicInput): Clinic {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(input.userId) as any;
  if (!user) throw notFound('Foydalanuvchi topilmadi');
  if (user.clinic_id) throw conflict('already_clinic', 'Siz allaqachon klinikaga biriktirilgansiz');
  if (!input.name.trim()) throw badRequest('name_required', 'Klinika nomi kerak');
  if (!db.prepare(`SELECT 1 FROM cities WHERE id = ?`).get(input.cityId)) {
    throw badRequest('unknown_city', 'Shahar topilmadi');
  }
  if (!input.operationIds.length) throw badRequest('operations_required', 'Kamida bitta operatsiya yo‘nalishini tanlang');

  const clinicId = tx(() => {
    const info = db
      .prepare(
        `INSERT INTO clinics (name, city_id, address, about, license_file_id, verification, subscription_status)
         VALUES (?, ?, ?, ?, ?, 'pending', 'none')`,
      )
      .run(input.name.trim(), input.cityId, input.address, input.about, input.licenseFileId);
    const id = Number(info.lastInsertRowid);

    const ins = db.prepare(`INSERT OR IGNORE INTO clinic_operations (clinic_id, operation_id) VALUES (?, ?)`);
    for (const opId of input.operationIds) ins.run(id, opId);

    const roles: string[] = JSON.parse(user.roles);
    if (!roles.includes('clinic_admin')) roles.push('clinic_admin');
    db.prepare(`UPDATE users SET clinic_id = ?, roles = ? WHERE id = ?`).run(id, toJson(roles), input.userId);

    return id;
  });

  return getClinic(clinicId);
}

/**
 * Klinikaning yo'nalishlari.
 *
 * Yozuv MANBAGA qarab ishlaydi va bu muhim: banisa'dan kelgan
 * yo'nalishlar o'sha yerda boshqariladi, bu yerdan tahrirlanmaydi.
 * Ilgari bu funksiya hamma qatorni o'chirib qayta yozardi — ya'ni
 * saqlash banisa ulanishini buzar va keyingi sinxronizatsiya uni
 * qaytarardi. Shu sababli ulangan klinikaga ekran butunlay yopilgandi.
 *
 * Endi faqat `manual` qatorlar almashtiriladi. Natijada ulangan
 * klinika ham banisa'da yo'q yo'nalishni O'ZI qo'sha oladi —
 * KlinikaTop katalogi kengroq va ulanish uni yopib qo'ymasligi kerak.
 */
export function updateClinicOperations(clinicId: number, operationIds: number[]) {
  tx(() => {
    db.prepare(`DELETE FROM clinic_operations WHERE clinic_id = ? AND source = 'manual'`).run(clinicId);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO clinic_operations (clinic_id, operation_id, source) VALUES (?, ?, 'manual')`,
    );
    // banisa'niki allaqachon bor bo'lsa `OR IGNORE` uni tegmasdan o'tkazadi
    for (const id of operationIds) ins.run(clinicId, id);
  });
}

/** banisa'dan kelgan yo'nalishlar — ular bu yerda tahrirlanmaydi. */
export function externalOperationIds(clinicId: number): number[] {
  return (
    db
      .prepare(`SELECT operation_id FROM clinic_operations WHERE clinic_id = ? AND source = 'banisa'`)
      .all(clinicId) as { operation_id: number }[]
  ).map((r) => r.operation_id);
}

export function updateClinicProfile(
  clinicId: number,
  input: Partial<{
    name: string;
    address: string;
    about: string;
    logoUrl: string | null;
    phone: string | null;
    website: string | null;
    workHours: string | null;
    beds: number | null;
    foundedYear: number | null;
    equipment: string[];
    photos: string[];
    acceptsReferral: boolean;
  }>,
): Clinic {
  const current = db.prepare(`SELECT * FROM clinics WHERE id = ?`).get(clinicId) as any;
  if (!current) throw notFound('Klinika topilmadi');

  const pick = <T>(next: T | undefined, fallback: T): T => (next === undefined ? fallback : next);
  const list = (next: string[] | undefined, fallback: string) =>
    next === undefined
      ? fallback
      : JSON.stringify(next.map((v) => v.trim()).filter(Boolean).slice(0, 24));

  db.prepare(
    `UPDATE clinics
        SET name = ?, address = ?, about = ?, logo_url = ?, phone = ?, website = ?,
            work_hours = ?, beds = ?, founded_year = ?, equipment = ?, photos = ?,
            accepts_referral = ?
      WHERE id = ?`,
  ).run(
    pick(input.name, current.name).trim().slice(0, 200),
    pick(input.address, current.address).slice(0, 300),
    pick(input.about, current.about).slice(0, 1500),
    pick(input.logoUrl, current.logo_url),
    pick(input.phone, current.phone)?.slice(0, 40) ?? null,
    pick(input.website, current.website)?.slice(0, 200) ?? null,
    pick(input.workHours, current.work_hours)?.slice(0, 120) ?? null,
    pick(input.beds, current.beds),
    pick(input.foundedYear, current.founded_year),
    list(input.equipment, current.equipment ?? '[]'),
    list(input.photos, current.photos ?? '[]'),
    pick(input.acceptsReferral, current.accepts_referral !== 0) ? 1 : 0,
    clinicId,
  );

  return getClinic(clinicId);
}

/* ── Verifikatsiya (12.1) ───────────────────────────────────── */

/**
 * Moderator navbati.
 *
 * Faqat 'pending' emas: rad etilgan klinika hujjatni tuzatib qayta yuklasa,
 * u ham navbatga qaytadi. Aks holda klinika tuzatgan bo'lsa ham hech kim
 * ko'rmaydi va ariza abadiy rad etilgan holda qoladi.
 */
export function listPendingVerifications(): Clinic[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM clinics c
        WHERE c.verification = 'pending'
           OR (c.verification = 'rejected'
               AND EXISTS (SELECT 1 FROM clinic_documents d
                            WHERE d.clinic_id = c.id AND d.status = 'pending'))
        ORDER BY c.id ASC`,
    )
    .all();
  return rows.map(mapClinic);
}

export function setVerification(
  clinicId: number,
  moderatorId: number,
  status: VerificationStatus,
  note: string | null,
): Clinic {
  if (status === 'rejected' && !note?.trim()) {
    throw badRequest('note_required', 'Rad etish sababini yozing');
  }

  db.prepare(`UPDATE clinics SET verification = ?, verification_note = ? WHERE id = ?`).run(status, note, clinicId);
  db.prepare(`INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note) VALUES (?, 'clinic', ?, ?, ?)`).run(
    moderatorId,
    clinicId,
    `verification:${status}`,
    note,
  );

  notifyClinic(clinicId, 'verification_result', { approved: status === 'approved' ? 1 : 0, note: note ?? '' }, `/clinic`);
  return getClinic(clinicId);
}

/* ── Obuna (11-bo'lim) ──────────────────────────────────────── */

/** To'lov davri — oylik. To'lov bo'lmasa obuna TO'XTATILADI, faol bitimlar saqlanadi. */
export function activateSubscription(clinicId: number, plan: SubscriptionPlan, months = 1): Clinic {
  const clinic = getClinic(clinicId);
  if (clinic.verification !== 'approved') {
    throw forbidden('Avval klinika tasdiqlanishi kerak');
  }

  const amount = PLAN_LIMITS[plan].priceUzs * months;
  const startsFrom =
    clinic.subscriptionUntil && new Date(clinic.subscriptionUntil) > new Date()
      ? clinic.subscriptionUntil.replace('T', ' ').slice(0, 19)
      : null;

  tx(() => {
    db.prepare(
      `UPDATE clinics SET plan = ?, subscription_status = 'active',
              subscription_until = datetime(COALESCE(?, 'now'), ?)
        WHERE id = ?`,
    ).run(plan, startsFrom, `+${months} months`, clinicId);

    const updated = db.prepare(`SELECT subscription_until FROM clinics WHERE id = ?`).get(clinicId) as {
      subscription_until: string;
    };
    db.prepare(
      `INSERT INTO subscription_payments (clinic_id, plan, amount_uzs, period_from, period_to)
       VALUES (?, ?, ?, datetime(COALESCE(?, 'now')), ?)`,
    ).run(clinicId, plan, amount, startsFrom, updated.subscription_until);
  });

  return getClinic(clinicId);
}

/**
 * 11.2: muddati o'tgan obunalarni to'xtatish + tugashidan oldin eslatma.
 * Faol bitimlar davom etadi, faqat yangi so'rov kelmaydi (matching sharti).
 */
export function processSubscriptions(): { suspended: number; reminded: number } {
  const expired = db
    .prepare(
      `SELECT id FROM clinics
        WHERE subscription_status = 'active' AND subscription_until IS NOT NULL
          AND subscription_until <= datetime('now')`,
    )
    .all() as { id: number }[];

  for (const c of expired) {
    db.prepare(`UPDATE clinics SET subscription_status = 'expired' WHERE id = ?`).run(c.id);
    notifyClinic(c.id, 'subscription_expiring', { days: 0 }, `/clinic/subscription`);
  }

  const soon = db
    .prepare(
      `SELECT id, subscription_until FROM clinics
        WHERE subscription_status = 'active' AND subscription_until IS NOT NULL
          AND subscription_until <= datetime('now', '+3 days')
          AND subscription_until > datetime('now')`,
    )
    .all() as { id: number; subscription_until: string }[];

  for (const c of soon) {
    const days = Math.max(
      1,
      Math.ceil((new Date(c.subscription_until.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 86_400_000),
    );
    notifyClinic(c.id, 'subscription_expiring', { days }, `/clinic/subscription`);
  }

  return { suspended: expired.length, reminded: soon.length };
}

export function suspendSubscription(clinicId: number, moderatorId: number, note: string): Clinic {
  db.prepare(`UPDATE clinics SET subscription_status = 'suspended' WHERE id = ?`).run(clinicId);
  db.prepare(`INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note) VALUES (?, 'clinic', ?, 'suspend', ?)`).run(
    moderatorId,
    clinicId,
    note,
  );
  return getClinic(clinicId);
}

/* ── Dashboard (10-ekran) ───────────────────────────────────── */

export function getDashboard(clinicId: number): ClinicDashboard {
  const clinic = getClinic(clinicId);

  const incoming = db
    .prepare(
      `SELECT COUNT(*) AS n FROM request_broadcasts b
         JOIN requests r ON r.id = b.request_id
        WHERE b.clinic_id = ? AND r.status IN ('NEW','COLLECTING')`,
    )
    .get(clinicId) as { n: number };

  const offers = db
    .prepare(`SELECT COUNT(*) AS n FROM offers WHERE clinic_id = ?`)
    .get(clinicId) as { n: number };

  const wins = db
    .prepare(`SELECT COUNT(*) AS n FROM offers WHERE clinic_id = ? AND status = 'CHOSEN'`)
    .get(clinicId) as { n: number };

  const money = db
    .prepare(
      `SELECT COALESCE(SUM(confirmed_amount_uzs), 0) AS revenue,
              COALESCE(SUM(commission_uzs), 0) AS commission
         FROM deals WHERE clinic_id = ? AND status = 'CONFIRMED'`,
    )
    .get(clinicId) as { revenue: number; commission: number };

  const weekly = db
    .prepare(
      `WITH RECURSIVE days(d) AS (
         SELECT date('now', '-6 days')
         UNION ALL SELECT date(d, '+1 day') FROM days WHERE d < date('now')
       )
       SELECT days.d AS date,
         (SELECT COUNT(*) FROM request_broadcasts b JOIN requests r ON r.id = b.request_id
           WHERE b.clinic_id = @clinicId AND date(b.created_at) = days.d) AS requests,
         (SELECT COUNT(*) FROM offers o WHERE o.clinic_id = @clinicId AND date(o.created_at) = days.d) AS offers,
         (SELECT COUNT(*) FROM offers o WHERE o.clinic_id = @clinicId AND o.status = 'CHOSEN' AND date(o.updated_at) = days.d) AS wins
       FROM days`,
    )
    .all({ clinicId }) as { date: string; requests: number; offers: number; wins: number }[];

  const plan = clinic.plan ?? 'basic';

  return {
    kpi: {
      incomingRequests: incoming.n,
      offersSent: offers.n,
      offersWon: wins.n,
      winRatePercent: offers.n > 0 ? Math.round((wins.n / offers.n) * 100) : 0,
      revenueUzs: money.revenue,
      commissionUzs: money.commission,
      avgResponseMinutes: clinic.avgResponseMinutes,
    },
    weekly,
    subscription: {
      plan: clinic.plan,
      status: clinic.subscriptionStatus,
      until: clinic.subscriptionUntil,
      offersUsed: monthlyOfferCount(clinicId),
      offersLimit: PLAN_LIMITS[plan].monthlyOffers,
    },
  };
}

export const COMMISSION_PERCENT = config.rules.commissionPercent;

/* ── Klinikani boshqarish: tahrir, parol, o'chirish ──────────── */

/**
 * Klinikani o'chirish NIMANI olib ketadi.
 *
 * Bazadagi HAR BIR bog'lanish `ON DELETE CASCADE` — ya'ni bitta
 * `DELETE FROM clinics` bitimlarni, takliflarni, sharhlarni,
 * to'lovlarni va bitimlar ostidagi yozishmalarni ham jimgina olib
 * ketadi. Bu loyihada bir marta shunday yo'qotish bo'lgan (migratsiya
 * 029), shuning uchun bu yerda son OLDINDAN hisoblanadi va odamga
 * ko'rsatiladi: u nimani yo'qotayotganini bilib turib bossin.
 */
export interface ClinicDeletionImpact {
  deals: number;
  offers: number;
  reviews: number;
  messages: number;
  payments: number;
  accounts: number;
  /** Tarixi yo'q klinikani o'chirish xavfsiz — yo'qotadigan narsa yo'q */
  empty: boolean;
}

export function clinicDeletionImpact(clinicId: number): ClinicDeletionImpact {
  getClinic(clinicId); // yo'q bo'lsa shu yerda to'xtaydi

  const one = (sql: string) => (db.prepare(sql).get(clinicId) as { n: number }).n;

  const deals = one(`SELECT COUNT(*) n FROM deals WHERE clinic_id = ?`);
  const offers = one(`SELECT COUNT(*) n FROM offers WHERE clinic_id = ?`);
  const reviews = one(`SELECT COUNT(*) n FROM reviews WHERE clinic_id = ?`);
  const accounts = one(`SELECT COUNT(*) n FROM admin_users WHERE clinic_id = ?`);

  // Yozishmalar bitim orqali ketadi — ya'ni bilvosita, lekin baribir
  const messages = one(
    `SELECT COUNT(*) n FROM messages WHERE deal_id IN (SELECT id FROM deals WHERE clinic_id = ?)`,
  );

  const payments =
    one(`SELECT COUNT(*) n FROM subscription_payments WHERE clinic_id = ?`) +
    one(`SELECT COUNT(*) n FROM commission_payments WHERE clinic_id = ?`);

  return {
    deals,
    offers,
    reviews,
    messages,
    payments,
    accounts,
    /*
     * Hisoblar sanalmaydi: ular klinikaning O'ZI, tarixi emas.
     * Hisobsiz klinika bo'lmaydi, ya'ni ularni shartga qo'shsak
     * hech bir klinika hech qachon "bo'sh" bo'lmasdi.
     */
    empty: deals + offers + reviews + messages + payments === 0,
  };
}

/**
 * Klinikani butunlay o'chirish.
 *
 * Tarixi bor klinika ODDIY YO'L bilan o'chmaydi: buning uchun
 * `force` kerak va uni faqat bosh administrator bera oladi. Sabab
 * oddiy — bitimlar, to'lovlar va sharhlar moliyaviy hamda tibbiy
 * yozuv; ularni tasodifan yo'qotib bo'lmasligi kerak. Ishlayotgan
 * klinikani vaqtincha to'xtatish uchun `suspendSubscription` bor.
 */
export function deleteClinic(
  clinicId: number,
  moderatorId: number,
  opts: { force?: boolean } = {},
): ClinicDeletionImpact {
  const clinic = getClinic(clinicId);
  const impact = clinicDeletionImpact(clinicId);

  if (!impact.empty && !opts.force) {
    throw conflict(
      'clinic_has_history',
      `Bu klinikada ${impact.deals} bitim, ${impact.offers} taklif, ${impact.reviews} sharh bor. ` +
        'O‘chirish ularni ham yo‘q qiladi — tasdiqlash kerak.',
    );
  }

  return tx(() => {
    /*
     * Veb hisoblarning `users` dagi juftligi.
     *
     * `admin_users` klinika bilan birga CASCADE o'chadi, lekin
     * `users` dagi qator `clinic_id` si NULL bo'lib QOLADI — va
     * unda hali ham klinika roli turadi. O'zi orqali kirib
     * bo'lmaydi (kirish `admin_users` orqali), lekin bu yarim
     * yozuv: rolini ham olib tashlaymiz.
     *
     * Qatorning O'ZI o'chirilmaydi: unga moderatsiya jurnali,
     * yozishmalar va boshqa yozuvlar ishora qiladi — o'chirilsa
     * o'sha tarix ham buzilardi.
     */
    db.prepare(
      `UPDATE users SET roles = '[]', clinic_id = NULL
        WHERE clinic_id = ? AND telegram_id < 0`,
    ).run(clinicId);

    db.prepare(`DELETE FROM clinics WHERE id = ?`).run(clinicId);

    /*
     * Jurnalga NIMA yo'qolgani yoziladi. Klinikaning o'zi endi yo'q,
     * ya'ni keyin "bu yerda nima bor edi" degan savolga javob faqat
     * shu yozuvdan chiqadi.
     */
    db.prepare(
      `INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note)
       VALUES (?, 'clinic', ?, 'delete', ?)`,
    ).run(
      moderatorId,
      clinicId,
      JSON.stringify({ name: clinic.name, forced: Boolean(opts.force), ...impact }),
    );

    return impact;
  });
}

/**
 * Administrator klinikani tahrirlaydi.
 *
 * Klinikaning o'zi `updateClinicProfile` orqali tavsif va rasm kabi
 * narsalarni o'zgartiradi. Bu yerda esa KIMLIK maydonlari: nomi,
 * shahri, aloqa raqami. Ularni admin tuzatishi kerak bo'ladi —
 * ariza noto'g'ri to'ldirilgan yoki klinika ko'chib o'tgan.
 *
 * Shahar alohida: u qidiruvga ta'sir qiladi (so'rov faqat o'z
 * shahridagi klinikalarga boradi), shuning uchun mavjudligi
 * tekshiriladi — yo'q shahar yozilsa klinika hech qayerda
 * ko'rinmay qolardi.
 */
export function updateClinicByAdmin(
  clinicId: number,
  input: Partial<{ name: string; cityId: number; phone: string | null; address: string; website: string | null }>,
  moderatorId: number,
): Clinic {
  const current = getClinic(clinicId);

  if (input.name !== undefined && input.name.trim().length < 2) {
    throw badRequest('name_required', 'Klinika nomini yozing');
  }

  if (input.cityId !== undefined) {
    const city = db.prepare(`SELECT id FROM cities WHERE id = ?`).get(input.cityId);
    if (!city) throw badRequest('bad_city', 'Bunday shahar yo‘q');
  }

  db.prepare(
    `UPDATE clinics SET name = ?, city_id = ?, phone = ?, address = ?, website = ? WHERE id = ?`,
  ).run(
    (input.name ?? current.name).trim().slice(0, 200),
    input.cityId ?? current.cityId,
    input.phone === undefined ? current.phone : input.phone?.trim().slice(0, 40) || null,
    (input.address ?? current.address ?? '').slice(0, 300),
    input.website === undefined ? current.website : input.website?.trim().slice(0, 200) || null,
    clinicId,
  );

  db.prepare(
    `INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note)
     VALUES (?, 'clinic', ?, 'edit', ?)`,
  ).run(moderatorId, clinicId, JSON.stringify({ before: current.name, after: input.name ?? current.name }));

  return getClinic(clinicId);
}

/**
 * Klinika parolini tiklash.
 *
 * Administrator YANGI PAROL O'YLAB TOPMAYDI. Buning o'rniga bir
 * martalik havola beriladi va parolni klinikaning o'zi qo'yadi —
 * xuddi ariza tasdiqlangandagidek.
 *
 * Nima uchun shunday: admin o'ylab topgan parol telefonda aytiladi,
 * yozishmada qoladi va ko'pincha o'zgartirilmaydi. Ya'ni klinika
 * kabinetiga kirish yo'li boshqa odamda ham qolib ketardi. Havola
 * esa bir marta ishlaydi va parolni faqat egasi biladi.
 *
 * Amaldagi sessiyalar ham yopiladi: parol o'zgardi degani — eski
 * kirish tugadi degani. Aks holda parol tiklangandan keyin ham eski
 * sessiya ochiq qolardi va butun amal ma'nosini yo'qotardi.
 */
export function resetClinicPassword(
  clinicId: number,
  moderatorId: number,
): { phone: string; fullName: string; setupToken: string } {
  getClinic(clinicId);

  /*
   * Klinikada bir nechta hisob bo'lishi mumkin (admin va operator).
   * Parol EGASIGA — ya'ni `clinic_admin` ga tiklanadi; u bo'lmasa
   * eng eskisiga, chunki u odatda ariza bergan odam.
   */
  const account = db
    .prepare(
      `SELECT id, phone, full_name FROM admin_users
        WHERE clinic_id = ? AND disabled_at IS NULL
        ORDER BY CASE level WHEN 'clinic_admin' THEN 0 ELSE 1 END, id ASC
        LIMIT 1`,
    )
    .get(clinicId) as { id: number; phone: string; full_name: string } | undefined;

  if (!account) throw notFound('Bu klinikada faol hisob yo‘q');

  const setupToken = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + 7 * 24 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');

  return tx(() => {
    db.prepare(
      `UPDATE admin_users
          SET password_salt = '', password_hash = '', setup_token = ?, setup_expires = ?,
              failed_count = 0, locked_until = NULL
        WHERE id = ?`,
    ).run(setupToken, expires, account.id);

    db.prepare(`DELETE FROM admin_sessions WHERE admin_id = ?`).run(account.id);

    /*
     * Jurnalga TOKEN YOZILMAYDI — u parolga teng sir. Jurnalni
     * ko'ra oladigan har kim uni ishlatib kabinetni egallab olardi.
     */
    db.prepare(
      `INSERT INTO moderation_log (moderator_id, entity, entity_id, action, note)
       VALUES (?, 'clinic', ?, 'password:reset', ?)`,
    ).run(moderatorId, clinicId, `account:${account.id}`);

    return { phone: account.phone, fullName: account.full_name, setupToken };
  });
}
