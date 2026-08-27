/**
 * Katalogni banisa.uz dan olib kelish.
 *
 * ═══ Nima uchun ko'chirib olinadi, jonli o'qilmaydi ═══
 *
 * Eng oson yo'l — har katalog so'rovida banisa bazasidan o'qish. Uni
 * ataylab tanlamadik:
 *
 *   • Ikki mahsulot bir-birining ishlashiga bog'lanib qolardi: banisa
 *     to'xtasa KlinikaTop'da so'rov qoldirib bo'lmasdi.
 *   • banisa sxemasidagi har o'zgarish KlinikaTop'ni sindirardi.
 *   • Bemor qidiruvi har harfda begona bazaga borardi.
 *
 * Shuning uchun katalog KlinikaTop'ning O'Z jadvaliga ko'chiriladi.
 * banisa manba bo'lib qoladi, ishlash nuqtasi emas.
 *
 * ═══ Xavfsizlik ═══
 *
 * Ulanish shu qoidalar bilan chegaralangan:
 *
 *   • Alohida Postgres roli, FAQAT SELECT — va faqat ikkita jadvalga.
 *     Yozish huquqi kod intizomi bilan emas, bazaning o'zi bilan
 *     taqiqlanadi. Bu yerda xato qilsak ham banisa'ga zarar yetmaydi.
 *   • Ulanish faqat localhost orqali — ikkala xizmat bitta mashinada.
 *   • So'rovga vaqt chegarasi: og'ir so'rov banisa'ni sekinlashtirmaydi.
 *   • Import HECH QACHON o'chirmaydi. Manbadan yo'qolgan operatsiya
 *     deaktivatsiya qilinadi: klinikalar uni allaqachon tanlagan
 *     bo'lishi mumkin va o'chirish ularning sozlamasini yo'q qilardi.
 *   • Har yugurish jurnalga yoziladi.
 */
import { Client } from 'pg';
import { db } from '../db';
import { config } from '../lib/config';
import { badRequest } from '../lib/errors';
import { normalize, slugify } from '../lib/format';

const SOURCE = 'banisa';

/**
 * "Bilmayman" — bemor operatsiyani tanlay olmaganda ishlatiladigan
 * maxsus yozuv. U katalog elementi emas, oqimning bir qismi: shunday
 * so'rov shahardagi HAMMA klinikaga boradi. Manbada bunday narsa yo'q
 * va bo'lishi ham kerak emas, shuning uchun u qoidadan chetda qoladi.
 */
const SENTINEL_SLUG = 'unknown';

/** So'rov shu vaqtdan uzoq ketsa uziladi — qo'shni bazani band qilmaymiz. */
const STATEMENT_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 8_000;

interface SourceCategory {
  id: string;
  nameUz: string;
  nameRu: string;
  slug: string | null;
  icon: string | null;
  sortOrder: number | null;
  parentId: string | null;
  /** Daraxtdagi chuqurlik: 0 — xizmat turi, 1 — tibbiy soha, 2 — bo'lim */
  level: number;
}

interface SourceOperation {
  id: string;
  nameUz: string;
  nameRu: string;
  categoryId: string | null;
  shortDescription: string | null;
  isActive: boolean;
}

/* ─────────────────────────  Manbadan o'qish  ───────────────────────── */

/**
 * banisa katalogini o'qish.
 *
 * So'rovlar qat'iy: aniq jadval, aniq ustunlar. `SELECT *` ishlatilmaydi —
 * manbada yangi ustun paydo bo'lsa u bizga sezdirmay oqib kirmasin.
 */
