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

import nodeCrypto from 'node:crypto';

/** Test uchun TOTP kodi — servisdagi bilan bir xil algoritm. */
function totpFor(secret: string): string {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secret) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 30_000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const digest = nodeCrypto.createHmac('sha1', Buffer.from(bytes)).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
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
  db.prepare(`UPDATE users SET roles = ? WHERE id = ?`).run(toJson(['admin']), moderator.id);

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

  section('11. So‘rovlar soni va o‘chirish');
  db.prepare(`UPDATE clinics SET subscription_status = 'active', subscription_until = datetime('now','+30 days') WHERE id = ?`).run(clinic.id);

  const makeRequest = () =>
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

  /*
   * Faol so'rovlar soniga cheklov YO'Q.
   *
   * Ilgari uchtadan keyin to'xtardi. Bir odamda bir necha muammo
   * bo'lishi mumkin va oila a'zolari uchun ham so'rov qoldiradi.
   * Spamdan himoya daqiqalik tezlik cheklovida.
   */
  const activeBefore = db
    .prepare("SELECT COUNT(*) c FROM requests WHERE patient_id = ? AND status IN ('NEW','COLLECTING')")
    .get(patient.id).c;

  for (let i = 0; i < 6; i++) makeRequest();

  const activeAfter = db
    .prepare("SELECT COUNT(*) c FROM requests WHERE patient_id = ? AND status IN ('NEW','COLLECTING')")
    .get(patient.id).c;
  check('cheklovsiz so‘rov qoldirildi', activeAfter === activeBefore + 6, { activeBefore, activeAfter });

  /* ── O'chirish ── */

  const doomed = makeRequest();
  check('o‘chirish uchun so‘rov yaratildi', doomed.id > 0);

  throws('boshqa odam so‘rovni o‘chirib bo‘lmaydi', () => requests.deleteRequest(doomed.id, clinicUser.id));

  requests.deleteRequest(doomed.id, patient.id);
  check(
    'so‘rov bazadan yo‘qoldi',
    db.prepare('SELECT COUNT(*) c FROM requests WHERE id = ?').get(doomed.id).c === 0,
  );

  /*
   * Takliflar va tarqatmalar kaskad bilan ketishi kerak — aks holda
   * klinika ro'yxatida yo'q so'rovga havola qolib, ekran buzilardi.
   */
  const withOffer = makeRequest();
  offers.createOffer({
    requestId: withOffer.id,
    clinicId: clinic.id,
    priceUzs: 8_000_000,
    includes: ['Operatsiya'],
    advantages: [],
    leadTimeDays: 5,
    note: null,
  });

  const offerCount = db.prepare('SELECT COUNT(*) c FROM offers WHERE request_id = ?').get(withOffer.id).c;
  check('taklif yuborildi', offerCount === 1, offerCount);

  requests.deleteRequest(withOffer.id, patient.id);
  check(
    'takliflar ham o‘chdi',
    db.prepare('SELECT COUNT(*) c FROM offers WHERE request_id = ?').get(withOffer.id).c === 0,
  );
  check(
    'tarqatmalar ham o‘chdi',
    db.prepare('SELECT COUNT(*) c FROM request_broadcasts WHERE request_id = ?').get(withOffer.id).c === 0,
  );

  /*
   * Biriktirilgan fayllar ham ketishi kerak. Aks holda o'chirilgan
   * so'rovning tibbiy suratlari serverda qolib ketardi va
   * "o'chirdim" degan so'z yolg'on bo'lardi.
   */
  const fileSvc = require('../services/files');
  const attached = fileSvc.saveFile({
    ownerId: patient.id,
    name: 'tekshiruv.pdf',
    mimeType: 'application/pdf',
    kind: 'other',
    dataBase64: Buffer.from('%PDF-1.4 UZI natijasi').toString('base64'),
  });

  const withFile = requests.createRequest({
    patientId: patient.id,
    operationId: gallbladder.id,
    cityId: tashkent.id,
    budgetUzs: 9_000_000,
    note: null,
    urgency: 'normal',
    attachments: [attached.id],
    aiSuggested: false,
    conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
    acceptTerms: true,
  });

  // `storage_path` — nisbiy nom; to'liq yo'lni servisdagi kabi yig'amiz
  const uploadsDir = path.resolve(path.dirname(TEST_DB), 'uploads');
  const onDisk = db.prepare('SELECT storage_path FROM files WHERE id = ?').get(attached.id);
  const fullPath = path.join(uploadsDir, path.basename(onDisk.storage_path));
  check('fayl diskda paydo bo‘ldi', fs.existsSync(fullPath), fullPath);

  requests.deleteRequest(withFile.id, patient.id);

  check(
    'fayl yozuvi bazadan o‘chdi',
    db.prepare('SELECT COUNT(*) c FROM files WHERE id = ?').get(attached.id).c === 0,
  );
  check('fayl diskdan ham o‘chdi', !fs.existsSync(fullPath));

  // Boshqa odamning fayliga tegilmaydi
  const foreign = fileSvc.saveFile({
    ownerId: clinicUser.id,
    name: 'klinika.pdf',
    mimeType: 'application/pdf',
    kind: 'other',
    dataBase64: Buffer.from('%PDF-1.4 klinika hujjati').toString('base64'),
  });
  fileSvc.deleteFiles([foreign.id], patient.id);
  check(
    'begona fayl o‘chmadi',
    db.prepare('SELECT COUNT(*) c FROM files WHERE id = ?').get(foreign.id).c === 1,
  );

  /*
   * BITIM tuzilgan so'rov o'chirilmaydi. Bu adolat masalasi: bitimda
   * klinikaning ishi va komissiya hisobi bor, bir tomon uni bir
   * bosishda yo'q qila olmasligi kerak.
   */
  const withDeal = makeRequest();
  const dealOffer = offers.createOffer({
    requestId: withDeal.id,
    clinicId: clinic.id,
    priceUzs: 7_500_000,
    includes: ['Operatsiya'],
    advantages: [],
    leadTimeDays: 5,
    note: null,
  });
  deals.chooseOffer(withDeal.id, dealOffer.id, patient.id);

  throws(
    'bitim tuzilgan so‘rov o‘chirilmaydi',
    () => requests.deleteRequest(withDeal.id, patient.id),
    'request_has_deal',
  );
  check(
    'bitim joyida qoldi',
    db.prepare('SELECT COUNT(*) c FROM deals WHERE request_id = ?').get(withDeal.id).c === 1,
  );

  /* ═════ 14. Veb hisoblar: klinika va admin ═════ */
  console.log('\n14. Veb hisoblar va rollarning ajratilishi');

  const webAuth = require('../services/webAuth');

  /*
   * Kirish identifikatori — TELEFON. Raqam turli shaklda kelishi
   * mumkin va hammasi bitta hisobga olib borishi kerak, aks holda bir
   * odam ikki hisob yasab, nima uchun kira olmayotganini tushunmasdi.
   */
  check('xalqaro shakl', webAuth.normalizePhone('+998 90 123 45 67') === '998901234567');
  check('mahalliy 9 xonali', webAuth.normalizePhone('901234567') === '998901234567');
  check('eski 8 bilan', webAuth.normalizePhone('8901234567') === '998901234567');
  check('qavs va chiziqcha', webAuth.normalizePhone('(90) 123-45-67') === '998901234567');

  const acc = webAuth.createAccount({
    phone: '+998 90 111 22 33',
    email: 'Sinov@Klinika.LOCAL',
    fullName: 'Sinov Egasi',
    level: 'clinic_admin',
    clinicId: clinic.id,
  });

  check('raqam bir shaklga keltirildi', acc.user.phone === '998901112233', acc.user.phone);
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

  throws('parol o‘rnatmasdan kirib bo‘lmaydi', () => webAuth.login('998901112233', 'nimadir'));
  throws('qisqa parol rad etiladi', () => webAuth.completeSetup(acc.setupToken, 'qisqa'), 'weak_password');
  throws(
    'faqat raqamdan iborat parol rad etiladi',
    () => webAuth.completeSetup(acc.setupToken, '1234567890123'),
    'weak_password',
  );

  webAuth.completeSetup(acc.setupToken, 'yaxshi-parol-2026');
  throws('sozlash havolasi bir martalik', () => webAuth.completeSetup(acc.setupToken, 'boshqa-parol-2026'));

  // Raqam qanday yozilishidan qat'i nazar bir xil hisobga tushadi
  const session = webAuth.login('+998 90 111 22 33', 'yaxshi-parol-2026', '1.2.3.4', 'test');
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
      webAuth.login('998901112233', 'notogri-parol');
    } catch {
      /* kutilgan */
    }
  }
  throws('5 xatodan keyin hisob qulflandi', () => webAuth.login('998901112233', 'yaxshi-parol-2026'));

  throws(
    'bir raqam ikki marta ishlatilmaydi',
    () =>
      webAuth.createAccount({
        phone: '998901112233',
        fullName: 'X',
        level: 'clinic_admin',
        clinicId: clinic.id,
      }),
    'phone_taken',
  );
  throws(
    'klinikasiz klinika roli bo‘lmaydi',
    () => webAuth.createAccount({ phone: '998900000009', fullName: 'X', level: 'clinic_operator', clinicId: null }),
    'clinic_required',
  );
  throws(
    'admin hisobi klinikaga bog‘lanmaydi',
    () => webAuth.createAccount({ phone: '998900000008', fullName: 'X', level: 'full', clinicId: clinic.id }),
    'clinic_not_allowed',
  );

  // `full` daraja platformada `admin` roli bilan ish ko'radi
  const adminAcc = webAuth.createAccount({
    phone: '998900000001',
    fullName: 'Bosh Admin',
    level: 'full',
    clinicId: null,
  });
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
  const adminSession = webAuth.login('998900000001', 'admin-paroli-2026');
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

  /*
   * Katalog 100% manbadan bo'lishi kerak. Qo'lda kiritilganlar
   * ro'yxatdan chiqadi, lekin O'CHIRILMAYDI: `requests.operation_id`
   * ularga ishora qilishi mumkin.
   */
  const manualRows = db
    .prepare("SELECT COUNT(*) c FROM operations WHERE external_id IS NULL AND slug <> 'unknown'")
    .get().c;
  check('qo‘lda kiritilganlar bazada saqlanib qoldi', manualRows > 0, manualRows);

  // "Bilmayman" sentineli mavjud bo'lishi shart — usiz bemor oqimi buziladi
  const sentinel = db.prepare("SELECT active FROM operations WHERE slug = 'unknown'").get();
  check('“Bilmayman” yozuvi mavjud', Boolean(sentinel));

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

  /*
   * Manbadan bo'lmagan yozuvni yashirish qoidasini to'g'ridan-to'g'ri
   * tekshiramiz: sinxronizatsiya SQL'i shu shartga tayanadi va uni
   * bexosdan o'zgartirish katalogga begona yozuvlarni qaytarardi.
   */
  const hiddenByRule = db
    .prepare(
      "SELECT COUNT(*) c FROM operations WHERE active = 1 AND external_id IS NULL AND slug <> 'unknown'",
    )
    .get().c;
  const willHide = db
    .prepare(
      "UPDATE operations SET active = 0 WHERE active = 1 AND external_id IS NULL AND slug <> 'unknown'",
    )
    .run().changes;
  check('qoida barcha begona yozuvni topdi', willHide === hiddenByRule, { willHide, hiddenByRule });

  const leftOver = db
    .prepare("SELECT COUNT(*) c FROM operations WHERE active = 1 AND external_id IS NULL AND slug <> 'unknown'")
    .get().c;
  check('katalogda faqat manbadan kelganlar qoldi', leftOver === 0, leftOver);

  /*
   * Sentinel katalogda `active = 0` bilan turadi — u ro'yxat elementi
   * emas, oqim belgisi. Muhimi qoida unga TEGMASLIGI: uni faol qilib
   * ko'ramiz va qoidadan keyin faol qolganini tekshiramiz.
   */
  db.prepare("UPDATE operations SET active = 1 WHERE slug = 'unknown'").run();
  db.prepare(
    "UPDATE operations SET active = 0 WHERE active = 1 AND external_id IS NULL AND slug <> 'unknown'",
  ).run();
  const sentinelAfter = db.prepare("SELECT active FROM operations WHERE slug = 'unknown'").get();
  check('qoida “Bilmayman” yozuviga tegmadi', sentinelAfter?.active === 1, sentinelAfter);
  db.prepare("UPDATE operations SET active = 0 WHERE slug = 'unknown'").run();

  /*
   * Bo'shab qolgan kategoriyalar ro'yxatga chiqmasligi kerak. Ular
   * o'chirilmaydi — ichidagi yashirilgan yozuvlarga o'tgan so'rovlar
   * ishora qiladi — lekin bemor ochib bo'sh bo'limga tushmasin.
   */
  const emptyCat = db
    .prepare("INSERT INTO operation_categories (slug, name_uz, name_ru, icon) VALUES ('bosh-kat','Bo‘sh','Пустая','')")
    .run().lastInsertRowid;

  // Oldingi tekshiruvlar `catId` ichidagi hamma narsani yashirgan edi
  db.prepare(
    "INSERT INTO operations (category_id, slug, name_uz, name_ru, active, source, external_id) VALUES (?, 'kat-tirik', 'Tirik yozuv', 'Живая', 1, 'banisa', 'op-alive')",
  ).run(catId);

  const listed = catalog.listCategories();
  check(
    'bo‘sh kategoriya ro‘yxatda yo‘q',
    !listed.some((c: any) => c.id === emptyCat),
    listed.length,
  );
  check(
    'ichida yozuvi bori ro‘yxatda bor',
    listed.some((c: any) => c.id === catId),
    listed.map((c: any) => c.id),
  );


  /* ═════ 16. Telefon bo'yicha tanish (bot va Mini App) ═════ */
  console.log('\n16. Telefon bo‘yicha tanish');

  const identity = require('../services/clinicIdentity');

  check('notanish raqam — hech narsa yo‘q', identity.clinicStandingByPhone('998900099009').kind === 'none');
  check('buzuq raqam ham xato bermaydi', identity.clinicStandingByPhone('abc').kind === 'none');

  /*
   * Ariza bosqichi: hisob hali yo'q, lekin odam holatini bilishi kerak.
   * Ilgari u moderatordan qo'ng'iroq kutib o'tirardi.
   */
  const appId = db
    .prepare(
      `INSERT INTO clinic_applications
         (name, city_id, address, about, license_no, contact_name, contact_phone, contact_email, operation_ids, status)
       VALUES ('Ariza Klinikasi', ?, 'Toshkent', '', 'LIC-ID-1', 'Aziz', '+998 90 555 44 33', NULL, '[1]', 'pending')`,
    )
    .run(clinic.cityId).lastInsertRowid;

  let standing = identity.clinicStandingByPhone('998905554433');
  check('ariza holati topildi', standing.kind === 'pending', standing.kind);
  check('ariza raqami qaytdi', standing.applicationId === appId, standing);

  // Raqam boshqa shaklda yozilgan bo'lsa ham topilishi kerak
  check('mahalliy shaklda ham topildi', identity.clinicStandingByPhone('905554433').kind === 'pending');

  db.prepare("UPDATE clinic_applications SET status = 'rejected', note = 'Litsenziya eskirgan' WHERE id = ?").run(appId);
  standing = identity.clinicStandingByPhone('998905554433');
  check('rad etilgani ko‘rinadi', standing.kind === 'rejected', standing.kind);
  check('rad sababi ham qaytadi', standing.note === 'Litsenziya eskirgan', standing.note);

  /* ── Hisob ochilgach ── */
  const idAcc = webAuth.createAccount({
    phone: '998905554433',
    fullName: 'Aziz',
    level: 'clinic_admin',
    clinicId: clinic.id,
  });

  standing = identity.clinicStandingByPhone('998905554433');
  check('hisob arizadan ustun turadi', standing.kind === 'needs_password', standing.kind);
  check('sozlash tokeni berildi', typeof standing.setupToken === 'string' && standing.setupToken.length > 20);

  /*
   * Parol qo'yilmagan hisobga Telegram orqali ham kirib bo'lmaydi.
   * Aks holda raqami bo'lgan har kim parolsiz kabinetga tushardi.
   */
  check(
    'parolsiz hisobga Telegram orqali kirib bo‘lmaydi',
    webAuth.loginByVerifiedPhone('998905554433', null, null) === null,
  );

  webAuth.completeSetup(idAcc.setupToken, 'klinika-paroli-2026');
  standing = identity.clinicStandingByPhone('998905554433');
  check('parol qo‘yilgach tayyor', standing.kind === 'ready', standing.kind);

  /* ── Telegram orqali kirish ── */
  const tgSession = webAuth.loginByVerifiedPhone('+998 90 555 44 33', '1.2.3.4', 'telegram');
  check('tasdiqlangan raqam bilan sessiya ochildi', Boolean(tgSession?.token));
  const resolved = webAuth.resolveSession(tgSession.token);
  check('sessiya to‘g‘ri hisobga tegishli', resolved?.user.id === idAcc.user.id, resolved?.user.id);
  check('2FA yo‘q — sessiya to‘liq', resolved?.mfaPassed === true);

  check(
    'notanish raqam bilan sessiya ochilmaydi',
    webAuth.loginByVerifiedPhone('998900099009', null, null) === null,
  );

  // O'chirilgan hisob Telegram orqali ham kira olmaydi
  db.prepare("UPDATE admin_users SET disabled_at = datetime('now') WHERE id = ?").run(idAcc.user.id);
  check(
    'o‘chirilgan hisob kira olmaydi',
    webAuth.loginByVerifiedPhone('998905554433', null, null) === null,
  );
  db.prepare('UPDATE admin_users SET disabled_at = NULL WHERE id = ?').run(idAcc.user.id);


  /* ═════ 17. Hisob xavfsizligi: 2FA, parol, sessiyalar ═════ */
  console.log('\n17. Hisob xavfsizligi');

  const secAcc = webAuth.createAccount({
    phone: '998907776655',
    fullName: 'Xavfsizlik Sinovi',
    level: 'clinic_admin',
    clinicId: clinic.id,
  });
  webAuth.completeSetup(secAcc.setupToken, 'birinchi-parol-2026');

  const s1 = webAuth.login('998907776655', 'birinchi-parol-2026', '1.1.1.1', 'kompyuter');
  const s2 = webAuth.login('998907776655', 'birinchi-parol-2026', '2.2.2.2', 'telefon');
  check('ikki sessiya ochildi', webAuth.listSessions(secAcc.user.id, s1.token).length === 2);
  check('joriy sessiya belgilangan',
    webAuth.listSessions(secAcc.user.id, s1.token).filter((r: any) => r.current).length === 1);

  /* ── Parol almashtirish ── */

  throws(
    'joriy parolsiz almashtirib bo‘lmaydi',
    () => webAuth.changePassword(secAcc.user.id, 'notogri', 'yangi-parol-2026', s1.token),
  );
  throws(
    'qisqa parol qabul qilinmaydi',
    () => webAuth.changePassword(secAcc.user.id, 'birinchi-parol-2026', 'qisqa', s1.token),
    'weak_password',
  );
  throws(
    'faqat raqamli parol qabul qilinmaydi',
    () => webAuth.changePassword(secAcc.user.id, 'birinchi-parol-2026', '12345678901', s1.token),
    'weak_password',
  );

  webAuth.changePassword(secAcc.user.id, 'birinchi-parol-2026', 'ikkinchi-parol-2026', s1.token);

  /*
   * Odam parolni odatda "kimdir kirgan" deb o'ylab almashtiradi.
   * Eski sessiyalar ochiq qolsa bu harakat ma'nosiz bo'lardi.
   */
  check('boshqa sessiya yopildi', webAuth.resolveSession(s2.token) === null);
  check('joriy sessiya ochiq qoldi', webAuth.resolveSession(s1.token) !== null);

  throws('eski parol endi ishlamaydi', () => webAuth.login('998907776655', 'birinchi-parol-2026'));
  check('yangi parol ishlaydi',
    Boolean(webAuth.login('998907776655', 'ikkinchi-parol-2026', null, null).token));

  /* ── 2FA ── */

  check('dastlab 2FA yoqilmagan', secAcc.user.totpEnabled === false);

  const totpSetup = webAuth.startTotpSetup(secAcc.user.id);
  check('otpauth havolasi to‘g‘ri', totpSetup.otpauth.startsWith('otpauth://totp/'));
  check('sir base32 shaklida', /^[A-Z2-7]{32}$/.test(totpSetup.secret), totpSetup.secret);

  throws('noto‘g‘ri kod bilan yoqilmaydi', () => webAuth.confirmTotp(secAcc.user.id, '000000'));

  /*
   * Haqiqiy kodni o'zimiz hisoblaymiz — tekshiruv chinakam TOTP
   * algoritmidan o'tsin, "har qanday olti raqam bo'ladi" emas.
   */
  const validCode = totpFor(totpSetup.secret);
  webAuth.confirmTotp(secAcc.user.id, validCode);

  const afterTotp = webAuth.login('998907776655', 'ikkinchi-parol-2026', null, null);
  check('2FA yoqilgach kirish yarim qoladi', afterTotp.mfaRequired === true);
  check('yarim sessiya to‘liq emas', webAuth.resolveSession(afterTotp.token)?.mfaPassed === false);

  throws('noto‘g‘ri kod sessiyani to‘ldirmaydi', () => webAuth.passMfa(afterTotp.token, '000000'));

  webAuth.passMfa(afterTotp.token, totpFor(totpSetup.secret));
  check('to‘g‘ri kod sessiyani to‘ldirdi', webAuth.resolveSession(afterTotp.token)?.mfaPassed === true);

  /*
   * Telegram orqali kirishda ham 2FA talab qilinadi: ikkinchi
   * bosqichning maqsadi "bitta narsa o'g'irlansa ham yetarli
   * bo'lmasin", telefonni qo'lga kiritgan odam uchun ham shu qoida.
   */
  const tgAfterTotp = webAuth.loginByVerifiedPhone('998907776655', null, null);
  check('Telegram orqali ham 2FA so‘raladi', tgAfterTotp?.mfaRequired === true);
  check('u ham yarim sessiya', webAuth.resolveSession(tgAfterTotp.token)?.mfaPassed === false);

  /* ── 2FA ni o'chirish ── */

  throws('parolsiz 2FA o‘chirilmaydi', () => webAuth.disableTotp(secAcc.user.id, 'notogri'));
  webAuth.disableTotp(secAcc.user.id, 'ikkinchi-parol-2026');
  check('2FA o‘chirildi',
    webAuth.login('998907776655', 'ikkinchi-parol-2026', null, null).mfaRequired === false);


  /* ═════ 18. Profil ustiga yozilmasligi ═════ */
  console.log('\n18. Telegram profil ustiga yozmaydi');

  /*
   * Bemor familiyasini kiritgach, keyingi so'rovda u Telegramdagi
   * qiymat bilan almashardi — Telegramda familiya yo'q bo'lsa esa
   * bo'shab qolardi. Natijada profil "to'liq emas" bo'lib, odam
   * ro'yxatdan o'tish ekraniga qaytaverardi va sababini bilmasdi.
   */
  const tgUser = { id: 900555, first_name: 'Telegramdagi', language_code: 'uz' };
  const createdUser = upsertUser(tgUser);
  check('birinchi kirishda Telegram ismi olindi', createdUser.firstName === 'Telegramdagi');
  check('familiya dastlab bo‘sh', !createdUser.lastName);

  db.prepare(`UPDATE users SET first_name = ?, last_name = ? WHERE id = ?`).run(
    'Aziz',
    'Karimov',
    createdUser.id,
  );

  // Telegramda familiya YO'Q — lekin kiritilgani saqlanib qolishi kerak
  const againUser = upsertUser(tgUser);
  check('kiritilgan ism saqlandi', againUser.firstName === 'Aziz', againUser.firstName);
  check('kiritilgan familiya saqlandi', againUser.lastName === 'Karimov', againUser.lastName);

  // Telegram boshqa ism yuborsa ham tegmaydi
  const thirdUser = upsertUser({ ...tgUser, first_name: 'Boshqa', last_name: 'Nom' });
  check('Telegram ismni qayta yozmadi', thirdUser.firstName === 'Aziz', thirdUser.firstName);
  check('Telegram familiyani qayta yozmadi', thirdUser.lastName === 'Karimov', thirdUser.lastName);

  // Telegramga tegishli maydonlar esa yangilanadi
  const fourthUser = upsertUser({ ...tgUser, username: 'yangi_login' });
  check('username yangilandi', fourthUser.username === 'yangi_login', fourthUser.username);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Natija: ${passed} o'tdi, ${failed} yiqildi`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nTest ishga tushmadi:', err);
  process.exit(1);
});
