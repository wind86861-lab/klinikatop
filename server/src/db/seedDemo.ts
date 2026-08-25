/**
 * Demo ma'lumot — bosh sahifadagi "narx pulsi" va "bemorlar fikri" bo'sh turmasin.
 *
 * Real oqimning o'zidan foydalanadi: bemor → so'rov → taklif → tanlov →
 * bajarildi → tasdiqlandi → sharh. Ya'ni yaratilgan ma'lumot haqiqiy
 * bitimlardan farq qilmaydi va statistikaga to'g'ri tushadi.
 *
 *   npm run seed:demo --workspace=server
 */
import { db, migrate } from './index';
import { config } from '../lib/config';
import { upsertUser } from '../middleware/auth';
import { createRequest } from '../services/requests';
import { createOffer } from '../services/offers';
import { chooseOffer, agreeSchedule, markPerformed, confirmDeal } from '../services/deals';
import { createReview } from '../services/reviews';
import { activateSubscription } from '../services/clinics';

/**
 * Qattiq qulf.
 *
 * Demo ma'lumot HAQIQIY oqim orqali yaratiladi — bemor so'rov beradi,
 * klinika taklif qiladi, bitim tasdiqlanadi. Ya'ni natija real bitimdan
 * farq qilmaydi va narx statistikasiga to'g'ridan-to'g'ri tushadi.
 *
 * Shu sababli production bazasida bir marta yugurtirilsa, platformaning
 * yagona va'dasi — "narx real bitimlardan olinadi" — buziladi va buni
 * ortga qaytarib bo'lmaydi. Shuning uchun bu yerda ogohlantirish emas,
 * to'xtatish turadi.
 */
if (config.env === 'production') {
  console.error('[seed:demo] Production bazasida demo ma‘lumot yaratib bo‘lmaydi. To‘xtatildi.');
  process.exit(1);
}

if (process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error(
    '[seed:demo] Bu buyruq soxta bitim va sharh yaratadi va ular real statistikaga tushadi.\n' +
      '            Ataylab qilayotgan bo‘lsangiz: ALLOW_DEMO_SEED=true npm run seed:demo',
  );
  process.exit(1);
}

interface DemoCase {
  telegramId: number;
  firstName: string;
  lastName: string;
  operationSlug: string;
  budget: number;
  offerPrice: number;
  paid: number;
  condition: string;
  review: string;
  scores: [number, number, number, number];
}

const CASES: DemoCase[] = [
  {
    telegramId: 950001,
    condition: "O'ng biqinimda og'riq bor, UZI'da o't pufagida tosh topildi.",
    firstName: 'Malika',
    lastName: 'Rasulova',
    operationSlug: 'laparoscopic-cholecystectomy',
    budget: 14_000_000,
    offerPrice: 12_500_000,
    paid: 12_000_000,
    review: 'Uch klinika taklif berdi, narxlar ochiq edi. Eng mosini o‘zim tanladim — hammasi shaffof.',
    scores: [5, 5, 5, 5],
  },
  {
    telegramId: 950002,
    condition: "Har oy tomog'im og'riydi, shifokor bodomchani olishni tavsiya qildi.",
    firstName: 'Jasur',
    lastName: 'Toshmatov',
    operationSlug: 'tonsillectomy',
    budget: 6_000_000,
    offerPrice: 5_400_000,
    paid: 5_000_000,
    review: 'Ilgari narxni bilmasdim. Bu yerda oldindan ko‘rdim va ortiqcha to‘lamadim.',
    scores: [5, 4, 4, 4],
  },
  {
    telegramId: 950003,
    condition: "Kechasi qorinning o'ng pastida kuchli og'riq boshlandi, shoshilinch murojaat qildim.",
    firstName: 'Nigora',
    lastName: 'Saidova',
    operationSlug: 'appendectomy',
    budget: 10_000_000,
    offerPrice: 9_200_000,
    paid: 9_000_000,
    review: 'Bir kunda 4 ta taklif keldi. Vaqt ham, pul ham tejaldi. Juda qulay.',
    scores: [5, 5, 5, 5],
  },
  {
    telegramId: 950004,
    condition: "Qorin og'rig'i bilan bordim, appenditsit deb aytdilar.",
    firstName: 'Bekzod',
    lastName: 'Yo‘ldoshev',
    operationSlug: 'appendectomy',
    budget: 9_000_000,
    offerPrice: 8_400_000,
    paid: 8_200_000,
    review: 'Klinika hamma narxni oldindan aytdi, qo‘shimcha to‘lov bo‘lmadi.',
    scores: [5, 5, 4, 5],
  },
  {
    telegramId: 950005,
    condition: "Ko'zim xiralashib qoldi, gavharda parda bor deyishdi.",
    firstName: 'Dilnoza',
    lastName: 'Ergasheva',
    operationSlug: 'cataract-phaco',
    budget: 8_000_000,
    offerPrice: 7_000_000,
    paid: 6_800_000,
    review: 'Ko‘zim yaxshi ko‘radigan bo‘ldi. Narx ham kutganimdan arzon chiqdi.',
    scores: [5, 5, 5, 5],
  },
];