async function fetchSource(): Promise<{ categories: SourceCategory[]; operations: SourceOperation[] }> {
  const url = config.catalogSource.url;
  if (!url) {
    throw badRequest('no_source', 'Manba ulanishi sozlanmagan (CATALOG_SOURCE_URL)');
  }

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    // Ulanish localhost orqali; TLS kerak emas va sertifikat ham yo'q
    ssl: false,
    application_name: 'klinikatop-catalog-sync',
  });

  await client.connect();
  try {
    /*
     * Butun o'qish BITTA tranzaksiyada va READ ONLY rejimida.
     *
     * READ ONLY — ikkinchi qatlam himoya: rolda yozish huquqi yo'q, lekin
     * tranzaksiya ham buni taqiqlaydi. Bir tranzaksiya bo'lgani uchun
     * kategoriyalar va operatsiyalar bir xil paytdagi holatni ko'radi:
     * o'rtada yangi kategoriya qo'shilsa, ota-onasiz operatsiya kelmaydi.
     */
    await client.query('BEGIN TRANSACTION READ ONLY');

    const categories = await client.query<SourceCategory>(
      `SELECT id, "nameUz", "nameRu", slug, icon, "sortOrder", "parentId", level
         FROM "ServiceCategory"
        ORDER BY "sortOrder" NULLS LAST, "nameUz"`,
    );

    const operations = await client.query<SourceOperation>(
      `SELECT id, "nameUz", "nameRu", "categoryId", "shortDescription", "isActive"
         FROM "SurgicalService"
        ORDER BY "nameUz"`,
    );

    await client.query('COMMIT');
    return { categories: categories.rows, operations: operations.rows };
  } finally {
    await client.end();
  }
}

/* ─────────────────────────  Farqni hisoblash  ───────────────────────── */

export interface SyncChange {
  kind: 'add' | 'update' | 'deactivate' | 'reactivate';
  externalId: string;
  nameUz: string;
  /** `update` uchun: qaysi maydonlar o'zgaradi */
  fields?: string[];
}

export interface SyncPlan {
  categories: { add: number; update: number };
  operations: SyncChange[];
  /** Manbada nechta operatsiya bor */
  sourceTotal: number;
  /** Qo'lda kiritilgan — katalogdan chiqariladi (o'chirilmaydi) */
  manualHidden: number;
  /** Manbada nomi takrorlangani uchun olinmaydiganlar */
  skippedDuplicates: number;
}

const text = (v: string | null | undefined) => (v ?? '').trim();

/**
 * Reja tuzish — hech narsa yozmaydi.
 *
 * Admin avval nima o'zgarishini ko'radi, keyin qaror qiladi. Katalog
 * platformaning o'zagi: 105 ta yozuvni ko'rmasdan almashtirish xavfli.
 */
export async function planSync(): Promise<SyncPlan> {
  const { categories, operations } = await fetchSource();

  const existingCats = new Map(
    (
      db
        .prepare(`SELECT external_id, name_uz, name_ru FROM operation_categories WHERE source = ?`)
        .all(SOURCE) as any[]
    ).map((r) => [r.external_id as string, r]),
  );

  let catAdd = 0;
  let catUpdate = 0;
  for (const c of usedSpecialties(categories, operations)) {
    const cur = existingCats.get(c.id);
    if (!cur) catAdd++;
    else if (cur.name_uz !== text(c.nameUz) || cur.name_ru !== text(c.nameRu)) catUpdate++;
  }

  const existingOps = new Map(
    (
      db
        .prepare(`SELECT external_id, name_uz, name_ru, desc_uz, active FROM operations WHERE source = ?`)
        .all(SOURCE) as any[]
    ).map((r) => [r.external_id as string, r]),
  );

  const changes: SyncChange[] = [];
  const seen = new Set<string>();
  const planNames = new Set(
    (db.prepare(`SELECT name_uz FROM operations WHERE active = 1`).all() as { name_uz: string }[]).map(
      (r) => normalize(r.name_uz),
    ),
  );
  let skipped = 0;

  for (const op of operations) {
    const nameUz = text(op.nameUz);
    if (!nameUz) continue;
    seen.add(op.id);

    const cur = existingOps.get(op.id);
    if (!cur) {
      // Manbada o'chirilgan xizmatni umuman olib kelmaymiz
      if (!op.isActive) continue;
      // Nomi allaqachon band bo'lsa — takror, olinmaydi
      if (planNames.has(normalize(nameUz))) {
        skipped++;
        continue;
      }
      planNames.add(normalize(nameUz));
      changes.push({ kind: 'add', externalId: op.id, nameUz });
      continue;
    }

    const fields: string[] = [];
    if (cur.name_uz !== nameUz) fields.push('nomi');
    if (cur.name_ru !== text(op.nameRu)) fields.push('nomi (ru)');
    if (cur.desc_uz !== text(op.shortDescription)) fields.push('tavsif');

    const shouldBeActive = op.isActive ? 1 : 0;
    if (cur.active !== shouldBeActive) {
      changes.push({
        kind: op.isActive ? 'reactivate' : 'deactivate',
        externalId: op.id,
        nameUz,
      });
    } else if (fields.length > 0) {
      changes.push({ kind: 'update', externalId: op.id, nameUz, fields });
    }
  }

  // Manbadan butunlay yo'qolganlar — o'chirilmaydi, faqat yashiriladi
  for (const [externalId, cur] of existingOps) {
    if (!seen.has(externalId) && cur.active === 1) {
      changes.push({ kind: 'deactivate', externalId, nameUz: cur.name_uz });
    }
  }

  /*
   * Qo'lda kiritilganlar endi "saqlanadi" emas, "yashiriladi": katalog
   * to'liq manbadan bo'lishi kerak. Rejada shuni ochiq ko'rsatamiz —
   * admin qo'llashdan oldin nechta yozuv ro'yxatdan chiqishini bilsin.
   */
  const manualHidden = (
    db
      .prepare(
        `SELECT COUNT(*) c FROM operations
          WHERE active = 1 AND external_id IS NULL AND slug <> ?`,
      )
      .get(SENTINEL_SLUG) as { c: number }
  ).c;

  return {
    categories: { add: catAdd, update: catUpdate },
    operations: changes,
    sourceTotal: operations.length,
    manualHidden,
    skippedDuplicates: skipped,
  };
}

