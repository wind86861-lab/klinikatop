-- Shifo — ma'lumotlar bazasi sxemasi (SQLite)
-- Har bir jadval funksional spetsifikatsiyadagi bo'limga mos keladi.

PRAGMA foreign_keys = ON;

/* ── 1. Foydalanuvchi va rollar ────────────────────────────────── */

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id   INTEGER NOT NULL UNIQUE,
  username      TEXT,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT,
  photo_url     TEXT,
  lang          TEXT NOT NULL DEFAULT 'uz' CHECK (lang IN ('uz','ru')),
  -- Bitta foydalanuvchi bir vaqtda bemor ham, klinika operatori ham bo'la oladi
  roles         TEXT NOT NULL DEFAULT '["patient"]',
  clinic_id     INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
  onboarded_at  TEXT,
  bonus_points  INTEGER NOT NULL DEFAULT 0,
  blocked_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

/* ── 2. Ma'lumotnomalar ────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS cities (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  slug     TEXT NOT NULL UNIQUE,
  name_uz  TEXT NOT NULL,
  name_ru  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operation_categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  slug     TEXT NOT NULL UNIQUE,
  name_uz  TEXT NOT NULL,
  name_ru  TEXT NOT NULL,
  icon     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS operations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES operation_categories(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL UNIQUE,
  name_uz      TEXT NOT NULL,
  name_ru      TEXT NOT NULL,
  -- Xalq tilidagi nom: bemor "o't pufagida tosh" deydi, tibbiy atamani bilmaydi
  alias_uz     TEXT NOT NULL DEFAULT '',
  alias_ru     TEXT NOT NULL DEFAULT '',
  desc_uz      TEXT NOT NULL DEFAULT '',
  desc_ru      TEXT NOT NULL DEFAULT '',
  keywords     TEXT NOT NULL DEFAULT '[]',
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_operations_category ON operations(category_id);

/* ── 3. Klinika ────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS clinics (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT NOT NULL,
  city_id               INTEGER NOT NULL REFERENCES cities(id),
  address               TEXT NOT NULL DEFAULT '',
  about                 TEXT NOT NULL DEFAULT '',
  logo_url              TEXT,
  -- Verifikatsiyasiz klinika taklif yubora olmaydi (12.1)
  verification          TEXT NOT NULL DEFAULT 'pending' CHECK (verification IN ('pending','approved','rejected')),
  verification_note     TEXT,
  license_file_id       TEXT,
  plan                  TEXT CHECK (plan IN ('basic','pro')),
  subscription_status   TEXT NOT NULL DEFAULT 'none' CHECK (subscription_status IN ('active','suspended','expired','none')),
  subscription_until    TEXT,
  rating_avg            REAL NOT NULL DEFAULT 0,
  rating_count          INTEGER NOT NULL DEFAULT 0,
  deals_count           INTEGER NOT NULL DEFAULT 0,
  response_minutes_sum  INTEGER NOT NULL DEFAULT 0,
  response_samples      INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Matching sharti: klinika shu operatsiyani qilishini belgilagan bo'lishi kerak (6.1)
CREATE TABLE IF NOT EXISTS clinic_operations (
  clinic_id    INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  operation_id INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  PRIMARY KEY (clinic_id, operation_id)
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id   INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  plan        TEXT NOT NULL CHECK (plan IN ('basic','pro')),
  amount_uzs  INTEGER NOT NULL,
  period_from TEXT NOT NULL,
  period_to   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

/* ── 4. So'rov (request) ───────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id   INTEGER NOT NULL REFERENCES operations(id),
  city_id        INTEGER NOT NULL REFERENCES cities(id),
  budget_uzs     INTEGER,                 -- NULL = "klinika narx bersin"
  note           TEXT,
  urgency        TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','soon','urgent')),
  attachments    TEXT NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'NEW'
                 CHECK (status IN ('NEW','COLLECTING','CHOSEN','COMPLETED','CANCELLED')),
  ai_suggested   INTEGER NOT NULL DEFAULT 0,
  expires_at     TEXT NOT NULL,
  chosen_offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
  expiring_notified INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_requests_patient ON requests(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_match   ON requests(operation_id, city_id, status);

-- So'rov qaysi klinikalarga bordi va kim ko'rdi (radar / statistika uchun)
CREATE TABLE IF NOT EXISTS request_broadcasts (
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  clinic_id  INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  viewed_at  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (request_id, clinic_id)
);

/* ── 5. Taklif (offer) ─────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS offers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id     INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  price_uzs      INTEGER NOT NULL,
  includes       TEXT NOT NULL DEFAULT '[]',   -- shaffoflik: narxga nima kiradi
  advantages     TEXT NOT NULL DEFAULT '[]',
  lead_time_days INTEGER NOT NULL DEFAULT 7,
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'SENT'
                 CHECK (status IN ('SENT','CHOSEN','REJECTED','EXPIRED','WITHDRAWN')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5.2: bir klinika bir so'rovga faqat bitta faol taklif bera oladi
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_active
  ON offers(request_id, clinic_id)
  WHERE status IN ('SENT','CHOSEN');

CREATE INDEX IF NOT EXISTS idx_offers_request ON offers(request_id, status);
CREATE INDEX IF NOT EXISTS idx_offers_clinic  ON offers(clinic_id, status);

/* ── 6. Bitim (deal) ───────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS deals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id           INTEGER NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
  offer_id             INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  patient_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id            INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  agreed_price_uzs     INTEGER NOT NULL,
  scheduled_at         TEXT,
  status               TEXT NOT NULL DEFAULT 'SELECTED'
                       CHECK (status IN ('SELECTED','AGREED','PERFORMED','CONFIRMED','CANCELLED','DISPUTED')),
  confirmed_amount_uzs INTEGER,
  commission_uzs       INTEGER,
  commission_percent   REAL,
  confirmed_at         TEXT,
  performed_at         TEXT,
  confirm_prompted_at  TEXT,
  dispute_reason       TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deals_patient ON deals(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_clinic  ON deals(clinic_id, status);

/* ── 7. Chat ───────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id     INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('patient','clinic','system')),
  body        TEXT NOT NULL DEFAULT '',
  attachment  TEXT,
  kind        TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','file','system')),
  redacted    INTEGER NOT NULL DEFAULT 0,   -- bypass himoyasi: raqam/havola tozalandi
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_deal ON messages(deal_id, id);

/* ── 8. Sharh va reyting ───────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 10.1: bir bitimga bir sharh, faqat TASDIQLANGAN bitimdan
  deal_id       INTEGER NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
  clinic_id     INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quality       INTEGER NOT NULL CHECK (quality BETWEEN 1 AND 5),
  attitude      INTEGER NOT NULL CHECK (attitude BETWEEN 1 AND 5),
  cleanliness   INTEGER NOT NULL CHECK (cleanliness BETWEEN 1 AND 5),
  result        INTEGER NOT NULL CHECK (result BETWEEN 1 AND 5),
  average       REAL NOT NULL,
  body          TEXT,
  flagged       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_clinic ON reviews(clinic_id);

/* ── 9. Bildirishnoma ──────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title_key  TEXT NOT NULL,
  params     TEXT NOT NULL DEFAULT '{}',
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

/* ── 10. Narx statistikasi — cold start (4.3) ──────────────────── */

-- Qo'lda kiritilgan bozor narxlari. Real bitimlar bilan ARALASHMAYDI —
-- foydalanuvchiga qaysi manba ekani ko'rsatiladi.
CREATE TABLE IF NOT EXISTS manual_prices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  city_id      INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  min_uzs      INTEGER NOT NULL,
  p25_uzs      INTEGER NOT NULL,
  median_uzs   INTEGER NOT NULL,
  p75_uzs      INTEGER NOT NULL,
  max_uzs      INTEGER NOT NULL,
  note         TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (operation_id, city_id)
);

/* ── 11. Moderatsiya jurnali ───────────────────────────────────── */

CREATE TABLE IF NOT EXISTS moderation_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity       TEXT NOT NULL,       -- clinic | deal | review | user
  entity_id    INTEGER NOT NULL,
  action       TEXT NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
