#!/bin/bash
#
# Server kuzatuvchisi — har 3 daqiqada (server-watch.timer).
#
# Ikkala sayt (KlinikaTop, banisa) va disk tekshiriladi. Biror narsa
# ketma-ket 2 marta yiqilsa — bosh adminning Telegram'iga xabar boradi,
# tiklansa — yana xabar. Holat o'zgarmasa jim turadi (spam yo'q).
#
# Xabar KlinikaTop boti orqali ketadi: token /etc/klinikatop.env dan,
# chat /etc/server-watch.env dagi WATCH_CHAT_ID dan olinadi.
#
set -uo pipefail

STATE_DIR=/var/lib/server-watch
mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"

TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' /etc/klinikatop.env | cut -d= -f2- | tr -d '"')
CHAT=$(grep -E '^WATCH_CHAT_ID=' /etc/server-watch.env 2>/dev/null | cut -d= -f2- | tr -d '"')

notify() {
  [ -n "$TOKEN" ] && [ -n "$CHAT" ] || return 0
  curl -s -m 15 -o /dev/null "https://api.telegram.org/bot${TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT}" --data-urlencode "text=$1" -d parse_mode=HTML
}

# check <nom> <buyruq...> — muvaffaqiyat 0 qaytaradi
check() {
  local name=$1; shift
  local f="$STATE_DIR/$name" prev fails
  prev=$(cut -d' ' -f1 "$f" 2>/dev/null || echo ok)
  fails=$(cut -d' ' -f2 "$f" 2>/dev/null || echo 0)
  if "$@" >/dev/null 2>&1; then
    [ "$prev" = down ] && notify "✅ <b>Tiklandi:</b> ${name} ($(hostname), $(TZ=Asia/Tashkent date '+%d.%m %H:%M'))"
    echo "ok 0" > "$f"
  else
    fails=$((fails + 1))
    if [ "$prev" != down ] && [ "$fails" -ge 2 ]; then
      notify "🚨 <b>Ishlamayapti:</b> ${name}
Server: $(hostname) · $(TZ=Asia/Tashkent date '+%d.%m %H:%M') (Toshkent)
${DETAIL:-}"
      echo "down $fails" > "$f"
    else
      echo "$prev $fails" > "$f"
    fi
  fi
}

http_ok() { curl -sf -m 10 -o /dev/null "$@"; }
site_ok() { curl -sf -m 10 -o /dev/null --resolve "$1:443:127.0.0.1" "https://$1/"; }
disk_ok() { [ "$(df --output=pcent / | tail -1 | tr -dc 0-9)" -lt 85 ]; }
# Sertifikat 14 kundan ko'proq amal qilsin (certbot o'zi yangilashi kerak)
cert_ok() { echo | openssl s_client -servername "$1" -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -checkend $((14*86400)) >/dev/null; }

check "KlinikaTop API"        http_ok http://127.0.0.1:8791/api/health
check "banisa API"            bash -c 'curl -sf -m 10 http://127.0.0.1:5000/api/health | grep -q "\"ok\":true"'
check "klinikatop.uz sayti"   site_ok klinikatop.uz
check "banisa.uz sayti"       site_ok banisa.uz
DETAIL="Disk: $(df -h / | awk 'NR==2{print $5" band ("$4" bo‘sh)"}')" check "Disk (85% dan oshdi)" disk_ok
check "klinikatop.uz SSL (14 kundan kam qoldi)" cert_ok klinikatop.uz
check "banisa.uz SSL (14 kundan kam qoldi)"     cert_ok banisa.uz