/**
 * Qaysi daraja olinadi va nima uchun.
 *
 * banisa'da kategoriyalar uch qavatli:
 *
 *   0-daraja  "Operatsiyalar", "Diagnostika Xizmatlari"     — 2 ta
 *   1-daraja  "Ko'z Xirurgiyasi", "Ginekologiya", ...       — 14 ta
 *   2-daraja  "Katarakta", "Refraktiv xirurgiya", ...       — 70 ta
 *
 * Operatsiyalarning hammasi 2-darajada turadi.
 *
 * Bizga 1-DARAJA kerak — tibbiy soha. 0-daraja juda keng: 105 ta
 * operatsiya ikki guruhga tushib, klinika o'z sohasini topa olmasdi.
 * 2-daraja esa juda mayda: 70 ta bo'lim, ba'zisida bittadan yozuv, va
 * ekran ro'yxatdan iborat bo'lib qolardi.
 */
const SPECIALTY_LEVEL = 1;

/** Operatsiyaning kategoriyasidan uning sohasiga ko'tariladi. */
function specialtyOf(all: SourceCategory[]): Map<string, string> {
  const byId = new Map(all.map((c) => [c.id, c]));
  const map = new Map<string, string>();

  for (const c of all) {
    let node: SourceCategory | undefined = c;
    let guard = 0;

    // Halqadan himoya: buzuq ma'lumot cheksiz aylanishga olib kelmasin
    while (node && node.level > SPECIALTY_LEVEL && node.parentId && guard++ < 10) {
      node = byId.get(node.parentId);
    }

    if (node && node.level === SPECIALTY_LEVEL) map.set(c.id, node.id);
  }
  return map;
}

/**
 * Ichida bironta operatsiya bo'lgan sohalar.
 *
 * banisa'da diagnostika uchun ham sohalar bor ("Laboratoriya
 * Diagnostikasi" va h.k.) — ularda jarrohlik yo'q. Bo'sh soha klinika
 * ekranida ochib ko'rilib, ichidan hech narsa chiqmaydigan bo'lim bo'lib
 * qolardi, shuning uchun ular olib kelinmaydi.
 */
function usedSpecialties(
  all: SourceCategory[],
  operations: SourceOperation[],
): SourceCategory[] {
  const toSpecialty = specialtyOf(all);
  const used = new Set<string>();

  for (const op of operations) {
    if (!op.isActive || !op.categoryId) continue;
    const id = toSpecialty.get(op.categoryId);
    if (id) used.add(id);
  }

  return all.filter((c) => used.has(c.id) && text(c.nameUz));
}

/* ─────────────────────────  Qo'llash  ───────────────────────── */

export interface SyncResult {
  added: number;
  updated: number;
  deactivated: number;
  categories: number;
  /** Manbada bir xil nomda takrorlangani uchun olinmaganlar */
  skippedDuplicates: number;
  durationMs: number;
}

/**
 * Rejani qo'llash.
 *
 * Hammasi bitta tranzaksiyada: yarim ko'chirilgan katalog — kategoriyasiz
 * operatsiyalar yoki operatsiyasiz kategoriyalar — bemor qidiruvini
 * buzardi. Xato bo'lsa hech narsa o'zgarmaydi.
 */
