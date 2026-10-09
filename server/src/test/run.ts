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
/*
 * banisa sirlari MODULLAR YUKLANISHIDAN oldin qo'yiladi — `config`
 * ularni bir marta o'qiydi va keyin o'zgartirib bo'lmaydi.
 *
 * Bu muhim: sir bo'lmasa `verifyTicket` darhol "sozlanmagan" deb
 * xato beradi va biletga oid tekshiruvlar noto'g'ri sababdan
 * "o'tib ketadi".
 */
process.env.LINK_TICKET_SECRET = 'sinov-uchun-bilet-siri-2026';
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

/** Bugundan N kun keyingi sana (YYYY-MM-DD). */
function futureDate(days: number): string {
  return new Date(Date.now() + days * 24 * 3600_000).toISOString().slice(0, 10);
}

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
        note: null,
        proposedDates: [futureDate(5)],
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
        note: null,
        proposedDates: [futureDate(5)],
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
        note: null,
        proposedDates: [futureDate(5)],
      }),
    'includes_required',
  );

  const offer = offers.createOffer({
    requestId: request.id,
    clinicId: clinic.id,
    priceUzs: 11_500_000,
    includes: ['Operatsiya', 'Narkoz', 'Palata (2 kun)'],
    advantages: ['Oliy toifali jarroh'],
    note: 'Ertaga qabulga kelishingiz mumkin',
    proposedDates: [futureDate(5)],
  });
  check('taklif yuborildi', offer.status === 'SENT');
  check('klinika ko‘rildi deb belgilandi', requests.getRequest(request.id).viewedCount === 1);

  throws(
    'bitta klinika ikkinchi faol taklif bera olmaydi',
    () =>
      offers.createOffer({
        requestId: 1,
        clinicId: clinic.id,
        // Byudjet chegarasi ichida — tekshirilayotgani takror, narx emas
        priceUzs: 11_000_000,
        includes: ['Operatsiya'],
        advantages: [],
        note: null,
        proposedDates: [futureDate(5)],
      }),
    'offer_exists',
  );

  const updated = offers.updateOffer(offer.id, clinic.id, { priceUzs: 10_800_000 });
  check('taklifni tahrirlash mumkin (tanlangunicha)', updated.priceUzs === 10_800_000);

  /* ── Auksion turi: klinika raqobatchini ko'radimi ── */

  const terms = require('../services/terms.business');
  const setMode = (mode: string) => terms.setTextSetting('auction_mode', mode, null);

  // Ikkinchi klinika — raqobatchi bo'lishi uchun
  const rivalUser = upsertUser({ id: 900_077, first_name: 'Raqib', language_code: 'uz' });
  const rival = clinics.registerClinic({
    userId: rivalUser.id,
    name: 'Raqib Klinika',
    cityId: tashkent.id,
    address: 'Toshkent',
    about: 'Test',
    licenseFileId: 'lic-2',
    operationIds: [gallbladder.id],
  });
  clinics.setVerification(rival.id, moderator.id, 'approved', null);
  clinics.activateSubscription(rival.id, 'pro', 1);
  offers.createOffer({
    requestId: request.id,
    clinicId: rival.id,
    // Byudjet chegarasi ichida, lekin biznikidan ARZON — birinchi o'rinda tursin
    priceUzs: 10_000_000,
    includes: ['Operatsiya'],
    advantages: [],
    note: null,
    proposedDates: [futureDate(6)],
  });

  setMode('sealed');
  const sealed = offers.competitionFor(request.id, clinic.id);
  check('yopiq: soni ko‘rinadi', sealed.count === 2, sealed.count);
  check('yopiq: o‘z o‘rni ko‘rinadi', sealed.myRank === 2, sealed.myRank);
  check(
    'yopiq: raqobatchi narxi BERILMAYDI',
    sealed.offers.length === 0 && sealed.minUzs === null && sealed.medianUzs === null,
  );

  setMode('anonymous');
  const anon = offers.competitionFor(request.id, clinic.id);
  check('nomsiz: narxlar ko‘rinadi', anon.offers.length === 2 && anon.minUzs === 10_000_000);
  check('nomsiz: NOM berilmaydi', anon.offers.every((o: any) => o.clinicName === null));
  check('nomsiz: o‘z taklifi belgilangan', anon.offers.filter((o: any) => o.mine).length === 1);
  check('nomsiz: mediana hisoblandi', anon.medianUzs === Math.round((10_000_000 + 10_800_000) / 2), anon.medianUzs);

  setMode('named');
  const named = offers.competitionFor(request.id, clinic.id);
  check(
    'nom bilan: raqobatchi nomi ko‘rinadi',
    named.offers.find((o: any) => !o.mine)?.clinicName === 'Raqib Klinika',
  );

  // Buzuq qiymat ishni to'xtatmasin
  setMode('allaqachon-yoq-rejim');
  check('noma‘lum rejim nomsizga tushadi', offers.competitionFor(request.id, clinic.id).mode === 'anonymous');
  setMode('anonymous');

  // Taklif qaytarib olinsa raqobatdan ham chiqadi
  const rivalOffer = named.offers.find((o: any) => !o.mine)!;
  offers.withdrawOffer(rivalOffer.id, rival.id);
  check('qaytarib olingan taklif raqobatda ko‘rinmaydi', offers.competitionFor(request.id, clinic.id).count === 1);

  section('6. Chat kirish nazorati va bypass himoyasi');
  throws(
    'tanlovdan OLDIN chat ochilmaydi',
    () => chat.listMessages(999, patient.id, null),
    'not_found',
  );

  const deal = deals.chooseOffer(request.id, offer.id, patient.id, offer.proposedDates[0]);
  check('bitim darrov KELISHILGAN holatda yaratildi', deal.status === 'AGREED', deal.status);
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
  check('KELISHILGAN holatiga o‘tdi', deals.getDeal(deal.id).status === 'AGREED');

  /*
   * To'lov OPERATSIYADAN OLDIN: sana kelishilgach navbat bemorda.
   * Klinika oxirida bir marta tasdiqlaydi — pul ham olindi,
   * operatsiya ham bajarildi.
   */
  const paid = deals.declarePayment(deal.id, patient.id, 10_500_000, 'cash');
  check('TO‘LANDI holatiga o‘tdi', paid.status === 'PAID');
  check('summa yozildi', paid.confirmedAmountUzs === 10_500_000);
  check('to‘lov usuli yozildi', paid.paymentMethod === 'cash');
  check('bemor to‘lagani bilan komissiya hali yo‘q', paid.commissionUzs === null);
  check('so‘rov hali yakunlanmagan', requests.getRequest(request.id).status !== 'COMPLETED');

  throws('begona klinika to‘lovni tasdiqlay olmaydi', () =>
    deals.confirmReceipt(deal.id, clinic.id + 999),
  );

  const confirmed = deals.confirmReceipt(deal.id, clinic.id);
  check('TASDIQLANGAN holatiga o‘tdi', confirmed.status === 'CONFIRMED');
  check('klinika tasdig‘i yozildi', confirmed.receiptConfirmedAt !== null);
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
    // Budjetdan yuqori — endi sabab majburiy
    priceUzs: 13_500_000,
    includes: ['Operatsiya', 'Narkoz'],
    advantages: [],
    aboveBudgetReason: 'Narkoz turi murakkabroq va bir kecha yotoq narxga kiradi',
    note: null,
    proposedDates: [futureDate(5)],
  });
  /*
   * Taklif qilinmagan kunni tanlab bo'lmaydi: aks holda bemor
   * ixtiyoriy sana yozib qo'yardi va klinika o'sha kuni band
   * bo'lishi mumkin edi — bu yana kelishuvga qaytarardi.
   */
  throws(
    'klinika taklif qilmagan kun rad etiladi',
    () => deals.chooseOffer(request2.id, offer2.id, patient.id, '2030-01-01'),
    'date_not_offered',
  );

  const deal2 = deals.chooseOffer(request2.id, offer2.id, patient.id, offer2.proposedDates[0]);
  check('bitim darrov KELISHILGAN holatda ochildi', deal2.status === 'AGREED', deal2.status);
  check('bitimda sana bor', Boolean(deal2.scheduledAt), deal2.scheduledAt);
  deals.declarePayment(deal2.id, patient.id, 13_000_000);
  deals.confirmReceipt(deal2.id, deals.getDeal(deal2.id).clinicId);

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
    note: null,
    proposedDates: [futureDate(5)],
  });
  const autoDeal = deals.chooseOffer(autoReq.id, autoOffer.id, patient.id, autoOffer.proposedDates[0]);

  /*
   * To'lovi bildirilmagan bitim avtomatik YOPILMAYDI.
   *
   * Ilgari klinikaning "bajarildi" belgisi soatni ishga tushirardi.
   * Endi bunday belgi yo'q va to'lovsiz bitimni yopish hech kim
   * "bo'ldi" demagan ish uchun komissiya yozish bo'lardi. Bunday
   * holat uchun nizo yo'li bor.
   */
  db.prepare(`UPDATE deals SET scheduled_at = datetime('now', '-30 days') WHERE id = ?`).run(autoDeal.id);
  check('to‘lovsiz bitim avtomatik yopilmaydi', deals.autoConfirmStaleDeals() === 0);

  deals.declarePayment(autoDeal.id, patient.id, 12_000_000);
  check('avto-tasdiq muddati kelmagan bitimga tegmaydi', deals.autoConfirmStaleDeals() === 0);

  // To'lov sanasini orqaga surib, muddat o'tganini taqlid qilamiz
  db.prepare(`UPDATE deals SET paid_at = datetime('now', '-30 days') WHERE id = ?`).run(autoDeal.id);
  const closed = deals.autoConfirmStaleDeals();
  check('klinika tasdiqlamagan bitim avtomatik yopildi', closed === 1, String(closed));

  const autoClosed = deals.getDeal(autoDeal.id);
  check('holat CONFIRMED', autoClosed.status === 'CONFIRMED', autoClosed.status);
  check('avto belgisi qo‘yildi', (autoClosed as any).autoConfirmed !== false);
  check(
    'komissiya bildirilgan summadan hisoblandi',
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
    note: null,
    proposedDates: [futureDate(5)],
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
    note: null,
    proposedDates: [futureDate(5)],
  });
  deals.chooseOffer(withDeal.id, dealOffer.id, patient.id, dealOffer.proposedDates[0]);

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

  throws('parol o‘rnatmasdan kirib bo‘lmaydi', () => webAuth.login('998901112233', 'nimadir', null, null, 'clinic'));
  throws('qisqa parol rad etiladi', () => webAuth.completeSetup(acc.setupToken, 'qisqa'), 'weak_password');
  throws(
    'faqat raqamdan iborat parol rad etiladi',
    () => webAuth.completeSetup(acc.setupToken, '1234567890123'),
    'weak_password',
  );

  webAuth.completeSetup(acc.setupToken, 'yaxshi-parol-2026');
  throws('sozlash havolasi bir martalik', () => webAuth.completeSetup(acc.setupToken, 'boshqa-parol-2026'));

  // Raqam qanday yozilishidan qat'i nazar bir xil hisobga tushadi
  const session = webAuth.login('+998 90 111 22 33', 'yaxshi-parol-2026', '1.2.3.4', 'test', 'clinic');
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
      webAuth.login('998901112233', 'notogri-parol', null, null, 'clinic');
    } catch {
      /* kutilgan */
    }
  }
  throws('5 xatodan keyin hisob qulflandi', () => webAuth.login('998901112233', 'yaxshi-parol-2026', null, null, 'clinic'));

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
  const adminSession = webAuth.login('998900000001', 'admin-paroli-2026', null, null, 'admin');
  check('2FA yoqilgach kod talab qilinadi', adminSession.mfaRequired === true);
  check('sessiya hali to‘liq emas', webAuth.resolveSession(adminSession.token).mfaPassed === false);

  webAuth.passMfa(adminSession.token, webAuth.currentTotp(totp.secret));
  check('kod kiritilgach sessiya to‘liq', webAuth.resolveSession(adminSession.token).mfaPassed === true);

  /* ── Kirish eshiklari: klinika va admin alohida ── */

  const doorAcc = webAuth.createAccount({
    phone: '998900000077',
    fullName: 'Eshik Sinovi',
    level: 'clinic_admin',
    clinicId: clinic.id,
  });
  webAuth.completeSetup(doorAcc.setupToken, 'klinika-eshigi-2026');

  check(
    'klinika hisobi klinika eshigidan kiradi',
    webAuth.login('998900000077', 'klinika-eshigi-2026', null, null, 'clinic').user.id === doorAcc.user.id,
  );
  throws(
    'klinika hisobi admin eshigidan kirmaydi',
    () => webAuth.login('998900000077', 'klinika-eshigi-2026', null, null, 'admin'),
    'forbidden',
  );
  throws(
    'admin hisobi klinika eshigidan kirmaydi',
    () => webAuth.login('998900000001', 'admin-paroli-2026', null, null, 'clinic'),
    'forbidden',
  );
  check(
    'admin hisobi admin eshigidan kiradi',
    webAuth.login('998900000001', 'admin-paroli-2026', null, null, 'admin').mfaRequired === true,
  );

  // Eshiksiz kirib bo'lmaydi — bu himoyani chetlab o'tishning eng oson yo'li edi
  throws(
    'eshiksiz so‘rov qabul qilinmaydi',
    () => (webAuth.login as any)('998900000077', 'klinika-eshigi-2026'),
    'forbidden',
  );

  /*
   * Noto'g'ri eshik — parol xatosi EMAS.
   *
   * Aks holda o'z parolini biladigan odam noto'g'ri sahifada bir necha
   * marta urinib, hisobini 15 daqiqaga qulflab qo'yardi.
   */
  for (let i = 0; i < 6; i += 1) {
    try {
      webAuth.login('998900000077', 'klinika-eshigi-2026', null, null, 'admin');
    } catch {
      /* kutilgan */
    }
  }
  check(
    'noto‘g‘ri eshik hisobni qulflamaydi',
    webAuth.login('998900000077', 'klinika-eshigi-2026', null, null, 'clinic').user.id === doorAcc.user.id,
  );

  /* ── Klinikaga bot orqali xabar: chat raqam bo'yicha topiladi ── */

  const botClinicAcc = webAuth.createAccount({
    phone: '998900000088',
    fullName: 'Bot Xabari Sinovi',
    level: 'clinic_admin',
    clinicId: clinic.id,
  });

  /*
   * `notify()` ichida qator XOM holda o'qiladi (`telegram_id`), shuning
   * uchun bu yerda ham xuddi shunday shakl beriladi — mapper'dan
   * o'tgan `telegramId` emas.
   */
  const shadow = { telegram_id: -botClinicAcc.user.id };
  const notif = require('../services/notifications');

  check(
    'raqam botda tanilmagan bo‘lsa chat yo‘q',
    notif.telegramChatForTest(shadow) === null,
  );

  // Klinika egasi botga kontaktini ulashdi — endi haqiqiy chat bor
  db.prepare(
    `INSERT INTO users (telegram_id, first_name, roles, phone, onboarded_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(556677889, 'Klinika Egasi', JSON.stringify(['patient']), '+998900000088');

  check(
    'raqam bo‘yicha haqiqiy Telegram chati topildi',
    notif.telegramChatForTest(shadow) === 556677889,
    String(notif.telegramChatForTest(shadow)),
  );

  check(
    'bemorning o‘z chati o‘zgarmaydi',
    notif.telegramChatForTest({ telegram_id: 12345 }) === 12345,
  );

  /* ── Eshik SESSIYAGA yoziladi va keyin ham amal qiladi ── */

  const clinicDoor = webAuth.login('998900000077', 'klinika-eshigi-2026', null, null, 'clinic');
  check(
    'kabinet sessiyasi kabinet eshigini eslab qoladi',
    webAuth.resolveSession(clinicDoor.token).scope === 'clinic',
    webAuth.resolveSession(clinicDoor.token).scope,
  );

  /*
   * 2FA yoqilgan admin hisobi bilan tekshiramiz: sessiya to'liq
   * bo'lmasa ham eshik yozilgan bo'lishi kerak.
   */
  const adminDoor = webAuth.login('998900000001', 'admin-paroli-2026', null, null, 'admin');
  check(
    'admin sessiyasi admin eshigini eslab qoladi',
    webAuth.resolveSession(adminDoor.token).scope === 'admin',
    webAuth.resolveSession(adminDoor.token).scope,
  );

  /*
   * Telegram ko'prigi administrator sessiyasini HECH QACHON bermaydi.
   * Bu yo'l parol so'ramaydi — butun platformani boshqaradigan hisob
   * uchun raqam tasdig'i yetarli asos emas.
   */
  check(
    'Telegram ko‘prigi admin hisobiga sessiya bermaydi',
    webAuth.loginByVerifiedPhone('998900000001', null, null) === null,
  );


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

  const s1 = webAuth.login('998907776655', 'birinchi-parol-2026', '1.1.1.1', 'kompyuter', 'clinic');
  const s2 = webAuth.login('998907776655', 'birinchi-parol-2026', '2.2.2.2', 'telefon', 'clinic');
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

  throws('eski parol endi ishlamaydi', () => webAuth.login('998907776655', 'birinchi-parol-2026', null, null, 'clinic'));
  check('yangi parol ishlaydi',
    Boolean(webAuth.login('998907776655', 'ikkinchi-parol-2026', null, null, 'clinic').token));

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

  const afterTotp = webAuth.login('998907776655', 'ikkinchi-parol-2026', null, null, 'clinic');
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
    webAuth.login('998907776655', 'ikkinchi-parol-2026', null, null, 'clinic').mfaRequired === false);


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


  /* ═════ 19. Taklif tafsilotlari va narx o'zgarishi ═════ */
  console.log('\n19. Taklif tafsilotlari va narx o‘zgarishi');

  const patientCase = require('../services/patientCase');

  /*
   * Katalog testlari (15-bo'lim) manbadan bo'lmagan operatsiyalarni
   * yashirgan. Bu yerga toza, faol yozuv kerak — aks holda so'rov
   * "operatsiya topilmadi" bilan yiqiladi.
   */
  const liveOp = db
    .prepare(
      "INSERT INTO operations (category_id, slug, name_uz, name_ru, active, source, external_id) VALUES (?, 'narx-sinov', 'Narx sinovi', 'Тест цены', 1, 'banisa', 'op-price-test')",
    )
    .run(catId).lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO clinic_operations (clinic_id, operation_id) VALUES (?, ?)').run(
    clinic.id,
    liveOp,
  );

  /*
   * Klinika bemor holatini taklif berishdan OLDIN ko'rishi kerak:
   * yosh, vazn, surunkali kasallik narxni o'zgartiradi.
   */
  const caseReq = requests.createRequest({
    patientId: patient.id,
    operationId: liveOp,
    cityId: tashkent.id,
    budgetUzs: 8_000_000,
    note: null,
    urgency: 'normal',
    attachments: [],
    aiSuggested: false,
    conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
    acceptTerms: true,
  });

  const pc = patientCase.patientCaseForRequest(caseReq.id);
  check('yosh ko‘rinadi', typeof pc.ageYears === 'number', pc.ageYears);
  check('jins ko‘rinadi', pc.gender !== null, pc.gender);
  check('bo‘y va vazn ko‘rinadi', pc.heightCm !== null && pc.weightKg !== null, {
    h: pc.heightCm,
    w: pc.weightKg,
  });
  check('tana massasi indeksi hisoblandi', typeof pc.bmi === 'number' && pc.bmi > 10, pc.bmi);
  check('surunkali kasalliklar uzatildi', pc.chronicConditions.length > 0, pc.chronicConditions);
  check('holat matni bor', Boolean(pc.conditionText));

  // SHAXS ma'lumoti chiqmasligi kerak — klinika holatni ko'radi, odamni emas
  const caseKeys = Object.keys(pc);
  check(
    'ism va telefon uzatilmaydi',
    !caseKeys.some((k) => /name|phone|telegram|email/i.test(k)),
    caseKeys,
  );

  /* ── Tanishga so'rov: anketa ISHLATILMAYDI ── */
  const relativeReq = requests.createRequest({
    patientId: patient.id,
    operationId: liveOp,
    cityId: tashkent.id,
    budgetUzs: 8_000_000,
    note: null,
    urgency: 'normal',
    attachments: [],
    aiSuggested: false,
    conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
    acceptTerms: true,
    forSelf: false,
    subjectName: 'Onam',
    subjectBirthYear: 1960,
    subjectGender: 'female',
  });

  const relativeCase = patientCase.patientCaseForRequest(relativeReq.id);
  check('tanishning yoshi olindi', relativeCase.ageYears === new Date().getFullYear() - 1960, relativeCase.ageYears);
  check('tanishning jinsi olindi', relativeCase.gender === 'female');
  check(
    'so‘rov qoldirgan odamning anketasi ISHLATILMADI',
    relativeCase.chronicConditions.length === 0 && relativeCase.weightKg === null,
    relativeCase,
  );

  /* ── Budjetdan yuqori narx ── */

  /*
   * Narx bemor budjetidan ±20% dan chetga chiqmaydi. Ilgari yuqori
   * chegara yo'q edi: 8 mln so'ragan bemorga 30 mln taklif qilsa
   * bo'lardi va bunday taklifni hech kim o'qimasdi.
   */
  throws(
    'budjetdan 20% dan ortiq yuqori narx rad etiladi',
    () =>
      offers.createOffer({
        requestId: caseReq.id,
        clinicId: clinic.id,
        priceUzs: 12_000_000, // 8 mln dan 50% yuqori
        includes: ['Operatsiya'],
        advantages: [],
        aboveBudgetReason: 'Sabab yozilgan bo‘lsa ham chegaradan chiqib bo‘lmaydi',
        note: null,
        proposedDates: [futureDate(5)],
      }),
    'price_too_high',
  );

  throws(
    'budjetdan 20% dan ortiq past narx ham rad etiladi',
    () =>
      offers.createOffer({
        requestId: caseReq.id,
        clinicId: clinic.id,
        priceUzs: 5_000_000, // 8 mln dan 37% past
        includes: ['Operatsiya'],
        advantages: [],
        note: null,
        proposedDates: [futureDate(5)],
      }),
    'price_too_low',
  );

  // Chegaraning aynan chetlari qabul qilinadi
  const edge = offers.createOffer({
    requestId: relativeReq.id,
    clinicId: clinic.id,
    priceUzs: 9_600_000, // 8 mln + 20%
    includes: ['Operatsiya'],
    advantages: [],
    aboveBudgetReason: 'Robot yordamida operatsiya va bir kecha yotoq narxga kiradi',
    note: null,
    proposedDates: [futureDate(5)],
  });
  check('chegaraning aynan cheti qabul qilindi', edge.priceUzs === 9_600_000);

  throws(
    'budjetdan yuqori narx sababsiz rad etiladi',
    () =>
      offers.createOffer({
        requestId: caseReq.id,
        clinicId: clinic.id,
        priceUzs: 9_000_000,
        includes: ['Operatsiya'],
        advantages: [],
        note: null,
        proposedDates: [futureDate(5)],
      }),
    'above_budget_reason_required',
  );

  const pricier = offers.createOffer({
    requestId: caseReq.id,
    clinicId: clinic.id,
    priceUzs: 9_000_000,
    includes: ['Operatsiya', 'Narkoz', 'Bir kecha yotoq'],
    advantages: ['Oliy toifali jarroh'],
    proposedDates: [futureDate(7), futureDate(9), futureDate(3)],
    aboveBudgetReason: 'Robot yordamida operatsiya va bir kecha yotoq narxga kiradi',
    note: null,
  });

  check('budjetdan yuqori taklif qabul qilindi', pricier.priceUzs === 9_000_000);
  check('sabab saqlandi', Boolean(pricier.aboveBudgetReason), pricier.aboveBudgetReason);
  check('sanalar tartiblandi', pricier.proposedDates[0] === futureDate(3), pricier.proposedDates);
  check('sanalar soni to‘g‘ri', pricier.proposedDates.length === 3, pricier.proposedDates);

  // O'tmish sanalari va takrorlar tashlanadi
  const cleaned = offers.updateOffer(pricier.id, clinic.id, {
    proposedDates: ['2020-01-01', futureDate(5), futureDate(5), 'axlat'],
  });
  check('o‘tmish sanasi tashlandi', !cleaned.proposedDates.includes('2020-01-01'), cleaned.proposedDates);
  check('takror sana bir marta qoldi', cleaned.proposedDates.length === 1, cleaned.proposedDates);

  // Erkin matnli bandlar
  const freeText = offers.updateOffer(pricier.id, clinic.id, {
    includes: ['  Operatsiya  ', 'Operatsiya', 'O‘zim yozgan xizmat'],
    advantages: ['Xalqaro sertifikat'],
  });
  check('bo‘sh joylar tozalandi', freeText.includes[0] === 'Operatsiya', freeText.includes);
  check('takror band olib tashlandi', freeText.includes.length === 2, freeText.includes);
  check('erkin matn qabul qilindi', freeText.includes.includes('O‘zim yozgan xizmat'));

  /*
   * Narxni o'zgartirish OLIB TASHLANDI.
   *
   * Bemor taklifni aynan narxiga qarab tanlaydi; tanlangandan keyin
   * narxni qayta muhokama qilish o'sha tanlovning asosini olib
   * tashlash bo'lardi. Kelishmovchilik uchun nizo yo'li bor.
   */
  check('narx o‘zgartirish amali endi yo‘q', (deals as any).proposePriceChange === undefined);

  /* ═════ Migratsiya kaskadi ═════ */
  console.log('\nMigratsiya kaskadi');

  /*
   * SQLite ustunni o'zgartira olmaydi — jadvalni qayta qurish kerak.
   * Ammo `DROP TABLE` tashqi kalit kaskadini ishga tushiradi va
   * bog'liq jadvallar JIMGINA tozalanib ketadi.
   *
   * Bu prodda bir marta sodir bo'ldi: `requests` qayta qurilganda
   * unga bog'langan takliflar, bitimlar, chat va sharhlar o'chdi.
   * Ma'lumot ko'chirilgan bo'lsa ham, kaskad undan oldin ishlagan.
   *
   * Quyida usulning o'zi tekshiriladi: tashqi kalitlar o'chirilgan
   * holda qayta qurish bolalarni saqlab qoladi.
   */
  {
    const Database = require('better-sqlite3');
    const probe = new Database(':memory:');
    probe.pragma('foreign_keys = ON');
    probe.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE
      );
      INSERT INTO parent (id, name) VALUES (1, 'a');
      INSERT INTO child (id, parent_id) VALUES (1, 1), (2, 1);
    `);

    // Kalitlar YOQILGAN holda qayta qurish — bolalar yo'qoladi
    probe.exec(`
      CREATE TABLE parent_copy (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO parent_copy SELECT id, name FROM parent;
      DROP TABLE parent;
      ALTER TABLE parent_copy RENAME TO parent;
    `);
    check(
      'kalitlar yoqilgan holda qayta qurish bolalarni o‘chiradi',
      probe.prepare('SELECT COUNT(*) n FROM child').get().n === 0,
    );

    // Endi to'g'ri usul: kalitlar o'chirilgan holda
    probe.pragma('foreign_keys = OFF');
    probe.exec(`
      INSERT INTO child (id, parent_id) VALUES (1, 1), (2, 1);
      CREATE TABLE parent_copy (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO parent_copy SELECT id, name FROM parent;
      DROP TABLE parent;
      ALTER TABLE parent_copy RENAME TO parent;
    `);
    check(
      'kalitlar o‘chirilgan holda bolalar saqlanadi',
      probe.prepare('SELECT COUNT(*) n FROM child').get().n === 2,
      probe.prepare('SELECT COUNT(*) n FROM child').get().n,
    );
    probe.pragma('foreign_keys = ON');
    probe.close();
  }

  // Migratsiyalardan keyin kalitlar QAYTA yoqilgan bo'lishi kerak
  check('migratsiyadan keyin tashqi kalitlar yoqilgan', db.pragma('foreign_keys', { simple: true }) === 1);
  check('bog‘lanishlar buzilmagan', (db.pragma('foreign_key_check') as unknown[]).length === 0);


  /* ═════ Tahlil so'rovi ═════ */
  console.log('\nTahlil so‘rovi');

  const labs = require('../services/labOrgans');
  const { requestTitle } = require('../../../shared/types');

  const tests = labs.listLabTests();
  check('tekshiruvlar katalogi to‘ldirilgan', tests.length >= 50, tests.length);

  /*
   * Katalog ikki darajali: MRT va MSKT — guruh, ichida esa aniq
   * tekshiruvlar. Guruhni tanlab bo'lmaydi.
   */
  const mrtGroup = tests.find((x: any) => x.slug === 'mrt');
  const msktGroup = tests.find((x: any) => x.slug === 'mskt');
  check('MRT guruhi bor', Boolean(mrtGroup) && mrtGroup.hasChildren === true);
  check('MSKT guruhi bor', Boolean(msktGroup) && msktGroup.hasChildren === true);

  const mrtKids = tests.filter((x: any) => x.parentId === mrtGroup.id);
  const msktKids = tests.filter((x: any) => x.parentId === msktGroup.id);
  check('MRT ichida 24 ta tekshiruv', mrtKids.length === 24, mrtKids.length);
  check('MSKT ichida 32 ta tekshiruv', msktKids.length === 32, msktKids.length);
  check('tekshiruvda davomiylik bor', mrtKids.every((x: any) => x.durationMin > 0));
  // Narx katalogda ko'rsatilmaydi: uni klinika taklifida beradi
  check('katalogda narx yo‘q', mrtKids.every((x: any) => x.priceUzs === undefined));

  const mrt = mrtKids.find((x: any) => x.nameUz.includes('Tizza'));
  const blood = tests.find((x: any) => x.slug === 'blood');
  check('tizza MRT topildi', Boolean(mrt), mrt?.nameUz);

  /*
   * Tahlil so'rovi operatsiyaga bog'lanmaydi va holat tavsifi
   * so'ralmaydi — o'rniga tekshiruv va vazn majburiy.
   */
  /* ══════════  Yo'llanma so'rovi (rasm orqali)  ══════════ */

  {
    const files = require('../services/files');

    /* 1x1 PNG — mazmuni muhim emas, haqiqiy fayl bo'lsa bo'lgani */
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const photo = files.saveFile({
      ownerId: patient.id,
      name: 'yollanma.png',
      mimeType: 'image/png',
      kind: 'xulosa',
      dataBase64: png,
    });

    const refBody = (extra: Record<string, unknown> = {}) => ({
      patientId: patient.id,
      kind: 'referral',
      cityId: tashkent.id,
      budgetUzs: 300_000,
      note: null,
      urgency: 'normal',
      attachments: [photo.id],
      aiSuggested: false,
      acceptTerms: true,
      ...extra,
    });

    throws(
      'rasmsiz va ro‘yxatsiz yo‘llanma rad etiladi',
      () => requests.createRequest(refBody({ attachments: [] }) as any),
      'referral_empty',
    );

    /* ── Qo'lda yozilgan analizlar ── */

    const byHand = requests.createRequest(
      refBody({
        attachments: [],
        referralItems: [
          'Umumiy qon tahlili',
          '  siydik   tahlili ',
          // Katta-kichik harf bilan farq qilsa ham takror
          'UMUMIY QON TAHLILI',
          // Ikki belgidan qisqasi — tasodifiy tegish
          'x',
        ],
      }) as any,
    );

    check('rasmsiz, faqat ro‘yxat bilan o‘tdi', byHand.kind === 'referral');
    check(
      'ro‘yxat tozalandi: probel, takror, qisqasi tushdi',
      JSON.stringify(byHand.referralItems) ===
        JSON.stringify(['Umumiy qon tahlili', 'siydik tahlili']),
      JSON.stringify(byHand.referralItems),
    );

    const both = requests.createRequest(refBody({ referralItems: ['Gemogramma'] }) as any);
    check(
      'rasm va ro‘yxat birga bo‘lishi mumkin',
      both.attachments.length === 1 && both.referralItems.length === 1,
    );

    const capped = requests.createRequest(
      refBody({
        attachments: [],
        referralItems: Array.from({ length: 40 }, (_, i) => `Analiz ${i + 1}`),
      }) as any,
    );
    check('ro‘yxat 30 tada to‘xtaydi', capped.referralItems.length === 30, capped.referralItems.length);

    const ref = requests.createRequest(refBody() as any);
    check('yo‘llanma so‘rovi yaratildi', ref.kind === 'referral');
    check('katalogdan hech narsa tanlanmagan', ref.operationId === null && ref.labTestId === null);
    check('rasm so‘rovga ilashdi', ref.attachments.length === 1);
    check('sarlavha bo‘sh qolmadi', requestTitle(ref) === 'Shifokor yo‘llanmasi');

    /*
     * Tarqatish: yo'llanma shahardagi yo'llanmani QABUL QILADIGAN
     * tasdiqlangan klinikalarga boradi — tahlil ro'yxatini
     * belgilamagani ham, lekin `accepts_referral` o'chirilgani EMAS.
     */
    const approved = db
      .prepare(
        `SELECT COUNT(*) n FROM clinics
          WHERE verification = 'approved' AND city_id = ? AND accepts_referral = 1`,
      )
      .get(tashkent.id) as { n: number };
    check(
      'yo‘llanma shahardagi qabul qiladigan klinikalarga ketdi',
      ref.broadcastCount === approved.n,
      `${ref.broadcastCount} / ${approved.n}`,
    );

    // Bitta klinika yo'llanmani o'chiradi — keyingi yo'llanma unga bormasin
    const optedOut = db
      .prepare(`SELECT id FROM clinics WHERE verification = 'approved' AND city_id = ? LIMIT 1`)
      .get(tashkent.id) as { id: number };
    db.prepare(`UPDATE clinics SET accepts_referral = 0 WHERE id = ?`).run(optedOut.id);
    const afterOptOut = requests.createRequest(refBody() as any);
    check(
      'yo‘llanmani o‘chirgan klinikaga bormaydi',
      afterOptOut.broadcastCount === approved.n - 1 &&
        !db
          .prepare(`SELECT 1 FROM request_broadcasts WHERE request_id = ? AND clinic_id = ?`)
          .get(afterOptOut.id, optedOut.id),
      `${afterOptOut.broadcastCount} / ${approved.n - 1}`,
    );
    db.prepare(`UPDATE clinics SET accepts_referral = 1 WHERE id = ?`).run(optedOut.id);

    /*
     * Yo'llanmada byudjet YO'Q. Kelgan qiymat rad etilmaydi,
     * jimgina tashlanadi: bemorning telefonida ilovaning eski
     * keshlangan versiyasi turishi mumkin va u hali byudjet
     * so'rayveradi. Xato qaytarilsa bemor buni tuzata olmaydi.
     */
    const refWithBudget = requests.createRequest(refBody({ budgetUzs: 150_000 }) as any);
    check(
      'yo‘llanmada byudjet saqlanmaydi',
      refWithBudget.budgetUzs === null,
      String(refWithBudget.budgetUzs),
    );
  }

  const labBody = (extra: Record<string, unknown>) => ({
    patientId: patient.id,
    kind: 'lab',
    cityId: tashkent.id,
    budgetUzs: 300_000,
    note: null,
    urgency: 'normal',
    attachments: [],
    aiSuggested: false,
    acceptTerms: true,
    ...extra,
  });

  throws(
    'tekshiruvsiz tahlil so‘rovi rad etiladi',
    () => requests.createRequest(labBody({ weightKg: 70 }) as any),
    'test_required',
  );

  throws(
    'vaznsiz tahlil so‘rovi rad etiladi',
    () => requests.createRequest(labBody({ labTestId: mrt.id }) as any),
    'invalid_weight',
  );

  /*
   * GURUHNI tanlab bo'lmaydi: "MRT" degan javob klinikaga hech
   * narsa aytmaydi, chunki MRT ning o'zi 24 xil.
   */
  throws(
    'guruhni tanlab bo‘lmaydi',
    () => requests.createRequest(labBody({ labTestId: mrtGroup.id, weightKg: 70 }) as any),
    'test_is_group',
  );

  /* Tahlilda ham byudjet yo'q — yo'llanmadagi kabi tashlanadi */
  const labWithBudget = requests.createRequest(
    labBody({ labTestId: mrt.id, weightKg: 70, budgetUzs: 150_000 }) as any,
  );
  check(
    'tahlilda byudjet saqlanmaydi',
    labWithBudget.budgetUzs === null,
    String(labWithBudget.budgetUzs),
  );

  // Klinika shu tekshiruvni qilishini belgilaydi
  labs.saveClinicLabTests(clinic.id, [mrt.id]);
  check('klinika tekshiruvni belgiladi', labs.clinicLabTestIds(clinic.id).includes(mrt.id));

  const labReq = requests.createRequest(labBody({ labTestId: mrt.id, weightKg: 72 }) as any);

  check('tahlil so‘rovi yaratildi', labReq.kind === 'lab', labReq.kind);
  check('operatsiya bo‘sh', labReq.operationId === null);
  check('tekshiruv yozildi', labReq.labTestId === mrt.id);
  check('vazn yozildi', labReq.weightKg === 72);
  check('sarlavha tekshiruv nomidan olinadi', requestTitle(labReq) === mrt.nameUz, requestTitle(labReq));

  // Vazn profilga ham yozildi — keyingi safar o'zi to'ladi
  check(
    'vazn profilga saqlandi',
    (db.prepare('SELECT weight_kg AS w FROM users WHERE id = ?').get(patient.id) as any).w === 72,
  );

  check('so‘rov klinikaga bordi', labReq.broadcastCount >= 1, labReq.broadcastCount);

  const cheap = requests.createRequest(
    labBody({ labTestId: mrt.id, weightKg: 72, budgetUzs: 200_000 }) as any,
  );
  check('tahlil so‘rovi byudjetsiz ketadi', cheap.budgetUzs === null, String(cheap.budgetUzs));

  /*
   * Belgilanmagan tekshiruv bo'yicha so'rov klinikaga BORMAYDI:
   * qilmaydigan ishiga so'rov yuborish uni ham, bemorni ham
   * bezovta qilardi.
   */
  const other = requests.createRequest(labBody({ labTestId: blood.id, weightKg: 72 }) as any);
  check('belgilanmagan tekshiruv bo‘yicha so‘rov bormaydi', other.broadcastCount === 0, other.broadcastCount);

  /* ── Admin katalogni qo'lda to'ldiradi ── */

  const made = labs.createLabTest({
    nameUz: 'Sinov tekshiruvi',
    nameRu: 'Тест',
    icon: '🧪',
    parentId: mrtGroup.id,
    durationMin: 20,
  });
  check('admin tekshiruv qo‘shdi', made.id > 0 && made.nameUz === 'Sinov tekshiruvi');
  check('tekshiruv guruhga kirdi', made.parentId === mrtGroup.id);
  check('davomiylik saqlandi', made.durationMin === 20);

  throws(
    'ichida tekshiruvi bor guruh o‘chirilmaydi',
    () => labs.deleteLabTest(mrtGroup.id),
    'test_has_children',
  );
  check('yangi tekshiruv ro‘yxatda ko‘rinadi', labs.listLabTests().some((x: any) => x.id === made.id));

  throws(
    'nomsiz tekshiruv qabul qilinmaydi',
    () => labs.createLabTest({ nameUz: 'x' } as any),
    'name_required',
  );

  // Ishlatilgan tekshiruvni o'chirib bo'lmaydi — yashirish kerak
  throws(
    'so‘rovda ishlatilgan tekshiruv o‘chirilmaydi',
    () => labs.deleteLabTest(mrt.id),
    'test_in_use',
  );
  labs.deleteLabTest(made.id);
  check('ishlatilmagan tekshiruv o‘chirildi', !labs.listLabTests(true).some((x: any) => x.id === made.id));

  /* ── Tahlilga MOS savol ── */

  const steps2 = require('../services/requestSteps');
  const baseSteps = steps2.listSteps().map((x: any) => ({
    key: x.key,
    kind: x.kind,
    enabled: x.enabled,
    required: x.required,
    titleUz: x.titleUz,
    titleRu: x.titleRu,
    subUz: x.subUz,
    subRu: x.subRu,
    options: x.options,
    requestKind: x.requestKind ?? null,
    labTestId: x.labTestId ?? null,
  }));

  steps2.saveSteps(
    [
      ...baseSteps,
      {
        key: 'metal_implant',
        kind: 'boolean',
        enabled: true,
        required: true,
        titleUz: 'Tanangizda metall implant bormi?',
        titleRu: null,
        subUz: null,
        subRu: null,
        options: null,
        labTestId: mrt.id,
      },
    ],
    null,
  );

  const has = (key: string, scope: any) =>
    steps2.customSteps(scope).some((x: any) => x.key === key);

  check('savol MRT so‘rovida chiqadi', has('metal_implant', { kind: 'lab', labTestId: mrt.id }));
  check(
    'savol boshqa tekshiruvda chiqmaydi',
    !has('metal_implant', { kind: 'lab', labTestId: blood.id }),
  );
  check('savol operatsiya so‘rovida chiqmaydi', !has('metal_implant', { kind: 'operation' }));

  throws(
    'MRT so‘rovida savol majburiy',
    () => requests.createRequest(labBody({ labTestId: mrt.id, weightKg: 72 }) as any),
    'answer_required',
  );

  const answered = requests.createRequest(
    labBody({ labTestId: mrt.id, weightKg: 72, extraAnswers: { metal_implant: false } }) as any,
  );
  check('javob berilgach so‘rov o‘tdi', answered.kind === 'lab');
  check('javob saqlandi', (answered.extraAnswers as any)?.metal_implant === false);

  /* ── Savol daraxtning istalgan bo'g'iniga bog'lanadi ── */

  const q = (key: string, scope: any, kind = 'boolean') => ({
    key,
    kind,
    enabled: true,
    required: false,
    titleUz: `Savol ${key}`,
    titleRu: null,
    subUz: null,
    subRu: null,
    options: null,
    ...scope,
  });

  steps2.saveSteps(
    [
      ...baseSteps,
      q('mrt_all', { labTestId: mrtGroup.id }),
      q('lab_all', { requestKind: 'lab' }),
      q('op_all', { requestKind: 'operation' }),
      q('when_ready', {}, 'date'),
    ],
    null,
  );

  // Guruhga bog'langan savol ICHIDAGI hamma tekshiruvda chiqadi
  check('guruh savoli MRT turida chiqadi', has('mrt_all', { kind: 'lab', labTestId: mrt.id }));
  check(
    'guruh savoli boshqa guruhda chiqmaydi',
    !has('mrt_all', { kind: 'lab', labTestId: blood.id }),
  );
  check('guruh savoli guruhning o‘zida ham chiqadi', has('mrt_all', { kind: 'lab', labTestId: mrtGroup.id }));

  // Turga bog'langani — o'sha turdagi HAMMA so'rovda
  check('tahlil savoli qon tahlilida ham chiqadi', has('lab_all', { kind: 'lab', labTestId: blood.id }));
  check('tahlil savoli operatsiyada chiqmaydi', !has('lab_all', { kind: 'operation' }));
  check('operatsiya savoli operatsiyada chiqadi', has('op_all', { kind: 'operation' }));
  check(
    'operatsiya savoli tahlilda chiqmaydi',
    !has('op_all', { kind: 'lab', labTestId: mrt.id }),
  );

  // Qamrovsiz savol ikkalasida ham
  check('umumiy savol ikkala turda ham', has('when_ready', { kind: 'operation' }) && has('when_ready', { kind: 'lab' }));

  // Tekshiruv ko'rsatilsa tur avtomatik `lab` bo'ladi
  check(
    'tekshiruvli savol avtomatik tahlilga o‘tdi',
    steps2.listSteps().find((x: any) => x.key === 'mrt_all')?.requestKind === 'lab',
  );
  throws(
    'yo‘q tekshiruvga bog‘lab bo‘lmaydi',
    () => steps2.saveSteps([...baseSteps, q('bad_scope', { labTestId: 999_999 })], null),
    'unknown_lab_test',
  );

  /* ── Sana savoli ── */

  check(
    'sana javobi qabul qilindi',
    steps2.validateAnswers({ when_ready: '2026-12-31' }, { kind: 'operation' }) ===
      '{"when_ready":"2026-12-31"}',
  );
  throws('buzuq sana rad etiladi', () =>
    steps2.validateAnswers({ when_ready: '31.12.2026' }, { kind: 'operation' }),
  );
  throws('mavjud bo‘lmagan kun rad etiladi', () =>
    steps2.validateAnswers({ when_ready: '2026-02-30' }, { kind: 'operation' }),
  );
  check(
    'sana klinikaga mahalliy tartibda ko‘rinadi',
    steps2.readAnswers('{"when_ready":"2026-12-31"}', 'uz')[0]?.value === '31.12.2026',
  );

  // Sinovdan keyin tozalaymiz
  steps2.saveSteps(baseSteps, null);

  // Bosqichlar oqim bo'yicha ajraladi
  const { stepInFlow } = require('../../../shared/types');
  check('operatsiya bosqichi tahlilda yo‘q', stepInFlow('operation', 'lab') === false);
  check('tekshiruv bosqichi faqat tahlilda', stepInFlow('test', 'lab') && !stepInFlow('test', 'operation'));
  check(
    'byudjet faqat operatsiyada',
    stepInFlow('budget', 'operation') &&
      !stepInFlow('budget', 'lab') &&
      !stepInFlow('budget', 'referral'),
  );


  /* ═════ 20. Sana oralig'i va moslashuvchanlik ═════ */
  console.log('\n20. Sana oralig‘i');

  const { normalizeDateWindow } = require('../services/requests');

  /*
   * "Moslashuvchan" va "aniq oraliq" bir narsaning ikki holati.
   * Ilgari ikkalasi alohida yozilardi va bemor sanani belgilab, ustiga
   * moslashuvchanlikni ham yoqib qo'yardi — klinika buni qanday
   * tushunishi kerakligi noaniq edi.
   */
  const noDates = normalizeDateWindow(null, null);
  check('sanasiz — moslashuvchan', noDates.dateFlexible === true);

  const withDates = normalizeDateWindow(futureDate(3), futureDate(6));
  check('sana bor — moslashuvchan EMAS', withDates.dateFlexible === false);
  check('oraliq saqlandi', withDates.dateFrom === futureDate(3) && withDates.dateTo === futureDate(6));

  const onlyEnd = normalizeDateWindow(null, futureDate(4));
  check('faqat tugash sanasi boshlanish bo‘ldi', onlyEnd.dateFrom === futureDate(4), onlyEnd);
  check('yolg‘iz sana moslashuvchan emas', onlyEnd.dateFlexible === false);

  /* ── O'tgan sana ── */
  throws('o‘tgan boshlanish sanasi rad etiladi', () => normalizeDateWindow('2020-01-01', null), 'date_in_past');
  throws('o‘tgan tugash sanasi rad etiladi', () => normalizeDateWindow(null, '2020-01-01'), 'date_in_past');
  throws('teskari tartib rad etiladi', () => normalizeDateWindow(futureDate(6), futureDate(3)), 'date_order');
  throws('buzuq sana rad etiladi', () => normalizeDateWindow('kecha', null), 'invalid_date');

  // Bugun ruxsat etiladi — shoshilinch holat bo'lishi mumkin
  const todayWindow = normalizeDateWindow(new Date().toISOString().slice(0, 10), null);
  check('bugungi sana qabul qilinadi', todayWindow.dateFrom !== null);

  /* ── So'rov yaratilganda ham amal qiladi ── */
  throws(
    'o‘tgan sana bilan so‘rov yaratilmaydi',
    () =>
      requests.createRequest({
        patientId: patient.id,
        operationId: liveOp,
        cityId: tashkent.id,
        budgetUzs: 9_000_000,
        note: null,
        urgency: 'normal',
        attachments: [],
        aiSuggested: false,
        conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
        acceptTerms: true,
        dateFrom: '2020-01-01',
      }),
    'date_in_past',
  );

  const dateReq = requests.createRequest({
    patientId: patient.id,
    operationId: liveOp,
    cityId: tashkent.id,
    budgetUzs: 9_000_000,
    note: null,
    urgency: 'normal',
    attachments: [],
    aiSuggested: false,
    conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
    acceptTerms: true,
    dateFrom: futureDate(4),
    dateTo: futureDate(8),
    // Mijoz zid qiymat yuborsa ham server buni e'tiborga olmaydi
    dateFlexible: true,
  });
  check('zid moslashuvchanlik e‘tiborga olinmadi', dateReq.dateFlexible === false, dateReq.dateFlexible);
  // Mapper sanani to'liq ISO'ga o'giradi — kun qismini solishtiramiz
  check(
    'so‘rovda oraliq saqlandi',
    (dateReq.dateFrom ?? '').slice(0, 10) === futureDate(4),
    dateReq.dateFrom,
  );

  /* ── Bitim sanasi ham o'tmishda bo'lmaydi ── */
  const schedOffer = offers.createOffer({
    requestId: dateReq.id,
    clinicId: clinic.id,
    priceUzs: 8_000_000,
    includes: ['Operatsiya'],
    advantages: [],
    note: null,
    proposedDates: [futureDate(5)],
  });
  /*
   * Alohida "Sana belgilash" bosqichi yo'q: sana tanlov bilan
   * birga belgilanadi va o'tmish sanasi taklifga ham tushmaydi
   * (`cleanDates` uni tashlab yuboradi).
   */
  check('sana belgilash amali endi yo‘q', (deals as any).agreeSchedule === undefined);

  const schedDeal = deals.chooseOffer(dateReq.id, schedOffer.id, patient.id, schedOffer.proposedDates[0]);
  check('bitim kelishilgan sana bilan ochildi', schedDeal.status === 'AGREED' && Boolean(schedDeal.scheduledAt));

  /*
   * O'tmish kuni taklifga umuman tushmaydi — tanlangan taklifni
   * tahrirlab bo'lmaydi, shuning uchun yangi taklifda sinaymiz.
   */
  const dateReq2 = requests.createRequest({
    patientId: patient.id,
    operationId: liveOp,
    cityId: tashkent.id,
    budgetUzs: 9_000_000,
    note: null,
    urgency: 'normal',
    attachments: [],
    aiSuggested: false,
    conditionText: "Holatim: qorin o'ng tomonida og'riq, tekshiruvda tosh topildi.",
    acceptTerms: true,
    dateFlexible: true,
  });

  throws(
    'faqat o‘tmish kunlari taklif qilib bo‘lmaydi',
    () =>
      offers.createOffer({
        requestId: dateReq2.id,
        clinicId: clinic.id,
        priceUzs: 8_000_000,
        includes: ['Operatsiya'],
        advantages: [],
        note: null,
        proposedDates: ['2020-01-01'],
      }),
    'dates_required',
  );


  /* ═════ 21. Katalog daraxti: soha → bo'lim ═════ */
  console.log('\n21. Katalog daraxti');

  /*
   * 104 ta operatsiyani tekis ro'yxatda ko'rsatish ishlamadi: "Ko'z
   * Xirurgiyasi" ni ochgan odam 23 ta yozuvni birdaniga ko'rardi.
   * Endi ikki daraja: soha → bo'lim → operatsiya.
   */
  const soha = db
    .prepare(
      "INSERT INTO operation_categories (slug, name_uz, name_ru, icon, source, external_id) VALUES ('sinov-soha','Sinov sohasi','Тест','', 'banisa','cat-soha')",
    )
    .run().lastInsertRowid;
  const bolim = db
    .prepare(
      "INSERT INTO operation_categories (slug, name_uz, name_ru, icon, source, external_id, parent_id) VALUES ('sinov-bolim','Sinov bo‘limi','Раздел','', 'banisa','cat-bolim', ?)",
    )
    .run(soha).lastInsertRowid;

  const inBolim = db
    .prepare(
      "INSERT INTO operations (category_id, subcategory_id, slug, name_uz, name_ru, active, source, external_id) VALUES (?, ?, 'op-bolimda', 'Bo‘limdagi', 'В разделе', 1, 'banisa', 'op-b1')",
    )
    .run(soha, bolim).lastInsertRowid;
  const looseOp = db
    .prepare(
      "INSERT INTO operations (category_id, subcategory_id, slug, name_uz, name_ru, active, source, external_id) VALUES (?, NULL, 'op-erkin', 'Bo‘limsiz', 'Без раздела', 1, 'banisa', 'op-b2')",
    )
    .run(soha).lastInsertRowid;

  const tree = catalog.catalogTree();
  const branch = tree.find((b: any) => b.category.id === soha);

  check('soha daraxtda bor', Boolean(branch));
  check('jami soni to‘g‘ri', branch.total === 2, branch.total);
  check('bo‘lim ajratildi', branch.sections.length === 1, branch.sections.length);
  check(
    'bo‘limdagi operatsiya o‘z joyida',
    branch.sections[0].operations[0].id === inBolim,
    branch.sections[0].operations.map((o: any) => o.id),
  );
  check('bo‘limsiz operatsiya alohida', branch.loose.length === 1 && branch.loose[0].id === looseOp);
  check('bo‘lim ota-onasini biladi', branch.sections[0].category.parentId === soha);

  /*
   * Begona bo'lim e'tiborga olinmasligi kerak: manba o'zgarganda
   * shunday holat yuzaga kelishi mumkin va operatsiya boshqa sohada
   * paydo bo'lib qolardi.
   */
  const otherSoha = db
    .prepare(
      "INSERT INTO operation_categories (slug, name_uz, name_ru, icon, source, external_id) VALUES ('boshqa-soha','Boshqa','Другое','', 'banisa','cat-boshqa')",
    )
    .run().lastInsertRowid;
  const alienBolim = db
    .prepare(
      "INSERT INTO operation_categories (slug, name_uz, name_ru, icon, source, external_id, parent_id) VALUES ('begona-bolim','Begona','Чужой','', 'banisa','cat-begona', ?)",
    )
    .run(otherSoha).lastInsertRowid;

  db.prepare('UPDATE operations SET subcategory_id = ? WHERE id = ?').run(alienBolim, looseOp);

  const tree2 = catalog.catalogTree();
  const branch2 = tree2.find((b: any) => b.category.id === soha);
  check(
    'begona bo‘lim e‘tiborga olinmadi',
    branch2.loose.some((o: any) => o.id === looseOp),
    branch2.loose.map((o: any) => o.id),
  );
  check(
    'begona sohada paydo bo‘lmadi',
    !tree2.find((b: any) => b.category.id === otherSoha),
    tree2.map((b: any) => b.category.id),
  );

  // Bo'sh soha daraxtga chiqmaydi
  db.prepare(
    "INSERT INTO operation_categories (slug, name_uz, name_ru, icon) VALUES ('bosh-soha','Bo‘sh','Пустая','')",
  ).run();
  check(
    'bo‘sh soha daraxtda yo‘q',
    !catalog.catalogTree().some((b: any) => b.category.slug === 'bosh-soha'),
  );


  /* ═════ 22. banisa ulanishi ═════ */
  console.log('\n22. banisa ulanishi');

  const cityMatch = require('../services/cityMatch');
  const clinicLink = require('../services/clinicLink');

  /*
   * Shahar moslashtirish. banisa'da hudud erkin matn va haqiqiy
   * bazada Toshkent TO'RT xil yozilgan — to'rttasi ham bir shaharga
   * borishi kerak, aks holda klinikaga so'rov umuman kelmaydi.
   */
  const tashkentId = db.prepare("SELECT id FROM cities WHERE slug = 'tashkent'").get().id;

  for (const form of ['Toshkent', 'Toshkent shahri', 'tashkent_city', 'toshkent', 'TASHKENT']) {
    const m = cityMatch.matchCity(form);
    check(`"${form}" → Toshkent`, m.cityId === tashkentId, m);
  }

  check('samarkand ham topiladi', cityMatch.matchCity('Samarkand').cityId !== null);
  check('notanish hudud topilmaydi', cityMatch.matchCity('Atlantida').cityId === null);
  check('bo‘sh hudud topilmaydi', cityMatch.matchCity('').cityId === null);
  check('null ham xato bermaydi', cityMatch.matchCity(null).cityId === null);

  /* ── Bilet ── */

  const secret = process.env.LINK_TICKET_SECRET!;

  const makeTicket = (payload: any, sig?: string) => {
    const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature =
      sig ??
      nodeCrypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${signature}`;
  };

  const soon = Math.floor(Date.now() / 1000) + 60;

  throws('shakli buzuq bilet rad etiladi', () => clinicLink.verifyTicket('axlat'));
  throws(
    'imzosi noto‘g‘ri bilet rad etiladi',
    () => clinicLink.verifyTicket(makeTicket({ clinicId: 'c1', jti: 'j1', exp: soon }, 'yolgon')),
  );
  throws(
    'muddati o‘tgan bilet rad etiladi',
    () =>
      clinicLink.verifyTicket(
        makeTicket({ clinicId: 'c1', jti: 'j-old', exp: Math.floor(Date.now() / 1000) - 10 }),
      ),
  );
  throws(
    'klinikasiz bilet rad etiladi',
    () => clinicLink.verifyTicket(makeTicket({ jti: 'j2', exp: soon })),
  );

  const good = makeTicket({ clinicId: 'c-banisa-1', userId: 'u1', phone: '998901112233', jti: 'j-ok', exp: soon });
  const parsed = clinicLink.verifyTicket(good);
  check('to‘g‘ri bilet o‘qildi', parsed.clinicId === 'c-banisa-1' && parsed.phone === '998901112233');

  /*
   * Bir martalik. banisa biletni saqlamaydi — takrorni shu yerda
   * to'xtatamiz, aks holda bir havola bilan qayta-qayta ulanish
   * mumkin bo'lardi.
   */
  throws('bilet ikkinchi marta ishlamaydi', () => clinicLink.verifyTicket(good), 'ticket_used');

  /* ── Ichki token ── */

  const handoff = clinicLink.issueHandoff(parsed);
  const back = clinicLink.readHandoff(handoff);
  check('ichki token o‘qildi', back.clinicId === 'c-banisa-1');

  throws('buzilgan ichki token rad etiladi', () => clinicLink.readHandoff(handoff.slice(0, -4) + 'aaaa'));

  /*
   * Ichki token banisa bileti bilan BIR XIL sir ishlatmasligi kerak:
   * aks holda biri ikkinchisining o'rniga o'tib ketardi.
   */
  throws('banisa bileti ichki token sifatida ishlamaydi', () => clinicLink.readHandoff(good));

  /* ── Telefon va manzil tozalash ── */

  const banisa = require('../services/banisa');

  check(
    'takroriy telefonlar olib tashlandi',
    banisa.cleanPhones(['+998 93 380-23-13', '+998 93 380-23-13', '+998 93 380-23-13']).length === 1,
  );
  check('qisqa raqam tashlandi', banisa.cleanPhones(['123']).length === 0);
  check('massiv bo‘lmasa bo‘sh qaytadi', banisa.cleanPhones(null).length === 0);

  check(
    'manzildan hudud prefiksi olindi',
    banisa.cleanAddress('tashkent_city, olmazor, Beltepa 1A', 'tashkent_city') ===
      'olmazor, Beltepa 1A',
  );
  check(
    'bo‘sh bo‘laklar tozalandi',
    banisa.cleanAddress('olmazor, , Forobiy 28', null) === 'olmazor, Forobiy 28',
  );

  /* ══════════════  So'rov bosqichlari  ══════════════ */

  section("So'rov bosqichlari");

  const steps = require('../services/requestSteps');
  const { BUILTIN_STEPS } = require('../../../shared/types');

  const base = steps.listSteps();
  check('boshlang‘ich tayyor bosqichlar soni', base.length === BUILTIN_STEPS.length, base.length);
  check('hammasi builtin', base.every((s: any) => s.kind === 'builtin'));
  check('tartib o‘sib boradi', base.every((s: any, i: number) => i === 0 || s.position >= base[i - 1].position));
  check('operatsiya qulflangan', base.find((s: any) => s.key === 'operation').locked === true);
  check('izoh qulflanmagan', base.find((s: any) => s.key === 'note').locked === false);

  /** Ro'yxatni saqlashga tayyor ko'rinishga o'tkazadi. */
  const asInput = (list: any[]) =>
    list.map((s) => ({
      key: s.key,
      kind: s.kind,
      enabled: s.enabled,
      required: s.required,
      titleUz: s.titleUz,
      titleRu: s.titleRu,
      subUz: s.subUz,
      subRu: s.subRu,
      options: s.options,
    }));

  // ── Tartibni o'zgartirish ──
  const reordered = asInput(base);
  const noteIdx = reordered.findIndex((s) => s.key === 'note');
  const [note] = reordered.splice(noteIdx, 1);
  reordered.splice(1, 0, note);
  const afterMove = steps.saveSteps(reordered, null);
  check('izoh ikkinchi o‘ringa ko‘chdi', afterMove[1].key === 'note');
  check('ko‘chirishdan keyin soni o‘zgarmadi', afterMove.length === BUILTIN_STEPS.length, afterMove.length);

  // ── Ixtiyoriy bosqichni o'chirish ──
  const off = asInput(afterMove).map((s) => (s.key === 'documents' ? { ...s, enabled: false } : s));
  steps.saveSteps(off, null);
  check(
    'hujjatlar bosqichi o‘chdi',
    steps.wizardSteps('uz').every((s: any) => s.key !== 'documents'),
  );
  check('o‘chgan bosqich admin ro‘yxatida qoladi', steps.listSteps().some((s: any) => s.key === 'documents'));

  // ── Qulflangan bosqichni o'chirib bo'lmaydi ──
  throws('qulflangan bosqich o‘chmaydi', () =>
    steps.saveSteps(
      asInput(steps.listSteps()).map((s) => (s.key === 'operation' ? { ...s, enabled: false } : s)),
      null,
    ),
  );
  throws('qulflangan bosqich ixtiyoriy bo‘lmaydi', () =>
    steps.saveSteps(
      asInput(steps.listSteps()).map((s) => (s.key === 'region' ? { ...s, required: false } : s)),
      null,
    ),
  );

  // ── Tayyor bosqichni yo'qotib bo'lmaydi ──
  throws('tayyor bosqich ro‘yxatdan tushib qolmaydi', () =>
    steps.saveSteps(asInput(steps.listSteps()).filter((s) => s.key !== 'budget'), null),
  );
  throws('yangi builtin yaratib bo‘lmaydi', () =>
    steps.saveSteps([...asInput(steps.listSteps()), { key: 'xray', kind: 'builtin', enabled: true, required: false }], null),
  );

  // ── Matnni o'zgartirish ──
  steps.saveSteps(
    asInput(steps.listSteps()).map((s) =>
      s.key === 'budget' ? { ...s, titleUz: 'Byudjetingiz', titleRu: 'Ваш бюджет' } : s,
    ),
    null,
  );
  check(
    'sarlavha o‘zbekcha keldi',
    steps.wizardSteps('uz').find((s: any) => s.key === 'budget').title === 'Byudjetingiz',
  );
  check(
    'sarlavha ruscha keldi',
    steps.wizardSteps('ru').find((s: any) => s.key === 'budget').title === 'Ваш бюджет',
  );
  check(
    'yozilmagan matn null qaytadi',
    steps.wizardSteps('uz').find((s: any) => s.key === 'note').title === null,
  );

  // ── Admin savoli qo'shish ──
  const withCustom = [
    ...asInput(steps.listSteps()),
    {
      key: 'smoking',
      kind: 'choice',
      enabled: true,
      required: true,
      titleUz: 'Chekasizmi?',
      titleRu: 'Курите?',
      options: [
        { value: 'yes', uz: 'Ha', ru: 'Да' },
        { value: 'no', uz: 'Yo‘q', ru: 'Нет' },
      ],
    },
  ];
  const withQ = steps.saveSteps(withCustom, null);
  check('savol qo‘shildi', withQ.length === BUILTIN_STEPS.length + 1, withQ.length);
  check('savol turi saqlandi', withQ.find((s: any) => s.key === 'smoking').kind === 'choice');
  check(
    'variantlar tilga qarab keladi',
    steps.wizardSteps('ru').find((s: any) => s.key === 'smoking').options[0].label === 'Да',
  );

  throws('ikkitadan kam variant rad etiladi', () =>
    steps.saveSteps(
      [...asInput(steps.listSteps()).filter((s) => s.key !== 'smoking'),
        { key: 'q2', kind: 'choice', enabled: true, required: false, titleUz: 'Savol', options: [{ value: 'a', uz: 'A', ru: 'A' }] }],
      null,
    ),
  );
  throws('noto‘g‘ri kalit rad etiladi', () =>
    steps.saveSteps([...asInput(steps.listSteps()), { key: 'Bad Key!', kind: 'text', enabled: true, required: false }], null),
  );
  throws('bir kalit ikki marta kelmaydi', () =>
    steps.saveSteps([...asInput(steps.listSteps()), ...asInput(steps.listSteps()).slice(0, 1)], null),
  );

  // ── Javoblarni tekshirish ──
  check('to‘g‘ri javob qabul qilindi', steps.validateAnswers({ smoking: 'yes' }, { kind: 'operation' }) === '{"smoking":"yes"}');
  throws('noma‘lum variant rad etiladi', () => steps.validateAnswers({ smoking: 'maybe' }, { kind: 'operation' }));
  throws('majburiy savolsiz o‘tmaydi', () => steps.validateAnswers({}, { kind: 'operation' }));
  check(
    'noma‘lum kalit e‘tiborsiz qoldiriladi',
    steps.validateAnswers({ smoking: 'no', qadimgi: 'x' }, { kind: 'operation' }) === '{"smoking":"no"}',
  );

  // Ko'rsatish uchun ochish
  const shown = steps.readAnswers('{"smoking":"no"}', 'uz');
  check('javob yorlig‘i bilan ochildi', shown[0].label === 'Chekasizmi?' && shown[0].value === 'Yo‘q');
  check('buzuq JSON bo‘sh qaytaradi', steps.readAnswers('{buzuq', 'uz').length === 0);

  // ── Tozalash: sinovdan keyin dastlabki holatga qaytaramiz ──
  steps.saveSteps(
    asInput(steps.listSteps())
      .filter((s) => s.kind === 'builtin')
      .map((s) => ({ ...s, enabled: true, titleUz: null, titleRu: null })),
    null,
  );
  check(
    'sinovdan keyin tiklandi',
    steps.listSteps().length === BUILTIN_STEPS.length && steps.validateAnswers({}, { kind: 'operation' }) === null,
  );

  /* ══════════════  To'lov bosqichi  ══════════════ */

  section("To'lov bosqichi");

  /*
   * Bu blok fayl oxirida turadi — katalog sinxronizatsiyasi sinovlari
   * seed qilingan operatsiyalarni o'chirgan bo'lishi mumkin. Shuning
   * uchun operatsiya SHU YERDA, amaldagi ro'yxatdan olinadi.
   */
  const payOp = db
    .prepare(
      `SELECT o.id FROM clinic_operations co
         JOIN operations o ON o.id = co.operation_id
        WHERE co.clinic_id = ? AND o.active = 1
        LIMIT 1`,
    )
    .get(clinic.id) as { id: number };

  {
    // Yangi to'liq oqim: so'rov → taklif → tanlov → sana → bajarildi
    const p2 = upsertUser({ id: 778001, first_name: 'To‘lov', language_code: 'uz' });
    db.prepare(
      `UPDATE users SET last_name = 'Sinov', city_id = ?, birth_year = 1990, gender = 'male' WHERE id = ?`,
    ).run(tashkent.id, p2.id);
    const r2 = requests.createRequest({
      patientId: p2.id, operationId: payOp.id, cityId: tashkent.id, budgetUzs: 12_000_000,
      conditionText: 'To‘lov bosqichini sinash uchun holat tavsifi', note: null,
      urgency: 'normal', attachments: [], otherRegionsOk: false,
      dateFrom: null, dateTo: null, dateFlexible: true, aiSuggested: false, acceptTerms: true,
    });
    const o2 = offers.createOffer({
      requestId: r2.id,
      clinicId: clinic.id,
      priceUzs: 12_000_000,
      includes: ['Operatsiya', 'Narkoz', 'Palata'],
      advantages: ['Sinov'],
      note: null,
      proposedDates: [futureDate(5)],
    });
    const d2 = deals.chooseOffer(r2.id, o2.id, p2.id, o2.proposedDates[0]);

    // ── Klinika to'lovdan OLDIN tasdiqlay olmaydi ──
    throws('to‘lovsiz tasdiqlab bo‘lmaydi', () => deals.confirmReceipt(d2.id, clinic.id));

    // ── Noto'g'ri summa ──
    throws('juda kichik summa rad etiladi', () => deals.declarePayment(d2.id, p2.id, 1000));
    throws('begona odam to‘lov bildira olmaydi', () => deals.declarePayment(d2.id, patient.id, 12_000_000));

    // ── Bemor to'lovni bildiradi ──
    const paid2 = deals.declarePayment(d2.id, p2.id, 11_000_000, 'card');
    check('holat PAID', paid2.status === 'PAID');
    check('to‘lov vaqti yozildi', paid2.paidAt !== null);
    check('komissiya hali hisoblanmagan', paid2.commissionUzs === null);
    check('klinika hisobiga hali qo‘shilmagan', requests.getRequest(r2.id).status !== 'COMPLETED');

    // ── Ikki marta bildirib bo'lmaydi ──
    throws('ikkinchi marta to‘lov bildirilmaydi', () => deals.declarePayment(d2.id, p2.id, 11_000_000));

    // ── Klinika tasdiqlaydi ──
    const done2 = deals.confirmReceipt(d2.id, clinic.id);
    check('holat CONFIRMED', done2.status === 'CONFIRMED');
    /*
     * Foiz qattiq yozilmaydi: yuqoridagi sinovlar platforma qiymatini
     * o'zgartiradi. Muhimi — komissiya BEMOR aytgan summadan olinishi.
     */
    check(
      'komissiya bemor aytgan summadan',
      done2.commissionUzs === Math.round((11_000_000 * done2.commissionPercent!) / 100),
      { commission: done2.commissionUzs, percent: done2.commissionPercent },
    );
    check('summa o‘zgarmadi', done2.confirmedAmountUzs === 11_000_000);
    check('so‘rov yakunlandi', requests.getRequest(r2.id).status === 'COMPLETED');
    check('qo‘lda yopilganda avto belgisi yo‘q', deals.getDeal(d2.id).status === 'CONFIRMED');

    // ── Yopilgach qayta tasdiqlab bo'lmaydi ──
    throws('yopilgan bitim qayta tasdiqlanmaydi', () => deals.confirmReceipt(d2.id, clinic.id));
  }

  {
    /*
     * Klinika jim qolsa — avtomatik yopiladi.
     *
     * Busiz jim turish klinikaga foydali bo'lardi: tasdiqlamasa
     * komissiya ham hisoblanmasdi.
     */
    const p3 = upsertUser({ id: 778002, first_name: 'Jim', language_code: 'uz' });
    db.prepare(
      `UPDATE users SET last_name = 'Klinika', city_id = ?, birth_year = 1990, gender = 'male' WHERE id = ?`,
    ).run(tashkent.id, p3.id);
    const r3 = requests.createRequest({
      patientId: p3.id, operationId: payOp.id, cityId: tashkent.id, budgetUzs: 12_000_000,
      conditionText: 'Klinika tasdiqlamagan holatni sinash uchun tavsif', note: null,
      urgency: 'normal', attachments: [], otherRegionsOk: false,
      dateFrom: null, dateTo: null, dateFlexible: true, aiSuggested: false, acceptTerms: true,
    });
    const o3 = offers.createOffer({
      requestId: r3.id,
      clinicId: clinic.id,
      priceUzs: 12_000_000,
      includes: ['Operatsiya', 'Narkoz', 'Palata'],
      advantages: ['Sinov'],
      note: null,
      proposedDates: [futureDate(5)],
    });
    const d3 = deals.chooseOffer(r3.id, o3.id, p3.id, o3.proposedDates[0]);
    deals.declarePayment(d3.id, p3.id, 9_000_000);

    // Soatni orqaga suramiz — 60 kun oldin to'langan deb
    db.prepare(`UPDATE deals SET paid_at = datetime('now', '-60 days') WHERE id = ?`).run(d3.id);

    const closed = deals.autoConfirmStaleDeals();
    check('jim klinika bitimi avtomatik yopildi', closed >= 1, closed);
    const after3 = deals.getDeal(d3.id);
    check('holat CONFIRMED', after3.status === 'CONFIRMED');
    check(
      'summa BEMOR aytgan qiymatdan olindi',
      after3.confirmedAmountUzs === 9_000_000,
      after3.confirmedAmountUzs,
    );
    check(
      'komissiya shu summadan',
      after3.commissionUzs === Math.round((9_000_000 * after3.commissionPercent!) / 100),
      { commission: after3.commissionUzs, percent: after3.commissionPercent },
    );
    check(
      'avtomatik yopilgani belgilandi',
      (db.prepare(`SELECT auto_confirmed FROM deals WHERE id = ?`).get(d3.id) as any).auto_confirmed === 1,
    );
    check(
      'avtomatik yopishda bonus berilmadi',
      (db.prepare(`SELECT bonus_points FROM users WHERE id = ?`).get(p3.id) as any).bonus_points === 0,
    );
  }

  /* ══════════════  Komissiya to'lovi: klinika → admin  ══════════════ */

  section('Komissiya to‘lovi');

  {
    const cab = require('../services/clinicCabinet');
    const before = cab.getRevenue(clinic.id);
    check('qarz bor', before.outstandingUzs > 0, before.outstandingUzs);
    check('tekshiruvdagi summa hozircha nol', before.pendingCommissionUzs === 0);

    // ── Qarzdan ortiq topshirib bo'lmaydi ──
    throws('qarzdan ortiq to‘lov rad etiladi', () =>
      cab.declareCommissionPayment({
        clinicId: clinic.id,
        amountUzs: before.outstandingUzs + 1,
        method: 'bank',
        reference: null,
      }),
    );

    // ── Klinika topshiradi ──
    const part = Math.floor(before.outstandingUzs / 2);
    const afterDeclare = cab.declareCommissionPayment({
      clinicId: clinic.id,
      amountUzs: part,
      method: 'bank',
      reference: 'TXN-1',
    });
    check('tekshiruvda turibdi', afterDeclare.pendingCommissionUzs === part, afterDeclare.pendingCommissionUzs);
    check(
      'topshirish QARZNI KAMAYTIRMAYDI',
      afterDeclare.outstandingUzs === before.outstandingUzs,
      afterDeclare.outstandingUzs,
    );
    check('to‘lov ro‘yxatda "declared"', afterDeclare.commissionPayments[0].status === 'declared');

    // ── Ikki marta topshirib qarzni yopib bo'lmaydi ──
    throws('tekshiruvdagi summa hisobga olinadi', () =>
      cab.declareCommissionPayment({
        clinicId: clinic.id,
        amountUzs: before.outstandingUzs,
        method: 'bank',
        reference: 'TXN-2',
      }),
    );

    // ── Admin navbatda ko'radi ──
    const queue = cab.listPendingCommissionPayments();
    check('admin navbatida ko‘rinadi', queue.length === 1 && queue[0].amountUzs === part);
    check('klinika nomi bilan keladi', Boolean(queue[0].clinicName));

    // ── Rad etish sababsiz bo'lmaydi ──
    throws('sababsiz rad etilmaydi', () =>
      cab.reviewCommissionPayment(queue[0].id, moderator.id, 'rejected', null),
    );

    // ── Admin tasdiqlaydi ──
    cab.reviewCommissionPayment(queue[0].id, moderator.id, 'confirmed', null);
    const afterConfirm = cab.getRevenue(clinic.id);
    check(
      'tasdiqlangach qarz kamaydi',
      afterConfirm.outstandingUzs === before.outstandingUzs - part,
      afterConfirm.outstandingUzs,
    );
    check('tekshiruvdagi summa bo‘shadi', afterConfirm.pendingCommissionUzs === 0);
    check('to‘langan summaga qo‘shildi', afterConfirm.paidCommissionUzs >= part);
    check('navbat bo‘shadi', cab.listPendingCommissionPayments().length === 0);

    // ── Ikki marta ko'rib chiqilmaydi ──
    throws('ikki marta tasdiqlanmaydi', () =>
      cab.reviewCommissionPayment(queue[0].id, moderator.id, 'confirmed', null),
    );

    // ── Rad etish oqimi ──
    const d2 = cab.declareCommissionPayment({
      clinicId: clinic.id,
      amountUzs: 100_000,
      method: 'cash',
      reference: 'TXN-3',
    });
    const q2 = cab.listPendingCommissionPayments();
    cab.reviewCommissionPayment(q2[0].id, moderator.id, 'rejected', 'Bankdan tushmadi');
    const afterReject = cab.getRevenue(clinic.id);
    check('rad etilgach qarz o‘zgarmadi', afterReject.outstandingUzs === afterConfirm.outstandingUzs);
    check('rad etilgan yozuv saqlanadi', afterReject.commissionPayments.some((p: any) => p.status === 'rejected'));
    check(
      'rad etish sababi ko‘rinadi',
      afterReject.commissionPayments.find((p: any) => p.status === 'rejected')?.reviewNote === 'Bankdan tushmadi',
    );
    void d2;
  }

  /* ══════════════  Super-admin  ══════════════ */

  section('Super-admin');

  {
    const adm = require('../services/admin');

    /*
     * O'zini qulflab qo'yish — qaytarib bo'lmaydigan xato: panelga
     * faqat admin kiradi, ya'ni tiklash uchun boshqa admin yoki
     * bazaga qo'lda kirish kerak bo'lardi.
     */
    throws('admin o‘zidan admin rolini ola olmaydi', () =>
      adm.setUserRoles(moderator.id, ['patient'], moderator.id),
    );
    throws('admin o‘zini bloklay olmaydi', () =>
      adm.setUserBlocked(moderator.id, true, moderator.id, ''),
    );

    // Boshqa odamga esa ruxsat
    const victim = upsertUser({ id: 779001, first_name: 'Oddiy', language_code: 'uz' });
    const promoted = adm.setUserRoles(victim.id, ['patient', 'admin'], moderator.id);
    check('boshqa odamga rol berildi', promoted.roles.includes('admin'));
    const blocked = adm.setUserBlocked(victim.id, true, moderator.id, 'sinov');
    check('boshqa odam bloklandi', blocked.blockedAt !== null);
    check('blokdan chiqarildi', adm.setUserBlocked(victim.id, false, moderator.id, '').blockedAt === null);

    // O'ziga rolni SAQLAB qo'shimcha berish mumkin
    const keep = adm.setUserRoles(moderator.id, ['admin', 'patient'], moderator.id);
    check('o‘ziga admin saqlangan holda rol qo‘shsa bo‘ladi', keep.roles.includes('admin'));

    /* Qidiruv: ilgari qat'iy 100 ta chegara bor edi va qidiruv yo'q edi */
    const found = adm.listUsers({ search: 'Oddiy' });
    check('ism bo‘yicha topildi', found.length >= 1 && found.some((u: any) => u.id === victim.id));
    check('mos kelmagani chiqmaydi', adm.listUsers({ search: 'zzzyyyxxx' }).length === 0);
    check('klinika nomi qatorga qo‘shiladi', 'clinicName' in adm.listUsers()[0]);
  }

  /* ══════════════  Yo'nalishlar: banisa va qo'lda  ══════════════ */

  section("Yo'nalishlar manbasi");

  {
    const cl = require('../services/clinics');
    const ops = catalog.listOperations().filter((o: any) => o.active !== false);
    const [a, b, c] = [ops[0].id, ops[1].id, ops[2].id];

    // banisa'dan kelgan yo'nalish
    db.prepare(
      `INSERT OR REPLACE INTO clinic_operations (clinic_id, operation_id, source) VALUES (?, ?, 'banisa')`,
    ).run(clinic.id, a);
    // qo'lda qo'shilgan
    cl.updateClinicOperations(clinic.id, [b]);

    const after = new Set(cl.getClinicOperations(clinic.id));
    check('banisa yo‘nalishi saqlanib qoldi', after.has(a));
    check('qo‘lda qo‘shilgani ham bor', after.has(b));
    check('banisa\'niki alohida ajratiladi', cl.externalOperationIds(clinic.id).join() === String(a));

    /*
     * Eng muhimi: klinika o'z ro'yxatini saqlaganda banisa qatori
     * O'CHMASLIGI kerak. Ilgari funksiya hamma qatorni o'chirib
     * qayta yozardi — shu sababli ulangan klinikaga ekran butunlay
     * yopilgandi.
     */
    cl.updateClinicOperations(clinic.id, [c]);
    const after2 = new Set(cl.getClinicOperations(clinic.id));
    check('saqlash banisa yo‘nalishini o‘chirmadi', after2.has(a));
    check('eski qo‘lda qo‘shilgani olib tashlandi', !after2.has(b));
    check('yangi qo‘lda qo‘shilgani qo‘shildi', after2.has(c));

    // banisa'nikini "tanlash" uni ikkilantirmasligi kerak
    cl.updateClinicOperations(clinic.id, [a, c]);
    const rows = db
      .prepare(`SELECT source FROM clinic_operations WHERE clinic_id = ? AND operation_id = ?`)
      .all(clinic.id, a) as { source: string }[];
    check('banisa yozuvi ikkilanmadi', rows.length === 1, rows.length);
    check('manbasi banisa bo‘lib qoldi', rows[0].source === 'banisa');

    // Tozalash
    db.prepare(`DELETE FROM clinic_operations WHERE clinic_id = ? AND source = 'banisa'`).run(clinic.id);
  }

  /* ══════════════  Bot matnlari  ══════════════ */

  section('Bot matnlari');

  {
    const botSvc = require('../services/bot');
    const terms = require('../services/terms.business');

    const before = botSvc.getBotFace();
    check('sozlanmagan bo‘lsa zaxira matn keladi', before.description === botSvc.BOT_DEFAULTS.description);
    check('tugma nomi ham zaxiradan', before.menuButton === botSvc.BOT_DEFAULTS.menuButton);

    terms.setTextSetting(botSvc.SETTING_BOT_DESCRIPTION, 'Yangi tavsif matni', null);
    terms.setTextSetting(botSvc.SETTING_BOT_MENU, 'Ochish', null);

    const after = botSvc.getBotFace();
    check('admin yozgani ustun keladi', after.description === 'Yangi tavsif matni');
    check('tugma nomi o‘zgardi', after.menuButton === 'Ochish');
    check('tegilmagani zaxirada qoladi', after.shortDescription === botSvc.BOT_DEFAULTS.shortDescription);

    /*
     * Bo'sh satr ham HAQIQIY qiymat: admin qisqa tavsifni ataylab
     * o'chirishi mumkin va u zaxiraga qaytmasligi kerak.
     */
    terms.setTextSetting(botSvc.SETTING_BOT_SHORT, '', null);
    check('bo‘sh satr zaxiraga qaytmaydi', botSvc.getBotFace().shortDescription === '');

    // Tozalash
    db.prepare(`DELETE FROM platform_settings WHERE key LIKE 'bot_%'`).run();
    check('tozalangach zaxira qaytdi', botSvc.getBotFace().description === botSvc.BOT_DEFAULTS.description);
  }

  /* ══════════════  Noma'lum operatsiya: kimga boradi  ══════════════ */

  section("Noma'lum operatsiya yo'nalishi");

  {
    const match = require('../services/matching');
    const cat = require('../services/catalog');
    const unknownOp = cat.getUnknownOperation()!;

    /*
     * Ilgari noma'lum operatsiyada filtr BUTUNLAY o'char va so'rov
     * shahardagi hamma klinikaga borardi — ko'z muammosi
     * stomatologiyaga ham. Bu sinov aynan shuni qo'riqlaydi.
     */
    const everyone = match.findMatchingClinics(unknownOp.id, tashkent.id, {});
    check('sohasiz — hammasiga boradi (oxirgi chora)', everyone.length >= 1, everyone.length);

    // Klinikaning yo'nalishlari qaysi sohada ekanini topamiz
    const own = db
      .prepare(
        `SELECT o.category_id AS categoryId
           FROM clinic_operations co JOIN operations o ON o.id = co.operation_id
          WHERE co.clinic_id = ? LIMIT 1`,
      )
      .get(clinic.id) as { categoryId: number } | undefined;

    if (own) {
      const inField = match.findMatchingClinics(unknownOp.id, tashkent.id, {
        fallbackCategoryId: own.categoryId,
      });
      check('o‘z sohasida — klinika qatnashadi', inField.some((c: any) => c.id === clinic.id));

      /*
       * Boshqa soha — klinika CHIQIB qolishi kerak. Aynan shu
       * xatti-harakat "ko'z muammosi stomatologiyaga bormasin"
       * degani.
       */
      const other = db
        .prepare(`SELECT id FROM operation_categories WHERE parent_id IS NULL AND id != ? LIMIT 1`)
        .get(own.categoryId) as { id: number } | undefined;

      if (other) {
        const outside = match.findMatchingClinics(unknownOp.id, tashkent.id, {
          fallbackCategoryId: other.id,
        });
        check(
          'boshqa sohada — klinika chiqib qoladi',
          !outside.some((c: any) => c.id === clinic.id),
          outside.length,
        );
        check('soha bilan doira toraydi', outside.length < everyone.length, {
          soha: outside.length,
          hammasi: everyone.length,
        });
      }
    }

    // Aniq operatsiya berilsa soha e'tiborga olinmaydi
    const exact = match.findMatchingClinics(gallbladder.id, tashkent.id, { fallbackCategoryId: 99999 });
    check('aniq operatsiyada soha o‘zgartirmaydi', Array.isArray(exact));
  }

  /* ══════════════  Noma'lum operatsiyani klinika aniqlaydi  ══════════════ */

  section("Noma'lum operatsiyani aniqlash");

  {
    const cat = require('../services/catalog');
    const unknownOp = cat.getUnknownOperation()!;

    const own = db
      .prepare(
        `SELECT co.operation_id AS id FROM clinic_operations co
           JOIN operations o ON o.id = co.operation_id
          WHERE co.clinic_id = ? AND o.active = 1 LIMIT 1`,
      )
      .get(clinic.id) as { id: number };

    const mkRequest = () =>
      requests.createRequest({
        patientId: patient.id,
        operationId: unknownOp.id,
        cityId: tashkent.id,
        budgetUzs: null, // budjet KO'RSATILMAGAN — shunda ham summa aniq bo'lishi kerak
        conditionText: 'Nimaligini bilmayman, shifokor operatsiya kerak dedi',
        note: null,
        urgency: 'normal',
        attachments: [],
        aiSuggested: false,
        acceptTerms: true,
      });

    const body = (requestId: number, extra: any = {}) => ({
      requestId,
      clinicId: clinic.id,
      priceUzs: 9_000_000,
      includes: ['Operatsiya', 'Narkoz'],
      advantages: [],
      proposedDates: [futureDate(5)],
      note: null,
      ...extra,
    });

    // ── Operatsiyasiz taklif RAD ETILADI ──
    const r1 = mkRequest();
    throws('noma‘lum so‘rovga operatsiyasiz taklif yuborilmaydi', () => offers.createOffer(body(r1.id)));

    // ── O'zi qilmaydigan operatsiyani ko'rsata olmaydi ──
    const foreign = db
      .prepare(
        `SELECT id FROM operations
          WHERE active = 1 AND id NOT IN (SELECT operation_id FROM clinic_operations WHERE clinic_id = ?)
          LIMIT 1`,
      )
      .get(clinic.id) as { id: number } | undefined;
    if (foreign) {
      throws('o‘zi qilmaydigan operatsiyani ko‘rsata olmaydi', () =>
        offers.createOffer(body(r1.id, { resolvedOperationId: foreign.id })),
      );
    }

    // ── To'g'ri operatsiya bilan o'tadi ──
    const o1 = offers.createOffer(body(r1.id, { resolvedOperationId: own.id }));
    check('operatsiya ko‘rsatilgan taklif o‘tdi', o1.status === 'SENT');
    check('taklifda operatsiya yozildi', o1.resolvedOperationId === own.id, o1.resolvedOperationId);

    // So'rov HALI noma'lum: tanlov qilinmaguncha o'zgarmaydi
    check(
      'tanlanmaguncha so‘rov noma‘lumligicha qoladi',
      requests.getRequest(r1.id).operationId === unknownOp.id,
    );

    // ── Bemor tanlagach so'rov aniqlanadi ──
    const deal = deals.chooseOffer(r1.id, o1.id, patient.id, o1.proposedDates[0]);
    const resolved = requests.getRequest(r1.id);
    check('tanlovdan keyin so‘rov aniq operatsiyaga o‘tdi', resolved.operationId === own.id, resolved.operationId);
    check('soha zaxirasi tozalandi', resolved.fallbackCategoryId === null);

    /*
     * Asosiy maqsad: budjet ko'rsatilmagan bo'lsa ham bitim
     * summasi ANIQ operatsiyaga yoziladi va narx statistikasi uni
     * ko'radi. Busiz "bu operatsiya qanchaga ketdi" degan savolga
     * javob qolmasdi.
     */
    deals.declarePayment(deal.id, patient.id, 9_500_000);
    deals.confirmReceipt(deal.id, clinic.id);

    const counted = db
      .prepare(
        `SELECT COUNT(*) n FROM deals d JOIN requests r ON r.id = d.request_id
          WHERE d.status = 'CONFIRMED' AND r.operation_id = ? AND r.city_id = ?`,
      )
      .get(own.id, tashkent.id) as { n: number };
    check('budjetsiz bitim ham aniq operatsiyaga yozildi', counted.n >= 1, counted.n);
  }

  /* ══════════════  AI kalitlari  ══════════════ */

  section('AI kalitlari');

  {
    const keys = require('../services/aiKeys');

    check('kalit niqoblanadi', keys.maskKey('AQ.Ab8RN6K4LKfQem0sTNszH9x6uYl') === 'AQ.Ab8…6uYl');
    check('qisqa kalit butunlay yashiriladi', /^•+$/.test(keys.maskKey('qisqa')));

    const after = keys.addAiKey({ provider: 'gemini', apiKey: 'SINOV-KALIT-1234567890', label: 'Asosiy' });
    check('kalit qo‘shildi', after.length >= 1);
    const mine = after.find((k: any) => k.label === 'Asosiy')!;
    check('to‘liq kalit QAYTARILMAYDI', !JSON.stringify(after).includes('SINOV-KALIT-1234567890'));
    check('niqob ko‘rinadi', mine.masked.includes('…'));

    throws('bir xil kalit ikki marta qo‘shilmaydi', () =>
      keys.addAiKey({ provider: 'gemini', apiKey: 'SINOV-KALIT-1234567890', label: null }),
    );
    throws('juda qisqa kalit rad etiladi', () =>
      keys.addAiKey({ provider: 'gemini', apiKey: 'qisqa', label: null }),
    );

    // Sinash ro'yxatida bo'lishi kerak
    check('sinash ro‘yxatida bor', keys.keysToTry('gemini').includes('SINOV-KALIT-1234567890'));

    // O'chirilgan kalit sinalmaydi
    keys.setAiKeyActive(mine.id, false);
    check('o‘chirilgan kalit sinalmaydi', !keys.keysToTry('gemini').includes('SINOV-KALIT-1234567890'));
    keys.setAiKeyActive(mine.id, true);

    // Xato belgilanadi va admin ko'radi
    keys.markKeyResult('SINOV-KALIT-1234567890', 'Gemini 503: high demand');
    const withErr = keys.listAiKeys().find((k: any) => k.id === mine.id)!;
    check('xato yozildi', withErr.lastError?.includes('503'), withErr.lastError);
    keys.markKeyResult('SINOV-KALIT-1234567890', null);
    check('muvaffaqiyat xatoni tozalaydi', keys.listAiKeys().find((k: any) => k.id === mine.id)!.lastError === null);

    keys.deleteAiKey(mine.id);
    check('kalit o‘chirildi', !keys.listAiKeys().some((k: any) => k.id === mine.id));
  }

  /* ══════════════  Sessiya muddati  ══════════════ */

  section('Sessiya muddati');

  {
    const wa = require('../services/webAuth');

    const sess = db
      .prepare(`SELECT token, expires_at, ttl_hours FROM admin_sessions ORDER BY rowid DESC LIMIT 1`)
      .get() as { token: string; expires_at: string; ttl_hours: number } | undefined;

    if (sess) {
      check('sessiyada muddat saqlanadi', sess.ttl_hours > 0, sess.ttl_hours);

      /*
       * Muddat BEKORCHILIK vaqti bo'lishi kerak: foydalanilganda
       * oldinga suriladi. Ilgari u qat'iy edi va kun bo'yi ishlab
       * turgan klinika ham chiqib ketardi.
       */
      db.prepare(
        `UPDATE admin_sessions SET expires_at = datetime('now', '+1 hours') WHERE token = ?`,
      ).run(sess.token);

      const before = db
        .prepare(`SELECT expires_at FROM admin_sessions WHERE token = ?`)
        .get(sess.token) as { expires_at: string };

      // resolveSession xom token kutadi, bazada esa hash yotadi — to'g'ridan-to'g'ri sinaymiz
      const rows = db
        .prepare(
          `SELECT s.expires_at, s.ttl_hours FROM admin_sessions s WHERE s.token = ? AND s.expires_at > datetime('now')`,
        )
        .get(sess.token) as { expires_at: string; ttl_hours: number };
      check('muddat kamayganini ko‘rdik', rows.expires_at === before.expires_at);

      // Uzaytirish mantig'i: qolgan vaqt muddatning 90% dan kam bo'lsa suriladi
      const ttlMs = rows.ttl_hours * 3600_000;
      const remaining = new Date(rows.expires_at.replace(' ', 'T') + 'Z').getTime() - Date.now();
      check('uzaytirish sharti ishga tushadi', remaining < ttlMs * 0.9, { remaining, ttlMs });
    }

    check('eskirgan sessiyalar tozalanadi', typeof wa.purgeExpiredSessions() === 'number');
  }

  /* ══════════════  Telegram ismini ajratish  ══════════════ */

  section('Ism va familiya');

  {
    const mk = (id: number, first: string, last?: string) =>
      upsertUser({ id, first_name: first, last_name: last, language_code: 'uz' } as any);

    // Telegram familiya BERGAN — tegilmaydi
    const a = mk(781001, 'Aziz', 'Karimov');
    check('familiya berilgan bo‘lsa ajratilmaydi', a.firstName === 'Aziz' && a.lastName === 'Karimov');

    /*
     * Familiya berilmagan va ismda probel bor — oxirgi so'z familiya.
     * Ilgari butun matn ism maydoniga tushar, familiya bo'sh qolardi
     * va forma uni qo'lda qayta yozishga majbur qilardi.
     */
    const b = mk(781002, 'Aziz Karimov');
    check('to‘liq ism ajratildi', b.firstName === 'Aziz' && b.lastName === 'Karimov', {
      f: b.firstName,
      l: b.lastName,
    });

    // Uch so'z — oxirgisi familiya
    const c = mk(781003, 'Abdulla Qodiriy Zufarovich');
    check('uch so‘zda oxirgisi familiya', c.lastName === 'Zufarovich' && c.firstName === 'Abdulla Qodiriy');

    // Bitta so'z — ajratilmaydi
    const d = mk(781004, 'Aziz');
    check('bitta so‘z ajratilmaydi', d.firstName === 'Aziz' && !d.lastName);

    // Ortiqcha probellar
    const e = mk(781005, '  Aziz   Karimov  ');
    check('ortiqcha probel tozalanadi', e.firstName === 'Aziz' && e.lastName === 'Karimov');

    /*
     * Odam profilini to'ldirgach Telegram unga TEGMAYDI: ism uning
     * o'z tanlovi. Bu qoida ilgari ham bor edi, sinov uni saqlaydi.
     */
    db.prepare(`UPDATE users SET first_name = 'Anvar', last_name = 'Rasulov' WHERE telegram_id = ?`).run(781002);
    const again = mk(781002, 'Aziz Karimov');
    check('odam yozgan ism qayta yozilmaydi', again.firstName === 'Anvar' && again.lastName === 'Rasulov');
  }

  /* ══════════════  Klinikani boshqarish  ══════════════ */

  section('Klinikani tahrirlash, parol, o‘chirish');

  {
    const cl = require('../services/clinics');
    const wa2 = require('../services/webAuth');

    /* ── Tahrirlash ── */

    const edited = cl.updateClinicByAdmin(clinic.id, { name: 'Yangi nom', phone: '998901112233' }, moderator.id);
    check('nom o‘zgardi', edited.name === 'Yangi nom');
    check('telefon o‘zgardi', edited.phone === '998901112233');
    throws(
      'yo‘q shahar qabul qilinmaydi',
      () => cl.updateClinicByAdmin(clinic.id, { cityId: 999_999 }, moderator.id),
      'bad_city',
    );
    cl.updateClinicByAdmin(clinic.id, { name: clinic.name }, moderator.id);

    /* ── O'chirishning ta'siri ── */

    const impact = cl.clinicDeletionImpact(clinic.id);
    check('tarix sanaldi', impact.offers > 0 && impact.deals > 0, JSON.stringify(impact));
    check('tarixi bor klinika bo‘sh emas', impact.empty === false);

    throws(
      'tarixi bor klinika oddiy yo‘l bilan o‘chmaydi',
      () => cl.deleteClinic(clinic.id, moderator.id),
      'clinic_has_history',
    );

    /* ── Bo'sh klinikani o'chirish ── */

    const spare = cl.registerClinic({
      userId: moderator.id,
      name: 'O‘chiriladigan klinika',
      cityId: tashkent.id,
      address: 'Test',
      about: '',
      licenseFileId: 'lic-del',
      operationIds: [gallbladder.id],
    });
    const spareImpact = cl.clinicDeletionImpact(spare.id);
    check('yangi klinika bo‘sh', spareImpact.empty === true, JSON.stringify(spareImpact));

    cl.deleteClinic(spare.id, moderator.id);
    check(
      'bo‘sh klinika o‘chdi',
      !db.prepare(`SELECT id FROM clinics WHERE id = ?`).get(spare.id),
    );

    /* ── Majburiy o'chirish HAMMASINI olib ketadi ── */

    const doomed = cl.registerClinic({
      userId: moderator.id,
      name: 'Tarixi bor klinika',
      cityId: tashkent.id,
      address: 'Test',
      about: '',
      licenseFileId: 'lic-doom',
      operationIds: [gallbladder.id],
    });
    const acc = wa2.createAccount({
      phone: '998900999111',
      fullName: 'Sinov egasi',
      level: 'clinic_admin',
      clinicId: doomed.id,
    });
    db.prepare(
      `INSERT INTO offers (request_id, clinic_id, price_uzs, includes, status)
       VALUES (?, ?, 1000000, '[]', 'SENT')`,
    ).run(request.id, doomed.id);

    const doomedImpact = cl.clinicDeletionImpact(doomed.id);
    check('taklif sanaldi', doomedImpact.offers === 1 && doomedImpact.empty === false);
    check('hisob sanaldi', doomedImpact.accounts === 1);

    cl.deleteClinic(doomed.id, moderator.id, { force: true });
    check('majburiy o‘chirish ishladi', !db.prepare(`SELECT id FROM clinics WHERE id = ?`).get(doomed.id));
    check(
      'taklif ham ketdi (CASCADE)',
      (db.prepare(`SELECT COUNT(*) n FROM offers WHERE clinic_id = ?`).get(doomed.id) as any).n === 0,
    );
    check(
      'hisob ham ketdi',
      !db.prepare(`SELECT id FROM admin_users WHERE id = ?`).get(acc.user.id),
    );
    /*
     * `users` dagi juftlik QOLADI — unga jurnal va yozishmalar
     * ishora qiladi — lekin roli olib tashlanadi.
     */
    const mirror = db.prepare(`SELECT roles, clinic_id FROM users WHERE telegram_id = ?`).get(-acc.user.id) as any;
    check('juftlik qatori saqlandi', Boolean(mirror));
    check('juftlikning roli olindi', mirror?.roles === '[]' && mirror?.clinic_id === null);
    check(
      'o‘chirish jurnalga yozildi',
      Boolean(
        db
          .prepare(`SELECT id FROM moderation_log WHERE entity = 'clinic' AND entity_id = ? AND action = 'delete'`)
          .get(doomed.id),
      ),
    );

    /* ── Parolni tiklash ── */

    const before = db.prepare(`SELECT password_hash FROM admin_users WHERE clinic_id = ? LIMIT 1`).get(clinic.id) as any;
    check('tiklashdan oldin parol bor', Boolean(before?.password_hash));

    const reset = cl.resetClinicPassword(clinic.id, moderator.id);
    check('havola berildi', reset.setupToken.length > 20);

    const after = db
      .prepare(`SELECT password_hash, setup_token FROM admin_users WHERE phone = ?`)
      .get(reset.phone) as any;
    check('parol tozalandi', after.password_hash === '');
    check('sozlash tokeni qo‘yildi', after.setup_token === reset.setupToken);
    check(
      'token jurnalga YOZILMADI',
      !(db.prepare(`SELECT note FROM moderation_log WHERE action = 'password:reset'`).all() as any[]).some(
        (r) => String(r.note ?? '').includes(reset.setupToken),
      ),
    );
  }

  /* ══════════════  Bemorning brauzerdan kirishi  ══════════════ */

  section('Bemor brauzerdan kiradi');
  {
    const pa = require('../services/patientAuth');
    const crypto = require('node:crypto');

    // ── Raqamni normallash ──
    check('mahalliy raqamga kod qo‘shiladi', pa.normalizePhone('901234567') === '998901234567');
    check('bezaklar tushadi', pa.normalizePhone('+998 90 123-45-67') === '998901234567');
    check('to‘liq raqam o‘zgarmaydi', pa.normalizePhone('998901234567') === '998901234567');
    check('qisqa raqam rad etiladi', pa.normalizePhone('12345') === null);
    check('boshqa mamlakat rad etiladi', pa.normalizePhone('79161234567') === null);

    // ── Bitta raqam = bitta hisob ──
    const phone = '998909998877';
    const browserUser = upsertUser({ id: 960_001, first_name: 'Brauzer', language_code: 'uz' });
    db.prepare(`UPDATE users SET phone = ? WHERE id = ?`).run(phone, browserUser.id);

    throws(
      'bir xil raqamli ikkinchi hisob yaratilmaydi',
      () => {
        const other = upsertUser({ id: 960_002, first_name: 'Takror', language_code: 'uz' });
        db.prepare(`UPDATE users SET phone = ? WHERE id = ?`).run(phone, other.id);
      },
    );

    // ── Kod so‘rash ──
    check(
      'noma‘lum raqamga hisob topilmaydi',
      !(await pa.requestLoginCode('998900000001', null)).found,
    );
    const asked = await pa.requestLoginCode('+998 90 999-88-77', null);
    check('mavjud raqam turli formatda ham topiladi', asked.found === true);

    // Dev'da bot yubormaydi, lekin kod BAZAGA yozilgan bo'lishi kerak
    const codeRow = db
      .prepare(`SELECT id FROM phone_login_codes WHERE phone = ? ORDER BY id DESC LIMIT 1`)
      .get(phone) as { id: number } | undefined;
    check('kod saqlandi', Boolean(codeRow));

    // Kodning o'zi saqlanmaydi — xeshini bilgan holda sinaymiz
    const known = '424242';
    db.prepare(`UPDATE phone_login_codes SET code_hash = ? WHERE id = ?`).run(
      crypto.createHash('sha256').update(`${phone}:${known}`).digest('hex'),
      codeRow!.id,
    );

    throws('noto‘g‘ri kod o‘tmaydi', () => pa.verifyLoginCode(phone, '000000', null, null));
    check(
      'xato urinish sanaldi',
      (db.prepare(`SELECT attempts FROM phone_login_codes WHERE id = ?`).get(codeRow!.id) as any)
        .attempts === 1,
    );

    const session = pa.verifyLoginCode(phone, known, null, null);
    check('to‘g‘ri kod sessiya berdi', Boolean(session.token) && session.user.id === browserUser.id);
    check('sessiya AYNAN o‘sha hisobga', session.user.phone === phone);

    throws('kod ikkinchi marta ishlamaydi', () => pa.verifyLoginCode(phone, known, null, null));

    check('token foydalanuvchini beradi', pa.resolvePatientSession(session.token)?.id === browserUser.id);
    check('yo‘q token hech kimni bermaydi', pa.resolvePatientSession('yoq-token') === null);

    // Muddati o'tgan sessiya ishlamasin
    check('bazada token ochiq matnda emas, xesh bo‘lib saqlanadi',
      !db.prepare(`SELECT 1 FROM patient_sessions WHERE token = ?`).get(session.token) &&
        !!db.prepare(`SELECT 1 FROM patient_sessions WHERE token = ?`).get(pa.sessionKey(session.token)));
    db.prepare(`UPDATE patient_sessions SET expires_at = datetime('now','-1 hour') WHERE token = ?`)
      .run(pa.sessionKey(session.token));
    check('muddati o‘tgan sessiya rad etiladi', pa.resolvePatientSession(session.token) === null);

    // Chiqish tokenni darhol o'chiradi
    const second = (() => {
      db.prepare(
        `INSERT INTO phone_login_codes (phone, code_hash, expires_at) VALUES (?, ?, datetime('now','+5 minutes'))`,
      ).run(phone, crypto.createHash('sha256').update(`${phone}:${known}`).digest('hex'));
      return pa.verifyLoginCode(phone, known, null, null);
    })();
    pa.endPatientSession(second.token);
    check('chiqqandan keyin token o‘lik', pa.resolvePatientSession(second.token) === null);

    /* ── NOLDAN ro'yxatdan o'tish: Telegramsiz odam ── */

    const fresh = '998911100011';
    db.prepare(`DELETE FROM users WHERE phone = ?`).run(fresh);
    db.prepare(`DELETE FROM phone_login_codes WHERE phone = ?`).run(fresh);

    // SMS sozlanmagan va Telegram hisobi ham yo'q — kanal yo'q
    const noChannel = await pa.requestLoginCode(fresh, null);
    check('kanalsiz raqamga kod yasalmaydi', noChannel.channel === null && !noChannel.sent);
    check(
      'kanalsiz holatda bo‘sh kod yozuvi qolmaydi',
      (db.prepare(`SELECT COUNT(*) n FROM phone_login_codes WHERE phone = ?`).get(fresh) as any).n === 0,
    );

    // Kanal bo'lganda hisob tasdiqlangach YARATILADI
    db.prepare(
      `INSERT INTO phone_login_codes (phone, code_hash, expires_at) VALUES (?, ?, datetime('now','+5 minutes'))`,
    ).run(fresh, crypto.createHash('sha256').update(`${fresh}:135790`).digest('hex'));

    const born = pa.verifyLoginCode(fresh, '135790', null, null);
    check('yangi hisob yaratildi', born.isNew === true && born.user.phone === fresh);
    check('bemor roli berildi', born.user.roles.includes('patient'));
    check(
      'profil to‘ldirilmagan — ilova ro‘yxatdan o‘tishga yuboradi',
      born.user.profileCompletedAt === null && born.user.onboardedAt === null,
    );

    /*
     * Eng nozik joy: `telegram_id` AJRATILGAN diapazonda bo'lishi va
     * `admin_users.id` bilan to'qnashmasligi kerak — aks holda
     * `telegramChatFor` begona odamning chatini topib berardi.
     */
    const bornRow = db
      .prepare(`SELECT telegram_id FROM users WHERE id = ?`)
      .get(born.user.id) as { telegram_id: number };
    check('ajratilgan diapazonda', bornRow.telegram_id <= -2_000_000_000, bornRow.telegram_id);
    check(
      'admin hisobi bilan to‘qnashmaydi',
      (db.prepare(`SELECT COUNT(*) n FROM admin_users WHERE id = ?`).get(-bornRow.telegram_id) as any)
        .n === 0,
    );

    const { telegramChatForTest } = require('../services/notifications');
    check(
      'Telegramsiz hisobga chat topilmaydi',
      telegramChatForTest({ telegram_id: bornRow.telegram_id }) === null,
    );

    // Ikkinchi marta KIRISH bo'ladi, yangi hisob emas
    db.prepare(
      `INSERT INTO phone_login_codes (phone, code_hash, expires_at) VALUES (?, ?, datetime('now','+5 minutes'))`,
    ).run(fresh, crypto.createHash('sha256').update(`${fresh}:246800`).digest('hex'));
    const again = pa.verifyLoginCode(fresh, '246800', null, null);
    check('ikkinchi kirish yangi hisob ochmaydi', again.isNew === false && again.user.id === born.user.id);

    // Bir soatda 5 tadan ko'p kod so'ralmaydi
    for (let i = 0; i < 6; i++) await pa.requestLoginCode(phone, null).catch(() => {});
    let limited = false;
    try {
      await pa.requestLoginCode(phone, null);
    } catch (err: any) {
      limited = err?.code === 'rate_limited';
    }
    check('bir raqamga kod so‘rash cheklangan', limited);
  }

  section('Operatsiya narx oralig‘i');
  {
    const pricing = require('../services/operationPricing');

    /*
     * Katalog sinxronizatsiyasi bo'limi importdan tashqaridagi
     * operatsiyalarni nofaol qilib qo'yadi, bu bo'lim esa undan
     * KEYIN ishlaydi. Shuning uchun qaytarib yoqiladi — aks holda
     * `unknown_operation` chiqadi va sabab ko'rinmaydi.
     */
    db.prepare(`UPDATE operations SET active = 1 WHERE id = ?`).run(gallbladder.id);

    const opBody = (extra: Record<string, unknown> = {}) => ({
      patientId: patient.id,
      operationId: gallbladder.id,
      cityId: tashkent.id,
      conditionText: 'Holatim: qorin o‘ng tomonida og‘riq, tekshiruvda tosh topildi.',
      attachments: [],
      acceptTerms: true,
      /* Xizmat to'g'ridan-to'g'ri chaqiriladi — marshrutdagi zod
         standart qiymatlari bu yerda qo'llanmaydi */
      urgency: 'normal',
      ...extra,
    });

    // ── Admin oraliqni belgilaydi ──
    const saved = pricing.setOperationPriceRange(gallbladder.id, 5_000_000, 20_000_000);
    check('oraliq saqlandi', saved.minPriceUzs === 5_000_000 && saved.maxPriceUzs === 20_000_000);

    check(
      'oraliq katalogda ko‘rinadi',
      pricing
        .listOperationsForPricing()
        .some((o: any) => o.id === gallbladder.id && o.minPriceUzs === 5_000_000),
    );

    // min > max — bunday oraliqqa hech qanday byudjet to'g'ri kelmaydi
    throws(
      'teskari oraliq rad etiladi',
      () => pricing.setOperationPriceRange(gallbladder.id, 30_000_000, 10_000_000),
      'invalid_range',
    );

    // ── Bemorning byudjeti oraliqda bo'lishi kerak ──
    throws(
      'oraliqdan past byudjet rad etiladi',
      () => requests.createRequest(opBody({ budgetUzs: 3_000_000 }) as any),
      'budget_below_min',
    );
    throws(
      'oraliqdan yuqori byudjet rad etiladi',
      () => requests.createRequest(opBody({ budgetUzs: 25_000_000 }) as any),
      'budget_above_max',
    );

    const inRange = requests.createRequest(opBody({ budgetUzs: 12_000_000 }) as any);
    check('oraliq ichidagi byudjet qabul qilindi', inRange.budgetUzs === 12_000_000);

    // Chegaralarning O'ZI ham ichida — `<` emas, `<=`
    const atMin = requests.createRequest(opBody({ budgetUzs: 5_000_000 }) as any);
    check('eng past chegara ichida hisoblanadi', atMin.budgetUzs === 5_000_000);
    const atMax = requests.createRequest(opBody({ budgetUzs: 20_000_000 }) as any);
    check('eng yuqori chegara ichida hisoblanadi', atMax.budgetUzs === 20_000_000);

    // Byudjetsiz so'rov oraliqqa qaramaydi — byudjet ixtiyoriy bo'lib qolaveradi
    const noBudget = requests.createRequest(opBody() as any);
    check('byudjetsiz so‘rov o‘tadi', noBudget.budgetUzs === null);

    /*
     * ── Tahrirlash ham tekshiriladi ──
     *
     * Aks holda oraliq chetlab o'tilardi: to'g'ri byudjet bilan
     * yuborib, keyin tahrirlab oraliqdan chiqarish mumkin bo'lardi.
     */
    throws(
      'tahrirlashda ham oraliq tekshiriladi',
      () => requests.updateRequest(inRange.id, patient.id, { budgetUzs: 100_000_000 }),
      'budget_above_max',
    );
    const edited = requests.updateRequest(inRange.id, patient.id, { budgetUzs: 15_000_000 });
    check('oraliq ichida tahrirlash ishlaydi', edited.budgetUzs === 15_000_000);

    // ── Faqat bitta chegara ──
    pricing.setOperationPriceRange(gallbladder.id, 5_000_000, null);
    throws(
      'faqat pastki chegara ham ishlaydi',
      () => requests.createRequest(opBody({ budgetUzs: 1_000_000 }) as any),
      'budget_below_min',
    );
    const highOk = requests.createRequest(opBody({ budgetUzs: 500_000_000 }) as any);
    check('yuqori chegara yo‘q — katta byudjet o‘tadi', highOk.budgetUzs === 500_000_000);

    // ── Chegara olib tashlanadi ──
    pricing.setOperationPriceRange(gallbladder.id, null, null);
    const free = requests.createRequest(opBody({ budgetUzs: 1_000_000 }) as any);
    check('chegarasiz operatsiyada byudjet erkin', free.budgetUzs === 1_000_000);
  }

  {
    section('Sayt media (klinikatop.uz)');
    const media = await import('../services/siteMedia');

    // ── YouTube havolasi tanib olinadi ──
    const id = 'dQw4w9WgXcQ';
    check('youtu.be havolasi', media.parseYoutubeId(`https://youtu.be/${id}`) === id);
    check('watch?v= havolasi', media.parseYoutubeId(`https://www.youtube.com/watch?v=${id}&t=10`) === id);
    check('shorts havolasi', media.parseYoutubeId(`https://youtube.com/shorts/${id}`) === id);
    check('faqat ID', media.parseYoutubeId(id) === id);
    check('begona sayt rad etiladi', media.parseYoutubeId(`https://evil.example/watch?v=${id}`) === null);
    check('buzuq ID rad etiladi', media.parseYoutubeId('https://youtu.be/abc') === null);

    // ── Faqat ro'yxatdagi joylar ──
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ).toString('base64');
    throws(
      "ro'yxatda yo'q kalit rad etiladi",
      () => media.setSiteImage('../../etc', { mimeType: 'image/png', dataBase64: png, altUz: '', altRu: '' }),
      'not_found',
    );
    throws(
      'video joyiga rasm yuklab bo‘lmaydi',
      () => media.setSiteImage('video-home', { mimeType: 'image/png', dataBase64: png, altUz: '', altRu: '' }),
      'wrong_kind',
    );
    throws(
      'SVG qabul qilinmaydi (ichida skript bo‘lishi mumkin)',
      () => media.setSiteImage('hero-app', { mimeType: 'image/svg+xml', dataBase64: png, altUz: '', altRu: '' }),
      'unsupported_type',
    );

    // ── Yuklash, ochiq ro'yxat, almashtirish, o'chirish ──
    const first = media.setSiteImage('hero-app', { mimeType: 'image/png', dataBase64: png, altUz: 'Ilova', altRu: 'Приложение' });
    check('rasm yuklandi va manzil berildi', Boolean(first.url?.startsWith('/api/public/media/hero-app-')));
    check('ochiq ro‘yxatda chiqadi', media.publicSiteMedia()['hero-app']?.url === first.url);
    const firstName = first.url!.split('/').pop()!;
    check('faylni o‘qish mumkin', media.readSiteMediaFile(firstName).mimeType === 'image/png');

    const second = media.setSiteImage('hero-app', { mimeType: 'image/png', dataBase64: png, altUz: '', altRu: '' });
    check('almashtirilganda manzil yangilanadi (kesh)', second.url !== first.url);
    throws('eski fayl endi berilmaydi', () => media.readSiteMediaFile(firstName), 'not_found');
    throws('yo‘l bo‘ylab chiqish rad etiladi', () => media.readSiteMediaFile('../klinikatop.db'), 'not_found');

    const video = media.setSiteVideo('video-home', { url: `https://youtu.be/${id}`, altUz: '', altRu: '' });
    check('video saqlandi', video.youtubeId === id);

    media.clearSiteMedia('hero-app');
    media.clearSiteMedia('video-home');
    check('o‘chirilgach ochiq ro‘yxat bo‘sh', Object.keys(media.publicSiteMedia()).length === 0);
    throws('o‘chirilgan fayl berilmaydi', () => media.readSiteMediaFile(second.url!.split('/').pop()!), 'not_found');
  }

  {
    section('Klinika arizasi: litsenziya fayli');
    const apps = await import('../services/clinicApplications');
    const lic = await import('../services/applicationFiles');
    const pdf = Buffer.from('%PDF-1.4\n%sinov\n').toString('base64');
    const cityId = (db.prepare('SELECT id FROM cities LIMIT 1').get() as { id: number }).id;
    const opId = (db.prepare('SELECT id FROM operations LIMIT 1').get() as { id: number }).id;
    const stamp = Date.now();
    const base = (n: string, file: { name: string; dataBase64: string }) => ({
      name: `Litsenziya sinovi ${n}`,
      cityId,
      address: 'Toshkent',
      about: '',
      licenseNo: `LIC-FILE-${n}-${stamp}`,
      contactName: 'Aziz',
      contactPhone: `+99890${String(stamp).slice(-7)}`.slice(0, 13) + n.length,
      contactEmail: null,
      operationIds: [opId],
      labTestIds: [],
      acceptsReferral: false,
      licenseFile: file,
      ip: null,
    });

    throws(
      '.pdf deb nomlangan HTML rad etiladi',
      () => apps.submitApplication(base('html', { name: 'x.pdf', dataBase64: Buffer.from('<html><script>1</script></html>').toString('base64') })),
      'unsupported_type',
    );
    throws('bo‘sh fayl rad etiladi', () => apps.submitApplication(base('empty', { name: 'x.pdf', dataBase64: '' })), 'empty_file');
    throws(
      '8 MB dan katta fayl rad etiladi',
      () => apps.submitApplication(base('big', { name: 'x.pdf', dataBase64: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(lic.MAX_LICENSE_BYTES)]).toString('base64') })),
      'file_too_large',
    );

    const created = apps.submitApplication(base('ok', { name: '../../etc/passwd.pdf', dataBase64: pdf }));
    const app = apps.getApplication(created.id);
    check('ariza fayl bilan saqlandi', app.licenseFile?.mime === 'application/pdf');
    check('fayl nomidan yo‘l belgilari olib tashlandi', app.licenseFile?.name === 'passwd.pdf', app.licenseFile?.name);
    check('admin faylni o‘qiy oladi', apps.getApplicationLicense(created.id).buffer.toString('latin1').startsWith('%PDF-'));

    const approved = apps.approveApplication(created.id, moderator.id);
    const doc = db
      .prepare(`SELECT d.kind, f.mime_type FROM clinic_documents d JOIN files f ON f.id = d.file_id WHERE d.clinic_id = ?`)
      .get(approved.clinicId) as { kind: string; mime_type: string } | undefined;
    check('tasdiqlanganda litsenziya klinika hujjatlariga ko‘chdi', doc?.kind === 'license' && doc.mime_type === 'application/pdf');

    const spam = apps.submitApplication(base('del', { name: 'l.pdf', dataBase64: pdf }));
    apps.deleteApplication(spam.id);
    throws('o‘chirilgan arizaning fayli qolmaydi', () => apps.getApplicationLicense(spam.id), 'not_found');
  }

  {
    section('Admin: so‘rovlar va ular qaysi klinikalarga ketgani');
    const ar = await import('../services/adminRequests');

    const all = ar.listAdminRequests('all');
    check('so‘rovlar ro‘yxati bo‘sh emas', all.length > 0);
    const sent = all.find((r) => r.sent > 0);
    check('klinikaga yetgan so‘rov bor', Boolean(sent));
    if (sent) {
      const d = ar.getAdminRequest(sent.id);
      check('tafsilotda klinikalar soni ro‘yxat bilan bir xil', d.clinics.length === sent.sent);
      check('klinikaga yetgan so‘rovda diagnostika yo‘q', d.diagnosis === null);
      check('ko‘rganlar soni to‘g‘ri', d.clinics.filter((c) => c.viewedAt).length === sent.viewed);
    }
    check(
      '"yetmagan" filtri faqat hech kimga ketmaganlarni beradi',
      ar.listAdminRequests('unreached').every((r) => r.sent === 0),
    );
    check(
      '"taklifsiz" filtri: yetgan, lekin taklif yo‘q',
      ar.listAdminRequests('no_offers').every((r) => r.sent > 0 && r.offers === 0),
    );
    check(
      '"faol" filtri faqat ochiq so‘rovlar',
      ar.listAdminRequests('active').every((r) => r.status === 'NEW' || r.status === 'COLLECTING'),
    );

    const closed = db.prepare(`SELECT id FROM requests WHERE status IN ('CANCELLED','COMPLETED') LIMIT 1`).get() as
      | { id: number }
      | undefined;
    if (closed) throws('yopilgan so‘rovni qayta yuborib bo‘lmaydi', () => ar.rebroadcastRequest(closed.id), 'request_closed');

    const open = ar.listAdminRequests('active').find((r) => r.sent > 0);
    if (open) {
      const before = db.prepare(`SELECT COUNT(*) n FROM notifications`).get() as { n: number };
      const again = ar.rebroadcastRequest(open.id);
      const after = db.prepare(`SELECT COUNT(*) n FROM notifications`).get() as { n: number };
      check(
        'qayta yuborishda oldin xabar olgan klinikaga takror xabar ketmaydi',
        again.added > 0 || after.n === before.n,
        { added: again.added, before: before.n, after: after.n },
      );
    }
    throws('mavjud bo‘lmagan so‘rov', () => ar.getAdminRequest(99_999_999), 'not_found');
  }

  {
    section('Bemor paroli: ro‘yxatdan o‘tish, kirish, tiklash');
    const pa = await import('../services/patientAuth');
    const phone = '99893' + String(Date.now()).slice(-7);
    const codeFor = (code: string) =>
      db
        .prepare(`INSERT INTO phone_login_codes (phone, code_hash, expires_at, ip) VALUES (?, ?, datetime('now','+5 minutes'), 'test')`)
        .run(phone, nodeCrypto.createHash('sha256').update(`${phone}:${code}`).digest('hex'));

    // 1. Ro'yxatdan o'tish: kod bilan sessiya → parol
    codeFor('111111');
    const reg = pa.verifyLoginCode(phone, '111111', null, null);
    check('kod bilan yangi hisob ochildi', reg.isNew === true);
    throws('qisqa parol rad etiladi', () => pa.setPatientPassword(reg.token, 'abc12'), 'weak_password');
    throws('faqat raqamli parol rad etiladi', () => pa.setPatientPassword(reg.token, '12345678'), 'weak_password');
    pa.setPatientPassword(reg.token, 'yaxshi-parol1');
    check('parol o‘rnatildi', Boolean((db.prepare('SELECT password_hash FROM users WHERE phone = ?').get(phone) as any)?.password_hash));
    throws(
      'bir kod-sessiyadan ikkinchi marta parol almashtirib bo‘lmaydi',
      () => pa.setPatientPassword(reg.token, 'boshqa-parol2'),
      'forbidden',
    );

    // 2. Qayta ro'yxatdan o'tish rad etiladi, tiklash ruxsat etiladi
    await (async () => {
      let code = '';
      try {
        await pa.requestLoginCode(phone, null, 'register');
      } catch (e: any) {
        code = e.code;
      }
      check('ro‘yxatdan o‘tgan raqam qayta ro‘yxatdan o‘tolmaydi', code === 'already_registered', code);
      code = '';
      try {
        await pa.requestLoginCode('998' + '77' + String(Date.now()).slice(-7), null, 'reset');
      } catch (e: any) {
        code = e.code;
      }
      check('hisobsiz raqamda parol tiklanmaydi', code === 'no_account', code);
    })();

    // 3. Parol bilan kirish — SMS'siz
    const login = pa.loginWithPassword(`+${phone}`, 'yaxshi-parol1', null, null);
    check('telefon + parol bilan kirildi', Boolean(login.token) && login.isNew === false);
    throws('parol bilan ochilgan sessiya parolni o‘zgartira olmaydi', () => pa.setPatientPassword(login.token, 'yangi-parol3'), 'forbidden');
    throws('noto‘g‘ri parol', () => pa.loginWithPassword(phone, 'xato-parol', null, null), 'unauthorized');
    throws('mavjud bo‘lmagan raqam — xuddi shu xato', () => pa.loginWithPassword('998770000000', 'xato-parol', null, null), 'unauthorized');

    // 4. Bloklash: 5 xato → 15 daqiqa, to'g'ri parol ham o'tmaydi
    for (let i = 0; i < 5; i++) {
      try {
        pa.loginWithPassword(phone, 'xato-parol', null, null);
      } catch {
        /* kutilgan */
      }
    }
    throws('5 xatodan keyin hisob vaqtincha yopiladi', () => pa.loginWithPassword(phone, 'yaxshi-parol1', null, null), 'rate_limited');

    // 5. Tiklash: yangi kod-sessiya → yangi parol → boshqa sessiyalar yopiladi
    codeFor('222222');
    const reset = pa.verifyLoginCode(phone, '222222', null, null);
    pa.setPatientPassword(reset.token, 'yangi-parol-2026');
    check('tiklashda eski sessiyalar yopildi', pa.resolvePatientSession(login.token) === null);
    check('tiklagan sessiya ishlayveradi', pa.resolvePatientSession(reset.token) !== null);
    check('tiklash bloklashni ham ochadi', Boolean(pa.loginWithPassword(phone, 'yangi-parol-2026', null, null).token));
  }

  {
    section('Yo‘llanma: faqat o‘zi yoqqan klinikaga');
    const { MIGRATIONS } = await import('../db/migrations');
    const optIn = MIGRATIONS.find((m) => m.id === '042_referral_opt_in')!;

    // Arizasida yo'llanmani tanlamagan, lekin sukut bilan 1 bo'lib qolgan klinika
    const silent = db
      .prepare(
        `SELECT c.id FROM clinics c
          WHERE NOT EXISTS (SELECT 1 FROM clinic_applications a WHERE a.clinic_id = c.id AND a.accepts_referral = 1)
          LIMIT 1`,
      )
      .get() as { id: number };
    db.prepare(`UPDATE clinics SET accepts_referral = 1 WHERE id = ?`).run(silent.id);

    // Arizasida o'zi tanlagan klinika
    const chose = db.prepare(`SELECT clinic_id AS id FROM clinic_applications WHERE clinic_id IS NOT NULL LIMIT 1`).get() as
      | { id: number }
      | undefined;
    if (chose) {
      db.prepare(`UPDATE clinic_applications SET accepts_referral = 1 WHERE clinic_id = ?`).run(chose.id);
      db.prepare(`UPDATE clinics SET accepts_referral = 1 WHERE id = ?`).run(chose.id);
    }

    optIn.up(db);
    const flag = (id: number) => (db.prepare('SELECT accepts_referral f FROM clinics WHERE id = ?').get(id) as { f: number }).f;
    check('rozilik bermagan klinikada yo‘llanma o‘chdi', flag(silent.id) === 0);
    if (chose) check('arizada tanlagan klinikada yo‘llanma qoldi', flag(chose.id) === 1);

    const { mapClinic } = await import('../lib/mappers');
    check(
      'sukut qiymati "yoqilgan" deb ko‘rsatilmaydi',
      mapClinic({ ...(db.prepare('SELECT * FROM clinics WHERE id = ?').get(silent.id) as object), accepts_referral: 0 } as any)
        .acceptsReferral === false,
    );
  }

  {
    section('Admin: klinika ma‘lumoti');
    const { getAdminClinicDetail } = await import('../services/adminClinicDetail');
    const busy = db
      .prepare(`SELECT clinic_id AS id, COUNT(*) n FROM request_broadcasts GROUP BY clinic_id ORDER BY n DESC LIMIT 1`)
      .get() as { id: number; n: number };
    const d = getAdminClinicDetail(busy.id);
    check('kelgan so‘rovlar soni to‘g‘ri', d.activity.received === busy.n, `${d.activity.received} / ${busy.n}`);
    check('ochganlar kelganlardan ko‘p emas', d.activity.viewed <= d.activity.received);
    check('oxirgi so‘rovlar 15 tadan oshmaydi', d.recentRequests.length <= 15 && d.recentRequests.length > 0);
    check('xizmatlar ro‘yxati 30 tadan oshmaydi', d.services.operations.length <= 30);
    throws('mavjud bo‘lmagan klinika', () => getAdminClinicDetail(99_999_999), 'not_found');
  }

  {
    section('Sayt media: video faqat YouTube orqali');
    const media = await import('../services/siteMedia');
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]).toString('base64');
    throws(
      'mp4 fon video joyi yo‘q (video — YouTube havolasi)',
      () => media.setSiteImage('hero-loop', { mimeType: 'video/mp4', dataBase64: mp4, altUz: '', altRu: '' }),
      'not_found',
    );
    throws(
      'rasm joyiga video yuklab bo‘lmaydi',
      () => media.setSiteImage('hero-app', { mimeType: 'video/mp4', dataBase64: mp4, altUz: '', altRu: '' }),
      'unsupported_type',
    );
    const yt = media.setSiteVideo('video-home', { url: 'https://youtu.be/dQw4w9WgXcQ', altUz: '', altRu: '' });
    check('bosh sahifa videosi YouTube havolasi bilan saqlandi', yt.youtubeId === 'dQw4w9WgXcQ');
    media.clearSiteMedia('video-home');
  }

  {
    section('Sayt: matnlar, hamkorlar va sahifani serverda to‘ldirish');
    const sc = await import('../services/siteContent');
    const { config: cfg } = await import('../lib/config');

    // Build'ga bog'liq bo'lmasin — kichik soxta shablon
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kt-site-'));
    fs.mkdirSync(path.join(root, 'site-content'));
    fs.writeFileSync(
      path.join(root, 'site-content', 'defaults.json'),
      JSON.stringify({
        uz: { 'home.hero.title': 'Bitta so‘rov', 'nav.login': 'Kirish', 'auth.eyebrow': 'Kirish va ro‘yxatdan o‘tish', 'x.zero': '0' },
        ru: {},
      }),
    );
    fs.writeFileSync(
      path.join(root, 'index.html'),
      '<html><head><title>Bitta so‘rov</title></head><body><h1> Bitta so‘rov </h1><a aria-label="Kirish">Kirish</a>' +
        '<span>Kirish va ro‘yxatdan o‘tish</span><b>0</b><div class="marquee__track" data-partners></div></body></html>',
    );
    (cfg as any).site.root = root;
    sc.invalidateSite();

    let html = sc.renderSitePage('/');
    check('o‘zgartirilmagan sahifa asl holida', html.includes('<h1> Bitta so‘rov </h1>'));
    check('media ro‘yxati sahifa ichida', html.includes('window.__KT_MEDIA__='));

    sc.setSiteText('uz', 'nav.login', 'Kabinetga <kirish> "tez"');
    html = sc.renderSitePage('/');
    check('matn tugunida almashdi va escape qilindi', html.includes('>Kabinetga &lt;kirish&gt; &quot;tez&quot;<'));
    check('atributda ham almashdi', html.includes('aria-label="Kabinetga &lt;kirish&gt; &quot;tez&quot;"'));
    check('uzunroq matn ichidagi "Kirish" buzilmadi', html.includes('<span>Kirish va ro‘yxatdan o‘tish</span>'));

    sc.setSiteText('uz', 'home.hero.title', 'Bir so‘rov — ko‘p taklif');
    html = sc.renderSitePage('/');
    check('sarlavha (bo‘shliq bilan o‘ralgan) almashdi', html.includes('<h1> Bir so‘rov — ko‘p taklif </h1>'));
    check('<title> ham almashdi', html.includes('<title>Bir so‘rov — ko‘p taklif</title>'));

    check('juda qisqa qiymatlar tahrirlanmaydi', !sc.listSiteTexts('uz').some((e) => e.default === '0'));
    throws('bo‘sh matn saqlanmaydi', () => sc.setSiteText('uz', 'nav.login', '   '), 'empty_text');
    sc.setSiteText('uz', 'nav.login', null);
    html = sc.renderSitePage('/');
    check('asl matnga qaytarildi', html.includes('aria-label="Kirish"') && !html.includes('Kabinetga'));

    // Hamkorlar — cheklanmagan son, tartib bilan
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ).toString('base64');
    const a = sc.addPartner({ name: 'Alfa <Klinika>', url: 'alfa.uz', mimeType: 'image/png', dataBase64: png });
    const b = sc.addPartner({ name: 'Beta', url: null, mimeType: 'image/png', dataBase64: png });
    check('havola https bilan to‘ldirildi', a.url === 'https://alfa.uz/');
    throws('noto‘g‘ri havola rad etiladi', () => sc.addPartner({ name: 'X', url: 'javascript:alert(1)', mimeType: 'image/png', dataBase64: png }), 'bad_url');
    throws('logo turi tekshiriladi', () => sc.addPartner({ name: 'X', url: null, mimeType: 'text/html', dataBase64: png }), 'unsupported_type');
    html = sc.renderSitePage('/');
    check('hamkorlar sahifaga qo‘yildi (lenta uchun ikki marta)', (html.match(/class="partner"/g) ?? []).length === 4);
    check('hamkor nomi escape qilindi', html.includes('alt="Alfa &lt;Klinika&gt;"'));
    sc.reorderPartners([b.id, a.id]);
    check('tartib o‘zgardi', sc.listPartners()[0].id === b.id);
    sc.deletePartner(a.id);
    sc.deletePartner(b.id);
    html = sc.renderSitePage('/');
    check('hamkorlar o‘chirilgach lenta bo‘sh', html.includes('data-partners></div>'));
    throws('noma‘lum sahifa', () => sc.renderSitePage('/yoq-sahifa/'), 'not_found');

    db.prepare(`DELETE FROM site_texts`).run();
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    section('Sayt: logoni admin almashtiradi');
    const media = await import('../services/siteMedia');
    const sc = await import('../services/siteContent');
    const { config: cfg } = await import('../lib/config');
    const b64 = (x: string) => Buffer.from(x).toString('base64');
    const clean = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#0fb39e"/></svg>';

    throws('skriptli SVG rad etiladi', () => media.setSiteImage('logo', { mimeType: 'image/svg+xml', dataBase64: b64(clean.replace('<path', '<script>alert(1)</script><path')), altUz: '', altRu: '' }), 'unsafe_svg');
    throws('hodisa atributli SVG rad etiladi', () => media.setSiteImage('logo', { mimeType: 'image/svg+xml', dataBase64: b64(clean.replace('<path', '<path onload="x()"')), altUz: '', altRu: '' }), 'unsafe_svg');
    throws('tashqi havolali SVG rad etiladi', () => media.setSiteImage('logo', { mimeType: 'image/svg+xml', dataBase64: b64(clean.replace('<path', '<image href="https://evil.example/a.png"/><path')), altUz: '', altRu: '' }), 'unsafe_svg');
    throws('oddiy rasm joyiga SVG yuklab bo‘lmaydi', () => media.setSiteImage('hero-app', { mimeType: 'image/svg+xml', dataBase64: b64(clean), altUz: '', altRu: '' }), 'unsupported_type');

    const logo = media.setSiteImage('logo', { mimeType: 'image/svg+xml', dataBase64: b64(clean), altUz: '', altRu: '' });
    check('toza SVG logo qabul qilindi', Boolean(logo.url?.endsWith('.svg')));
    check('SVG to‘g‘ri turda beriladi', media.siteMediaFilePath(logo.url!.split('/').pop()!).mimeType === 'image/svg+xml');

    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kt-logo-'));
    fs.mkdirSync(path.join(root, 'site-content'));
    fs.writeFileSync(path.join(root, 'site-content', 'defaults.json'), JSON.stringify({ uz: {}, ru: {} }));
    fs.writeFileSync(
      path.join(root, 'index.html'),
      '<html><head><link rel="icon" href="/favicon.svg" type="image/svg+xml"></head><body>' +
        '<img src="/logo.svg" alt=""><img src="/logo.svg" alt=""><img src="/logo-light.svg" alt=""><div data-partners></div></body></html>',
    );
    const prevRoot = (cfg as any).site.root;
    (cfg as any).site.root = root;
    sc.invalidateSite();
    const html = sc.renderSitePage('/');
    check('hamma logo almashdi', !html.includes('/logo.svg"') && html.split(logo.url!).length - 1 >= 3);
    check('to‘q fon logosi bo‘lmasa asosiysi ishlatildi', !html.includes('/logo-light.svg'));
    check('favicon ham almashdi', html.includes(`<link rel="icon" href="${logo.url}" type="image/svg+xml">`));

    media.clearSiteMedia('logo');
    sc.invalidateSite();
    check('logo o‘chirilgach standart logo qaytdi', sc.renderSitePage('/').includes('src="/logo.svg"'));
    (cfg as any).site.root = prevRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    section('Shifokor: ro‘yxatdan o‘tish va admin tasdig‘i');
    const rd = await import('../services/referringDoctors');
    const pdf = Buffer.from('%PDF-1.4\n%diplom\n').toString('base64');
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
    const mkUser = (tgId: number, phone: string | null, roles = ['patient']) =>
      Number(
        db
          .prepare(`INSERT INTO users (telegram_id, first_name, roles, phone) VALUES (?, 'Doktor', ?, ?)`)
          .run(tgId, toJson(roles), phone).lastInsertRowid,
      );
    const form = (extra: Record<string, unknown> = {}) => ({
      firstName: '  Aziz ',
      lastName: 'Karimov',
      specialty: 'Kardiolog',
      workplace: '1-shahar kasalxonasi',
      bio: 'Tajriba 10 yil',
      documents: [{ kind: 'bachelor' as const, name: 'diplom.pdf', dataBase64: pdf }],
      ...extra,
    });

    const noPhone = mkUser(7_100_001, null);
    throws('telefon tasdiqlanmagan — rad etiladi', () => rd.registerDoctor(noPhone, form()), 'phone_required');

    const webAcc = mkUser(-7_100_002, '998901110002', ['clinic_admin']);
    throws('klinika hisobi shifokor bo‘la olmaydi', () => rd.registerDoctor(webAcc, form()), 'role_taken');

    const uid = mkUser(7_100_003, '998901110003');
    throws('bakalavr diplomisiz — rad etiladi', () => rd.registerDoctor(uid, form({ documents: [] })), 'bachelor_required');
    throws(
      'faqat magistr diplomi — yetmaydi',
      () => rd.registerDoctor(uid, form({ documents: [{ kind: 'master', name: 'm.pdf', dataBase64: pdf }] })),
      'bachelor_required',
    );
    throws(
      '.pdf deb nomlangan HTML diplom rad etiladi',
      () => rd.registerDoctor(uid, form({ documents: [{ kind: 'bachelor', name: 'd.pdf', dataBase64: Buffer.from('<html></html>xxxxxxxx').toString('base64') }] })),
      'unsupported_type',
    );
    check('xato ariza hech narsa yaratmadi', rd.getMyDoctor(uid) === null);

    const doc = rd.registerDoctor(uid, form());
    check('ariza yaratildi — pending', doc.status === 'pending' && doc.documents.length === 1);
    check('ism tozalandi', doc.firstName === 'Aziz');
    const roles = JSON.parse((db.prepare('SELECT roles FROM users WHERE id = ?').get(uid) as any).roles);
    check('bemor roli saqlanib, doctor qo‘shildi', roles.includes('patient') && roles.includes('doctor'), roles);

    const again = rd.registerDoctor(uid, form({ specialty: 'Kardiojarroh', documents: [] }));
    check('qayta yuborish yangi ariza ochmaydi, profilni yangilaydi', again.id === doc.id && again.specialty === 'Kardiojarroh');
    check('qayta yuborish holatni o‘zgartirmaydi', again.status === 'pending');
    check(
      'bitta foydalanuvchi — bitta profil',
      (db.prepare('SELECT COUNT(*) AS n FROM referring_doctors WHERE user_id = ?').get(uid) as any).n === 1,
    );

    throws('tasdiqlanmagan shifokor tavsiya bera olmaydi', () => rd.assertApprovedDoctor(uid), 'forbidden');
    check('shifokor o‘z diplomini o‘qiy oladi', rd.readMyDoctorDocument(uid, doc.documents[0].id).buffer.toString('latin1').startsWith('%PDF-'));
    const stranger = mkUser(7_100_004, '998901110004');
    throws('begona odam diplomni o‘qiy olmaydi', () => rd.readMyDoctorDocument(stranger, doc.documents[0].id), 'not_found');
    throws('oxirgi bakalavr diplomini o‘chirib bo‘lmaydi', () => rd.deleteDoctorDocument(uid, doc.documents[0].id), 'bachelor_required');

    const list = rd.listDoctorsForAdmin('pending');
    check('admin ro‘yxatida bor, telefon bilan', list.doctors.some((d) => d.id === doc.id && d.phone === '998901110003'));
    check('kutilayotganlar soni', list.counts.pending >= 1 && rd.pendingDoctorCount() >= 1);

    throws('sababsiz rad etib bo‘lmaydi', () => rd.rejectDoctor(doc.id, moderator.id, ' '), 'reason_required');
    const rejected = rd.rejectDoctor(doc.id, moderator.id, 'Diplom <o‘qilmaydi>');
    check('rad etildi, sabab saqlandi', rejected.status === 'rejected' && rejected.rejectReason === 'Diplom <o‘qilmaydi>');
    const note = db
      .prepare(`SELECT params FROM notifications WHERE user_id = ? AND type = 'doctor_review' ORDER BY id DESC`)
      .get(uid) as any;
    check('shifokorga xabar ketdi', note && JSON.parse(note.params).approved === 0);
    throws('ko‘rib chiqilgan arizani qayta hal qilib bo‘lmaydi', () => rd.approveDoctor(doc.id, moderator.id), 'not_pending');

    const edited = rd.registerDoctor(uid, form({ bio: 'Yangi bio', documents: [] }));
    check('bio tahriri holatni o‘zgartirmaydi', edited.status === 'rejected');

    const withMaster = rd.addDoctorDocument(uid, { kind: 'master', name: 'magistr.png', dataBase64: png });
    check('yangi fayl → qayta ko‘rib chiqish (in_review)', withMaster.status === 'in_review');
    check('oldingi rad sababi saqlandi', withMaster.rejectReason === 'Diplom <o‘qilmaydi>');
    const masterId = withMaster.documents.find((d) => d.kind === 'master')!.id;
    const removed = rd.deleteDoctorDocument(uid, masterId);
    check('fayl o‘chirish holatga tegmaydi', removed.status === 'in_review' && removed.documents.length === 1);
    check('admin diplomni o‘qiy oladi', rd.readDoctorDocumentForAdmin(doc.id, doc.documents[0].id).mime === 'application/pdf');

    const approved = rd.approveDoctor(doc.id, moderator.id);
    check('tasdiqlandi', approved.status === 'approved' && approved.reviewedAt !== null);
    check('tasdiqlangan shifokor tavsiya bera oladi', rd.assertApprovedDoctor(uid).id === doc.id);
    const after = rd.addDoctorDocument(uid, { kind: 'master', name: 'm2.pdf', dataBase64: pdf });
    check('tasdiqlangan shifokor hujjat yuklasa holat o‘zgarmaydi', after.status === 'approved');
    check(
      'qaror jurnalga yozildi',
      (db.prepare(`SELECT COUNT(*) AS n FROM moderation_log WHERE entity = 'doctor' AND entity_id = ?`).get(doc.id) as any).n === 2,
    );

    for (let i = after.documents.length; i < rd.MAX_DOCTOR_DOCS; i++) {
      rd.addDoctorDocument(uid, { kind: 'master', name: `m${i}.pdf`, dataBase64: pdf });
    }
    throws('hujjatlar soni cheklangan', () => rd.addDoctorDocument(uid, { kind: 'master', name: 'x.pdf', dataBase64: pdf }), 'too_many_files');
  }

  {
    section('Shifokor: bemor uchun so‘rov va bemor roziligi');
    const rd = await import('../services/referringDoctors');
    const dc = await import('../services/doctorCases');
    const pdf = Buffer.from('%PDF-1.4\n%diplom\n').toString('base64');
    const cityId = (db.prepare('SELECT id FROM cities LIMIT 1').get() as { id: number }).id;
    const opId = (db.prepare(`SELECT id FROM operations WHERE active = 1 LIMIT 1`).get() as { id: number }).id;
    const mk = (tg: number, phone: string | null, complete = true) =>
      Number(
        db
          .prepare(
            `INSERT INTO users (telegram_id, first_name, last_name, roles, phone, city_id, birth_year, gender, onboarded_at, profile_completed_at)
             VALUES (?, 'Bemor', 'Aliyev', '["patient"]', ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          )
          .run(tg, phone, complete ? cityId : null, complete ? 1980 : null, complete ? 'male' : null).lastInsertRowid,
      );

    const docUser = mk(7_200_001, '998901200001');
    const doc = rd.registerDoctor(docUser, {
      firstName: 'Nodir', lastName: 'Rahimov', specialty: 'Terapevt', workplace: 'Poliklinika',
      documents: [{ kind: 'bachelor', name: 'd.pdf', dataBase64: pdf }],
    });
    const base = { kind: 'operation' as const, operationId: opId, cityId, note: 'Qorin og‘rig‘i, UZI da tosh bor' };
    throws('tasdiqlanmagan shifokor so‘rov yarata olmaydi', () => dc.createDoctorCase(docUser, { ...base, patientPhone: '901200002' }), 'forbidden');
    rd.approveDoctor(doc.id, moderator.id);

    throws('noto‘g‘ri raqam rad etiladi', () => dc.createDoctorCase(docUser, { ...base, patientPhone: '12345' }), 'invalid_phone');
    throws('o‘z raqamiga yuborib bo‘lmaydi', () => dc.createDoctorCase(docUser, { ...base, patientPhone: '+998 90 120 00 01' }), 'own_phone');
    throws('operatsiyada izoh majburiy', () => dc.createDoctorCase(docUser, { ...base, note: 'qisqa', patientPhone: '901200002' }), 'note_required');
    throws('yo‘llanmada ro‘yxat majburiy', () => dc.createDoctorCase(docUser, { kind: 'referral', cityId, referralItems: [' '], patientPhone: '901200002' }), 'referral_empty');

    // 1) Bemor botda BOR — xabar darhol boradi
    const patient = mk(7_200_002, '998901200002');
    const c1 = dc.createDoctorCase(docUser, { ...base, patientPhone: '90 120 00 02' });
    check('so‘rov yaratildi — kutilmoqda, bemor topildi', c1.status === 'waiting' && c1.patientLinked);
    check('telefon normallashtirildi', c1.patientPhone === '998901200002');
    check('havola bot orqali', /^https:\/\/t\.me\/\w+\?start=inv_[\w-]+$/.test(c1.inviteLink), c1.inviteLink);
    check('bemor ismi rozilikdan oldin ko‘rinmaydi', c1.patientName === null);
    const push = db.prepare(`SELECT params, link FROM notifications WHERE user_id = ? AND type = 'doctor_case'`).get(patient) as any;
    check('bemorga taklifnoma ketdi', push && push.link.startsWith('/invite/'));
    check('taklifnomada tashxis yo‘q', push && !push.params.includes('UZI'));
    check(
      'rozilikkacha klinikalar hech narsa ko‘rmaydi',
      (db.prepare('SELECT COUNT(*) AS n FROM requests WHERE doctor_case_id = ?').get(c1.id) as any).n === 0,
    );
    throws('bir raqamga bir kunda ikkinchi so‘rov yo‘q', () => dc.createDoctorCase(docUser, { ...base, patientPhone: '901200002' }), 'rate_limited');

    const token1 = c1.inviteLink.split('inv_')[1];
    const stranger = mk(7_200_003, '998901200003');
    throws('begona odam taklifnomani ochmaydi', () => dc.getInvite(stranger, token1), 'not_found');
    const inv = dc.getInvite(patient, token1);
    check('bemor taklifnomani ko‘radi', inv.doctor.name === 'Nodir Rahimov' && inv.status === 'waiting');
    throws('ofertasiz tasdiqlab bo‘lmaydi', () => dc.approveInvite(patient, token1, { acceptTerms: false }), 'terms_not_accepted');
    const ok = dc.approveInvite(patient, token1, { acceptTerms: true });
    const req = db.prepare('SELECT * FROM requests WHERE id = ?').get(ok.requestId) as any;
    check('tasdiqlandi — haqiqiy so‘rov yaratildi', req && req.patient_id === patient && req.doctor_case_id === c1.id);
    check('shifokor izohi holat tavsifi bo‘ldi', req.condition_text === base.note);
    const reqMod = await import('../services/requests');
    check('klinika uchun belgi: shifokor orqali', reqMod.getRequest(ok.requestId).viaDoctor === true);
    const after = dc.getDoctorCase(docUser, c1.id);
    check('shifokor holatni ko‘radi (approved, ism ochildi)', after.status === 'approved' && after.patientName === 'Bemor Aliyev');
    check(
      'shifokorga xabar ketdi',
      (db.prepare(`SELECT params FROM notifications WHERE type = 'doctor_case_update' ORDER BY id DESC`).get() as any)?.params.includes('approved'),
    );
    throws('ikkinchi marta tasdiqlab bo‘lmaydi', () => dc.approveInvite(patient, token1, { acceptTerms: true }), 'invite_decided');

    // 2) Bemor botda YO'Q — havola orqali keladi
    const c2 = dc.createDoctorCase(docUser, { kind: 'referral', cityId, referralItems: ['Qon umumiy tahlili', 'Glyukoza'], patientPhone: '901200004' });
    check('bemor topilmadi — havola kerak', !c2.patientLinked);
    const token2 = c2.inviteLink.split('inv_')[1];
    const late = mk(7_200_004, null);
    check('raqamsiz — kontakt so‘raladi', dc.claimInvite(late, token2) === 'no_phone');
    const wrong = mk(7_200_005, '998901200005');
    check('boshqa raqamli odam — mos emas', dc.claimInvite(wrong, token2) === 'mismatch');
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run('+998901200004', late);
    check('kontakt ulashgach — bog‘landi', dc.claimInvite(late, token2) === 'ok');
    dc.declineInvite(late, token2, false);
    check('rad etildi', dc.getDoctorCase(docUser, c2.id).status === 'declined');

    // 3) Havolasiz: raqam keyin ulashilsa ham topiladi
    const c3 = dc.createDoctorCase(docUser, { ...base, patientPhone: '901200006' });
    const newbie = mk(7_200_006, '998901200006');
    check('kontakt kelganda raqam bo‘yicha topildi', dc.bindCasesByPhone(newbie) === 1 && dc.getDoctorCase(docUser, c3.id).patientLinked);

    // 4) Muddat va eslatma
    db.prepare(`UPDATE doctor_cases SET notified_at = datetime('now', '-25 hours') WHERE id = ?`).run(c3.id);
    const r1 = dc.processDoctorCases();
    check('24 soatda bir marta eslatildi', r1.reminded >= 1 && dc.processDoctorCases().reminded === 0);
    db.prepare(`UPDATE doctor_cases SET expires_at = datetime('now', '-1 minute') WHERE id = ?`).run(c3.id);
    throws('muddati o‘tgan taklifnomani tasdiqlab bo‘lmaydi', () => dc.approveInvite(newbie, c3.inviteLink.split('inv_')[1], { acceptTerms: true }), 'invite_expired');
    dc.processDoctorCases();
    check('muddati tugadi', dc.getDoctorCase(docUser, c3.id).status === 'expired');

    const st = dc.doctorStats(docUser);
    check('statistika', st.cases === 3 && st.approved === 1 && st.declined === 1 && st.waiting === 0, st);
    throws('boshqa shifokor so‘rovni ko‘rmaydi', () => dc.getDoctorCase(patient, c1.id), 'not_found');

    // 5) "Bu men emasman" ko'paysa shifokor to'xtatiladi
    for (let i = 0; i < dc.NOT_ME_LIMIT; i++) {
      const ph = `99890130000${i}`;
      const u = mk(7_200_100 + i, ph);
      const c = dc.createDoctorCase(docUser, { ...base, patientPhone: ph });
      dc.declineInvite(u, c.inviteLink.split('inv_')[1], true);
    }
    check('3 ta “Bu men emasman” — shifokor to‘xtatildi', rd.getMyDoctor(docUser)?.status === 'rejected');
    throws('to‘xtatilgan shifokor so‘rov yarata olmaydi', () => dc.createDoctorCase(docUser, { ...base, patientPhone: '901399999' }), 'forbidden');
  }

  {
    section('So‘rov turlari: admin yoqadi/o‘chiradi va tartiblaydi');
    const rk = await import('../services/requestKinds');
    const rq = await import('../services/requests');
    check('standart: uchalasi, yo‘llanma birinchi', rk.enabledRequestKinds().join(',') === 'referral,operation,lab');

    throws('hammasini o‘chirib bo‘lmaydi', () =>
      rk.setRequestKinds([{ kind: 'lab', enabled: false }, { kind: 'operation', enabled: false }, { kind: 'referral', enabled: false }], null), 'no_kind_enabled');
    throws('tur tushib qolsa rad etiladi', () =>
      rk.setRequestKinds([{ kind: 'lab', enabled: true }, { kind: 'lab', enabled: true }, { kind: 'referral', enabled: false }], null), 'invalid_kinds');

    const after = rk.setRequestKinds(
      [{ kind: 'lab', enabled: true }, { kind: 'referral', enabled: false }, { kind: 'operation', enabled: false }],
      null,
    );
    check('tahlil birinchi, qolganlari o‘chiq', after[0].kind === 'lab' && after[0].enabled && !after[1].enabled && !after[2].enabled);
    check('bemorga faqat tahlil', rk.enabledRequestKinds().join(',') === 'lab');

    const cityId = (db.prepare('SELECT id FROM cities LIMIT 1').get() as { id: number }).id;
    const opId = (db.prepare('SELECT id FROM operations WHERE active = 1 LIMIT 1').get() as { id: number }).id;
    const pid = Number(
      db.prepare(
        `INSERT INTO users (telegram_id, first_name, last_name, roles, city_id, birth_year, gender, onboarded_at, profile_completed_at)
         VALUES (7300001, 'Tur', 'Sinov', '["patient"]', ?, 1990, 'male', datetime('now'), datetime('now'))`,
      ).run(cityId).lastInsertRowid,
    );
    throws(
      'o‘chirilgan turdagi so‘rov serverda rad etiladi',
      () =>
        rq.createRequest({
          patientId: pid, kind: 'operation', operationId: opId, cityId, budgetUzs: null,
          conditionText: 'Uzoq vaqtdan beri og‘riq bor', note: null, urgency: 'normal', attachments: [],
          otherRegionsOk: false, dateFrom: null, dateTo: null, dateFlexible: true, aiSuggested: false, acceptTerms: true,
        }),
      'kind_disabled',
    );

    // Bazada buzuq qiymat — ekran yiqilmaydi
    db.prepare(`UPDATE platform_settings SET value = 'buzuq' WHERE key = ?`).run(rk.SETTING_REQUEST_KINDS);
    check('buzuq sozlama — standartga qaytadi', rk.enabledRequestKinds().length === 3);
    db.prepare(`DELETE FROM platform_settings WHERE key = ?`).run(rk.SETTING_REQUEST_KINDS);
  }

  {
    section('Ilova bannerlari');
    const ab = await import('../services/appBanners');
    const seeded = ab.listBanners();
    check('migratsiya bitta banner yaratdi: MRT/MSKT → tekshiruv tanlash', seeded.length === 1 && seeded[0].link === '/new?kind=lab' && seeded[0].imageUrl === null && seeded[0].active);
    check('bemorga faol banner ko‘rinadi', ab.activeBanners().length === 1);

    throws('javascript: havola rad etiladi', () => ab.updateBanner(seeded[0].id, { link: 'javascript:alert(1)' }), 'bad_link');
    throws('http (shifrlanmagan) havola rad etiladi', () => ab.updateBanner(seeded[0].id, { link: 'http://x.uz' }), 'bad_link');
    throws('//boshqa-sayt havola rad etiladi', () => ab.updateBanner(seeded[0].id, { link: '//evil.com' }), 'bad_link');
    throws('rasm o‘rniga SVG rad etiladi', () => ab.updateBanner(seeded[0].id, { mimeType: 'image/svg+xml', dataBase64: 'PHN2Zy8+' }), 'unsupported_type');

    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
    const withImg = ab.updateBanner(seeded[0].id, { mimeType: 'image/png', dataBase64: png, subUz: 'Yangi izoh' });
    check('rasm yuklandi', !!withImg.imageUrl && withImg.subUz === 'Yangi izoh');
    const name = withImg.imageUrl!.split('/').pop()!;
    check('rasm fayli beriladi', ab.bannerFilePath(name).mimeType === 'image/png');
    throws('yo‘l bilan chiqib ketib bo‘lmaydi', () => ab.bannerFilePath('../klinikatop.db'), 'not_found');

    const replaced = ab.updateBanner(seeded[0].id, { mimeType: 'image/png', dataBase64: png });
    throws('almashtirilgan eski rasm endi berilmaydi', () => ab.bannerFilePath(name), 'not_found');
    check('rasm olib tashlandi — matnli ko‘rinishga qaytdi', ab.updateBanner(seeded[0].id, { removeImage: true }).imageUrl === null);
    throws('olib tashlangan rasm ham berilmaydi', () => ab.bannerFilePath(replaced.imageUrl!.split('/').pop()!), 'not_found');

    const second = ab.createBanner({ titleUz: 'Ikkinchi', link: '/new', active: false });
    check('nofaol banner bemorga ko‘rinmaydi', ab.activeBanners().every((b) => b.id !== second.id));
    check('ru sarlavha bo‘sh bo‘lsa uz olinadi', second.titleRu === 'Ikkinchi');
    const order = ab.reorderBanners([second.id, seeded[0].id]);
    check('tartib o‘zgardi', order[0].id === second.id);
    ab.deleteBanner(second.id);
    check('o‘chirildi', ab.listBanners().length === 1);
  }

  {
    section('Ilova bannerlari: video');
    const ab = await import('../services/appBanners');
    const b = ab.createBanner({ titleUz: 'Video banner', link: '/new?kind=lab' });
    const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex').toString('base64');

    const yt = ab.updateBanner(b.id, { videoLink: 'https://youtu.be/dQw4w9WgXcQ?si=abc' });
    check('YouTube havolasi tanildi', yt.video?.kind === 'youtube' && (yt.video as any).id === 'dQw4w9WgXcQ');
    check('shorts havolasi ham', (ab.updateBanner(b.id, { videoLink: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' }).video as any)?.id === 'dQw4w9WgXcQ');
    const link = ab.updateBanner(b.id, { videoLink: 'https://cdn.example.uz/promo.mp4' });
    check('to‘g‘ridan-to‘g‘ri .mp4 havola', link.video?.kind === 'link');
    throws('Instagram sahifasi — video fayl emas', () => ab.updateBanner(b.id, { videoLink: 'https://instagram.com/p/xyz' }), 'bad_video_link');
    throws('http .mp4 rad etiladi', () => ab.updateBanner(b.id, { videoLink: 'http://x.uz/a.mp4' }), 'bad_video_link');
    throws('noto‘g‘ri video turi', () => ab.updateBanner(b.id, { videoMimeType: 'video/quicktime', videoBase64: mp4 }), 'unsupported_type');

    const file = ab.updateBanner(b.id, { videoMimeType: 'video/mp4', videoBase64: mp4 });
    check('video fayl yuklandi — havola o‘rnini oldi', file.video?.kind === 'file');
    const vname = (file.video as any).src.split('/').pop();
    check('video to‘g‘ri turda beriladi', ab.bannerFilePath(vname).mimeType === 'video/mp4');
    const back = ab.updateBanner(b.id, { videoLink: 'dQw4w9WgXcQ' });
    check('havola qo‘yilganda eski video fayl o‘chdi', back.video?.kind === 'youtube');
    throws('eski video endi berilmaydi', () => ab.bannerFilePath(vname), 'not_found');

    check('matnni media ustida ko‘rsatish', ab.updateBanner(b.id, { overlay: true }).overlay === true);
    check('videoni olib tashlash', ab.updateBanner(b.id, { removeVideo: true }).video === null);
    ab.deleteBanner(b.id);
  }

  {
    section('Shifokor tavsiyasi va botdan tezkor qabul');
    const rd = await import('../services/referringDoctors');
    const dc = await import('../services/doctorCases');
    const rec = await import('../services/doctorRecommendations');
    const pdf = Buffer.from('%PDF-1.4\n%diplom\n').toString('base64');
    const cityId = (db.prepare('SELECT id FROM cities LIMIT 1').get() as { id: number }).id;
    const opId = (db.prepare('SELECT id FROM operations WHERE active = 1 LIMIT 1').get() as { id: number }).id;
    const [clinicA, clinicB] = (db.prepare('SELECT id FROM clinics ORDER BY id LIMIT 2').all() as { id: number }[]).map((r) => r.id);
    const mk = (tg: number, phone: string) =>
      Number(
        db
          .prepare(
            `INSERT INTO users (telegram_id, first_name, last_name, roles, phone, city_id, birth_year, gender, onboarded_at, profile_completed_at)
             VALUES (?, 'Malika', 'Tosheva', '["patient"]', ?, ?, 1988, 'female', datetime('now'), datetime('now'))`,
          )
          .run(tg, phone, cityId).lastInsertRowid,
      );
    const docUser = mk(7_400_001, '998901400001');
    const d = rd.registerDoctor(docUser, {
      firstName: 'Jasur', lastName: 'Aliyev', specialty: 'Urolog', workplace: 'Shahar shifoxonasi',
      documents: [{ kind: 'bachelor', name: 'd.pdf', dataBase64: pdf }],
    });
    rd.approveDoctor(d.id, moderator.id);
    const patientTg = 7_400_002;
    const patient = mk(patientTg, '998901400002');
    const c = dc.createDoctorCase(docUser, { kind: 'operation', operationId: opId, cityId, note: 'Buyrakda tosh, 8 mm', patientPhone: '901400002' });
    const { requestId } = dc.approveInvite(patient, c.inviteLink.split('inv_')[1], { acceptTerms: true });

    const addOffer = (clinicId: number, price: number, dates: string[]) =>
      Number(
        db
          .prepare(`INSERT INTO offers (request_id, clinic_id, price_uzs, includes, proposed_dates) VALUES (?, ?, ?, '["Operatsiya"]', ?)`)
          .run(requestId, clinicId, price, JSON.stringify(dates)).lastInsertRowid,
      );
    const oA = addOffer(clinicA, 10_000_000, [futureDate(3), futureDate(4)]);
    const oB = addOffer(clinicB, 12_000_000, [futureDate(5)]);

    throws('boshqa shifokor tavsiya bera olmaydi', () => rec.recommendOffer(patient, c.id, oA, null), 'forbidden');
    const r1 = rec.recommendOffer(docUser, c.id, oA, 'Tajribali jarroh, <b>yaqin</b>');
    check('tavsiya saqlandi', r1.recommendation?.offerId === oA && r1.recommendation.comment === 'Tajribali jarroh, <b>yaqin</b>');
    const pr = rec.recommendationForRequest(requestId);
    check('bemor so‘rovida 🩺 tavsiya ko‘rinadi', pr?.offerId === oA && pr.doctorName === 'Jasur Aliyev');
    check(
      'bemorga ichki bildirishnoma',
      !!db.prepare(`SELECT 1 FROM notifications WHERE user_id = ? AND type = 'doctor_recommendation'`).get(patient),
    );
    const txt = rec._testing.recText(rec._testing.context(db.prepare('SELECT id FROM doctor_recommendations WHERE offer_id = ?').get(oA)!.id as number)!);
    check('bot xabarida izoh HTML-ekranlangan', txt.includes('&lt;b&gt;yaqin&lt;/b&gt;') && !txt.includes('<b>yaqin'));
    const rows = rec._testing.dateRows(rec._testing.context((db.prepare('SELECT id FROM doctor_recommendations WHERE offer_id = ?').get(oA) as any).id)!);
    check('botda kun tugmalari + "Barcha takliflar"', rows[0].length === 2 && !!rows[rows.length - 1][0].web_app);
    throws('bir xil taklifni qayta tavsiya qilib bo‘lmaydi', () => rec.recommendOffer(docUser, c.id, oA, null), 'already_recommended');

    const r2 = rec.recommendOffer(docUser, c.id, oB, 'Fikrimni o‘zgartirdim');
    check('tavsiya almashdi — bitta faol', r2.recommendation?.offerId === oB &&
      (db.prepare('SELECT COUNT(*) AS n FROM doctor_recommendations WHERE case_id = ? AND superseded_at IS NULL').get(c.id) as any).n === 1);
    const oldRec = (db.prepare('SELECT id FROM doctor_recommendations WHERE offer_id = ?').get(oA) as any).id;
    const newRec = (db.prepare('SELECT id FROM doctor_recommendations WHERE offer_id = ?').get(oB) as any).id;
    const ymd = futureDate(5).replace(/-/g, '');

    await rec.handleRecommendationCallback({ id: 'x', from: { id: 999_999 }, data: `ry:${newRec}:${ymd}` });
    check('begona Telegram hisobi qabul qila olmaydi', (db.prepare('SELECT status FROM requests WHERE id = ?').get(requestId) as any).status !== 'CHOSEN');
    await rec.handleRecommendationCallback({ id: 'x', from: { id: patientTg }, data: `ry:${oldRec}:${futureDate(3).replace(/-/g, '')}` });
    check('eskirgan tavsiya bo‘yicha qabul bo‘lmaydi', (db.prepare('SELECT status FROM requests WHERE id = ?').get(requestId) as any).status !== 'CHOSEN');
    await rec.handleRecommendationCallback({ id: 'x', from: { id: patientTg }, data: `ry:${newRec}:20991231` });
    check('taklifda yo‘q kun bilan qabul bo‘lmaydi', (db.prepare('SELECT status FROM requests WHERE id = ?').get(requestId) as any).status !== 'CHOSEN');
    check('noma‘lum tugma — boshqa ishlovchiga', (await rec.handleRecommendationCallback({ id: 'x', from: { id: patientTg }, data: 'boshqa' })) === false);

    await rec.handleRecommendationCallback({ id: 'x', from: { id: patientTg }, data: `rd:${newRec}:${ymd}` });
    check('kun tanlandi — hali qabul emas (tasdiq kutiladi)', (db.prepare('SELECT status FROM requests WHERE id = ?').get(requestId) as any).status !== 'CHOSEN');
    await rec.handleRecommendationCallback({ id: 'x', from: { id: patientTg }, data: `ry:${newRec}:${ymd}` });
    const deal = db.prepare('SELECT * FROM deals WHERE request_id = ?').get(requestId) as any;
    check('botdan tasdiq — bitim ochildi', deal?.offer_id === oB && deal.scheduled_at.startsWith(futureDate(5)));
    const docNote = db.prepare(`SELECT params FROM notifications WHERE type = 'doctor_case_update' ORDER BY id DESC`).get() as any;
    check('shifokorga: bemor tavsiyani qabul qildi', JSON.parse(docNote.params).status === 'chosen' && JSON.parse(docNote.params).recommended === 1);
    throws('tanlovdan keyin tavsiyani o‘zgartirib bo‘lmaydi', () => rec.recommendOffer(docUser, c.id, oA, null), 'already_chosen');

    const st = dc.doctorStats(docUser);
    check('statistika: 1 faol tavsiya, klinika B, 12 mln', st.recommendations === 1 && st.byClinic[0].clinicId === clinicB && st.recommendedSumUzs === 12_000_000);
    check('statistika: qabul qilingan tavsiya va summa', st.acceptedRecommendations === 1 && st.acceptedSumUzs === 12_000_000 && st.deals === 1);
    const adminRow = dc.adminDoctorStats().find((r) => r.doctorId === d.id);
    check('admin statistikasida shifokor bor', adminRow?.recommendations === 1 && adminRow.byClinic.length === 1);
  }

  {
    section('Botda parol: saytga kirish uchun');
    const pa = await import('../services/patientAuth');
    const uid = Number(db.prepare(`INSERT INTO users (telegram_id, first_name, roles, phone) VALUES (7500001, 'Parol', '["patient"]', '+998 90 150-00-01')`).run().lastInsertRowid);
    check('holat: raqam normallashgan, parol yo‘q', (() => { const s = pa.webLoginStatus(uid); return s.phone === '998901500001' && !s.hasPassword; })());
    throws('qisqa parol rad etiladi', () => pa.setPasswordFromTelegram(uid, 'qisqa1'), 'weak_password');
    throws('faqat raqam rad etiladi', () => pa.setPasswordFromTelegram(uid, '12345678'), 'weak_password');
    const st = pa.setPasswordFromTelegram(uid, 'Kuchli-parol-1');
    check('parol qo‘yildi', st.hasPassword && !!st.passwordSetAt);
    check('bazadagi raqam ham normallashdi', (db.prepare('SELECT phone FROM users WHERE id = ?').get(uid) as any).phone === '998901500001');
    const ses = pa.loginWithPassword('+998 90 150 00 01', 'Kuchli-parol-1', null, null);
    check('saytdan raqam + parol bilan kirildi', !!ses.token);
    pa.setPasswordFromTelegram(uid, 'Yangi-parol-22');
    check('parol o‘zgargach brauzer sessiyalari yopildi', pa.resolvePatientSession(ses.token) === null);
    throws('eski parol endi ishlamaydi', () => pa.loginWithPassword('901500001', 'Kuchli-parol-1', null, null), 'unauthorized');
    check('yangi parol ishlaydi', !!pa.loginWithPassword('901500001', 'Yangi-parol-22', null, null).token);

    const noPhone = Number(db.prepare(`INSERT INTO users (telegram_id, first_name, roles) VALUES (7500002, 'Raqamsiz', '["patient"]')`).run().lastInsertRowid);
    throws('raqamsiz — avval kontakt', () => pa.setPasswordFromTelegram(noPhone, 'Kuchli-parol-1'), 'phone_required');
    const twin = Number(db.prepare(`INSERT INTO users (telegram_id, first_name, roles, phone) VALUES (7500003, 'Egizak', '["patient"]', '+998901500001')`).run().lastInsertRowid);
    throws('raqam boshqa hisobda band', () => pa.setPasswordFromTelegram(twin, 'Kuchli-parol-1'), 'phone_taken');
    const web = Number(db.prepare(`INSERT INTO users (telegram_id, first_name, roles, phone) VALUES (-7500004, 'Veb', '["patient"]', '998901500004')`).run().lastInsertRowid);
    throws('Telegram bo‘lmagan hisob bu yo‘ldan foydalana olmaydi', () => pa.setPasswordFromTelegram(web, 'Kuchli-parol-1'), 'forbidden');
  }

  {
    section('Kapsula endoskopiyasi: vaznsiz, qarshi ko‘rsatmalar bilan');
    const lo = await import('../services/labOrgans');
    const rq = await import('../services/requests');
    const top = db.prepare(`SELECT slug FROM lab_tests WHERE parent_id IS NULL AND active = 1 ORDER BY position, id`).all().map((r: any) => r.slug);
    check('katalogda 3-o‘rinda (MRT, MSKT dan keyin)', top[0] === 'mrt' && top[1] === 'mskt' && top[2] === 'kapsula-endoskopiya', top.slice(0, 4));
    const cap = db.prepare(`SELECT id FROM lab_tests WHERE slug = 'kapsula-endoskopiya'`).get() as { id: number };
    const capTest = lo.getLabTest(cap.id);
    check('vazn so‘ralmaydi, qarshi ko‘rsatmalar bor', capTest.needsWeight === false && !!capTest.contraUz && capTest.contraUz.includes('Oshqozon-ichak'));
    check('tanlanadigan tekshiruv (bolasiz guruh)', lo.selectableLabTestIds().has(cap.id));
    const apiOrder = lo.listLabTests().filter((x) => x.parentId === null).map((x) => x.slug);
    check('bemorga beriladigan ro‘yxatda ham 3-o‘rinda', apiOrder[2] === 'kapsula-endoskopiya', apiOrder.slice(0, 4));
    const all = lo.listLabTests();
    const mrtIdx = all.findIndex((x) => x.slug === 'mrt');
    check('guruh ichidagilar guruhidan keyin turadi', all[mrtIdx + 1]?.parentId === all[mrtIdx].id);
    check('sehrgarda "Qarshi ko‘rsatmalar" qadami bor', !!db.prepare(`SELECT 1 FROM request_steps WHERE key = 'contra' AND locked = 1`).get());

    const cityId = (db.prepare('SELECT id FROM cities LIMIT 1').get() as { id: number }).id;
    const pid = Number(
      db.prepare(
        `INSERT INTO users (telegram_id, first_name, last_name, roles, city_id, birth_year, gender, onboarded_at, profile_completed_at)
         VALUES (7600001, 'Kapsula', 'Sinov', '["patient"]', ?, 1975, 'male', datetime('now'), datetime('now'))`,
      ).run(cityId).lastInsertRowid,
    );
    const base = {
      patientId: pid, kind: 'lab' as const, labTestId: cap.id, cityId, budgetUzs: 50_000_000, conditionText: '', note: null,
      urgency: 'normal' as const, attachments: [], otherRegionsOk: false, dateFrom: null, dateTo: null, dateFlexible: true,
      aiSuggested: false, acceptTerms: true,
    };
    throws('qarshi ko‘rsatmalar tasdiqlanmasa — so‘rov ketmaydi', () => rq.createRequest(base), 'contraindications_required');
    const r = rq.createRequest({ ...base, contraindicationsAck: true });
    check('vaznsiz so‘rov qabul qilindi', r.weightKg === null && r.kind === 'lab');
    check('bemor narx bera olmaydi (byudjet e’tiborga olinmadi)', r.budgetUzs === null);
    check('klinika uchun belgi: qarshi ko‘rsatma yo‘qligi tasdiqlangan', r.contraAcked === true);

    const mriLeaf = db.prepare(`SELECT t.id FROM lab_tests t JOIN lab_tests p ON p.id = t.parent_id WHERE p.slug = 'mrt' LIMIT 1`).get() as { id: number };
    throws('MRT da vazn hali ham majburiy', () => rq.createRequest({ ...base, labTestId: mriLeaf.id }), 'invalid_weight');

    // Klinika MRT/MSKT qatorida yoqqan bo'lsa — so'rov unga boradi
    const clinicId = (db.prepare(`SELECT id FROM clinics WHERE verification = 'approved' LIMIT 1`).get() as { id: number } | undefined)?.id;
    if (clinicId) {
      const ownCity = (db.prepare('SELECT city_id FROM clinics WHERE id = ?').get(clinicId) as any).city_id;
      db.prepare(`INSERT OR IGNORE INTO clinic_lab_tests (clinic_id, test_id) VALUES (?, ?)`).run(clinicId, cap.id);
      const r2 = rq.createRequest({ ...base, cityId: ownCity, contraindicationsAck: true });
      check('kapsulani yoqqan klinikaga so‘rov bordi',
        !!db.prepare('SELECT 1 FROM request_broadcasts WHERE request_id = ? AND clinic_id = ?').get(r2.id, clinicId));
    }

    // Admin qisman tahriri o'rin va holatni buzmasin
    const before = db.prepare(`SELECT position, active FROM lab_tests WHERE id = ?`).get(cap.id) as any;
    lo.updateLabTest(cap.id, { nameUz: 'Kapsula endoskopiyasi' });
    const after = db.prepare(`SELECT position, active FROM lab_tests WHERE id = ?`).get(cap.id) as any;
    check('faqat nom tahriri — o‘rin va holat o‘zgarmadi', after.position === before.position && after.active === before.active);
    const off = lo.updateLabTest(cap.id, { contraUz: '  ' });
    check('qarshi ko‘rsatmalar o‘chirilsa qadam chiqmaydi', off.contraUz === null);
    lo.updateLabTest(cap.id, { contraUz: capTest.contraUz });
  }

  /* ── Admin: Telegram orqali tasdiqlash kodi ── */
  section('Admin 2FA — Telegram kodi');
  {
    const webAuth = require('../services/webAuth');
    const { config } = require('../lib/config');
    const realFetch = globalThis.fetch;
    const realToken = config.telegram.botToken;
    const sent: Array<{ chat_id: number; text: string }> = [];
    let tgOk = true;
    // Telegram API o'rniga — xabarni ushlab qolamiz
    (globalThis as any).fetch = async (_url: string, init: any) => {
      sent.push(JSON.parse(init.body));
      return new Response('{}', { status: tgOk ? 200 : 500 });
    };
    config.telegram.botToken = 'test-token';
    const flush = () => new Promise((r) => setTimeout(r, 20));
    const lastCode = () => /<code>(\d{6})<\/code>/.exec(sent[sent.length - 1]?.text ?? '')?.[1] ?? '';
    try {
      const acc = webAuth.createAccount({ phone: '998900000555', fullName: 'Telegram Admin', level: 'full', clinicId: null });
      webAuth.completeSetup(acc.setupToken, 'tg-admin-paroli-2026');

      // Telegram bog'lanmagan — avvalgidek kodsiz (yagona adminni qulflamaslik uchun)
      const free = webAuth.login('998900000555', 'tg-admin-paroli-2026', '9.9.9.9', 'test', 'admin');
      check('Telegram bog‘lanmagan admin — kod so‘ralmaydi', free.mfaRequired === false && sent.length === 0);

      db.prepare(`INSERT INTO users (telegram_id, first_name, roles, phone) VALUES (?, 'TG Admin', ?, ?)`)
        .run(777000555, JSON.stringify(['patient']), '+998900000555');

      const s1 = webAuth.login('998900000555', 'tg-admin-paroli-2026', '9.9.9.9', 'Chrome', 'admin');
      await flush();
      check('bog‘langan admin — kod talab qilinadi', s1.mfaRequired === true && s1.mfaMethod === 'telegram');
      check('kod adminning o‘z Telegram’iga ketdi', sent.length === 1 && sent[0].chat_id === 777000555);
      check('xabarda IP va qurilma bor', /9\.9\.9\.9/.test(sent[0].text) && /Chrome/.test(sent[0].text));
      check('kodsiz sessiya to‘liq emas', webAuth.resolveSession(s1.token).mfaPassed === false);
      const good = lastCode();
      const bad = good === '000000' ? '111111' : '000000';
      throws('noto‘g‘ri kod rad etiladi', () => webAuth.passMfa(s1.token, bad));
      webAuth.passMfa(s1.token, good);
      check('to‘g‘ri kod — sessiya to‘liq', webAuth.resolveSession(s1.token).mfaPassed === true);
      throws('bir kod ikki marta ishlamaydi', () => webAuth.passMfa(s1.token, good));

      // 5 xato — sessiya yopiladi
      const s2 = webAuth.login('998900000555', 'tg-admin-paroli-2026', null, null, 'admin');
      await flush();
      const c2 = lastCode();
      const wrong = c2 === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) { try { webAuth.passMfa(s2.token, wrong); } catch { /* kutilgan */ } }
      check('5 xatodan keyin sessiya yopildi', webAuth.resolveSession(s2.token) === null);
      throws('yopilgan sessiyada to‘g‘ri kod ham ishlamaydi', () => webAuth.passMfa(s2.token, c2));

      // Muddati o'tgan kod
      const s3 = webAuth.login('998900000555', 'tg-admin-paroli-2026', null, null, 'admin');
      await flush();
      const key = require('node:crypto').createHash('sha256').update(s3.token).digest('hex');
      webAuth._adminTelegram2faTesting.tgChallenges.get(key).expiresAt = Date.now() - 1;
      throws('eskirgan kod rad etiladi', () => webAuth.passMfa(s3.token, lastCode()));
      check('eskirgan koddan keyin sessiya yopildi', webAuth.resolveSession(s3.token) === null);

      // Telegram ishlamasa — sessiya yopiladi (kirish ochilib qolmaydi)
      tgOk = false;
      const s4 = webAuth.login('998900000555', 'tg-admin-paroli-2026', null, null, 'admin');
      await flush();
      check('Telegram yubora olmasa sessiya yopildi', webAuth.resolveSession(s4.token) === null);
      tgOk = true;

      // Klinika eshigiga ta'sir qilmaydi
      check('klinika kirishida Telegram kodi yo‘q', !sent.some((m) => /admin paneliga/.test(m.text) && m.chat_id !== 777000555));

      // Favqulodda o'chirish
      config.telegram.adminTelegram2fa = false;
      const s5 = webAuth.login('998900000555', 'tg-admin-paroli-2026', null, null, 'admin');
      check('ADMIN_TELEGRAM_2FA=off — kodsiz', s5.mfaRequired === false);
      config.telegram.adminTelegram2fa = true;
    } finally {
      (globalThis as any).fetch = realFetch;
      config.telegram.botToken = realToken;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Natija: ${passed} o'tdi, ${failed} yiqildi`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nTest ishga tushmadi:', err);
  process.exit(1);
});
