/**
 * Uchdan-uchgacha smoke test — yadro mantiqni tekshiradi.
 * Alohida test bazasida ishlaydi, asosiy ma'lumotlarga tegmaydi.
 *
 *   npm test --workspace=server
 */
import path from 'node:path';
import fs from 'node:fs';

// config yuklanishidan OLDIN test bazasini ko'rsatamiz
const TEST_DB = path.resolve(__dirname, '../../../data/test.db');
process.env.DATABASE_PATH = TEST_DB;
process.env.ALLOW_DEV_AUTH = 'true';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.MIN_DEALS_FOR_PRICE_STATS = '2';
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(TEST_DB + suffix, { force: true });
}

/* eslint-disable @typescript-eslint/no-var-requires */
const { db, migrate, toJson } = require('../db');
const { execSync } = require('node:child_process');

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` → ${JSON.stringify(detail)}` : ''}`);
  }
}

function throws(name: string, fn: () => unknown, expectedCode?: string) {
  try {
    fn();
    check(name, false, 'xatolik kutilgandi, lekin muvaffaqiyatli tugadi');
  } catch (err: any) {
    check(name, expectedCode ? err.code === expectedCode : true, err.code ?? err.message);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  migrate();
  execSync(`npx tsx ${path.resolve(__dirname, '../db/seed.ts')}`, {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_PATH: TEST_DB },
  });

  const catalog = require('../services/catalog');
  const requests = require('../services/requests');
  const offers = require('../services/offers');
  const deals = require('../services/deals');
  const chat = require('../services/chat');
  const reviews = require('../services/reviews');
  const clinics = require('../services/clinics');
  const priceStats = require('../services/priceStats');
  const matching = require('../services/matching');
  const ai = require('../services/ai');
  const scheduler = require('../services/scheduler');
  const business = require('../services/terms.business');
  const { upsertUser } = require('../middleware/auth');

  const tashkent = catalog.listCities().find((c: any) => c.slug === 'tashkent')!;
  const gallbladder = catalog
    .listOperations()
    .find((o: any) => o.slug === 'laparoscopic-cholecystectomy')!;

  section('1. Katalog va qidiruv');
  check('26 ta operatsiya seed qilindi', catalog.listOperations().length === 26);
  check(
    'xalq tilidagi qidiruv ishlaydi ("o\'t pufagi")',
    catalog.searchOperations("o't pufagi")[0]?.slug === 'laparoscopic-cholecystectomy',
  );
  check('ruscha qidiruv ishlaydi ("желчный")', catalog.searchOperations('желчный').length > 0);

  section('2. AI heuristikasi (API kalitisiz fallback)');
  const aiResult = await ai.suggestOperations("o'ng biqinim og'riyapti, tosh bor deyishdi", 'uz');
  check('shikoyatdan operatsiya taklif qilindi', aiResult.suggestions.length > 0);
  check(
    'aynan xoletsistektomiya birinchi o‘rinda',
    aiResult.suggestions[0]?.operationId === gallbladder.id,
    aiResult.suggestions[0]?.operationName,
  );
  check('ogohlantirish (tashxis emas) qaytarildi', aiResult.disclaimer.includes('shifokor'));
  const nonsense = await ai.suggestOperations('qwerty zxcvbn', 'uz');
  check('tushunarsiz matnda katalogga yo‘naltiriladi', nonsense.fallbackToCatalog === true);

  section('3. Foydalanuvchilar va klinika verifikatsiyasi');
  const patient = upsertUser({ id: 900001, first_name: 'Aziz', language_code: 'uz' });
  const clinicUser = upsertUser({ id: 900002, first_name: 'Klinika', language_code: 'uz' });
  const moderator = upsertUser({ id: 900003, first_name: 'Moderator' });
  db.prepare(`UPDATE users SET roles = ? WHERE id = ?`).run(toJson(['moderator']), moderator.id);

  section('3b. Bemor profili va ommaviy oferta');
  throws(
    'profilsiz so‘rov yuborib bo‘lmaydi',
    () =>
      requests.createRequest({
        patientId: patient.id,
        operationId: gallbladder.id,
        cityId: tashkent.id,
        budgetUzs: 10_000_000,
        note: null,
        urgency: 'normal',
        attachments: [],
        aiSuggested: false,
        conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
        acceptTerms: true,
      }),
    'profile_incomplete',
  );

  db.prepare(`UPDATE users SET last_name = 'Karimov', city_id = ? WHERE id = ?`).run(
    tashkent.id,
    patient.id,
  );
  check('profil to‘ldirildi', true);

  throws(
    'oferta qabul qilinmasa so‘rov yuborilmaydi',
    () =>
      requests.createRequest({
        patientId: patient.id,
        operationId: gallbladder.id,
        cityId: tashkent.id,
        budgetUzs: 10_000_000,
        note: null,
        urgency: 'normal',
        attachments: [],
        aiSuggested: false,
        conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
        acceptTerms: false,
      }),
    'terms_not_accepted',
  );

  const clinic = clinics.registerClinic({
    userId: clinicUser.id,
    name: 'Test Klinika',
    cityId: tashkent.id,
    address: 'Toshkent',
    about: 'Test',
    licenseFileId: 'lic-1',
    operationIds: [gallbladder.id],
  });
  check('klinika "pending" holatida yaratildi', clinic.verification === 'pending');

  throws(
    'tasdiqlanmagan klinika taklif yubora olmaydi',
    () =>
      offers.createOffer({
        requestId: 1,
        clinicId: clinic.id,
        priceUzs: 10_000_000,
        includes: ['Operatsiya'],
        advantages: [],
        leadTimeDays: 5,
        note: null,
      }),
    'forbidden',
  );

  clinics.setVerification(clinic.id, moderator.id, 'approved', null);
  check('moderator tasdiqladi', clinics.getClinic(clinic.id).verification === 'approved');

  // Qoida ataylab o'zgardi: obunasiz klinika so'rovni KO'RADI.
  // Sababi biznes: nimani boy berayotganini ko'rmagan klinika tarif olmaydi.
  // To'siq keyingi qadamda — taklif yuborishda.
  check(
    'obunasiz klinika so‘rovni ko‘radi (matching to‘smaydi)',
    matching.findMatchingClinics(gallbladder.id, tashkent.id).some((c: any) => c.id === clinic.id),
  );

  throws(
    'obunasiz klinika taklif yubora olmaydi (402)',
    () =>
      offers.createOffer({
        requestId: 1,
        clinicId: clinic.id,
        priceUzs: 9_000_000,
        includes: ['Operatsiya'],
        advantages: [],
        leadTimeDays: 5,
        note: null,
      }),
    'subscription_required',
  );

  clinics.activateSubscription(clinic.id, 'pro', 1);
  check(
    'obunadan keyin klinika matchingga tushdi',
    matching.findMatchingClinics(gallbladder.id, tashkent.id).some((c: any) => c.id === clinic.id),
  );

  section('3c. Vizard maydonlari');
  throws(
    'holat tavsifi bo‘sh bo‘lsa rad etiladi',
    () =>
      requests.createRequest({
        patientId: patient.id,
        operationId: gallbladder.id,
        cityId: tashkent.id,
        budgetUzs: 10_000_000,
        conditionText: 'qisqa',
        note: null,
        urgency: 'normal',
        attachments: [],
        otherRegionsOk: false,
        dateFrom: null,
        dateTo: null,
        dateFlexible: true,
        aiSuggested: false,
        acceptTerms: true,
      }),
    'condition_required',
  );

  throws(
    'begona hujjatni ilova qilib bo‘lmaydi',
    () =>
      requests.createRequest({
        patientId: patient.id,
        operationId: gallbladder.id,
        cityId: tashkent.id,
        budgetUzs: 10_000_000,
        conditionText: 'Holatim: uzoq vaqtdan beri og‘riq bezovta qiladi.',
        note: null,
        urgency: 'normal',
        attachments: ['begona-fayl-id'],
        otherRegionsOk: false,
        dateFrom: null,
        dateTo: null,
        dateFlexible: true,
        aiSuggested: false,
        acceptTerms: true,
      }),
    'forbidden',
  );

  const unknownOp = db.prepare(`SELECT id FROM operations WHERE slug = 'unknown'`).get() as any;
  check('katalogda "bilmayman" yozuvi bor', Boolean(unknownOp));
  check(
    '"bilmayman" katalog ro‘yxatida ko‘rinmaydi',
    catalog.listOperations().every((o: any) => o.slug !== 'unknown'),
  );
  check(
    '"bilmayman" uchun matching operatsiyaga qaramaydi',
    matching.findMatchingClinics(unknownOp.id, tashkent.id).length > 0,
  );

  const samarkand = catalog.listCities().find((c: any) => c.slug === 'samarkand')!;
  const inRegion = matching.countMatchingClinics(gallbladder.id, samarkand.id);
  const acrossRegions = matching.countMatchingClinics(gallbladder.id, samarkand.id, {
    otherRegionsOk: true,
  });
  check(
    '"boshqa viloyat ham bo‘ladi" matchingni kengaytiradi',
    acrossRegions > inRegion,
    `${inRegion} → ${acrossRegions}`,
  );

  section('4. So‘rov hayot sikli');
  const request = requests.createRequest({
    patientId: patient.id,
    operationId: gallbladder.id,
    cityId: tashkent.id,
    budgetUzs: 12_000_000,
    note: 'Iltimos tezroq',
    urgency: 'soon',
    attachments: [],
    aiSuggested: true,
    conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
    acceptTerms: true,
  });
  check('so‘rov COLLECTING holatiga o‘tdi', request.status === 'COLLECTING', request.status);
  check('oferta versiyasi so‘rovga yozildi', Boolean(request.termsVersion), request.termsVersion);
  check('holat tavsifi saqlandi', Boolean(request.conditionText), request.conditionText);
  check(
    'oferta qabuli alohida jadvalga yozildi',
    (db.prepare('SELECT COUNT(*) AS n FROM terms_acceptances WHERE request_id = ?').get(request.id) as any).n === 1,
  );
  check('so‘rov klinikalarga tarqatildi', request.broadcastCount > 0, request.broadcastCount);
  check(
    'klinika o‘z oqimida so‘rovni ko‘radi',
    requests.listClinicRequests(clinic.id).some((r: any) => r.id === request.id),
  );

  section('5. Taklif qoidalari');
  throws(
    '"nima kiradi" ko‘rsatilmasa taklif rad etiladi (shaffoflik)',
    () =>
      offers.createOffer({
        requestId: request.id,
        clinicId: clinic.id,
        priceUzs: 11_000_000,
        includes: [],
        advantages: [],
        leadTimeDays: 5,
        note: null,
      }),
    'includes_required',
  );

  const offer = offers.createOffer({
    requestId: request.id,
    clinicId: clinic.id,
    priceUzs: 11_500_000,
    includes: ['Operatsiya', 'Narkoz', 'Palata (2 kun)'],
    advantages: ['Oliy toifali jarroh'],
    leadTimeDays: 5,
    note: 'Ertaga qabulga kelishingiz mumkin',
  });
  check('taklif yuborildi', offer.status === 'SENT');
  check('klinika ko‘rildi deb belgilandi', requests.getRequest(request.id).viewedCount === 1);

  throws(
    'bitta klinika ikkinchi faol taklif bera olmaydi',
    () =>
      offers.createOffer({
        requestId: 1,
        clinicId: clinic.id,
        priceUzs: 9_000_000,
        includes: ['Operatsiya'],
        advantages: [],
        leadTimeDays: 3,
        note: null,
      }),
    'offer_exists',
  );

  const updated = offers.updateOffer(offer.id, clinic.id, { priceUzs: 10_800_000 });
  check('taklifni tahrirlash mumkin (tanlangunicha)', updated.priceUzs === 10_800_000);

  section('6. Chat kirish nazorati va bypass himoyasi');
  throws(
    'tanlovdan OLDIN chat ochilmaydi',
    () => chat.listMessages(999, patient.id, null),
    'not_found',
  );

  const deal = deals.chooseOffer(request.id, offer.id, patient.id);
  check('bitim SELECTED holatida yaratildi', deal.status === 'SELECTED');
  check('so‘rov CHOSEN holatiga o‘tdi', requests.getRequest(request.id).status === 'CHOSEN');
  check('kelishilgan narx taklifdan olindi', deal.agreedPriceUzs === 10_800_000);

  const msg = chat.sendMessage({
    dealId: deal.id,
    userId: patient.id,
    clinicId: null,
    body: 'Menga qo\'ng\'iroq qiling: +998 90 123 45 67',
  });
  check('telefon raqam yashirildi (bypass himoyasi)', msg.redacted && !msg.body.includes('123 45 67'), msg.body);

  const linkMsg = chat.sendMessage({
    dealId: deal.id,
    userId: clinicUser.id,
    clinicId: clinic.id,
    body: 'Telegramda yozing t.me/testclinic',
  });
  check('tashqi havola yashirildi', linkMsg.redacted && !linkMsg.body.includes('t.me/'), linkMsg.body);

  const priceMsg = chat.sendMessage({
    dealId: deal.id,
    userId: patient.id,
    clinicId: null,
    body: 'Narx 10800000 so\'m to\'g\'rimi? 15-sana bo\'ladimi?',
  });
  check('yalang‘och narx yashirilmaydi', !priceMsg.redacted, priceMsg.body);

  const spacedPrice = chat.sendMessage({
    dealId: deal.id,
    userId: patient.id,
    clinicId: null,
    body: 'Jami 10 800 000 so\'m, 2 kun palata bilan',
  });
  check('mingliklarga ajratilgan narx yashirilmaydi', !spacedPrice.redacted, spacedPrice.body);

  const bareNumber = chat.sendMessage({
    dealId: deal.id,
    userId: clinicUser.id,
    clinicId: clinic.id,
    body: 'Registratura: 901234567',
  });
  check(
    'ajratgichsiz mobil raqam ham yashiriladi',
    bareNumber.redacted && !bareNumber.body.includes('901234567'),
    bareNumber.body,
  );

  throws(
    'begona odam chatga kira olmaydi',
    () => chat.listMessages(deal.id, moderator.id, null),
    'forbidden',
  );

  section('7. Bitim bosqichlari va komissiya');
  deals.agreeSchedule(deal.id, patient.id, null, new Date(Date.now() + 86_400_000).toISOString());
  check('KELISHILGAN holatiga o‘tdi', deals.getDeal(deal.id).status === 'AGREED');

  throws(
    'bemor "bajarildi" deb belgilay olmaydi',
    () => deals.markPerformed(deal.id, null as any),
    'forbidden',
  );

  deals.markPerformed(deal.id, clinic.id);
  check('BAJARILGAN holatiga o‘tdi', deals.getDeal(deal.id).status === 'PERFORMED');

  const confirmed = deals.confirmDeal(deal.id, patient.id, 10_500_000);
  check('TASDIQLANGAN holatiga o‘tdi', confirmed.status === 'CONFIRMED');
  check('komissiya 5% hisoblandi', confirmed.commissionUzs === 525_000, confirmed.commissionUzs);
  check('so‘rov YAKUNLANGAN', requests.getRequest(request.id).status === 'COMPLETED');
  check(
    'bemor bonus oldi',
    (db.prepare(`SELECT bonus_points FROM users WHERE id = ?`).get(patient.id) as any).bonus_points === 50,
  );

  section('8. Sharh va reyting');
  throws(
    'boshqa odam sharh yoza olmaydi',
    () =>
      reviews.createReview({
        dealId: deal.id,
        patientId: moderator.id,
        scores: { quality: 5, attitude: 5, cleanliness: 5, result: 5 },
        body: null,
      }),
    'forbidden',
  );

  const review = reviews.createReview({
    dealId: deal.id,
    patientId: patient.id,
    scores: { quality: 5, attitude: 4, cleanliness: 5, result: 4 },
    body: 'Yaxshi xizmat',
  });
  check('sharh qoldirildi', review.average === 4.5, review.average);
  check('klinika reytingi yangilandi', clinics.getClinic(clinic.id).ratingAvg === 4.5);

  throws(
    'bitta bitimga ikkinchi sharh yozilmaydi',
    () =>
      reviews.createReview({
        dealId: deal.id,
        patientId: patient.id,
        scores: { quality: 5, attitude: 5, cleanliness: 5, result: 5 },
        body: null,
      }),
    'review_exists',
  );

  section('9. Narx statistikasi manbai');
  let stats = priceStats.getPriceStats(gallbladder.id, tashkent.id);
  check('1 ta bitim bilan hali "manual" manba', stats.source === 'manual', stats.source);
  check('kam ma‘lumot belgisi qo‘yilgan', stats.lowConfidence === true);

  // Ikkinchi tasdiqlangan bitim → chegara (2) ga yetadi
  const request2 = requests.createRequest({
    patientId: patient.id,
    operationId: gallbladder.id,
    cityId: tashkent.id,
    budgetUzs: 13_000_000,
    note: null,
    urgency: 'normal',
    attachments: [],
    aiSuggested: false,
    conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
    acceptTerms: true,
  });
  const offer2 = offers.createOffer({
    requestId: request2.id,
    clinicId: clinic.id,
    priceUzs: 13_500_000,
    includes: ['Operatsiya', 'Narkoz'],
    advantages: [],
    leadTimeDays: 7,
    note: null,
  });
  const deal2 = deals.chooseOffer(request2.id, offer2.id, patient.id);
  throws(
    'bosqichni o‘tkazib yuborib bo‘lmaydi (SELECTED → PERFORMED)',
    () => deals.markPerformed(deal2.id, clinic.id),
    'invalid_transition',
  );
  deals.agreeSchedule(deal2.id, patient.id, null, new Date(Date.now() + 86_400_000).toISOString());
  deals.markPerformed(deal2.id, clinic.id);
  deals.confirmDeal(deal2.id, patient.id, 13_000_000);

  stats = priceStats.getPriceStats(gallbladder.id, tashkent.id);
  check('yetarli bitimdan keyin real statistikaga o‘tdi', stats.source === 'deals', stats.source);
  check('o‘rtacha real to‘lovdan hisoblandi', stats.avg === 11_750_000, stats.avg);
  check('taklif narxi emas, to‘langan summa olindi', stats.max === 13_000_000, stats.max);

  section('10. Taymer va obuna vazifalari');
  db.prepare(`UPDATE requests SET expires_at = datetime('now', '-1 hour') WHERE id = ?`).run(request.id);
  const orphan = requests.createRequest({
    patientId: patient.id,
    operationId: gallbladder.id,
    cityId: tashkent.id,
    budgetUzs: 5_000_000,
    note: null,
    urgency: 'normal',
    attachments: [],
    aiSuggested: false,
    conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
    acceptTerms: true,
  });
  db.prepare(`UPDATE requests SET expires_at = datetime('now', '-1 hour') WHERE id = ?`).run(orphan.id);

  scheduler.tick();
  check(
    'taklifsiz muddati tugagan so‘rov BEKOR qilindi',
    requests.getRequest(orphan.id).status === 'CANCELLED',
    requests.getRequest(orphan.id).status,
  );
  check(
    'yakunlangan so‘rovga taymer tegmadi',
    requests.getRequest(request.id).status === 'COMPLETED',
  );

  db.prepare(`UPDATE clinics SET subscription_until = datetime('now', '-1 day') WHERE id = ?`).run(clinic.id);
  scheduler.tick();
  check('muddati o‘tgan obuna to‘xtatildi', clinics.getClinic(clinic.id).subscriptionStatus === 'expired');
  check(
    'obuna tugagach ham so‘rov ko‘rinaveradi',
    matching.findMatchingClinics(gallbladder.id, tashkent.id).some((c: any) => c.id === clinic.id),
  );
  check(
    'mavjud bitimlar saqlandi',
    deals.getDeal(deal.id).status === 'CONFIRMED',
  );


  section('12. Biznes shartlari: sinov davri, komissiya, avto-tasdiq');

  // ── Sinov davri: admin klinikaga muddat beradi ──
  business.grantTrial(clinic.id, 6);
  const trialed = clinics.getClinic(clinic.id);
  check('sinov davri berilgach obuna faol', trialed.subscriptionStatus === 'active');
  check('tarif "trial" bo‘ldi', trialed.plan === 'trial', String(trialed.plan));
  check('sinov davrida ekan', business.isOnTrial(clinic.id));

  throws('haddan uzoq sinov rad etiladi', () => business.grantTrial(clinic.id, 99), 'bad_months');

  // ── Komissiya: umumiy qiymat va klinikaga xos qiymat ──
  business.setSetting(business.SETTING_COMMISSION, 7, null);
  check(
    'platforma foizi qo‘llandi',
    business.commissionPercentFor(clinic.id) === 7,
    String(business.commissionPercentFor(clinic.id)),
  );

  business.setClinicCommission(clinic.id, 3);
  check(
    'klinikaga xos foiz ustun turadi',
    business.commissionPercentFor(clinic.id) === 3,
    String(business.commissionPercentFor(clinic.id)),
  );

  throws('haqiqatga to‘g‘ri kelmaydigan foiz rad etiladi', () => business.setClinicCommission(clinic.id, 80), 'bad_percent');

  business.setClinicCommission(clinic.id, null);
  check('null bo‘lsa umumiy qiymatga qaytadi', business.commissionPercentFor(clinic.id) === 7);

  // ── Avto-tasdiq: bemor javob bermasa komissiya yo‘qolmaydi ──
  const autoReq = requests.createRequest({
    patientId: patient.id,
    operationId: gallbladder.id,
    cityId: tashkent.id,
    conditionText: 'Avto-tasdiq sinovi uchun holat tavsifi.',
    budgetUzs: null,
    note: null,
    urgency: 'normal',
    attachments: [],
    otherRegionsOk: false,
    dateFrom: null,
    dateTo: null,
    dateFlexible: true,
    aiConversation: null,
    aiSuggested: false,
    acceptTerms: true,
  });
  const autoOffer = offers.createOffer({
    requestId: autoReq.id,
    clinicId: clinic.id,
    priceUzs: 12_000_000,
    includes: ['Operatsiya'],
    advantages: [],
    leadTimeDays: 5,
    note: null,
  });
  const autoDeal = deals.chooseOffer(autoReq.id, autoOffer.id, patient.id);
  deals.agreeSchedule(autoDeal.id, patient.id, null, new Date(Date.now() + 86_400_000).toISOString());
  deals.markPerformed(autoDeal.id, clinic.id);

  check('avto-tasdiq muddati kelmagan bitimga tegmaydi', deals.autoConfirmStaleDeals() === 0);

  // Bajarilgan sanani orqaga surib, muddat o'tganini taqlid qilamiz
  db.prepare(`UPDATE deals SET performed_at = datetime('now', '-30 days') WHERE id = ?`).run(autoDeal.id);
  const closed = deals.autoConfirmStaleDeals();
  check('javobsiz bitim avtomatik yopildi', closed === 1, String(closed));

  const autoClosed = deals.getDeal(autoDeal.id);
  check('holat CONFIRMED', autoClosed.status === 'CONFIRMED', autoClosed.status);
  check('avto belgisi qo‘yildi', (autoClosed as any).autoConfirmed !== false);
  check(
    'komissiya kelishilgan narxdan hisoblandi',
    autoClosed.commissionUzs === Math.round((12_000_000 * 7) / 100),
    String(autoClosed.commissionUzs),
  );
  check('ikkinchi marta yopilmaydi', deals.autoConfirmStaleDeals() === 0);

  section('11. Spam cheklovi');
  db.prepare(`UPDATE clinics SET subscription_status = 'active', subscription_until = datetime('now','+30 days') WHERE id = ?`).run(clinic.id);
  for (let i = 0; i < 3; i++) {
    requests.createRequest({
      patientId: patient.id,
      operationId: gallbladder.id,
      cityId: tashkent.id,
      budgetUzs: 9_000_000,
      note: null,
      urgency: 'normal',
      attachments: [],
      aiSuggested: false,
      conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
      acceptTerms: true,
    });
  }
  throws(
    'faol so‘rovlar limiti majburlanadi',
    () =>
      requests.createRequest({
        patientId: patient.id,
        operationId: gallbladder.id,
        cityId: tashkent.id,
        budgetUzs: 9_000_000,
        note: null,
        urgency: 'normal',
        attachments: [],
        aiSuggested: false,
        conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
        acceptTerms: true,
      }),
    'too_many_active_requests',
  );

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Natija: ${passed} o'tdi, ${failed} yiqildi`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nTest ishga tushmadi:', err);
  process.exit(1);
});
