/**
 * Seed — katalog, cold-start narxlar va demo klinikalar.
 * Idempotent: qayta ishga tushirilsa dublikat yaratmaydi.
 *
 *   npm run seed            — katalog + demo klinikalar
 *   npm run seed -- --reset — bazani tozalab qaytadan quradi
 */
import { db, migrate, toJson, tx } from './index';
import { CITIES, CATEGORIES, OPERATIONS, CITY_PRICE_FACTOR, DEMO_CLINICS } from './seedData';
import { ensureUnknownOperation } from './migrations';
import { config } from '../lib/config';

const reset = process.argv.includes('--reset');

function resetDb() {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];
  db.pragma('foreign_keys = OFF');
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  db.pragma('foreign_keys = ON');
  console.log(`  bazadagi ${tables.length} ta jadval tozalandi`);
}

function round(n: number) {
  // 100 ming so'mgacha yaxlitlash — "taxminiy" ekani ko'rinib tursin
  return Math.round(n / 100_000) * 100_000;
}

function seed() {
  if (reset) resetDb();
  migrate();

  tx(() => {
    // ── Shaharlar
    const insCity = db.prepare(
      `INSERT INTO cities (slug, name_uz, name_ru) VALUES (?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET name_uz = excluded.name_uz, name_ru = excluded.name_ru`,
    );
    for (const c of CITIES) insCity.run(c.slug, c.nameUz, c.nameRu);

    // ── Kategoriyalar
    const insCat = db.prepare(
      `INSERT INTO operation_categories (slug, name_uz, name_ru, icon) VALUES (?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET name_uz = excluded.name_uz, name_ru = excluded.name_ru, icon = excluded.icon`,
    );
    for (const c of CATEGORIES) insCat.run(c.slug, c.nameUz, c.nameRu, c.icon);

    const catId = new Map<string, number>();
    for (const row of db.prepare(`SELECT id, slug FROM operation_categories`).all() as { id: number; slug: string }[]) {
      catId.set(row.slug, row.id);
    }

    // ── Operatsiyalar
    const insOp = db.prepare(
      `INSERT INTO operations (category_id, slug, name_uz, name_ru, alias_uz, alias_ru, desc_uz, desc_ru, keywords)
       VALUES (@categoryId, @slug, @nameUz, @nameRu, @aliasUz, @aliasRu, @descUz, @descRu, @keywords)
       ON CONFLICT(slug) DO UPDATE SET
         category_id = excluded.category_id, name_uz = excluded.name_uz, name_ru = excluded.name_ru,
         alias_uz = excluded.alias_uz, alias_ru = excluded.alias_ru,
         desc_uz = excluded.desc_uz, desc_ru = excluded.desc_ru, keywords = excluded.keywords`,
    );
    for (const op of OPERATIONS) {
      insOp.run({
        categoryId: catId.get(op.category)!,
        slug: op.slug,
        nameUz: op.nameUz,
        nameRu: op.nameRu,
        aliasUz: op.aliasUz,
        aliasRu: op.aliasRu,
        descUz: op.descUz,
        descRu: op.descRu,
        keywords: toJson(op.keywords),
      });
    }

    // "Bilmayman" yozuvi: kategoriyalar endi bor, shuning uchun bu yerda kafolatlanadi
    ensureUnknownOperation(db);

    const opId = new Map<string, number>();
    for (const row of db.prepare(`SELECT id, slug FROM operations`).all() as { id: number; slug: string }[]) {
      opId.set(row.slug, row.id);
    }
    const cityId = new Map<string, number>();
    for (const row of db.prepare(`SELECT id, slug FROM cities`).all() as { id: number; slug: string }[]) {
      cityId.set(row.slug, row.id);
    }

    // ── Cold-start narxlar (har operatsiya × har shahar)
    const insPrice = db.prepare(
      `INSERT INTO manual_prices (operation_id, city_id, min_uzs, p25_uzs, median_uzs, p75_uzs, max_uzs, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(operation_id, city_id) DO UPDATE SET
         min_uzs = excluded.min_uzs, p25_uzs = excluded.p25_uzs, median_uzs = excluded.median_uzs,
         p75_uzs = excluded.p75_uzs, max_uzs = excluded.max_uzs, updated_at = datetime('now')`,
    );
    let priceRows = 0;
    for (const op of OPERATIONS) {
      for (const city of CITIES) {
        const f = CITY_PRICE_FACTOR[city.slug] ?? 0.8;
        const [min, p25, med, p75, max] = op.price;
        insPrice.run(
          opId.get(op.slug)!,
          cityId.get(city.slug)!,
          round(min * f),
          round(p25 * f),
          round(med * f),
          round(p75 * f),
          round(max * f),
          'Bozor tadqiqoti (taxminiy)',
        );
        priceRows++;
      }
    }

    // ── Demo klinikalar
    const insClinic = db.prepare(
      `INSERT INTO clinics (name, city_id, address, about, verification, plan, subscription_status,
                            subscription_until, rating_avg, rating_count, deals_count,
                            response_minutes_sum, response_samples)
       VALUES (@name, @cityId, @address, @about, 'approved', @plan, 'active',
               datetime('now', '+30 days'), @rating, @ratingCount, @deals, @respSum, @respSamples)`,
    );
    const insClinicOp = db.prepare(
      `INSERT OR IGNORE INTO clinic_operations (clinic_id, operation_id) VALUES (?, ?)`,
    );
    const existing = db.prepare(`SELECT COUNT(*) AS n FROM clinics`).get() as { n: number };

    /*
     * Demo klinikalar ishlab chiqarishda YARATILMAYDI.
     *
     * Ular `approved/active` holatida bo'ladi, ya'ni matching ularni tanlaydi
     * va haqiqiy bemorning so'rovi mavjud bo'lmagan klinikaga ketadi —
     * hech kim javob bermaydi, bemor platformaga ishonchini yo'qotadi.
     *
     * Katalog (shaharlar, operatsiyalar, cold-start narxlar) esa aksincha,
     * ishlab chiqarishda ham kerak — ularsiz bemor so'rov yubora olmaydi.
     */
    const seedClinics = config.env !== 'production';

    if (existing.n === 0 && seedClinics) {
      const allOpIds = [...opId.values()];
      DEMO_CLINICS.forEach((c, i) => {
        const respAvg = 25 + ((i * 17) % 90); // 25–115 daqiqa
        const samples = 20;
        const info = insClinic.run({
          name: c.name,
          cityId: cityId.get(c.city)!,
          address: `${c.city} sh., namunaviy manzil ${i + 1}`,
          about: c.about,
          plan: c.plan,
          rating: c.rating,
          ratingCount: Math.round(c.deals * 0.6),
          deals: c.deals,
          respSum: respAvg * samples,
          respSamples: samples,
        });
        // Har klinika operatsiyalarning aralash to'plamini bajaradi
        const step = (i % 3) + 2;
        allOpIds.forEach((id, idx) => {
          if (idx % step !== i % step) return;
          insClinicOp.run(Number(info.lastInsertRowid), id);
        });
        // Har klinikada kamida 6 ta yo'nalish bo'lsin
        allOpIds.slice(0, 6).forEach((id) => insClinicOp.run(Number(info.lastInsertRowid), id));
      });
    }

    db.prepare(`INSERT INTO meta (key, value) VALUES ('seeded_at', datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();

    console.log('Seed tugadi:');
    console.log(`  shaharlar        ${CITIES.length}`);
    console.log(`  kategoriyalar    ${CATEGORIES.length}`);
    console.log(`  operatsiyalar    ${OPERATIONS.length}`);
    console.log(`  narx yozuvlari   ${priceRows} (cold start, manual)`);
    console.log(
      `  klinikalar       ${
        !seedClinics
          ? '0 (production — demo klinikalar yaratilmadi)'
          : existing.n === 0
            ? DEMO_CLINICS.length
            : `${existing.n} (mavjud, o'tkazib yuborildi)`
      }`,
    );
  });
}

seed();
