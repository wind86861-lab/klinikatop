#!/usr/bin/env bash
#
# banisa.uz katalogiga FAQAT O'QISH uchun ulanish tayyorlaydi.
#
# Asosiy qoida: KlinikaTop banisa bazasiga yozish imkoniga EGA
# BO'LMASLIGI kerak. Buni kod intizomi bilan emas — bazaning o'zi bilan
# ta'minlaymiz. Kodda xato bo'lsa ham qo'shni mahsulotga zarar yetmaydi.
#
# Rol quyidagilarga ega:
#   • faqat SELECT, faqat IKKI jadvalga (ServiceCategory, SurgicalService)
#   • boshqa hamma jadval ko'rinmaydi
#   • jadval yaratish, rol yaratish, superuser huquqi yo'q
#   • ulanish soni cheklangan — sinxronizatsiya bazani band qilmaydi
#   • kelajakda qo'shiladigan jadvallarga huquq AVTOMATIK berilmaydi
#
#   bash deploy/setup-catalog-source.sh
set -euo pipefail

ROLE=klinikatop_readonly
ENV_FILE=/etc/klinikatop.env

DB=$(sudo -u postgres psql -tAc \
  "SELECT datname FROM pg_database WHERE datistemplate = false AND datname <> 'postgres'" | head -1)

if [ -z "$DB" ]; then
  echo "banisa bazasi topilmadi" >&2
  exit 1
fi

echo "▸ Baza: $DB"

# Parol har safar yangidan yasaladi: eski parol biror joyda qolgan
# bo'lsa ham ishlamay qoladi.
PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$ROLE') THEN
    CREATE ROLE $ROLE LOGIN;
  END IF;
END
\$\$;

ALTER ROLE $ROLE
  WITH PASSWORD '$PASSWORD'
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION
       CONNECTION LIMIT 3;

-- Avval hamma narsani tortib olamiz, keyin faqat kerakligini beramiz.
-- Shunda skript qayta yurgizilganda ortiqcha huquq qolib ketmaydi.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM $ROLE;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM $ROLE;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM $ROLE;
REVOKE ALL ON SCHEMA public FROM $ROLE;
REVOKE ALL ON DATABASE $DB FROM $ROLE;

GRANT CONNECT ON DATABASE $DB TO $ROLE;
GRANT USAGE ON SCHEMA public TO $ROLE;

-- Aynan shu ikki jadval. Boshqasi yo'q.
GRANT SELECT ON TABLE "ServiceCategory" TO $ROLE;
GRANT SELECT ON TABLE "SurgicalService" TO $ROLE;

-- Kelajakda qo'shiladigan jadvallarga huquq o'z-o'zidan berilmasin
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM $ROLE;
SQL

echo "▸ Huquqlar tekshirilmoqda"
sudo -u postgres psql -tAd "$DB" -c "
SELECT table_name || ': ' || string_agg(privilege_type, ',')
  FROM information_schema.table_privileges
 WHERE grantee = '$ROLE'
 GROUP BY table_name
 ORDER BY table_name"

# Ulanish satri env faylga yoziladi. Fayl 600 rejimida — uni faqat root
# o'qiy oladi, xizmat esa systemd orqali oladi.
URL="postgresql://$ROLE:$PASSWORD@127.0.0.1:5432/$DB"

if grep -q '^CATALOG_SOURCE_URL=' "$ENV_FILE" 2>/dev/null; then
  sed -i "s#^CATALOG_SOURCE_URL=.*#CATALOG_SOURCE_URL=$URL#" "$ENV_FILE"
else
  printf '\n# banisa.uz katalogi — faqat o‘qish uchun rol\nCATALOG_SOURCE_URL=%s\n' "$URL" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

echo "▸ Yozish taqiqlanganini tekshiramiz"
if PGPASSWORD="$PASSWORD" psql -h 127.0.0.1 -U "$ROLE" -d "$DB" -c \
     'DELETE FROM "SurgicalService" WHERE false' >/dev/null 2>&1; then
  echo "  ✗ XAVF: rol yoza oladi — to'xtatilmoqda" >&2
  exit 1
fi
echo "  ✓ yozish rad etildi"

echo "▸ O'qish ishlashini tekshiramiz"
PGPASSWORD="$PASSWORD" psql -h 127.0.0.1 -U "$ROLE" -tAd "$DB" -c \
  'SELECT COUNT(*) || '"'"' ta operatsiya o‘qildi'"'"' FROM "SurgicalService"'

echo "▸ Begona jadval ko'rinmasligini tekshiramiz"
if PGPASSWORD="$PASSWORD" psql -h 127.0.0.1 -U "$ROLE" -d "$DB" -c \
     'SELECT 1 FROM "User" LIMIT 1' >/dev/null 2>&1; then
  echo "  ✗ XAVF: rol boshqa jadvallarni ham ko'ryapti" >&2
  exit 1
fi
echo "  ✓ faqat katalog jadvallari ko'rinadi"

systemctl restart klinikatop
echo "✓ Tayyor"
