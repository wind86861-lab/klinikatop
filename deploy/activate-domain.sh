#!/usr/bin/env bash
#
# Domen ulangach bir marta yuritiladi.
#
#   bash deploy/activate-domain.sh klinikatop.uz
#
# Nima qiladi:
#   1. DNS haqiqatan shu serverga qarayotganini tekshiradi
#   2. nginx blokini domenga moslab yoqadi (banisa.uz blokiga tegmaydi)
#   3. Let's Encrypt sertifikatini oladi
#   4. .env dagi WEBAPP_URL va CORS_ORIGINS ni to'ldiradi
#   5. Xizmatni qayta ishga tushiradi va tekshiradi
#
# Har bir qadam oldingisi muvaffaqiyatli bo'lgandagina bajariladi:
# yarim sozlangan holat eng yomon holat.
set -euo pipefail

DOMAIN="${1:-}"
SERVER="${SERVER:-root@137.184.103.148}"
SSH_OPTS="-o StrictHostKeyChecking=no"

if [ -z "$DOMAIN" ]; then
  echo "Foydalanish: bash deploy/activate-domain.sh <domen>"
  echo "Masalan:     bash deploy/activate-domain.sh klinikatop.uz"
  exit 1
fi

echo "▸ Domen: $DOMAIN"

ssh $SSH_OPTS "$SERVER" DOMAIN="$DOMAIN" bash -s <<'REMOTE'
set -euo pipefail

SERVER_IP=$(curl -s --max-time 10 https://api.ipify.org || echo '')
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || echo '')

echo "  server IP: ${SERVER_IP:-aniqlanmadi}"
echo "  domen IP:  ${RESOLVED:-aniqlanmadi}"

if [ -z "$RESOLVED" ]; then
  echo "✗ DNS hali tarqalmagan. Bir necha soatdan keyin qayta urinib ko'ring."
  exit 1
fi

if [ -n "$SERVER_IP" ] && [ "$RESOLVED" != "$SERVER_IP" ]; then
  echo "✗ Domen boshqa serverga qarayapti ($RESOLVED)."
  echo "  A yozuvini $SERVER_IP ga o'zgartiring va DNS tarqalishini kuting."
  exit 1
fi

echo "▸ nginx bloki"
# Asosiy domen bo'lsa (klinikatop.uz) www varianti ham shu blokka tushishi
# kerak. Aks holda www.* nginx'ning birinchi blokiga — banisa.uz ga tushadi.
LABELS=$(echo "$DOMAIN" | awk -F. '{print NF}')
if [ "$LABELS" -le 2 ]; then
  NAMES="$DOMAIN www.$DOMAIN"
  CERT_ARGS="-d $DOMAIN -d www.$DOMAIN"
else
  NAMES="$DOMAIN"
  CERT_ARGS="-d $DOMAIN"
fi
echo "  server_name: $NAMES"

sed -i "s/KLINIKATOP_DOMAIN/$NAMES/g" /etc/nginx/sites-available/klinikatop
ln -sf /etc/nginx/sites-available/klinikatop /etc/nginx/sites-enabled/klinikatop

# banisa.uz bloki buzilmaganini tekshiramiz — buzilgan bo'lsa qaytaramiz
if ! nginx -t 2>&1 | grep -q successful; then
  echo "✗ nginx sozlamasi xato — o'zgarish qaytarildi"
  rm -f /etc/nginx/sites-enabled/klinikatop
  nginx -t
  exit 1
fi
systemctl reload nginx
echo "  nginx yangilandi (banisa.uz bloki o'zgarmadi)"

echo "▸ HTTPS sertifikati"
if ! command -v certbot >/dev/null; then
  apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx
fi
# shellcheck disable=SC2086
certbot --nginx $CERT_ARGS --non-interactive --agree-tos \
  --register-unsafely-without-email --redirect

echo "▸ Muhit o'zgaruvchilari"
sed -i "s|^WEBAPP_URL=.*|WEBAPP_URL=https://$DOMAIN|"     /etc/klinikatop.env
if [ "$LABELS" -le 2 ]; then
  sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN|" /etc/klinikatop.env
else
  sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://$DOMAIN|" /etc/klinikatop.env
fi

systemctl restart klinikatop
sleep 4

echo "▸ Tekshiruv"
echo "  xizmat:   $(systemctl is-active klinikatop)"
echo "  ichki:    $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8791/api/health)"
echo "  tashqi:   $(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/health" --max-time 15)"
echo "  ilova:    $(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/" --max-time 15)"
echo "  imzosiz:  $(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/me" --max-time 15)  (401 bo'lishi kerak)"
echo
echo "  banisa.uz: $(curl -s -o /dev/null -w '%{http_code}' -I https://banisa.uz --max-time 10 -k)"
REMOTE

echo
echo "✓ Domen ulandi: https://$DOMAIN"
echo
echo "Qolgan bitta qadam — @BotFather da:"
echo "  /mybots → @klinikatop_bot → Bot Settings → Menu Button"
echo "  URL: https://$DOMAIN"