function main() {
  migrate();

  const tashkent = db.prepare(`SELECT id FROM cities WHERE slug = 'tashkent'`).get() as { id: number };
  if (!tashkent) {
    console.error('Avval `npm run seed` ni ishga tushiring.');
    process.exit(1);
  }

  // Demo bitimlar uchun tasdiqlangan, obunasi faol klinika kerak
  const clinics = db
    .prepare(`SELECT id, name FROM clinics WHERE city_id = ? AND verification = 'approved' ORDER BY id`)
    .all(tashkent.id) as { id: number; name: string }[];

  if (!clinics.length) {
    console.error('Toshkentda tasdiqlangan klinika yo‘q. Avval `npm run seed` ni ishga tushiring.');
    process.exit(1);
  }

  let created = 0;
  let skipped = 0;

  for (const [index, demo] of CASES.entries()) {
    const operation = db
      .prepare(`SELECT id FROM operations WHERE slug = ?`)
      .get(demo.operationSlug) as { id: number } | undefined;
    if (!operation) continue;

    const patient = upsertUser({ id: demo.telegramId, first_name: demo.firstName, language_code: 'uz' });

    // Bir marta yaratamiz — skript qayta yugurtirilsa dublikat bo'lmasin
    const already = db
      .prepare(`SELECT 1 FROM reviews WHERE patient_id = ? LIMIT 1`)
      .get(patient.id);
    if (already) {
      skipped++;
      continue;
    }

    db.prepare(
      `UPDATE users SET last_name = ?, city_id = ?, profile_completed_at = datetime('now') WHERE id = ?`,
    ).run(demo.lastName, tashkent.id, patient.id);

    // Bu operatsiyani qiladigan klinikani tanlaymiz
    const clinic =
      (db
        .prepare(
          `SELECT c.id FROM clinics c
             JOIN clinic_operations co ON co.clinic_id = c.id AND co.operation_id = ?
            WHERE c.city_id = ? AND c.verification = 'approved'
            ORDER BY c.id LIMIT 1`,
        )
        .get(operation.id, tashkent.id) as { id: number } | undefined) ?? clinics[index % clinics.length];

    activateSubscription(clinic.id, 'pro', 12);

    const request = createRequest({
      patientId: patient.id,
      operationId: operation.id,
      cityId: tashkent.id,
      budgetUzs: demo.budget,
      conditionText: demo.condition,
      note: null,
      urgency: 'normal',
      attachments: [],
      otherRegionsOk: false,
      dateFrom: null,
      dateTo: null,
      dateFlexible: true,
      aiSuggested: false,
      acceptTerms: true,
      userAgent: 'seed:demo',
    });

    const offer = createOffer({
      requestId: request.id,
      clinicId: clinic.id,
      priceUzs: demo.offerPrice,
      includes: ['Operatsiya', 'Narkoz (anesteziya)', 'Palata (2 kun)'],
      advantages: ['Oliy toifali jarroh'],
      leadTimeDays: 5,
      note: null,
    });

    const deal = chooseOffer(request.id, offer.id, patient.id);
    agreeSchedule(deal.id, patient.id, null, new Date(Date.now() - 3 * 86_400_000).toISOString());
    markPerformed(deal.id, clinic.id);
    confirmDeal(deal.id, patient.id, demo.paid);

    createReview({
      dealId: deal.id,
      patientId: patient.id,
      scores: {
        quality: demo.scores[0],
        attitude: demo.scores[1],
        cleanliness: demo.scores[2],
        result: demo.scores[3],
      },
      body: demo.review,
    });

    created++;
  }

  console.log(`Demo tayyor: ${created} ta yangi bitim va sharh${skipped ? `, ${skipped} tasi mavjud edi` : ''}.`);
}

main();