export async function runSync(startedBy: number | null): Promise<SyncResult> {
  const began = Date.now();

  try {
    const { categories, operations } = await fetchSource();
    const specialties = usedSpecialties(categories, operations);
    const toSpecialty = specialtyOf(categories);

    const result = db.transaction(() => {
      /* ── Kategoriyalar ── */
      let catCount = 0;
      const catIdByExternal = new Map<string, number>();

      const findCat = db.prepare(
        `SELECT id FROM operation_categories WHERE source = ? AND external_id = ?`,
      );
      const insCat = db.prepare(
        `INSERT INTO operation_categories (slug, name_uz, name_ru, icon, source, external_id, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      );
      const updCat = db.prepare(
        `UPDATE operation_categories
            SET name_uz = ?, name_ru = ?, icon = ?, synced_at = datetime('now')
          WHERE id = ?`,
      );

      /*
       * Qo'lda kiritilgan kategoriyalar nomi bo'yicha topiladi.
       *
       * KlinikaTop'da "Ginekologiya" allaqachon bor edi va banisa'da ham
       * bor. Ikkovini ham saqlasak klinika ekranida bir xil nomli ikki
       * bo'lim paydo bo'lardi. Shuning uchun mavjudi EGALLANADI: unga
       * tashqi identifikator biriktiriladi va bundan keyin u
       * sinxronizatsiya boshqaradigan qatorga aylanadi.
       */
      const adoptableCats = new Map(
        (
          db
            .prepare(`SELECT id, name_uz FROM operation_categories WHERE external_id IS NULL`)
            .all() as { id: number; name_uz: string }[]
        ).map((r) => [normalize(r.name_uz), r.id]),
      );
      const adoptCat = db.prepare(
        `UPDATE operation_categories
            SET source = ?, external_id = ?, synced_at = datetime('now')
          WHERE id = ?`,
      );

      for (const c of specialties) {
        const nameUz = text(c.nameUz);
        const nameRu = text(c.nameRu) || nameUz;
        const icon = text(c.icon);

        let existing = findCat.get(SOURCE, c.id) as { id: number } | undefined;

        if (!existing) {
          const adopted = adoptableCats.get(normalize(nameUz));
          if (adopted !== undefined) {
            adoptCat.run(SOURCE, c.id, adopted);
            adoptableCats.delete(normalize(nameUz));
            existing = { id: adopted };
          }
        }

        if (existing) {
          updCat.run(nameUz, nameRu, icon, existing.id);
          catIdByExternal.set(c.id, existing.id);
        } else {
          /*
           * Slug noyob bo'lishi shart. banisa'dagi slug bo'sh yoki
           * bizdagi qo'lda kiritilgani bilan to'qnashishi mumkin,
           * shuning uchun bo'shini yasaymiz va band bo'lsa raqam
           * qo'shamiz.
           */
          const slug = uniqueSlug('operation_categories', text(c.slug) || slugify(nameUz));
          const info = insCat.run(slug, nameUz, nameRu, icon, SOURCE, c.id);
          catIdByExternal.set(c.id, Number(info.lastInsertRowid));
        }
        catCount++;
      }

      /*
       * Zaxira kategoriya faqat KERAK BO'LGANDA yaratiladi.
       *
       * Har safar ochib qo'ysak, hech narsa tushmaganda ham klinika
       * ekranida bo'sh "Boshqa jarrohlik" bo'limi turardi.
       */
      let fallbackCached: number | null = null;
      const fallbackCategory = () => (fallbackCached ??= ensureFallbackCategory());

      /* ── Operatsiyalar ── */
      let added = 0;
      let updated = 0;
      let deactivated = 0;

      const findOp = db.prepare(`SELECT id, active FROM operations WHERE source = ? AND external_id = ?`);
      const insOp = db.prepare(
        `INSERT INTO operations
           (category_id, slug, name_uz, name_ru, desc_uz, desc_ru, active, source, external_id, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      );
      const updOp = db.prepare(
        `UPDATE operations
            SET category_id = ?, name_uz = ?, name_ru = ?, desc_uz = ?, desc_ru = ?,
                active = ?, synced_at = datetime('now')
          WHERE id = ?`,
      );

      const seen = new Set<string>();

      /*
       * Bir xil nomli operatsiya IKKI MARTA bo'lmasligi kerak.
       *
       * Bu shunchaki tartib masalasi emas — mos kelish shunga bog'liq.
       * Bemor "Appendektomiya" ni qo'lda kiritilgan yozuvdan tanlab,
       * klinika esa banisa'dan kelgan bir xil nomli boshqa yozuvni
       * faollashtirsa, so'rov o'sha klinikaga HECH QACHON yetib
       * bormaydi. Ikkovi turli id, matching esa id bo'yicha ishlaydi.
       *
       * Shuning uchun mavjud yozuv egallanadi: unga tashqi id
       * biriktiriladi, lekin xalq tilidagi nomi va kalit so'zlari
       * SAQLANIB QOLADI — ular qo'lda yig'ilgan va manbada yo'q.
       */
      const adoptableOps = new Map(
        (
          db
            .prepare(`SELECT id, name_uz FROM operations WHERE external_id IS NULL`)
            .all() as { id: number; name_uz: string }[]
        ).map((r) => [normalize(r.name_uz), r.id]),
      );
      const adoptOp = db.prepare(
        `UPDATE operations SET source = ?, external_id = ?, synced_at = datetime('now') WHERE id = ?`,
      );

      /*
       * Manbaning O'ZIDA ham takror bor.
       *
       * "Elka protezlash" banisa'da ikki bo'limda ikki alohida yozuv
       * sifatida turadi. Ular u yerda ma'noli bo'lishi mumkin, bizda
       * esa emas: bemor ikki bir xil nomdan qaysinisini tanlashini
       * bilmaydi va noto'g'ri tanlasa klinikaga yetib bormaydi.
       * Shuning uchun bir yugurishda bir nom bir marta olinadi.
       */
      const takenNames = new Set(
        (
          db.prepare(`SELECT name_uz FROM operations WHERE active = 1`).all() as { name_uz: string }[]
        ).map((r) => normalize(r.name_uz)),
      );
      let skippedDuplicates = 0;

      for (const op of operations) {
        const nameUz = text(op.nameUz);
        if (!nameUz) continue;
        seen.add(op.id);

        const nameRu = text(op.nameRu) || nameUz;
        const desc = text(op.shortDescription);
        const active = op.isActive ? 1 : 0;

        const specialtyId = op.categoryId ? toSpecialty.get(op.categoryId) : null;
        const categoryId = (specialtyId && catIdByExternal.get(specialtyId)) || fallbackCategory();

        let existing = findOp.get(SOURCE, op.id) as { id: number; active: number } | undefined;

        if (!existing) {
          const adopted = adoptableOps.get(normalize(nameUz));
          if (adopted !== undefined) {
            adoptOp.run(SOURCE, op.id, adopted);
            adoptableOps.delete(normalize(nameUz));
            existing = { id: adopted, active: 1 };
          }
        }

        if (existing) {
          updOp.run(categoryId, nameUz, nameRu, desc, desc, active, existing.id);
          if (existing.active === 1 && active === 0) deactivated++;
          else updated++;
        } else if (active === 1) {
          if (takenNames.has(normalize(nameUz))) {
            skippedDuplicates++;
            continue;
          }
          const slug = uniqueSlug('operations', slugify(nameUz));
          insOp.run(categoryId, slug, nameUz, nameRu, desc, desc, 1, SOURCE, op.id);
          takenNames.add(normalize(nameUz));
          added++;
        }
      }

      /*
       * Manbadan yo'qolganlar — O'CHIRILMAYDI.
       *
       * Klinika allaqachon shu operatsiyani tanlagan bo'lishi mumkin va
       * unga tegishli so'rovlar, takliflar, bitimlar bor. O'chirish
       * ularning barchasini uzib qo'yardi.
       */
      const hide = db.prepare(`UPDATE operations SET active = 0, synced_at = datetime('now') WHERE id = ?`);

      const stillActive = db
        .prepare(`SELECT id, external_id FROM operations WHERE source = ? AND active = 1`)
        .all(SOURCE) as { id: number; external_id: string }[];

      for (const row of stillActive) {
        if (!seen.has(row.external_id)) {
          hide.run(row.id);
          deactivated++;
        }
      }

      /*
       * Katalog 100% MANBADAN bo'lishi kerak.
       *
       * Qo'lda kiritilgan operatsiyalar aralashib qolsa, ro'yxatda
       * banisa'da yo'q yo'nalishlar paydo bo'ladi: bemor shuni tanlaydi,
       * klinika esa uni o'z ro'yxatida ko'rmaydi va so'rov javobsiz
       * qoladi. Bitta manba — bitta haqiqat.
       *
       * Ular O'CHIRILMAYDI, yashiriladi: `requests.operation_id` ularga
       * ishora qilishi mumkin va o'chirish o'tgan so'rovlarni buzardi.
       * Shu bilan birga nomi manbadagi bilan bir xil bo'lganlar
       * yuqorida allaqachon EGALLANGAN — ularning xalq tilidagi
       * nomlari saqlanib qoladi.
       */
      const leftovers = db
        .prepare(
          `UPDATE operations
              SET active = 0, synced_at = datetime('now')
            WHERE active = 1 AND external_id IS NULL AND slug <> ?`,
        )
        .run(SENTINEL_SLUG).changes;
      deactivated += leftovers;

      /*
       * Bo'shab qolgan qo'lda kiritilgan kategoriyalar olib tashlanadi.
       * Ular ekranda ochiladigan, lekin ichi bo'sh bo'limlar bo'lib
       * qolardi. Ichida biror narsa qolgani teginilmaydi.
       */
      db.prepare(
        `DELETE FROM operation_categories
          WHERE external_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM operations o WHERE o.category_id = operation_categories.id)`,
      ).run();

      return {
        added,
        updated,
        deactivated,
        categories: catCount,
        skippedDuplicates,
        durationMs: Date.now() - began,
      };
    })();

    logSync(startedBy, 'ok', result, null);
    return result;
  } catch (err: any) {
    logSync(
      startedBy,
      'failed',
      { added: 0, updated: 0, deactivated: 0, categories: 0, skippedDuplicates: 0, durationMs: Date.now() - began },
      err?.message ?? String(err),
    );
    throw err;
  }
}

/** Manbada joyi topilmagan operatsiyalar uchun zaxira kategoriya. */
function ensureFallbackCategory(): number {
  const row = db
    .prepare(`SELECT id FROM operation_categories WHERE slug = 'boshqa-jarrohlik'`)
    .get() as { id: number } | undefined;
  if (row) return row.id;

  const info = db
    .prepare(
      `INSERT INTO operation_categories (slug, name_uz, name_ru, icon, source, external_id)
       VALUES ('boshqa-jarrohlik', 'Boshqa jarrohlik', 'Другая хирургия', '', ?, NULL)`,
    )
    .run(SOURCE);
  return Number(info.lastInsertRowid);
}

/** Band bo'lmagan slug — to'qnashuvda raqam qo'shiladi. */
function uniqueSlug(table: 'operations' | 'operation_categories', base: string): string {
  const clean = (base || 'xizmat').slice(0, 80);
  const stmt = db.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`);

  if (!stmt.get(clean)) return clean;
  for (let i = 2; i < 500; i++) {
    const candidate = `${clean}-${i}`;
    if (!stmt.get(candidate)) return candidate;
  }
  // Amalda yetib bo'lmaydigan holat, lekin cheksiz halqa qolmasin
  return `${clean}-${Date.now()}`;
}

function logSync(
  startedBy: number | null,
  status: 'ok' | 'failed',
  r: SyncResult,
  error: string | null,
): void {
  db.prepare(
    `INSERT INTO catalog_sync_log
       (source, started_by, status, added, updated, deactivated, categories, error, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(SOURCE, startedBy, status, r.added, r.updated, r.deactivated, r.categories, error?.slice(0, 500) ?? null, r.durationMs);
}

export interface SyncLogRow {
  id: number;
  status: 'ok' | 'failed';
  added: number;
  updated: number;
  deactivated: number;
  categories: number;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

export function listSyncLog(limit = 20): SyncLogRow[] {
  return (
    db
      .prepare(`SELECT * FROM catalog_sync_log ORDER BY id DESC LIMIT ?`)
      .all(Math.min(100, Math.max(1, limit))) as any[]
  ).map((r) => ({
    id: r.id,
    status: r.status,
    added: r.added,
    updated: r.updated,
    deactivated: r.deactivated,
    categories: r.categories,
    error: r.error,
    durationMs: r.duration_ms,
    createdAt: new Date(r.created_at.replace(' ', 'T') + 'Z').toISOString(),
  }));
}

/** Manba sozlanganmi — admin panelida ko'rsatish uchun. */
export function sourceConfigured(): boolean {
  return Boolean(config.catalogSource.url);
}
