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
  const { isProfileComplete } = require('../../../shared/types');
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

  // Yosh va jins ham majburiy: bir xil operatsiya turli yoshda boshqacha
  // narxlanadi va ba'zilari jinsga bog'liq
  db.prepare(
    `UPDATE users SET last_name = 'Karimov', city_id = ?, birth_year = 1990, gender = 'male' WHERE id = ?`,
  ).run(
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


  section('13. Profil, tibbiy anketa va so‘rov egasi');

  // ── Yosh va jins majburiy ──
  check('yoshsiz profil to‘liq emas', !isProfileComplete({ firstName: 'A', lastName: 'B', cityId: 1, birthYear: null, gender: 'male' } as any));
  check('jinssiz profil to‘liq emas', !isProfileComplete({ firstName: 'A', lastName: 'B', cityId: 1, birthYear: 1990, gender: null } as any));
  check('to‘liq profil qabul qilinadi', isProfileComplete({ firstName: 'A', lastName: 'B', cityId: 1, birthYear: 1990, gender: 'male' } as any));

  // ── Tibbiy anketa ──
  const med = require('../services/medicalProfile');
  check('anketa dastlab bo‘sh', med.getMedicalProfile(patient.id).chronicConditions.length === 0);

  const saved = med.saveMedicalProfile(patient.id, {
    chronicConditions: ['Qandli diabet', '  ', 'Gipertoniya'],
    allergies: ['Penitsillin'],
    bloodType: 'A+',
    heightCm: 178,
    weightKg: 82,
  });
  check('bo‘sh qatorlar tashlab yuborildi', saved.chronicConditions.length === 2, String(saved.chronicConditions.length));
  check('qon guruhi saqlandi', saved.bloodType === 'A+');

  throws('haqiqatga to‘g‘ri kelmaydigan bo‘y rad etiladi', () => med.saveMedicalProfile(patient.id, { heightCm: 300 }), 'bad_height');
  throws('haqiqatga to‘g‘ri kelmaydigan vazn rad etiladi', () => med.saveMedicalProfile(patient.id, { weightKg: 900 }), 'bad_weight');

  // Qisman yangilash qolganini o'chirmasligi kerak
  const partial = med.saveMedicalProfile(patient.id, { allergies: ['Yod'] });
  check('qisman yangilash qolganini saqladi', partial.bloodType === 'A+' && partial.chronicConditions.length === 2);

  // ── So'rov kimga ──
  const forFriend = requests.createRequest({
    patientId: patient.id,
    operationId: gallbladder.id,
    cityId: tashkent.id,
    conditionText: 'Onamning biqinida og‘riq bor, tekshiruvda tosh topildi.',
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
    forSelf: false,
    subjectName: 'Malika Karimova',
    subjectBirthYear: 1958,
    subjectGender: 'female',
    acceptTerms: true,
  });
  const friendReq = requests.getRequest(forFriend.id);
  check('tanish uchun so‘rov belgilandi', friendReq.forSelf === false);
  check('tanishning ismi saqlandi', friendReq.subjectName === 'Malika Karimova', String(friendReq.subjectName));
  check('tanishning yoshi saqlandi', friendReq.subjectBirthYear === 1958);
  check('tanishning jinsi saqlandi', friendReq.subjectGender === 'female');
  requests.cancelRequest(forFriend.id, patient.id);

  // O'ziga bo'lsa subject maydonlari TOZA qolishi kerak — aks holda
  // klinika noto'g'ri odamning ma'lumotini ko'radi
  const forMe = requests.createRequest({
    patientId: patient.id,
    operationId: gallbladder.id,
    cityId: tashkent.id,
    conditionText: 'O‘zimning biqinimda og‘riq, tekshiruvda tosh topildi.',
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
    forSelf: true,
    subjectName: 'Ataylab yuborilgan begona ism',
    subjectBirthYear: 1900,
    subjectGender: 'male',
    acceptTerms: true,
  });
  const mine = requests.getRequest(forMe.id);
  check('o‘ziga bo‘lsa begona ism yozilmaydi', mine.subjectName === null, String(mine.subjectName));
  check('o‘ziga bo‘lsa forSelf true', mine.forSelf === true);
  requests.cancelRequest(forMe.id, patient.id);

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


  /* ═════ 14. Veb hisoblar: klinika va admin ═════ */
  console.log('\n14. Veb hisoblar va rollarning ajratilishi');

  const webAuth = require('../services/webAuth');

  const acc = webAuth.createAccount({
    email: 'Sinov@Klinika.LOCAL',
    fullName: 'Sinov Egasi',
    level: 'clinic_admin',
    clinicId: clinic.id,
  });

  check('email kichik harfga keltirildi', acc.user.email === 'sinov@klinika.local', acc.user.email);
  check('sozlash tokeni berildi', typeof acc.setupToken === 'string' && acc.setupToken.length > 20);

  // Hisob `users` jadvalida MANFIY telegram_id bilan juftlanadi.
  // Aynan shu Telegram orqali kirishni imkonsiz qiladi.
  const person = webAuth.personFor(acc.user.id);
  check('shaxs qatori yaratildi', person !== null);
  check('roli klinika administratori', person.roles.includes('clinic_admin'), person?.roles);
  check('klinikaga biriktirildi', person.clinicId === clinic.id, person?.clinicId);

  const rawPerson = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(person.id);
  check('telegram_id manfiy — Telegram orqali topilmaydi', rawPerson.telegram_id < 0, rawPerson.telegram_id);

  // Bemor roli bu qatorga tegmaydi
  check('bemor roli berilmadi', !person.roles.includes('patient'), person?.roles);

  throws('parol o‘rnatmasdan kirib bo‘lmaydi', () => webAuth.login('sinov@klinika.local', 'nimadir'));
  throws('qisqa parol rad etiladi', () => webAuth.completeSetup(acc.setupToken, 'qisqa'), 'weak_password');
  throws(
    'faqat raqamdan iborat parol rad etiladi',
    () => webAuth.completeSetup(acc.setupToken, '1234567890123'),
    'weak_password',
  );

  webAuth.completeSetup(acc.setupToken, 'yaxshi-parol-2026');
  throws('sozlash havolasi bir martalik', () => webAuth.completeSetup(acc.setupToken, 'boshqa-parol-2026'));

  const session = webAuth.login('sinov@klinika.local', 'yaxshi-parol-2026', '1.2.3.4', 'test');
  check('kirish muvaffaqiyatli', typeof session.token === 'string');
  check('2FA yoqilmagan — sessiya darhol to‘liq', session.mfaRequired === false);

  // Token bazada OCHIQ saqlanmaydi: baza sizib chiqsa ham u bilan kirib bo'lmaydi
  const stored = db.prepare('SELECT token FROM admin_sessions WHERE admin_id = ?').get(acc.user.id);
  check('sessiya tokeni bazada ochiq saqlanmaydi', stored.token !== session.token);

  check('sessiya tanildi', webAuth.resolveSession(session.token)?.user.id === acc.user.id);
  webAuth.logout(session.token);
  check('chiqqandan keyin sessiya yo‘q', webAuth.resolveSession(session.token) === null);

  // Ketma-ket xato urinishlar hisobni qulflaydi
  for (let i = 0; i < 5; i++) {
    try {
      webAuth.login('sinov@klinika.local', 'notogri-parol');
    } catch {
      /* kutilgan */
    }
  }
  throws('5 xatodan keyin hisob qulflandi', () => webAuth.login('sinov@klinika.local', 'yaxshi-parol-2026'));

  throws(
    'bir email ikki marta ishlatilmaydi',
    () => webAuth.createAccount({ email: 'sinov@klinika.local', fullName: 'X', level: 'clinic_admin', clinicId: clinic.id }),
    'email_taken',
  );
  throws(
    'klinikasiz klinika roli bo‘lmaydi',
    () => webAuth.createAccount({ email: 'x@y.local', fullName: 'X', level: 'clinic_operator', clinicId: null }),
    'clinic_required',
  );
  throws(
    'admin hisobi klinikaga bog‘lanmaydi',
    () => webAuth.createAccount({ email: 'x@y.local', fullName: 'X', level: 'full', clinicId: clinic.id }),
    'clinic_not_allowed',
  );

  // `full` daraja platformada `admin` roli bilan ish ko'radi
  const adminAcc = webAuth.createAccount({ email: 'bosh@klinikatop.uz', fullName: 'Bosh Admin', level: 'full', clinicId: null });
  check('full daraja admin roliga aylandi', webAuth.personFor(adminAcc.user.id).roles.includes('admin'));

  /* ── 2FA ── */
  const totp = webAuth.startTotpSetup(adminAcc.user.id);
  check('otpauth havolasi yasaldi', totp.otpauth.startsWith('otpauth://totp/'));
  check('sir base32 shaklida', /^[A-Z2-7]+$/.test(totp.secret), totp.secret);

  const goodCode = webAuth.currentTotp(totp.secret);
  check('joriy kod qabul qilinadi', webAuth.verifyTotp(totp.secret, goodCode) === true, goodCode);
  check('shakli buzilgan kod rad etiladi', webAuth.verifyTotp(totp.secret, '12ab') === false);
  throws('noto‘g‘ri kod bilan 2FA yoqilmaydi', () => webAuth.confirmTotp(adminAcc.user.id, '000001'));

  webAuth.confirmTotp(adminAcc.user.id, webAuth.currentTotp(totp.secret));

  // 2FA yoqilgach parol YETARLI EMAS: sessiya to'liq bo'lmaydi
  webAuth.completeSetup(adminAcc.setupToken, 'admin-paroli-2026');
  const adminSession = webAuth.login('bosh@klinikatop.uz', 'admin-paroli-2026');
  check('2FA yoqilgach kod talab qilinadi', adminSession.mfaRequired === true);
  check('sessiya hali to‘liq emas', webAuth.resolveSession(adminSession.token).mfaPassed === false);

  webAuth.passMfa(adminSession.token, webAuth.currentTotp(totp.secret));
  check('kod kiritilgach sessiya to‘liq', webAuth.resolveSession(adminSession.token).mfaPassed === true);


  /* ═════ 15. Katalog sinxronizatsiyasi ═════ */
  console.log('\n15. Katalog sinxronizatsiyasi');

  const { slugify } = require('../lib/format');

  check('slug lotinga o‘girildi', slugify('Qalqonsimon bez') === 'qalqonsimon-bez', slugify('Qalqonsimon bez'));
  check('kirill lotinga o‘girildi', slugify('Холецистэктомия') === 'holetsistektomiya', slugify('Холецистэктомия'));
  check('tutuq belgisi tashlandi', slugify("Ko‘z operatsiyasi") === 'koz-operatsiyasi', slugify("Ko‘z operatsiyasi"));
  check('bo‘sh matndan ham slug chiqadi', slugify('!!!') === '', slugify('!!!'));

  /*
   * Sinxronizatsiyaning eng xavfli xossasi — u HECH QACHON o'chirmasligi.
   * Klinika tanlagan operatsiya o'chirilsa, uning sozlamasi va o'tgan
   * bitimlari uziladi. Shuni to'g'ridan-to'g'ri tekshiramiz.
   */
  const catalogSync = require('../services/catalogSync');

  // Manba jadvallarini taqlid qilamiz: haqiqiy Postgres testda yo'q,
  // shuning uchun import natijasini qo'lda yasab, xulq-atvorni sinaymiz.
  const catId = db
    .prepare("INSERT INTO operation_categories (slug, name_uz, name_ru, icon, source, external_id) VALUES ('sinov-kat','Sinov','Тест','', 'banisa','cat-1')")
    .run().lastInsertRowid;

  const importedOp = db
    .prepare(
      "INSERT INTO operations (category_id, slug, name_uz, name_ru, active, source, external_id) VALUES (?, 'sinov-op', 'Sinov operatsiyasi', 'Тестовая', 1, 'banisa', 'op-1')",
    )
    .run(catId).lastInsertRowid;

  // Klinika uni tanlaydi
  db.prepare('INSERT OR IGNORE INTO clinic_operations (clinic_id, operation_id) VALUES (?, ?)').run(
    clinic.id,
    importedOp,
  );

  // Manbadan yo'qolgandek qilib deaktivatsiya qilamiz
  db.prepare('UPDATE operations SET active = 0 WHERE id = ?').run(importedOp);

  const stillLinked = db
    .prepare('SELECT COUNT(*) c FROM clinic_operations WHERE operation_id = ?')
    .get(importedOp).c;
  check('deaktivatsiya klinika tanlovini buzmadi', stillLinked === 1, stillLinked);

  const stillExists = db.prepare('SELECT active FROM operations WHERE id = ?').get(importedOp);
  check('operatsiya o‘chirilmadi, yashirildi', stillExists && stillExists.active === 0);

  // Yashirilgan operatsiya bemorga ko'rinmaydi
  const visible = catalog.listOperations().some((o: any) => o.id === importedOp);
  check('yashirilgan operatsiya katalogda yo‘q', visible === false);

  // Qo'lda kiritilganlarga teginilmaydi
  const manualCount = db.prepare("SELECT COUNT(*) c FROM operations WHERE source = 'manual'").get().c;
  check('qo‘lda kiritilganlar saqlanib qoldi', manualCount > 0, manualCount);

  // Jurnal
  const before = db.prepare('SELECT COUNT(*) c FROM catalog_sync_log').get().c;
  try {
    await catalogSync.runSync(null);
  } catch {
    /* manba sozlanmagan — kutilgan */
  }
  const after = db.prepare('SELECT COUNT(*) c FROM catalog_sync_log').get().c;
  check('muvaffaqiyatsiz urinish ham jurnalga tushdi', after === before + 1, { before, after });

  const lastLog = catalogSync.listSyncLog(1)[0];
  check('jurnalda xato sababi bor', lastLog.status === 'failed' && Boolean(lastLog.error), lastLog);

  check('manba sozlanmagani aniqlandi', catalogSync.sourceConfigured() === false);

  /*
   * Takrorlanish — import qiladigan tizimning eng jimgina buziladigan
   * joyi. Bir xil nomli ikki operatsiya paydo bo'lsa, bemor birini
   * tanlab klinika ikkinchisini yoqadi va so'rov hech qachon yetib
   * bormaydi. Xato ko'rinmaydi: shunchaki hech kim taklif yubormaydi.
   */
  const normalizeFn = require('../lib/format').normalize;
  const dupes = db
    .prepare('SELECT name_uz, COUNT(*) c FROM operations WHERE active = 1 GROUP BY LOWER(name_uz) HAVING c > 1')
    .all();
  check('katalogda takroriy nom yo‘q', dupes.length === 0, dupes);

  check('nomlar solishtirish uchun bir shaklga keltiriladi',
    normalizeFn('Ko‘z  Xirurgiyasi') === normalizeFn("Ko'z Xirurgiyasi"));

  /*
   * Butun ishning maqsadi: klinika import qilingan yo'nalishni
   * faollashtirsa, o'sha yo'nalish bo'yicha so'rov unga KO'RINSIN.
   *
   * Mos kelish `operation_id` bo'yicha ishlaydi, ya'ni operatsiya
   * qaysi manbadan kelgani ahamiyatsiz bo'lishi kerak. Buni faraz
   * qilib qo'ymay, to'g'ridan-to'g'ri tekshiramiz.
   */
  const matchSvc = require('../services/matching');

  const importedOp2 = db
    .prepare(
      "INSERT INTO operations (category_id, slug, name_uz, name_ru, active, source, external_id) VALUES (?, 'import-mos', 'Import qilingan operatsiya', 'Импортированная', 1, 'banisa', 'op-match')",
    )
    .run(catId).lastInsertRowid;

  let matched = matchSvc.findMatchingClinics(importedOp2, clinic.cityId);
  check('yo‘nalish yoqilmagan — klinika chiqmadi', matched.length === 0, matched.length);

  db.prepare('INSERT OR IGNORE INTO clinic_operations (clinic_id, operation_id) VALUES (?, ?)').run(
    clinic.id,
    importedOp2,
  );

  matched = matchSvc.findMatchingClinics(importedOp2, clinic.cityId);
  check(
    'yo‘nalish yoqilgach klinika so‘rovni oladi',
    matched.some((c: any) => c.id === clinic.id),
    matched.map((c: any) => c.id),
  );

  // Boshqa shahardagi so'rov kelmasligi kerak
  const otherCity = db.prepare('SELECT id FROM cities WHERE id <> ?').get(clinic.cityId) as any;
  const wrongCity = matchSvc.findMatchingClinics(importedOp2, otherCity.id);
  check(
    'boshqa viloyat so‘rovi kelmadi',
    !wrongCity.some((c: any) => c.id === clinic.id),
    wrongCity.length,
  );

  // Yo'nalish o'chirilsa ham eski bog'lanish saqlanadi, lekin katalogda ko'rinmaydi
  db.prepare('UPDATE operations SET active = 0 WHERE id = ?').run(importedOp2);
  check(
    'yashirilgach ham klinika bog‘lanishi buzilmadi',
    db.prepare('SELECT COUNT(*) c FROM clinic_operations WHERE operation_id = ?').get(importedOp2).c === 1,
  );

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Natija: ${passed} o'tdi, ${failed} yiqildi`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nTest ishga tushmadi:', err);
  process.exit(1);
});
