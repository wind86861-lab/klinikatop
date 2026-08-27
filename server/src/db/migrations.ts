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

  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    db.transaction(() => {
      migration.up(db);
      mark.run(`migration:${migration.id}`);
    })();
    applied.push(migration.id);
  }

  return applied;
}
