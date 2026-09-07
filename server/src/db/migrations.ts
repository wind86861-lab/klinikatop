/**
 * Migratsiyalar — `schema.sql` yangi bazani quradi, bu esa mavjud bazani rivojlantiradi.
 *
 * Har migratsiya bir marta ishlaydi; bajarilganlari `meta` jadvalida belgilanadi.
 * Tartib muhim — massivga faqat OXIRIGA qo'shiladi, oradagilar o'zgartirilmaydi.
 */
import type { Database } from 'better-sqlite3';

interface Migration {
  id: string;
  up: (db: Database) => void;
}

/** Ustun allaqachon bo'lsa qayta qo'shmaydi — qayta ishga tushirishga chidamli. */
function addColumn(db: Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export const MIGRATIONS: Migration[] = [
  {
    // Bemor profili: ism, familiya va viloyat — so'rov yuborishdan oldin to'ldiriladi
    id: '001_user_profile',
    up: (db) => {
      addColumn(db, 'users', 'city_id', 'INTEGER REFERENCES cities(id)');
      addColumn(db, 'users', 'phone', 'TEXT');
      addColumn(db, 'users', 'profile_completed_at', 'TEXT');

      // Mavjud foydalanuvchilarda ism bor, lekin familiya/viloyat yo'q —
      // ular keyingi kirishda profilni to'ldirishga yo'naltiriladi
    },
  },
  {
    // Ommaviy oferta: har so'rovda qabul qilinadi va qaysi versiya ekani yoziladi
    id: '002_terms_acceptance',
    up: (db) => {
      addColumn(db, 'requests', 'terms_version', 'TEXT');
      addColumn(db, 'requests', 'terms_accepted_at', 'TEXT');

      db.exec(`
        CREATE TABLE IF NOT EXISTS terms_acceptances (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          request_id   INTEGER REFERENCES requests(id) ON DELETE SET NULL,
          version      TEXT NOT NULL,
          -- Yuridik dalil uchun: qachon va qaysi qurilmadan qabul qilingan
          accepted_at  TEXT NOT NULL DEFAULT (datetime('now')),
          user_agent   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_terms_user ON terms_acceptances(user_id, version);
      `);
    },
  },
  {
    /**
     * So'rov vizardi: holat tavsifi, sana oralig'i, boshqa viloyat, hujjatlar.
     *
     * "Bilmayman — klinika aytadi" varianti uchun katalogga maxsus yozuv
     * qo'shiladi (slug = 'unknown', active = 0). Shunday qilib `operation_id`
     * NOT NULL bo'lib qoladi va tashqi kalit butunligi buzilmaydi, lekin
     * bemor operatsiyani bilmasa ham so'rov yuborishi mumkin.
     */
    id: '003_request_wizard',
    up: (db) => {
      addColumn(db, 'requests', 'condition_text', 'TEXT');
      addColumn(db, 'requests', 'other_regions_ok', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'requests', 'date_from', 'TEXT');
      addColumn(db, 'requests', 'date_to', 'TEXT');
      addColumn(db, 'requests', 'date_flexible', 'INTEGER NOT NULL DEFAULT 1');

      // Bemor yuklagan hujjatlar (UZI, MRT, analiz). Kirish huquqi qat'iy:
      // egasi, so'rovni olgan klinika yoki moderator.
      db.exec(`
        CREATE TABLE IF NOT EXISTS files (
          id           TEXT PRIMARY KEY,
          owner_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name         TEXT NOT NULL,
          mime_type    TEXT NOT NULL,
          size_bytes   INTEGER NOT NULL,
          kind         TEXT NOT NULL DEFAULT 'other',
          storage_path TEXT NOT NULL,
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
      `);

      // Kategoriya hali bo'lmasa (yangi baza) — seed keyin qo'shadi
      ensureUnknownOperation(db);
    },
  },
  {
    /**
     * Hujjatga bemor bergan nom ("Boshqa" turini tanlaganda yoziladi) va
     * AI suhbati tarixi — klinika bemor bilan AI nima gaplashganini ko'radi.
     */
    id: '004_document_label_and_ai_chat',
    up: (db) => {
      addColumn(db, 'files', 'label', 'TEXT');
      addColumn(db, 'requests', 'ai_conversation', 'TEXT');
    },
  },
  {
    /**
     * Klinika kabineti. Bemor tomoni bitta so'rov atrofida qurilgan, klinika
     * tomoni esa takrorlanuvchi ish oqimi — shuning uchun shablon, kalendar,
     * jamoa va hisob-kitob uchun alohida jadvallar kerak bo'ldi.
     */
    id: '005_clinic_cabinet',
    up: (db) => {
      // Profilga qo'shimcha maydonlar — klinika o'zini to'liq ko'rsatishi uchun
      addColumn(db, 'clinics', 'phone', 'TEXT');
      addColumn(db, 'clinics', 'website', 'TEXT');
      addColumn(db, 'clinics', 'work_hours', 'TEXT');
      addColumn(db, 'clinics', 'photos', "TEXT NOT NULL DEFAULT '[]'");
      addColumn(db, 'clinics', 'equipment', "TEXT NOT NULL DEFAULT '[]'");
      addColumn(db, 'clinics', 'beds', 'INTEGER');
      addColumn(db, 'clinics', 'founded_year', 'INTEGER');

      // Sharhga javob — klinika obro'sini tiklash imkoni
      addColumn(db, 'reviews', 'reply_body', 'TEXT');
      addColumn(db, 'reviews', 'reply_at', 'TEXT');

      // Foydalanuvchi oxirgi marta qachon ko'ringan — operatorlar ro'yxati uchun
      addColumn(db, 'users', 'last_seen_at', 'TEXT');
      addColumn(db, 'users', 'notification_prefs', 'TEXT');

      db.exec(`
        CREATE TABLE IF NOT EXISTS clinic_documents (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          clinic_id  INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
          kind       TEXT NOT NULL DEFAULT 'other',
          label      TEXT,
          file_id    TEXT NOT NULL,
          status     TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
          note       TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_clinic_documents_clinic ON clinic_documents(clinic_id);

        CREATE TABLE IF NOT EXISTS offer_templates (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
          title          TEXT NOT NULL,
          operation_id   INTEGER REFERENCES operations(id) ON DELETE SET NULL,
          price_uzs      INTEGER,
          includes       TEXT NOT NULL DEFAULT '[]',
          advantages     TEXT NOT NULL DEFAULT '[]',
          lead_time_days INTEGER NOT NULL DEFAULT 7,
          note           TEXT,
          used_count     INTEGER NOT NULL DEFAULT 0,
          created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_offer_templates_clinic ON offer_templates(clinic_id);

        CREATE TABLE IF NOT EXISTS doctors (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          clinic_id        INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
          full_name        TEXT NOT NULL,
          specialty        TEXT NOT NULL DEFAULT '',
          experience_years INTEGER,
          photo_file_id    TEXT,
          bio              TEXT,
          active           INTEGER NOT NULL DEFAULT 1,
          created_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_doctors_clinic ON doctors(clinic_id);

        CREATE TABLE IF NOT EXISTS doctor_operations (
          doctor_id    INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
          operation_id INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
          PRIMARY KEY (doctor_id, operation_id)
        );

        -- Bo'sh slot: klinika qaysi kunda nechta operatsiya qila oladi
        CREATE TABLE IF NOT EXISTS capacity_slots (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
          date      TEXT NOT NULL,
          capacity  INTEGER NOT NULL DEFAULT 1,
          note      TEXT,
          UNIQUE (clinic_id, date)
        );

        -- Operator taklifnomasi: kod bilan klinikaga qo'shiladi
        CREATE TABLE IF NOT EXISTS clinic_invites (
          code           TEXT PRIMARY KEY,
          clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
          role           TEXT NOT NULL CHECK (role IN ('clinic_admin','clinic_operator')),
          expires_at     TEXT NOT NULL,
          used_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_clinic_invites_clinic ON clinic_invites(clinic_id);
      `);
    },
  },
  {
    /**
     * Komissiya to'lovlari.
     *
     * Ilgari "to'lanmagan komissiya" butun komissiya deb ko'rsatilardi —
     * chunki to'langanini yozib qo'yadigan joy yo'q edi. Endi har to'lov
     * alohida yozuv: hisob-kitob haqiqatni ko'rsatadi.
     */
    id: '006_commission_payments',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS commission_payments (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          clinic_id  INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
          amount_uzs INTEGER NOT NULL CHECK (amount_uzs > 0),
          method     TEXT NOT NULL DEFAULT 'manual',
          reference  TEXT,
          period     TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_commission_payments_clinic
          ON commission_payments(clinic_id);
      `);
    },
  },
  {
    /**
     * Admin web-panel poydevori.
     *
     * Panel bemor/klinika ilovasidan BUTUNLAY ajratilgan: alohida jadval,
     * alohida sessiya, alohida parol. Telegram hisobi bilan aloqasi yo'q —
     * shuning uchun Telegram akkaunti buzilsa ham panel ochilmaydi.
     *
     * Audit jurnali alohida turadi va hech qachon o'chirilmaydi: tibbiy
     * hujjatga kim qaraganini keyin isbotlash kerak bo'ladi.
     */
    id: '007_admin_panel',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS admin_users (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          email          TEXT NOT NULL UNIQUE,
          full_name      TEXT NOT NULL,
          -- scrypt: tuz va hash alohida saqlanadi
          password_salt  TEXT NOT NULL,
          password_hash  TEXT NOT NULL,
          -- 'full' hamma narsa, 'moderator' faqat moderatsiya bo'limlari
          level          TEXT NOT NULL DEFAULT 'moderator'
                         CHECK (level IN ('full','moderator')),
          totp_secret    TEXT,
          totp_enabled   INTEGER NOT NULL DEFAULT 0,
          disabled_at    TEXT,
          last_login_at  TEXT,
          -- Ketma-ket muvaffaqiyatsiz urinishlar; qulflash uchun
          failed_count   INTEGER NOT NULL DEFAULT 0,
          locked_until   TEXT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
          token       TEXT PRIMARY KEY,
          admin_id    INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
          ip          TEXT,
          user_agent  TEXT,
          expires_at  TEXT NOT NULL,
          -- 2FA hali tasdiqlanmagan sessiya faqat "kodni kiriting" bosqichida
          mfa_passed  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);

        -- Audit: kim, nima, qachon. O'chirish va tahrirlash yo'q.
        CREATE TABLE IF NOT EXISTS audit_log (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          admin_id     INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
          admin_email  TEXT,
          action       TEXT NOT NULL,
          entity       TEXT,
          entity_id    TEXT,
          -- Nima o'zgardi: oldingi va yangi qiymat
          details      TEXT,
          ip           TEXT,
          severity     TEXT NOT NULL DEFAULT 'info'
                       CHECK (severity IN ('info','warning','security','data_access')),
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_log(severity);

        -- Kod o'zgartirmasdan sozlanadigan qiymatlar
        CREATE TABLE IF NOT EXISTS platform_settings (
          key         TEXT PRIMARY KEY,
          value       TEXT NOT NULL,
          updated_by  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Deploy'siz tahrirlanadigan UI matnlari
        CREATE TABLE IF NOT EXISTS translation_overrides (
          key         TEXT NOT NULL,
          lang        TEXT NOT NULL CHECK (lang IN ('uz','ru')),
          value       TEXT NOT NULL,
          updated_by  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (key, lang)
        );

        -- Ommaviy bildirishnoma kampaniyalari
        CREATE TABLE IF NOT EXISTS broadcasts (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          title_uz      TEXT NOT NULL,
          title_ru      TEXT NOT NULL,
          body_uz       TEXT NOT NULL,
          body_ru       TEXT NOT NULL,
          -- JSON: {roles, cityIds, operationIds, activeSince}
          segment       TEXT NOT NULL DEFAULT '{}',
          scheduled_at  TEXT,
          status        TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
          sent_count    INTEGER NOT NULL DEFAULT 0,
          read_count    INTEGER NOT NULL DEFAULT 0,
          created_by    INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          sent_at       TEXT
        );

        -- Nizo qarorida qaytarilgan to'lov
        CREATE TABLE IF NOT EXISTS refunds (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          deal_id     INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
          amount_uzs  INTEGER NOT NULL,
          reason      TEXT NOT NULL,
          created_by  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Maxfiylik so'roviga binoan tozalash uchun belgi
      addColumn(db, 'users', 'anonymized_at', 'TEXT');
    },
  },
  {
    /**
     * Biznes shartlari kod'dan bazaga ko'chadi.
     *
     * Ilgari komissiya foizi ham, sinov muddati ham kodda qattiq yozilgan edi.
     * Endi ikkalasi ham admin qo'lida: platforma bo'yicha umumiy qiymat
     * `platform_settings` da, alohida klinika uchun esa shu jadvalda —
     * chunki yirik klinika bilan shartnoma boshqacha bo'lishi mumkin.
     */
    id: '008_business_terms',
    up: (db) => {
      // Sinov davri klinika TASDIQLANGAN kundan boshlanadi, platforma
      // ishga tushgan kundan emas — kech qo'shilgan ham to'liq muddat oladi
      addColumn(db, 'clinics', 'trial_until', 'TEXT');
      // null bo'lsa platforma bo'yicha umumiy foiz ishlatiladi
      addColumn(db, 'clinics', 'commission_percent', 'REAL');
      // Komissiya bitim tuzilgan PAYTDAGI foiz bilan qotib qoladi:
      // keyin foiz o'zgarsa eski bitimlar qayta hisoblanmaydi
      addColumn(db, 'deals', 'commission_percent', 'REAL');
      // Bemor javob bermagani uchun avtomatik yopilgan bitim belgisi
      addColumn(db, 'deals', 'auto_confirmed', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    /**
     * 'trial' tarifini bazada ham ruxsat etish.
     *
     * `plan` ustunida `CHECK (plan IN ('basic','pro'))` cheklovi bor edi.
     * SQLite CHECK cheklovini o'zgartirishga ruxsat bermaydi — jadvalni
     * qayta qurishdan boshqa yo'l yo'q. Ma'lumot to'liq ko'chiriladi.
     *
     * FK'lar (users.clinic_id va boshqalar) ko'chirish davomida o'chiriladi,
     * aks holda DROP TABLE ularni buzadi.
     */
    id: '009_trial_plan',
    up: (db) => {
      const constrained = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'clinics'`)
        .get() as { sql: string } | undefined;

      // Cheklov allaqachon yangilangan bo'lsa qayta qurmaymiz
      if (!constrained?.sql.includes("plan IN ('basic','pro')")) return;

      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE clinics_new (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          name                  TEXT NOT NULL,
          city_id               INTEGER NOT NULL REFERENCES cities(id),
          address               TEXT NOT NULL DEFAULT '',
          about                 TEXT NOT NULL DEFAULT '',
          logo_url              TEXT,
          verification          TEXT NOT NULL DEFAULT 'pending'
                                CHECK (verification IN ('pending','approved','rejected')),
          verification_note     TEXT,
          license_file_id       TEXT,
          plan                  TEXT CHECK (plan IN ('trial','basic','pro')),
          subscription_status   TEXT NOT NULL DEFAULT 'none'
                                CHECK (subscription_status IN ('active','suspended','expired','none')),
          subscription_until    TEXT,
          rating_avg            REAL NOT NULL DEFAULT 0,
          rating_count          INTEGER NOT NULL DEFAULT 0,
          deals_count           INTEGER NOT NULL DEFAULT 0,
          response_minutes_sum  INTEGER NOT NULL DEFAULT 0,
          response_samples      INTEGER NOT NULL DEFAULT 0,
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          phone                 TEXT,
          website               TEXT,
          work_hours            TEXT,
          photos                TEXT NOT NULL DEFAULT '[]',
          equipment             TEXT NOT NULL DEFAULT '[]',
          beds                  INTEGER,
          founded_year          INTEGER,
          trial_until           TEXT,
          commission_percent    REAL
        );

        INSERT INTO clinics_new
        SELECT id, name, city_id, address, about, logo_url, verification, verification_note,
               license_file_id, plan, subscription_status, subscription_until, rating_avg,
               rating_count, deals_count, response_minutes_sum, response_samples, created_at,
               phone, website, work_hours, photos, equipment, beds, founded_year,
               trial_until, commission_percent
          FROM clinics;

        DROP TABLE clinics;
        ALTER TABLE clinics_new RENAME TO clinics;
      `);
      db.pragma('foreign_keys = ON');

      // To'lov jadvalidagi cheklov ham yangilanadi — sinov davri to'lovsiz,
      // lekin kelajakda 'trial' yozuvi kerak bo'lishi mumkin
      const payments = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'subscription_payments'`)
        .get() as { sql: string } | undefined;
      if (payments?.sql.includes("plan IN ('basic','pro')")) {
        db.pragma('foreign_keys = OFF');
        db.exec(`
          CREATE TABLE subscription_payments_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            clinic_id   INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
            plan        TEXT NOT NULL CHECK (plan IN ('trial','basic','pro')),
            amount_uzs  INTEGER NOT NULL,
            period_from TEXT NOT NULL,
            period_to   TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO subscription_payments_new
          SELECT id, clinic_id, plan, amount_uzs, period_from, period_to, created_at
            FROM subscription_payments;
          DROP TABLE subscription_payments;
          ALTER TABLE subscription_payments_new RENAME TO subscription_payments;
        `);
        db.pragma('foreign_keys = ON');
      }
    },
  },
  {
    /**
     * Bemor profili va tibbiy anketa.
     *
     * Tug'ilgan YIL saqlanadi, yosh emas: yosh har yili eskirib qoladi va
     * bir marta kiritilgan qiymat keyin yolg'on bo'lib qolardi. Yosh
     * ko'rsatilganda hisoblanadi.
     *
     * Tibbiy anketa alohida jadvalda: u ixtiyoriy, maxfiyroq va
     * profildan ko'ra kamroq o'qiladi.
     */
    id: '010_patient_profile',
    up: (db) => {
      addColumn(db, 'users', 'birth_year', 'INTEGER');
      addColumn(db, 'users', 'gender', "TEXT CHECK (gender IN ('male','female'))");
      // Telegram bergan raqam o'zgartirilmaydi; bu qo'shimcha aloqa uchun
      addColumn(db, 'users', 'extra_phone', 'TEXT');

      db.exec(`
        CREATE TABLE IF NOT EXISTS medical_profiles (
          user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          -- JSON massivlar: har biri erkin matnli qatorlar ro'yxati
          chronic_conditions  TEXT NOT NULL DEFAULT '[]',
          past_surgeries      TEXT NOT NULL DEFAULT '[]',
          allergies           TEXT NOT NULL DEFAULT '[]',
          medications         TEXT NOT NULL DEFAULT '[]',
          blood_type          TEXT,
          height_cm           INTEGER,
          weight_kg           INTEGER,
          notes               TEXT,
          updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      /*
       * So'rov kimga tegishli.
       *
       * Bemor o'zi uchun ham, tanishi uchun ham so'rov qoldirishi mumkin.
       * Tanishi uchun bo'lsa profil ma'lumotlari ISHLATILMAYDI — aks holda
       * klinika noto'g'ri odamning yoshi va kasalligini ko'radi.
       */
      addColumn(db, 'requests', 'for_self', 'INTEGER NOT NULL DEFAULT 1');
      addColumn(db, 'requests', 'subject_name', 'TEXT');
      addColumn(db, 'requests', 'subject_birth_year', 'INTEGER');
      addColumn(db, 'requests', 'subject_gender', "TEXT CHECK (subject_gender IN ('male','female'))");
    },
  },
  {
    /**
     * Klinika arizasi — Telegramdan TASHQARIDA to'ldiriladi.
     *
     * Nima uchun alohida jadval, to'g'ridan-to'g'ri `clinics` emas:
     * ariza ochiq internetdan keladi va hali hech kim tekshirmagan. Uni
     * darhol klinika qilib qo'ysak, tasdiqlanmagan yozuvlar haqiqiy
     * klinikalar bilan aralashib ketardi va matching ularni ko'rardi.
     *
     * Oqim: ariza (ochiq veb) -> moderator tekshiradi -> klinika yaratiladi
     * va ulanish kodi beriladi -> klinika bot orqali kodni kiritib, o'z
     * Telegram hisobini biriktiradi.
     */
    id: '011_clinic_applications',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS clinic_applications (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          name           TEXT NOT NULL,
          city_id        INTEGER NOT NULL REFERENCES cities(id),
          address        TEXT NOT NULL DEFAULT '',
          about          TEXT NOT NULL DEFAULT '',
          license_no     TEXT NOT NULL,
          -- Bog'lanish uchun: moderator shu odamga qo'ng'iroq qiladi
          contact_name   TEXT NOT NULL,
          contact_phone  TEXT NOT NULL,
          contact_email  TEXT,
          -- JSON: qaysi operatsiyalarni bajaradi
          operation_ids  TEXT NOT NULL DEFAULT '[]',
          status         TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected')),
          note           TEXT,
          -- Tasdiqlangach yaratilgan klinika va ulanish kodi
          clinic_id      INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
          connect_code   TEXT,
          reviewed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
          reviewed_at    TEXT,
          -- Spamni cheklash uchun
          submitted_ip   TEXT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_clinic_applications_status
          ON clinic_applications(status, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_applications_code
          ON clinic_applications(connect_code) WHERE connect_code IS NOT NULL;
      `);
    },
  },
  {
    /**
     * Veb hisoblar — klinika va admin uchun.
     *
     * Bemor Telegram orqali kiradi, klinika va admin esa VEB orqali:
     * ular ish joyida kompyuterda ishlaydi va butun kabinetni telefon
     * ekranida yuritish noqulay. Shuning uchun bu ikki rol uchun
     * email + parol.
     *
     * `admin_users` jadvali kengaytiriladi: `level` endi klinika
     * rollarini ham qamraydi va `clinic_id` qo'shiladi. SQLite CHECK
     * cheklovini o'zgartirmaydi, shuning uchun jadval qayta quriladi.
     */
    id: '012_web_accounts',
    up: (db) => {
      const current = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'admin_users'`)
        .get() as { sql: string } | undefined;

      if (current?.sql.includes("level IN ('full','moderator')")) {
        db.pragma('foreign_keys = OFF');
        db.exec(`
          CREATE TABLE admin_users_new (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            email          TEXT NOT NULL UNIQUE,
            full_name      TEXT NOT NULL,
            password_salt  TEXT NOT NULL,
            password_hash  TEXT NOT NULL,
            level          TEXT NOT NULL DEFAULT 'moderator'
                           CHECK (level IN ('full','moderator','clinic_admin','clinic_operator')),
            -- Klinika rollari uchun majburiy, admin rollari uchun null
            clinic_id      INTEGER REFERENCES clinics(id) ON DELETE CASCADE,
            totp_secret    TEXT,
            totp_enabled   INTEGER NOT NULL DEFAULT 0,
            disabled_at    TEXT,
            last_login_at  TEXT,
            failed_count   INTEGER NOT NULL DEFAULT 0,
            locked_until   TEXT,
            -- Birinchi kirishda parol o'rnatish uchun bir martalik kod
            setup_token    TEXT,
            setup_expires  TEXT,
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
          );

          INSERT INTO admin_users_new
            (id, email, full_name, password_salt, password_hash, level,
             totp_secret, totp_enabled, disabled_at, last_login_at,
             failed_count, locked_until, created_at)
          SELECT id, email, full_name, password_salt, password_hash, level,
                 totp_secret, totp_enabled, disabled_at, last_login_at,
                 failed_count, locked_until, created_at
            FROM admin_users;

          DROP TABLE admin_users;
          ALTER TABLE admin_users_new RENAME TO admin_users;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_setup
            ON admin_users(setup_token) WHERE setup_token IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_admin_users_clinic ON admin_users(clinic_id);
        `);
        db.pragma('foreign_keys = ON');
      }
    },
  },
  {
    /**
     * Tashqi katalog manbasi.
     *
     * Operatsiyalar ro'yxati endi banisa.uz katalogidan olinadi. Ikki
     * yangi ustun kerak: qaysi manbadan kelgani va o'sha manbadagi
     * identifikatori. Shu ikkisi bo'lsa takroriy import qilinganda qator
     * qayta yaratilmaydi — mavjudi yangilanadi.
     *
     * Qo'lda kiritilgan operatsiyalarda bu ustunlar bo'sh qoladi va ular
     * sinxronizatsiyada teginilmaydi.
     */
    id: '013_catalog_source',
    up: (db) => {
      const cols = (table: string) =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

      const opCols = cols('operations');
      if (!opCols.includes('source')) {
        db.exec(`
          ALTER TABLE operations ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
          ALTER TABLE operations ADD COLUMN external_id TEXT;
          ALTER TABLE operations ADD COLUMN synced_at TEXT;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_external
            ON operations(source, external_id) WHERE external_id IS NOT NULL;
        `);
      }

      const catCols = cols('operation_categories');
      if (!catCols.includes('source')) {
        db.exec(`
          ALTER TABLE operation_categories ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
          ALTER TABLE operation_categories ADD COLUMN external_id TEXT;
          ALTER TABLE operation_categories ADD COLUMN synced_at TEXT;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_external
            ON operation_categories(source, external_id) WHERE external_id IS NOT NULL;
        `);
      }

      /*
       * Sinxronizatsiya jurnali.
       *
       * Katalog — platformaning o'zagi: unga tegish barcha klinikaning
       * ko'rinadigan so'rovlarini o'zgartiradi. Shuning uchun har bir
       * yugurish yozib boriladi: kim boshladi, nima o'zgardi, xato
       * bo'ldimi. Nimadir noto'g'ri ketsa nima bo'lganini aytib beradi.
       */
      db.exec(`
        CREATE TABLE IF NOT EXISTS catalog_sync_log (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          source        TEXT NOT NULL,
          started_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
          status        TEXT NOT NULL CHECK (status IN ('ok','failed')),
          -- Nima qilingani: qo'shildi / yangilandi / o'chirildi (deaktivatsiya)
          added         INTEGER NOT NULL DEFAULT 0,
          updated       INTEGER NOT NULL DEFAULT 0,
          deactivated   INTEGER NOT NULL DEFAULT 0,
          categories    INTEGER NOT NULL DEFAULT 0,
          error         TEXT,
          duration_ms   INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sync_log_created ON catalog_sync_log(created_at DESC);
      `);
    },
  },
  {
    /**
     * Kirish identifikatori: email emas, TELEFON RAQAMI.
     *
     * Sabab amaliy. O'zbekistonda klinika egasi elektron pochtadan
     * kamdan-kam foydalanadi, telefon esa hammada bor va u allaqachon
     * ariza jarayonida moderator tomonidan tekshirilgan — moderator
     * o'sha raqamga qo'ng'iroq qilib gaplashadi.
     *
     * Bundan tashqari telefon Telegram bilan bog'lanish nuqtasi
     * bo'ladi: bot kontakt so'raganda Telegram raqamning egasini o'zi
     * tasdiqlaydi, ya'ni bizga alohida SMS tekshiruvi kerak emas.
     *
     * Email qoladi, lekin ixtiyoriy: xabar yuborish uchun asqotadi.
     *
     * Shu bilan birga `moderator` darajasi olib tashlanadi. Amalda
     * ikki darajali admin kerak emas edi: super admin yetarli, ikkinchi
     * daraja esa faqat chalkashlik va qo'shimcha tekshiruv joyi
     * bo'lardi.
     */
    id: '014_phone_login',
    up: (db) => {
      const cols = (db.prepare(`PRAGMA table_info(admin_users)`).all() as { name: string }[]).map(
        (c) => c.name,
      );

      if (!cols.includes('phone')) {
        db.exec(`ALTER TABLE admin_users ADD COLUMN phone TEXT`);
      }

      const current = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'admin_users'`)
        .get() as { sql: string } | undefined;

      // `email` NOT NULL bo'lsa yoki `moderator` darajasi qolgan bo'lsa qayta quramiz
      const needsRebuild =
        Boolean(current?.sql.includes("'moderator'")) || Boolean(current?.sql.match(/email\s+TEXT NOT NULL/));

      if (needsRebuild) {
        db.exec(`
          CREATE TABLE admin_users_new (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            -- Kirish identifikatori
            phone          TEXT NOT NULL UNIQUE,
            -- Ixtiyoriy: xabar yuborish uchun
            email          TEXT UNIQUE,
            full_name      TEXT NOT NULL,
            password_salt  TEXT NOT NULL,
            password_hash  TEXT NOT NULL,
            level          TEXT NOT NULL DEFAULT 'clinic_admin'
                           CHECK (level IN ('full','clinic_admin','clinic_operator')),
            clinic_id      INTEGER REFERENCES clinics(id) ON DELETE CASCADE,
            totp_secret    TEXT,
            totp_enabled   INTEGER NOT NULL DEFAULT 0,
            disabled_at    TEXT,
            last_login_at  TEXT,
            failed_count   INTEGER NOT NULL DEFAULT 0,
            locked_until   TEXT,
            setup_token    TEXT,
            setup_expires  TEXT,
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
          );

          /*
           * Raqami yo'q eski hisoblar uchun vaqtinchalik qiymat
           * qo'yiladi: ustun NOT NULL va UNIQUE. Bunday hisob bilan
           * kirib bo'lmaydi — egasi raqamini biriktirgach tuzatiladi.
           */
          INSERT INTO admin_users_new
            (id, phone, email, full_name, password_salt, password_hash, level, clinic_id,
             totp_secret, totp_enabled, disabled_at, last_login_at, failed_count,
             locked_until, setup_token, setup_expires, created_at)
          SELECT id,
                 COALESCE(NULLIF(phone, ''), 'migratsiya:' || id),
                 email,
                 full_name, password_salt, password_hash,
                 CASE level WHEN 'moderator' THEN 'full' ELSE level END,
                 clinic_id,
                 totp_secret, totp_enabled, disabled_at, last_login_at, failed_count,
                 locked_until, setup_token, setup_expires, created_at
            FROM admin_users;

          DROP TABLE admin_users;
          ALTER TABLE admin_users_new RENAME TO admin_users;

          CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_setup
            ON admin_users(setup_token) WHERE setup_token IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_admin_users_clinic ON admin_users(clinic_id);
        `);
      }

      /*
       * Platforma rollarida ham `moderator` qolmaydi: u bo'lgan
       * hisoblar `admin` bo'ladi. Ikki xil admin darajasi amalda
       * kerak emas edi.
       */
      db.exec(`
        UPDATE users
           SET roles = REPLACE(roles, '"moderator"', '"admin"')
         WHERE roles LIKE '%moderator%';
      `);
      // REPLACE ikki xil rol qolgan bo'lsa takror yasashi mumkin
      db.exec(`UPDATE users SET roles = '["admin"]' WHERE roles = '["admin","admin"]'`);
    },
  },
  {
    /**
     * Taklifni aniqroq qiladigan uch narsa.
     *
     * `proposed_dates` — klinika taklif qilgan aniq sanalar. "7 kun
     * ichida" mo'ljal beradi, sana esa qaror qildiradi: bemor ishdan
     * ta'til olishi va yaqinini chaqirishi kerak.
     *
     * `above_budget_reason` — bemor budjetidan yuqori narx uchun izoh.
     * Klinika yaxshiroq shart bilan qimmatroq taklif bera oladi, lekin
     * sababsiz emas: aks holda bemor eng arzonini tanlaydi va tafovutni
     * tushunmaydi.
     *
     * `deal_price_changes` — bitim narxining o'zgarishi tarixi. Ilgari
     * narx faqat tasdiqlash paytida o'zgara olardi va nima uchun
     * o'zgargani hech qayerda qolmasdi. Endi har o'zgarish IKKI TOMON
     * roziligi bilan bo'ladi va yozib boriladi — komissiya ham, nizo
     * ham shu yozuvga tayanadi.
     */
    id: '015_offer_details',
    up: (db) => {
      addColumn(db, 'offers', 'proposed_dates', `TEXT NOT NULL DEFAULT '[]'`);
      addColumn(db, 'offers', 'above_budget_reason', 'TEXT');

      db.exec(`
        CREATE TABLE IF NOT EXISTS deal_price_changes (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          deal_id     INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
          from_uzs    INTEGER NOT NULL,
          to_uzs      INTEGER NOT NULL,
          reason      TEXT NOT NULL,
          proposed_by TEXT NOT NULL CHECK (proposed_by IN ('clinic','patient')),
          status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','rejected')),
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          decided_at  TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_price_changes_deal ON deal_price_changes(deal_id, status);

        /*
         * Bir bitimda bir vaqtda faqat BITTA kutilayotgan taklif
         * bo'lishi mumkin. Aks holda ikki xil narx bir vaqtda
         * kutilib turardi va qaysi biri qabul qilinsa — noaniq.
         */
        CREATE UNIQUE INDEX IF NOT EXISTS uq_price_change_pending
          ON deal_price_changes(deal_id) WHERE status = 'pending';
      `);
    },
  },
  {
    /**
     * Katalogga IKKINCHI daraja qo'shiladi: soha → bo'lim → operatsiya.
     *
     * Ilgari faqat soha bor edi va manbadagi bo'limlar tashlab
     * yuborilardi. Natijada "Ko'z Xirurgiyasi" ni ochgan odam 23 ta
     * operatsiyani bitta ro'yxatda ko'rardi — ular orasida "Katarakta
     * FEK+IOL (AQSH) Alkon" kabi nomlar bor. Bemor ham, klinika ham
     * o'zi qidirayotgan narsani topa olmasdi.
     *
     * Endi bo'limlar ham olinadi: "Katarakta" (5), "Glaukoma" (3),
     * "Refraktiv xirurgiya" (4). Har biri bir ekranga sig'adi.
     *
     * Bir jadval, ikki daraja: `parent_id` bo'sh bo'lsa — soha,
     * to'ldirilgan bo'lsa — bo'lim. Alohida jadval qilinsa, har
     * so'rovda ikkovini birlashtirish kerak bo'lardi.
     */
    id: '016_subcategories',
    up: (db) => {
      addColumn(db, 'operation_categories', 'parent_id', 'INTEGER REFERENCES operation_categories(id) ON DELETE CASCADE');
      addColumn(db, 'operation_categories', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');

      /*
       * Operatsiya BO'LIMGA bog'lanadi, lekin `category_id` ham
       * qoladi: matching va statistika unga tayanadi va ularni
       * birdan ko'chirish keraksiz xavf. Bo'lim ko'rsatilmasa
       * operatsiya to'g'ridan-to'g'ri sohada turadi.
       */
      addColumn(db, 'operations', 'subcategory_id', 'INTEGER REFERENCES operation_categories(id) ON DELETE SET NULL');

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_categories_parent ON operation_categories(parent_id);
        CREATE INDEX IF NOT EXISTS idx_operations_subcategory ON operations(subcategory_id);
      `);
    },
  },
  {
    /**
     * banisa.uz bilan ulanish.
     *
     * Klinika banisa'da ro'yxatdan o'tgan va operatsiyalarini yoqqan
     * bo'lsa, bu yerda hammasini qaytadan qilmasligi kerak. Ulanish
     * bir bosishda bo'ladi va yo'nalishlar shundan keyin ham
     * sinxron turadi.
     *
     * Egalik chegarasi: banisa — klinika kimligi va nima qilishining
     * egasi; bu yerdagi yozuvlar KO'ZGU. Tender shartlari (tarif,
     * komissiya, reyting) esa KlinikaTop'niki bo'lib qoladi.
     */
    id: '017_banisa_link',
    up: (db) => {
      addColumn(db, 'clinics', 'external_id', 'TEXT');
      addColumn(db, 'clinics', 'external_synced_at', 'TEXT');

      /*
       * Yo'nalish kimdan kelgani. banisa'dan kelganini bu yerda
       * tahrirlab bo'lmaydi — aks holda ikki tomon bir faktni
       * o'zgartiradi va ular ajralib ketadi.
       */
      addColumn(db, 'clinic_operations', 'source', `TEXT NOT NULL DEFAULT 'manual'`);

      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clinics_external
          ON clinics(external_id) WHERE external_id IS NOT NULL;

        /*
         * Shahar moslashtirish.
         *
         * banisa'da hudud ERKIN MATN va bir shahar bir necha xil
         * yoziladi: "Toshkent", "Toshkent shahri", "tashkent_city",
         * "toshkent" — hozir to'rttasi ham bazada bor.
         *
         * Normallashtirish ko'pini hal qiladi, qolganini shu jadval.
         * Topilmasa klinikadan so'raladi — jimgina taxmin qilinmaydi,
         * chunki noto'g'ri shahar so'rovlarni butunlay to'xtatib
         * qo'yadi va buni bir necha hafta sezmaslik mumkin.
         */
        CREATE TABLE IF NOT EXISTS city_aliases (
          alias      TEXT PRIMARY KEY,
          city_id    INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        /*
         * Ishlatilgan biletlar.
         *
         * Bilet bir martalik. banisa uni saqlamaydi — takrorni shu
         * yerda to'xtatamiz. Muddati o'tganlari tozalab turiladi.
         */
        CREATE TABLE IF NOT EXISTS used_link_tickets (
          jti        TEXT PRIMARY KEY,
          used_at    TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_used_tickets_exp ON used_link_tickets(expires_at);
      `);

      /*
       * Ma'lum yozilishlar oldindan kiritiladi. Ro'yxat to'liq
       * bo'lishi shart emas — normallashtirish ko'pini o'zi tutadi,
       * bu esa qolgan chetki holatlar uchun.
       */
      const seed = db.prepare(
        `INSERT OR IGNORE INTO city_aliases (alias, city_id)
         SELECT ?, id FROM cities WHERE slug = ?`,
      );

      const pairs: [string, string][] = [
        ['toshkent', 'tashkent'],
        ['tashkent', 'tashkent'],
        ['toshkentshahri', 'tashkent'],
        ['toshkentviloyati', 'tashkent'],
        ['samarqand', 'samarkand'],
        ['samarkand', 'samarkand'],
        ['buxoro', 'bukhara'],
        ['bukhara', 'bukhara'],
        ['andijon', 'andijan'],
        ['andijan', 'andijan'],
        ['fargona', 'fergana'],
        ['fergana', 'fergana'],
        ['namangan', 'namangan'],
        ['nukus', 'nukus'],
        ['qarshi', 'qarshi'],
        ['karshi', 'qarshi'],
        ['urganch', 'urgench'],
        ['urgench', 'urgench'],
        ['navoiy', 'navoiy'],
        ['navoi', 'navoiy'],
        ['jizzax', 'jizzakh'],
        ['jizzakh', 'jizzakh'],
        ['termiz', 'termez'],
        ['termez', 'termez'],
      ];

      for (const [alias, slug] of pairs) seed.run(alias, slug);
    },
  },
  {
    /*
     * So'rov bosqichlari admin qo'lida.
     *
     * Bemor so'rov qoldirayotganda bosqichma-bosqich yuradi. Qaysi
     * bosqich bor, qaysi tartibda va nima deb yozilgani — bu MAHSULOT
     * qarori, kod emas. Uni o'zgartirish uchun har safar deploy kutish
     * noto'g'ri: matn tajriba qilinadi, ortiqcha bosqich olib
     * tashlanadi, mavsumiy savol qo'shiladi.
     *
     * Ikki xil bosqich bor va farqi tub:
     *
     *   `builtin` — kodda yozilgan maxsus ekranlar (katalog tanlash,
     *   byudjet slayderi, sana oynasi, hujjat yuklash). Admin ularning
     *   TARTIBI, MATNI va yoqilgan-yoqilmaganini o'zgartiradi, lekin
     *   yangisini yarata olmaydi — ular kod.
     *
     *   Qolganlari — admin YARATADIGAN oddiy savollar (matn, tanlov,
     *   raqam, ha/yo'q). Javoblari `requests.extra_answers` ichida
     *   JSON bo'lib yotadi.
     *
     * Ba'zi bosqichlar o'chirilmaydi (`locked`): ularsiz so'rov
     * serverda rad etiladi — operatsiya, holat, viloyat va oferta.
     * Buni bazada belgilab qo'yamiz, aks holda admin o'zi bilmagan
     * holda so'rov yaratishni butunlay buzib qo'yishi mumkin.
     */
    id: '018_request_steps',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS request_steps (
          id          INTEGER PRIMARY KEY,
          key         TEXT    NOT NULL UNIQUE,
          kind        TEXT    NOT NULL,
          position    INTEGER NOT NULL,
          enabled     INTEGER NOT NULL DEFAULT 1,
          required    INTEGER NOT NULL DEFAULT 0,
          locked      INTEGER NOT NULL DEFAULT 0,
          title_uz    TEXT,
          title_ru    TEXT,
          sub_uz      TEXT,
          sub_ru      TEXT,
          options     TEXT,
          updated_by  INTEGER REFERENCES users(id),
          updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_request_steps_pos ON request_steps(position);
      `);

      // Admin yaratgan savollarga bemor bergan javoblar
      addColumn(db, 'requests', 'extra_answers', 'TEXT');

      /*
       * Boshlang'ich qiymat — hozir kodda qanday bo'lsa shundoq.
       * Matn maydonlari bo'sh: bo'sh bo'lsa ilova o'zining tarjima
       * fayllaridagi matnni ishlatadi. Admin yozsagina ustun keladi.
       * Shu sababli tilga bog'liq matn ikki joyda takrorlanmaydi.
       */
      const seed = db.prepare(
        `INSERT OR IGNORE INTO request_steps (key, kind, position, enabled, required, locked)
         VALUES (?, 'builtin', ?, 1, ?, ?)`,
      );
      const BUILTIN: [string, number, number][] = [
        // kalit, majburiymi, qulflanganmi
        ['who', 0, 0],
        ['operation', 1, 1],
        ['condition', 1, 1],
        ['documents', 0, 0],
        ['region', 1, 1],
        ['budget', 0, 0],
        ['date', 0, 0],
        ['note', 0, 0],
        ['review', 1, 1],
      ];
      BUILTIN.forEach(([key, required, locked], i) => seed.run(key, i * 10, required, locked));
    },
  },
  {
    /**
     * To'lov bosqichi: bemor to'ladi → klinika olganini tasdiqlaydi.
     *
     * Ilgari oqim `PERFORMED` dan to'g'ridan-to'g'ri `CONFIRMED` ga
     * o'tardi: bemor qancha to'laganini aytishi bilan bitim yopilib,
     * komissiya hisoblanardi. Klinika pulni HAQIQATAN olganini hech
     * kim tasdiqlamasdi — ya'ni klinikaga faqat bemorning gapiga
     * asoslanib komissiya yozilardi.
     *
     * Endi oraliqda `PAID` turadi:
     *   PERFORMED -> bemor to'lovni bildiradi -> PAID
     *   PAID      -> klinika olganini tasdiqlaydi -> CONFIRMED
     *
     * Summani BEMOR aytadi, klinika esa faqat "oldim" deydi. Sabab
     * rag'bat: summa komissiya bazasi, shuning uchun klinikaga uni
     * pasaytirish foydali bo'lardi; bemorda esa oshirishga sabab yo'q.
     * Rozi bo'lmasa klinika nizo ochadi.
     *
     * SQLite CHECK cheklovini o'zgartirishga ruxsat bermaydi —
     * jadval qayta quriladi (009 dagi kabi).
     */
    id: '019_deal_payment_step',
    up: (db) => {
      const current = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'deals'`)
        .get() as { sql: string } | undefined;

      // Allaqachon qo'llangan bo'lsa qayta qurmaymiz
      if (!current || current.sql.includes("'PAID'")) return;

      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE deals_new (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id           INTEGER NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
          offer_id             INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
          patient_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          clinic_id            INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
          agreed_price_uzs     INTEGER NOT NULL,
          scheduled_at         TEXT,
          status               TEXT NOT NULL DEFAULT 'SELECTED'
                               CHECK (status IN ('SELECTED','AGREED','PERFORMED','PAID','CONFIRMED','CANCELLED','DISPUTED')),
          confirmed_amount_uzs INTEGER,
          commission_uzs       INTEGER,
          commission_percent   REAL,
          confirmed_at         TEXT,
          performed_at         TEXT,
          confirm_prompted_at  TEXT,
          dispute_reason       TEXT,
          created_at           TEXT NOT NULL DEFAULT (datetime('now')),
          auto_confirmed       INTEGER NOT NULL DEFAULT 0,
          paid_at              TEXT,
          payment_method       TEXT CHECK (payment_method IS NULL OR payment_method IN ('cash','card','transfer')),
          receipt_confirmed_at TEXT
        );

        INSERT INTO deals_new
          (id, request_id, offer_id, patient_id, clinic_id, agreed_price_uzs, scheduled_at, status,
           confirmed_amount_uzs, commission_uzs, commission_percent, confirmed_at, performed_at,
           confirm_prompted_at, dispute_reason, created_at, auto_confirmed)
        SELECT
           id, request_id, offer_id, patient_id, clinic_id, agreed_price_uzs, scheduled_at, status,
           confirmed_amount_uzs, commission_uzs, commission_percent, confirmed_at, performed_at,
           confirm_prompted_at, dispute_reason, created_at, auto_confirmed
        FROM deals;

        DROP TABLE deals;
        ALTER TABLE deals_new RENAME TO deals;

        CREATE INDEX IF NOT EXISTS idx_deals_patient ON deals(patient_id, status);
        CREATE INDEX IF NOT EXISTS idx_deals_clinic  ON deals(clinic_id, status);
      `);
      db.pragma('foreign_keys = ON');

      /*
       * Yopilgan bitimlarda to'lov vaqti noma'lum — tasdiqlangan paytni
       * qo'yamiz, aks holda eski bitimlarda bosqich bo'sh ko'rinardi.
       */
      db.exec(`UPDATE deals SET paid_at = confirmed_at, receipt_confirmed_at = confirmed_at
                WHERE status = 'CONFIRMED' AND confirmed_at IS NOT NULL`);
    },
  },
  {
    /**
     * Komissiya to'lovi ham ikki qadam: klinika topshiradi, admin tasdiqlaydi.
     *
     * Ilgari klinika o'zi to'lov yozar va u SHU ZAHOTI "to'langan" deb
     * hisoblanardi — qarz kamayardi, hech kim tekshirmasdi. Ya'ni
     * klinika istalgan summani yozib qarzini nolga tushira olardi.
     *
     * Endi:
     *   klinika topshiradi -> `declared` (qarz KAMAYMAYDI)
     *   admin tasdiqlaydi  -> `confirmed` (qarz kamayadi)
     *   admin rad etadi    -> `rejected` (izoh bilan)
     *
     * Mavjud yozuvlar `confirmed` bo'ladi: ular allaqachon to'langan
     * deb hisoblangan, ularni endi qarzga qaytarish noto'g'ri bo'lardi.
     *
     * SQLite CHECK qo'shishga ruxsat bermaydi — jadval qayta quriladi.
     */
    id: '020_commission_payment_review',
    up: (db) => {
      const current = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'commission_payments'`)
        .get() as { sql: string } | undefined;
      if (!current || current.sql.includes("'declared'")) return;

      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE commission_payments_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          clinic_id    INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
          amount_uzs   INTEGER NOT NULL CHECK (amount_uzs > 0),
          method       TEXT NOT NULL DEFAULT 'manual',
          reference    TEXT,
          period       TEXT,
          status       TEXT NOT NULL DEFAULT 'declared'
                       CHECK (status IN ('declared','confirmed','rejected')),
          /*
           * ON DELETE SET NULL: bu audit maydoni, u foydalanuvchini
           * o'chirishni TO'SMASLIGI kerak. Oddiy FK bo'lsa, bir marta
           * to'lov tasdiqlagan admin hisobini keyin o'chirib bo'lmasdi.
           */
          reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
          reviewed_at  TEXT,
          review_note  TEXT,
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO commission_payments_new
          (id, clinic_id, amount_uzs, method, reference, period, status, reviewed_at, created_at)
        SELECT
           id, clinic_id, amount_uzs, method, reference, period, 'confirmed', created_at, created_at
        FROM commission_payments;

        DROP TABLE commission_payments;
        ALTER TABLE commission_payments_new RENAME TO commission_payments;

        CREATE INDEX IF NOT EXISTS idx_commission_payments_clinic
          ON commission_payments(clinic_id);
        CREATE INDEX IF NOT EXISTS idx_commission_payments_status
          ON commission_payments(status, created_at);
      `);
      db.pragma('foreign_keys = ON');
    },
  },
  {
    /**
     * Noma'lum operatsiya uchun SOHA zaxirasi.
     *
     * Muammo: bemor shikoyatini yozadi, AI aniq operatsiyani
     * aniqlay olmaydi va so'rov "noma'lum" bilan ketadi. Shundan
     * keyin `findMatchingClinics` operatsiya filtrini BUTUNLAY
     * o'chirar va so'rov shahardagi HAMMA tasdiqlangan klinikaga
     * borardi — ko'z muammosi stomatologiyaga ham.
     *
     * Bu ikki tomonga ham zarar: klinika o'zi qila olmaydigan
     * so'rovlarni ko'raverib oqimni o'qishni tashlaydi, bemor esa
     * mos bo'lmagan takliflar oladi yoki umuman javob olmaydi.
     *
     * Aslida AI deyarli har doim SOHANI biladi ("bu ko'z bilan
     * bog'liq"), faqat aniq operatsiyani ayta olmaydi. O'sha bilim
     * shu ustunda saqlanadi va so'rov shu soha klinikalariga
     * yo'naltiriladi.
     */
    id: '021_request_fallback_category',
    up: (db) => {
      addColumn(db, 'requests', 'fallback_category_id', 'INTEGER REFERENCES operation_categories(id)');
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_requests_fallback_category
           ON requests(fallback_category_id)`,
      );
    },
  },
  {
    /**
     * Noma'lum operatsiyani KLINIKA aniqlaydi — taklif yuborayotganda.
     *
     * Muammo pulda edi. Narx statistikasi `requests.operation_id`
     * bo'yicha yig'iladi. So'rov "noma'lum" bo'lib qolsa, bitim
     * tasdiqlangan summasi bilan birga hech qaysi operatsiyaga
     * yozilmasdi — ya'ni platforma "bu operatsiya qanchaga ketdi"
     * degan savolga javob bera olmasdi. Aynan shu savol uchun
     * statistika bor.
     *
     * Kim aniqlashi kerak: klinika. U bemorning tavsifini o'qidi va
     * nima qilishini biladi.
     *
     * Nima uchun taklifda, so'rovda emas: bir necha klinika har xil
     * operatsiya taklif qilishi mumkin. Qaysi biri to'g'ri ekanini
     * BEMOR tanlovi hal qiladi — shuning uchun so'rov faqat taklif
     * tanlanganda yangilanadi.
     */
    id: '022_offer_resolved_operation',
    up: (db) => {
      addColumn(db, 'offers', 'resolved_operation_id', 'INTEGER REFERENCES operations(id)');
    },
  },
  {
    /**
     * AI kalitlari — bir nechta, zaxira bilan.
     *
     * Prodda ko'rilgan holat: Gemini 503 "high demand" qaytardi va
     * butun AI heuristikaga tushdi. O'sha paytdagi so'rovlar
     * operatsiyasiz va sohasiz ketdi — ya'ni bitta provayderning
     * vaqtinchalik yuklamasi mahsulotning asosiy qismini o'chirardi.
     *
     * Endi kalitlar ro'yxati bor: biri ishlamasa keyingisiga
     * o'tiladi. Admin ularni panelidan qo'shadi — yangi kalit uchun
     * deploy kerak emas.
     *
     * Kalitning O'ZI hech qachon mijozga qaytarilmaydi; panelda
     * faqat niqoblangan ko'rinishi ko'rsatiladi.
     */
    id: '023_ai_keys',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_keys (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          provider    TEXT    NOT NULL CHECK (provider IN ('gemini','anthropic')),
          api_key     TEXT    NOT NULL,
          label       TEXT,
          active      INTEGER NOT NULL DEFAULT 1,
          /* Tartib: kichik raqam oldin sinaladi */
          position    INTEGER NOT NULL DEFAULT 0,
          /* Oxirgi xato — admin qaysi kalit ishlamayotganini ko'rishi uchun */
          last_error  TEXT,
          last_error_at TEXT,
          last_ok_at  TEXT,
          created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ai_keys_order ON ai_keys(provider, active, position);
      `);
    },
  },
  {
    /**
     * Sessiya foydalanilganda uzayadi.
     *
     * Muammo: Telegram orqali kirgan klinika sessiyasi 12 soat edi va
     * u faoliyatdan QAT'I NAZAR o'lardi. Ya'ni kun bo'yi ishlab
     * turgan klinika ham kuniga ikki marta chiqib ketardi — bu
     * to'g'ridan-to'g'ri kechikkan takliflar degani.
     *
     * Muddatni shunchaki uzaytirish yechim emas: tashlab ketilgan
     * sessiya ham o'sha muddat yashardi. To'g'risi — muddatni
     * BEKORCHILIK vaqti deb hisoblash: har foydalanishda oldinga
     * suriladi, ishlatilmasa o'ladi.
     *
     * `ttl_hours` sessiya bilan birga saqlanadi, chunki parol bilan
     * kirgan (7 kun) va Telegram orqali kirgan (12 soat) sessiyalar
     * bir xil emas.
     */
    id: '024_session_sliding_expiry',
    up: (db) => {
      addColumn(db, 'admin_sessions', 'ttl_hours', 'INTEGER NOT NULL DEFAULT 168');
      /* Mavjud Telegram sessiyalari qisqa muddatli — ular tabiiy tugaydi */
    },
  },
  {
    /**
     * Telegramdan kelgan to'liq ismni ajratish.
     *
     * Ko'p odam Telegram profilida butun ismini `first_name` ga yozadi
     * va `last_name` ni to'ldirmaydi. Ro'yxatdan o'tish ekranida
     * "Aziz Karimov" BITTA maydonga tushar, familiya bo'sh qolardi —
     * forma esa familiyani majburiy so'raydi.
     *
     * Ikki chegara bor va ikkalasi ham muhim:
     *
     *   `telegram_id > 0` — veb hisoblar (klinika, admin) manfiy
     *   identifikator bilan saqlanadi va ularning "ismi" aslida
     *   tashkilot nomi ("Real Medikal"). Uni ajratish xato bo'lardi.
     *
     *   `profile_completed_at IS NULL` — odam profilini allaqachon
     *   to'ldirgan bo'lsa, ismi uning O'Z tanlovi. Unga tegilmaydi.
     */
    id: '025_split_telegram_name',
    up: (db) => {
      const rows = db
        .prepare(
          `SELECT id, first_name FROM users
            WHERE telegram_id > 0
              AND profile_completed_at IS NULL
              AND (last_name IS NULL OR last_name = '')
              AND first_name LIKE '% %'`,
        )
        .all() as { id: number; first_name: string }[];

      const upd = db.prepare(`UPDATE users SET first_name = ?, last_name = ? WHERE id = ?`);
      for (const r of rows) {
        const parts = r.first_name.trim().split(/\s+/).filter(Boolean);
        if (parts.length < 2) continue;
        upd.run(parts.slice(0, -1).join(' '), parts[parts.length - 1], r.id);
      }
    },
  },
  {
    /**
     * To'lov operatsiyadan OLDIN — `PERFORMED` bosqichi olib tashlandi.
     *
     * Yangi oqim: Tanlandi -> Kelishildi -> To'landi -> Bajarildi.
     * Klinika oxirida bir marta tasdiqlaydi: pul ham olindi, operatsiya
     * ham bajarildi.
     *
     * Eski oqimda qolib ketgan bitimlar `PERFORMED` holatida turadi.
     * Ular `AGREED` ga qaytariladi: operatsiya bajarilgan, lekin to'lov
     * hali bildirilmagan — yangi oqimda aynan shu bosqich to'lovni
     * kutadi. Bekor qilinmaydi va yopilmaydi: birinchisi bajarilgan
     * ishni yo'q qilardi, ikkinchisi hech kim bildirmagan to'lovga
     * komissiya yozardi.
     *
     * `CHECK` ro'yxatiga tegilmaydi — u `PERFORMED` ni hali ham qabul
     * qiladi, lekin endi hech kim yozmaydi. Jadvalni faqat shuning
     * uchun qayta qurish arzimaydi.
     */
    id: '026_payment_before_operation',
    up: (db) => {
      db.prepare(`UPDATE deals SET status = 'AGREED' WHERE status = 'PERFORMED'`).run();
    },
  },
  {
    /**
     * Sessiya QAYSI ESHIKDAN ochilganini eslab qoladi.
     *
     * Ilgari eshik faqat kirish paytida tekshirilardi va faqat mijoz
     * o'zi aytsa. Ya'ni bu himoya emas, kelishuv edi: kimdir
     * `/api/web/login` ga `scope` siz so'rov yuborsa, administrator
     * sessiyasi bemalol ochilardi. Sessiyaning o'zida esa u qaysi
     * eshikdan kelgani haqida hech qanday belgi yo'q edi — demak
     * keyingi har bir so'rovda ham tekshirib bo'lmasdi.
     *
     * Endi eshik sessiyaga YOZILADI va har so'rovda majburlanadi:
     * admin bo'limiga faqat admin eshigidan ochilgan sessiya kiradi.
     *
     * Mavjud sessiyalar hisob darajasidan kelib chiqib to'ldiriladi —
     * hech kim kirishdan chiqarib yuborilmaydi.
     */
    id: '027_session_scope',
    up: (db) => {
      const cols = db.prepare(`PRAGMA table_info(admin_sessions)`).all() as { name: string }[];
      if (cols.some((c) => c.name === 'scope')) return;

      db.exec(`ALTER TABLE admin_sessions ADD COLUMN scope TEXT`);
      db.exec(`
        UPDATE admin_sessions
           SET scope = (
             SELECT CASE WHEN u.level = 'full' THEN 'admin' ELSE 'clinic' END
               FROM admin_users u WHERE u.id = admin_sessions.admin_id
           )
         WHERE scope IS NULL
      `);
    },
  },
  {
    /**
     * Sana bitimdan OLDIN — `SELECTED` bosqichi olib tashlandi.
     *
     * Yangi oqim: Kelishildi -> To'landi -> Bajarildi. Bemor
     * taklifni tanlaganda klinika taklif qilgan kunlardan birini
     * ham belgilaydi, ya'ni bitim boshidanoq kelishilgan sana bilan
     * ochiladi va alohida "Sana belgilash" bosqichi kerak emas.
     *
     * Eski oqimda `SELECTED` da qolgan bitimlar `AGREED` ga
     * o'tkaziladi. Ularda sana yo'q va shunday qoladi: uni o'ylab
     * topib qo'yish noto'g'ri bo'lardi, taraflar chatda kelishadi.
     *
     * Ular yo'qolib qolmasligi MUHIM: taxta ustunlari ro'yxatida
     * `SELECTED` endi yo'q va ko'chirilmagan bitim hech qaysi
     * ustunga tushmasdi.
     */
    id: '028_no_selected_step',
    up: (db) => {
      db.prepare(`UPDATE deals SET status = 'AGREED' WHERE status = 'SELECTED'`).run();
    },
  },
  {
    /**
     * TAHLIL SO'ROVI — platformaning ikkinchi turi.
     *
     * Ilgari har so'rov operatsiya edi: `requests.operation_id` majburiy
     * bo'lib, butun oqim shunga qurilgandi. Tahlil (MRT, UZI, qon
     * tahlili) esa boshqa savol talab qiladi — operatsiya nomi emas,
     * QAYSI ORGAN tekshirilishi va bemorning vazni.
     *
     * Shuning uchun:
     *   • so'rov TURGA ega bo'ldi (`kind`);
     *   • `operation_id` endi bo'sh bo'lishi mumkin — tahlilda u yo'q;
     *   • organ katalogi va klinikaning organ bo'yicha aktivatsiyasi
     *     qo'shildi (operatsiyalardagi `clinic_operations` kabi).
     *
     * SQLite ustundan NOT NULL ni olib tashlay olmaydi, shuning uchun
     * `requests` jadvali qayta quriladi. Ma'lumot to'liq ko'chiriladi
     * va mavjud so'rovlar `operation` turini oladi.
     */
    id: '029_lab_requests',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS lab_organs (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          slug     TEXT NOT NULL UNIQUE,
          name_uz  TEXT NOT NULL,
          name_ru  TEXT NOT NULL,
          icon     TEXT NOT NULL DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0,
          active   INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS clinic_lab_organs (
          clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
          organ_id  INTEGER NOT NULL REFERENCES lab_organs(id) ON DELETE CASCADE,
          PRIMARY KEY (clinic_id, organ_id)
        );
      `);

      const organ = db.prepare(
        `INSERT OR IGNORE INTO lab_organs (slug, name_uz, name_ru, icon, position)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const ORGANS: [string, string, string, string][] = [
        ['brain', 'Bosh miya', 'Головной мозг', '🧠'],
        ['heart', 'Yurak va tomirlar', 'Сердце и сосуды', '🫀'],
        ['lungs', 'O‘pka va nafas yo‘llari', 'Лёгкие и дыхательные пути', '🫁'],
        ['liver', 'Jigar va o‘t yo‘llari', 'Печень и желчные пути', '🩸'],
        ['kidney', 'Buyrak va siydik yo‘llari', 'Почки и мочевые пути', '🧫'],
        ['stomach', 'Oshqozon va ichak', 'Желудок и кишечник', '🍽'],
        ['spine', 'Umurtqa va bo‘g‘imlar', 'Позвоночник и суставы', '🦴'],
        ['thyroid', 'Qalqonsimon bez va gormonlar', 'Щитовидная железа и гормоны', '⚗️'],
        ['blood', 'Umumiy qon tahlili', 'Общий анализ крови', '💉'],
        ['reproductive', 'Reproduktiv tizim', 'Репродуктивная система', '🌡'],
        ['eye', 'Ko‘z', 'Глаза', '👁'],
        ['other', 'Boshqa', 'Другое', '🔬'],
      ];
      ORGANS.forEach(([slug, uz, ru, icon], i) => organ.run(slug, uz, ru, icon, i * 10));

      addColumn(db, 'users', 'weight_kg', 'INTEGER');

      // ── `requests` qayta quriladi: `operation_id` endi ixtiyoriy ──
      const cols = db.prepare(`PRAGMA table_info(requests)`).all() as { name: string }[];
      if (!cols.some((c) => c.name === 'kind')) {
        const names = cols.map((c) => c.name).join(', ');
        db.exec(`
          CREATE TABLE requests_new (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind           TEXT NOT NULL DEFAULT 'operation'
                           CHECK (kind IN ('operation','lab')),
            operation_id   INTEGER REFERENCES operations(id),
            lab_organ_id   INTEGER REFERENCES lab_organs(id),
            weight_kg      INTEGER,
            city_id        INTEGER NOT NULL REFERENCES cities(id),
            budget_uzs     INTEGER,
            note           TEXT,
            urgency        TEXT NOT NULL DEFAULT 'normal'
                           CHECK (urgency IN ('normal','soon','urgent')),
            attachments    TEXT NOT NULL DEFAULT '[]',
            status         TEXT NOT NULL DEFAULT 'NEW'
                           CHECK (status IN ('NEW','COLLECTING','CHOSEN','COMPLETED','CANCELLED')),
            ai_suggested   INTEGER NOT NULL DEFAULT 0,
            expires_at     TEXT NOT NULL,
            chosen_offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
            expiring_notified INTEGER NOT NULL DEFAULT 0,
            condition_text TEXT,
            other_regions_ok INTEGER NOT NULL DEFAULT 0,
            date_from      TEXT,
            date_to        TEXT,
            date_flexible  INTEGER NOT NULL DEFAULT 0,
            ai_conversation TEXT,
            fallback_category_id INTEGER REFERENCES operation_categories(id),
            extra_answers  TEXT,
            for_self       INTEGER NOT NULL DEFAULT 1,
            subject_name   TEXT,
            subject_birth_year INTEGER,
            subject_gender TEXT,
            terms_version  TEXT,
            terms_accepted_at TEXT,
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
          );

          INSERT INTO requests_new (${names}) SELECT ${names} FROM requests;

          DROP TABLE requests;
          ALTER TABLE requests_new RENAME TO requests;

          CREATE INDEX IF NOT EXISTS idx_requests_patient ON requests(patient_id, status);
          CREATE INDEX IF NOT EXISTS idx_requests_match   ON requests(operation_id, city_id, status);
          CREATE INDEX IF NOT EXISTS idx_requests_lab     ON requests(lab_organ_id, city_id, status);
        `);
      }

      // ── Yangi bosqichlar ──
      const step = db.prepare(
        `INSERT OR IGNORE INTO request_steps (key, kind, position, enabled, required, locked)
         VALUES (?, 'builtin', ?, 1, ?, ?)`,
      );
      step.run('type', 5, 1, 1);
      step.run('weight', 12, 1, 0);
      step.run('organ', 14, 1, 1);
    },
  },
];

/**
 * "Bilmayman — klinika aytadi" katalog yozuvini ta'minlaydi.
 *
 * Migratsiya va seed ikkalasi ham chaqiradi: yangi bazada migratsiya
 * kategoriyalardan OLDIN ishlaydi, shuning uchun bir joyda kafolat yetmaydi.
 */
export function ensureUnknownOperation(db: Database): boolean {
  const exists = db.prepare(`SELECT id FROM operations WHERE slug = 'unknown'`).get();
  if (exists) return false;

  const category = db
    .prepare(`SELECT id FROM operation_categories ORDER BY id LIMIT 1`)
    .get() as { id: number } | undefined;
  if (!category) return false;

  db.prepare(
    `INSERT INTO operations (category_id, slug, name_uz, name_ru, alias_uz, alias_ru,
                             desc_uz, desc_ru, keywords, active)
     VALUES (?, 'unknown', ?, ?, ?, ?, ?, ?, '[]', 0)`,
  ).run(
    category.id,
    'Bilmayman — klinika aytadi',
    'Не знаю — пусть скажет клиника',
    'Operatsiya turini klinika aniqlaydi',
    'Тип операции определит клиника',
    'Bemor operatsiya nomini bilmaydi; klinika holatga qarab aniqlaydi.',
    'Пациент не знает название операции; клиника определит по состоянию.',
  );
  return true;
}

export function runMigrations(db: Database): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  const done = new Set(
    (db.prepare(`SELECT key FROM meta WHERE key LIKE 'migration:%'`).all() as { key: string }[]).map(
      (r) => r.key.slice('migration:'.length),
    ),
  );

  const applied: string[] = [];
  const mark = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, datetime('now'))`);

  /*
   * Migratsiya davomida tashqi kalitlar O'CHIRILADI.
   *
   * SQLite ustunni o'zgartira olmaydi — jadvalni qayta qurish kerak:
   * yangisini yasa, ma'lumotni ko'chir, eskisini DROP qil, nomini
   * o'zgartir. Ammo `DROP TABLE` tashqi kalit kaskadini ishga
   * tushiradi va bog'liq jadvallar JIMGINA tozalanib ketadi.
   *
   * Aynan shu sodir bo'ldi: `requests` qayta qurilganda unga
   * bog'langan takliflar, bitimlar, chat va sharhlar o'chib ketdi.
   * Ma'lumot ko'chirilgan bo'lsa ham, kaskad undan oldin ishlagan.
   *
   * SQLite hujjatlarida ham shunday deyilgan: jadval qayta
   * qurishdan OLDIN `foreign_keys` o'chiriladi. Pragma tranzaksiya
   * ichida ishlamaydi, shuning uchun u tashqarida turadi.
   *
   * Oxirida `foreign_key_check` yuritiladi: migratsiya bog'lanishni
   * buzgan bo'lsa, buni jimgina o'tkazib yubormaymiz.
   */
  const fkWasOn = Boolean((db.pragma('foreign_keys', { simple: true }) as unknown as number));
  db.pragma('foreign_keys = OFF');

  try {
    for (const migration of MIGRATIONS) {
      if (done.has(migration.id)) continue;
      db.transaction(() => {
        migration.up(db);
        mark.run(`migration:${migration.id}`);
      })();
      applied.push(migration.id);
    }

    if (applied.length) {
      const broken = db.pragma('foreign_key_check') as unknown[];
      if (broken.length) {
        console.error(
          `[db] DIQQAT: migratsiyadan keyin ${broken.length} ta buzilgan bog‘lanish topildi`,
          broken.slice(0, 5),
        );
      }
    }
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON');
  }

  return applied;
}
