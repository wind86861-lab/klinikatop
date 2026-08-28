#!/usr/bin/env bash
# HTTP qatlami uchun uchdan-uchgacha oqim testi.
# Servis testi (npm test) mantiqni tekshiradi; bu esa marshrut, validatsiya va
# huquqlar to'g'ri ulanganini tekshiradi.
#
#   PORT=8099 bash src/test/http.sh
set -uo pipefail

API="http://localhost:${PORT:-8080}/api"
# Skript qayerdan chaqirilishidan qat'i nazar loyiha ildizini topamiz
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# Imzosiz kirish olib tashlangan — testlar ham haqiqiy Telegram imzosidan
# o'tadi. Imzo sinov boti tokeni bilan yasaladi (server ham shuni ishlatadi).
sign() { npx tsx "$ROOT/server/src/test/sign.ts" "$1"; }

#
# Bemor HAR YUGURISHDA yangi.
#
# Sabab tezlik cheklovi: bitta yugurish ~50 ta yozuv amali qiladi va
# `limits.write` daqiqada 60 tani o'tkazadi. Bir xil foydalanuvchi
# bilan ketma-ket ikki marta yurgizilsa, ikkinchisi 429 ga uriladi.
#
# Cheklovni kengaytirish yechim emas: u haqiqiy himoya va oddiy bemor
# unga hech qachon yetmaydi. Cheklov foydalanuvchi bo'yicha yuritiladi,
# shuning uchun yangi identifikator yangi hisobni beradi.
#
PATIENT_ID=$(( 910000 + $(date +%s) % 80000 ))
PATIENT=(-H "x-init-data: $(sign $PATIENT_ID)")
STRANGER=(-H "x-init-data: $(sign $(( PATIENT_ID + 1 )) )")
JSON=(-H "content-type: application/json")

# Klinika va admin Telegram orqali KIRMAYDI — ular veb sessiya ishlatadi.
# Hisoblar haqiqiy oqim orqali tayyorlanadi: hisob → parol → kirish.
WEB_SETUP=$(npx tsx "$ROOT/server/src/test/webAccounts.ts")
CLINIC_ID=$(echo "$WEB_SETUP" | awk '/^CLINIC_ID/{print $2}')
CLINIC=(-H "authorization: Bearer $(echo "$WEB_SETUP" | awk '/^CLINIC_TOKEN/{print $2}')")
MOD=(-H "authorization: Bearer $(echo "$WEB_SETUP" | awk '/^ADMIN_TOKEN/{print $2}')")

pass=0; fail=0
check() { # check <nom> <shart-natijasi>
  if [ "$2" = "1" ]; then pass=$((pass+1)); echo "  ✓ $1";
  else fail=$((fail+1)); echo "  ✗ $1 ${3:+→ $3}"; fi
}
jqv() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(eval('j'+process.argv[1])??'')}catch(e){console.log('')}})" "$1"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "1. Autentifikatsiya"
code=$(status "$API/me")
check "initData'siz kirish rad etiladi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"
code=$(status "${PATIENT[@]}" "$API/me")
check "dev foydalanuvchi kiradi (200)" "$([ "$code" = 200 ] && echo 1)" "$code"

echo
echo "2. Rollarning ajratilishi va verifikatsiya"

# Bemor klinika kabinetiga hech qanday yo'l bilan kira olmaydi
code=$(status "${PATIENT[@]}" "$API/clinic")
check "bemor klinika kabinetiga kirmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"
code=$(status "${PATIENT[@]}" "$API/admin/verifications")
check "bemor admin paneliga kirmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

# Klinika hisobi esa Telegram bilan emas, faqat veb sessiya bilan ishlaydi
code=$(status "${CLINIC[@]}" "$API/clinic")
check "klinika veb sessiya bilan kiradi (200)" "$([ "$code" = 200 ] && echo 1)" "$code"

if [ -z "$CLINIC_ID" ]; then
  CLINIC_ID=$(curl -s "${CLINIC[@]}" "$API/clinic" | jqv '.clinic.id')
  EXISTING=$(curl -s "${CLINIC[@]}" "$API/clinic" | jqv '.operationIds.join(",")')
  case ",$EXISTING," in
    *,1,*) ;;
    *) curl -s "${CLINIC[@]}" "${JSON[@]}" -X PATCH "$API/clinic" \
         -d "{\"operationIds\":[1${EXISTING:+,$EXISTING}]}" > /dev/null ;;
  esac
fi
check "klinika arizasi qabul qilindi" "$([ -n "$CLINIC_ID" ] && echo 1)" "id=$CLINIC_ID"

# Har yugurishda toza holatdan boshlaymiz
curl -s "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/verifications/$CLINIC_ID" -d '{"status":"rejected","note":"reset"}' > /dev/null 2>&1

code=$(status "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/offers" -d '{"requestId":1,"priceUzs":9000000,"includes":["Operatsiya"],"leadTimeDays":5}')
check "tasdiqlanmagan klinika taklif yubora olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

curl -s "${MOD[@]}" "$API/me" > /dev/null
# Moderator roli faqat platforma tomonidan beriladi (1.2) — CLI orqali
npx tsx "$(dirname "$0")/../db/grant.ts" 900003 moderator > /dev/null 2>&1
code=$(status "${PATIENT[@]}" "$API/admin/verifications")
check "bemor moderator paneliga kira olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

VERIF=$(curl -s "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/verifications/$CLINIC_ID" -d '{"status":"approved","note":null}' | jqv '.verification')
check "moderator klinikani tasdiqladi" "$([ "$VERIF" = "approved" ] && echo 1)" "$VERIF"

SUB=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/clinic/subscription" -d '{"plan":"pro","months":1}' | jqv '.subscriptionStatus')
check "obuna faollashtirildi" "$([ "$SUB" = "active" ] && echo 1)" "$SUB"

echo
echo "3. Bemor profili va oferta"
# Profil to'ldirilmagan bo'lsa so'rov yuborilmaydi
# Yosh va jins ham majburiy: bir xil operatsiya turli yoshda boshqacha
# narxlanadi va ba'zilari jinsga bog'liq
curl -s "${PATIENT[@]}" "${JSON[@]}" -X PATCH "$API/me" \
  -d '{"firstName":"Aziz","lastName":"Karimov","cityId":1,"birthYear":1990,"gender":"male"}' > /dev/null
COMPLETE=$(curl -s "${PATIENT[@]}" "$API/me" | jqv '.profileComplete')
check "profil to'ldirildi" "$([ "$COMPLETE" = "true" ] && echo 1)" "$COMPLETE"

TERMS=$(curl -s "${PATIENT[@]}" "$API/me/terms" | jqv '.version')
check "ommaviy oferta matni qaytdi" "$([ -n "$TERMS" ] && echo 1)" "v=$TERMS"

code=$(status "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d '{"operationId":1,"cityId":1,"budgetUzs":12000000,"urgency":"normal","conditionText":"3 oydan beri ong biqin ogriydi, tekshiruvda tosh topildi."}')
check "ofertasiz so'rov rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

code=$(status "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d '{"operationId":1,"cityId":1,"urgency":"normal","conditionText":"qisqa","acceptTerms":true}')
check "qisqa holat tavsifi rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

UNKNOWN=$(curl -s "${PATIENT[@]}" "$API/catalog/unknown-operation" | jqv '.slug')
check "\"bilmayman\" varianti mavjud" "$([ "$UNKNOWN" = "unknown" ] && echo 1)" "$UNKNOWN"

echo
echo "4. Hujjat yuklash"
# 1x1 shaffof PNG
PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
FILE_ID=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/files" \
  -d "{\"name\":\"uzi.png\",\"mimeType\":\"image/png\",\"kind\":\"uzi\",\"dataBase64\":\"$PNG\"}" | jqv '.id')
check "hujjat yuklandi" "$([ -n "$FILE_ID" ] && echo 1)" "id=${FILE_ID:0:8}…"

code=$(status "${PATIENT[@]}" "$API/files/$FILE_ID")
check "egasi hujjatni ko'radi (200)" "$([ "$code" = 200 ] && echo 1)" "$code"

code=$(status "${MOD[@]}" "$API/files/$FILE_ID")
check "moderator hujjatni ko'radi (200)" "$([ "$code" = 200 ] && echo 1)" "$code"

code=$(status "${JSON[@]}" "${STRANGER[@]}" "$API/files/$FILE_ID")
check "begona odam hujjatni ko'ra olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

code=$(status "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d '{"operationId":1,"cityId":1,"urgency":"normal","conditionText":"3 oydan beri ong biqin ogriydi, tekshiruvda tosh topildi.","attachments":["begona-id"],"acceptTerms":true}')
check "begona hujjatni ilova qilib bo'lmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

code=$(status "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/files" \
  -d '{"name":"x.exe","mimeType":"application/x-msdownload","kind":"other","dataBase64":"QUJD"}')
check "ruxsat etilmagan fayl turi rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

# "Boshqa" turdagi hujjat bemor bergan nom bilan saqlanadi
LABEL=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/files" \
  -d "{\"name\":\"skan.png\",\"mimeType\":\"image/png\",\"kind\":\"other\",\"label\":\"Shifokor xulosasi\",\"dataBase64\":\"$PNG\"}" | jqv '.label')
check "boshqa turdagi hujjat nomi saqlandi" "$([ "$LABEL" = "Shifokor xulosasi" ] && echo 1)" "$LABEL"

echo
echo
echo "4b. AI suhbati"
CHAT=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/ai/chat" \
  -d '{"turns":[{"role":"user","content":"Ong biqinim ogriydi, siydik yolida tosh bor deyishdi"}]}')
REPLY=$(echo "$CHAT" | jqv '.reply')
check "AI suhbatga javob berdi" "$([ -n "$REPLY" ] && echo 1)" "${REPLY:0:40}…"

DISC=$(echo "$CHAT" | jqv '.disclaimer')
check "javobda ogohlantirish bor" "$([ -n "$DISC" ] && echo 1)" "${DISC:0:30}…"

NEEDS=$(echo "$CHAT" | jqv '.needsMoreInfo')
SUGG=$(echo "$CHAT" | jqv '.suggestions.length')
FB=$(echo "$CHAT" | jqv '.fallbackToClinic')
# needsMoreInfo/fallbackToClinic mantiqiy, suggestions massiv bo'lishi shart
SHAPE="$([[ $NEEDS =~ ^(true|false)$ ]] && echo ok),$([[ $SUGG =~ ^[0-9]+$ ]] && echo ok),$([[ $FB =~ ^(true|false)$ ]] && echo ok)"
check "javob shakli to'g'ri" "$([ "$SHAPE" = "ok,ok,ok" ] && echo 1)" "$SHAPE"

code=$(status "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/ai/chat" -d '{"turns":[]}')
check "bo'sh suhbat rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

echo "5. So'rov va taklif"
# Oldingi yugurish yoki qo'lda sinovdan qolgan faol so'rovlarni yopamiz,
# aks holda spam cheklovi (3 ta) yangi so'rovni bloklaydi
for old in $(curl -s "${PATIENT[@]}" "$API/requests" | jqv '.filter(r=>r.status==="NEW"||r.status==="COLLECTING").map(r=>r.id).join(" ")'); do
  curl -s "${PATIENT[@]}" -X POST "$API/requests/$old/cancel" > /dev/null
done

REQ_ID=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d '{"operationId":1,"cityId":1,"budgetUzs":12000000,"note":"HTTP test","urgency":"soon","conditionText":"3 oydan beri ong biqin ogriydi, tekshiruvda tosh topildi.","acceptTerms":true}' | jqv '.id')
check "so'rov yaratildi" "$([ -n "$REQ_ID" ] && echo 1)" "id=$REQ_ID"

TV=$(curl -s "${PATIENT[@]}" "$API/requests/$REQ_ID" | jqv '.request.termsVersion')
check "so'rovda oferta versiyasi saqlandi" "$([ -n "$TV" ] && echo 1)" "$TV"

# Suhbat so'rov bilan birga saqlanadi — klinika bemor NIMA YOZGANINI ko'radi
CONV_ID=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d '{"operationId":1,"cityId":1,"urgency":"normal","conditionText":"Biqin ogriydi, tosh bor deyishdi. Ikki oydan beri.","aiConversation":[{"role":"user","content":"Biqin ogriydi"},{"role":"assistant","content":"Qachondan beri?"}],"acceptTerms":true}' | jqv '.id')
CONV=$(curl -s "${PATIENT[@]}" "$API/requests/$CONV_ID" | jqv '.request.aiConversation.length')
check "AI suhbati so'rovga biriktirildi" "$([ "$CONV" = 2 ] && echo 1)" "$CONV"
curl -s "${PATIENT[@]}" -X POST "$API/requests/$CONV_ID/cancel" > /dev/null

BROADCAST=$(curl -s "${PATIENT[@]}" "$API/requests/$REQ_ID" | jqv '.request.broadcastCount')
check "so'rov klinikalarga tarqatildi" "$([ "${BROADCAST:-0}" -gt 0 ] && echo 1)" "n=$BROADCAST"

code=$(status "${CLINIC[@]}" "$API/requests/$REQ_ID")
check "begona so'rovni ko'rib bo'lmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

COND_SEEN=$(curl -s "${CLINIC[@]}" "$API/clinic/requests/$REQ_ID" | jqv '.request.conditionText')
check "klinika holat tavsifini ko'radi" "$([ -n "$COND_SEEN" ] && echo 1)" "$(echo "$COND_SEEN" | cut -c1-28)…"

code=$(status "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/offers" -d "{\"requestId\":$REQ_ID,\"priceUzs\":11000000,\"includes\":[],\"leadTimeDays\":5}")
check "bo'sh 'nima kiradi' rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

code=$(status "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/offers" -d '{"requestId":}')
check "buzuq JSON 400 qaytaradi (500 emas)" "$([ "$code" = 400 ] && echo 1)" "$code"

OFFER_ID=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/offers" \
  -d "{\"requestId\":$REQ_ID,\"priceUzs\":11000000,\"includes\":[\"Operatsiya\",\"Narkoz\"],\"advantages\":[\"Oliy toifali jarroh\"],\"leadTimeDays\":5}" | jqv '.id')
check "taklif yuborildi" "$([ -n "$OFFER_ID" ] && echo 1)" "id=$OFFER_ID"

BADGES=$(curl -s "${PATIENT[@]}" "$API/requests/$REQ_ID" | jqv '.offers[0].badges.join(",")')
check "taklifga nishon berildi" "$([ -n "$BADGES" ] && echo 1)" "$BADGES"

echo
echo "6. Tanlov, chat va tasdiqlash"
code=$(status "${PATIENT[@]}" "$API/deals/999/messages")
check "mavjud bo'lmagan chat yopiq (404)" "$([ "$code" = 404 ] && echo 1)" "$code"

DEAL_ID=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests/$REQ_ID/choose" -d "{\"offerId\":$OFFER_ID}" | jqv '.id')
check "bitim yaratildi" "$([ -n "$DEAL_ID" ] && echo 1)" "id=$DEAL_ID"

REDACTED=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/deals/$DEAL_ID/messages" \
  -d '{"body":"Telefonim +998 90 123 45 67, qongiroq qiling"}' | jqv '.redacted')
check "chatda telefon raqam yashirildi" "$([ "$REDACTED" = "true" ] && echo 1)" "$REDACTED"

PRICE_OK=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/deals/$DEAL_ID/messages" \
  -d '{"body":"Narx 11 000 000 som to#g#ri deb tushundim"}' | jqv '.redacted')
check "narx yashirilmadi" "$([ "$PRICE_OK" = "false" ] && echo 1)" "$PRICE_OK"

code=$(status "${MOD[@]}" "$API/deals/$DEAL_ID/messages")
check "uchinchi shaxs chatga kira olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

TOMORROW=$(node -e "console.log(new Date(Date.now()+864e5).toISOString())")
STATUS=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/deals/$DEAL_ID/schedule" -d "{\"scheduledAt\":\"$TOMORROW\"}" | jqv '.status')
check "sana kelishildi (AGREED)" "$([ "$STATUS" = "AGREED" ] && echo 1)" "$STATUS"

code=$(status "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/deals/$DEAL_ID/performed")
check "bemor 'bajarildi' deya olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

STATUS=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/deals/$DEAL_ID/performed" | jqv '.status')
check "klinika bajarilganini belgiladi" "$([ "$STATUS" = "PERFORMED" ] && echo 1)" "$STATUS"

COMMISSION=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/deals/$DEAL_ID/confirm" -d '{"amountUzs":10500000}' | jqv '.commissionUzs')
check "komissiya hisoblandi (5%)" "$([ "$COMMISSION" = "525000" ] && echo 1)" "$COMMISSION"

AVG=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/deals/$DEAL_ID/review" \
  -d '{"quality":5,"attitude":4,"cleanliness":5,"result":4,"body":"Yaxshi"}' | jqv '.average')
check "sharh qoldirildi" "$([ "$AVG" = "4.5" ] && echo 1)" "$AVG"

code=$(status "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/deals/$DEAL_ID/review" \
  -d '{"quality":5,"attitude":5,"cleanliness":5,"result":5}')
check "ikkinchi sharh rad etiladi (409)" "$([ "$code" = 409 ] && echo 1)" "$code"

echo
echo "7. Klinika paneli va bildirishnomalar"
# Mutlaq son emas — baza qayta ishlatilsa jamlanadi
WON=$(curl -s "${CLINIC[@]}" "$API/clinic/dashboard" | jqv '.kpi.offersWon')
check "dashboard yutilgan taklifni ko'rsatadi" "$([ "${WON:-0}" -ge 1 ] && echo 1)" "$WON"

NOTIF=$(curl -s "${CLINIC[@]}" "$API/me/notifications" | jqv '.items.length')
check "klinikaga bildirishnoma yetdi" "$([ "${NOTIF:-0}" -gt 0 ] && echo 1)" "n=$NOTIF"

echo
echo "8. Klinika kabineti"

# Verifikatsiya ro'yxati — nima yetishmayotgani ko'rinadi
VER=$(curl -s "${CLINIC[@]}" "$API/clinic/verification")
VER_ITEMS=$(echo "$VER" | jqv '.items.length')
check "verifikatsiya ro'yxati qaytdi" "$([ "$VER_ITEMS" -ge 3 ] 2>/dev/null && echo 1)" "$VER_ITEMS ta band"

# Shablon: yaratish → ro'yxat → o'chirish
TPL=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/clinic/templates" \
  -d '{"title":"Standart paket","priceUzs":9000000,"includes":["Operatsiya","Yotoq"],"leadTimeDays":7}' | jqv '.id')
check "shablon yaratildi" "$([ -n "$TPL" ] && echo 1)" "id=$TPL"

TPL_N=$(curl -s "${CLINIC[@]}" "$API/clinic/templates" | jqv '.length')
check "shablon ro'yxatda ko'rinadi" "$([ "$TPL_N" -ge 1 ] 2>/dev/null && echo 1)" "$TPL_N ta"

code=$(status "${CLINIC[@]}" -X DELETE "$API/clinic/templates/$TPL")
check "shablon o'chirildi (204)" "$([ "$code" = 204 ] && echo 1)" "$code"

# Shifokor
DOC=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/clinic/doctors" \
  -d '{"fullName":"Karimov Aziz Rustamovich","specialty":"Jarroh","experienceYears":12,"operationIds":[1]}' | jqv '.id')
check "shifokor qo'shildi" "$([ -n "$DOC" ] && echo 1)" "id=$DOC"

DOC_OPS=$(curl -s "${CLINIC[@]}" "$API/clinic/doctors" | jqv '[0].operationIds.length')
check "shifokorga operatsiya biriktirildi" "$([ "$DOC_OPS" -ge 1 ] 2>/dev/null && echo 1)" "$DOC_OPS ta"

# Kalendar: quvvat belgilash va band kunni hisoblash
SLOT_DATE=$(date -d '+10 days' +%Y-%m-%d 2>/dev/null || date -v+10d +%Y-%m-%d)
SLOT_CAP=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X PUT "$API/clinic/slots/$SLOT_DATE" \
  -d '{"capacity":3,"note":"Ochiq"}' | jqv '.capacity')
check "kalendar kuni sozlandi" "$([ "$SLOT_CAP" = 3 ] && echo 1)" "quvvat=$SLOT_CAP"

code=$(status "${CLINIC[@]}" "${JSON[@]}" -X PUT "$API/clinic/slots/$SLOT_DATE" -d '{"capacity":99}')
check "haddan katta quvvat rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

# Analitika va daromad
AN=$(curl -s "${CLINIC[@]}" "$API/clinic/analytics?days=30" | jqv '.windowDays')
check "analitika qaytdi" "$([ "$AN" = 30 ] && echo 1)" "$AN kun"

COMM=$(curl -s "${CLINIC[@]}" "$API/clinic/revenue" | jqv '.commissionPercent')
check "daromad hisoboti komissiyani ko'rsatdi" "$([ "$COMM" = 5 ] && echo 1)" "$COMM%"

# Jamoa: xodimga ish hisobi ochiladi
OP_PHONE="99893$(date +%H%M%S)"
OP=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/clinic/operators" \
  -d "{\"phone\":\"$OP_PHONE\",\"fullName\":\"Sinov Xodim\",\"role\":\"clinic_operator\"}" | jqv '.setupToken')
check "xodimga hisob ochildi" "$([ -n "$OP" ] && echo 1)" ""

# Bir raqam ikki marta ishlatilmaydi
code=$(status "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/clinic/operators" \
  -d "{\"phone\":\"$OP_PHONE\",\"fullName\":\"Takror\",\"role\":\"clinic_operator\"}")
check "takroriy raqam rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

# Xodim parolini qo'yib kabinetga kiradi, lekin admin amallariga yo'l yo'q
curl -s "${JSON[@]}" -X POST "$API/web/setup" -d "{\"token\":\"$OP\",\"password\":\"xodim-paroli-2026\"}" > /dev/null
OP_TOKEN=$(curl -s "${JSON[@]}" -X POST "$API/web/login" \
  -d "{\"login\":\"$OP_PHONE\",\"password\":\"xodim-paroli-2026\"}" | jqv '.token')
OPH=(-H "authorization: Bearer $OP_TOKEN")
code=$(status "${OPH[@]}" "$API/clinic")
check "xodim kabinetga kirdi (200)" "$([ "$code" = 200 ] && echo 1)" "$code"
code=$(status "${OPH[@]}" "${JSON[@]}" -X POST "$API/clinic/operators" \
  -d '{"phone":"998940000001","fullName":"Yana","role":"clinic_operator"}')
check "xodim boshqa xodim qo'sha olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

# Begona klinikaning ma'lumotiga kirib bo'lmaydi
code=$(status "${JSON[@]}" "${STRANGER[@]}" "$API/clinic/templates")
check "klinikasiz odam shablonlarni ko'ra olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

# Bildirishnoma sozlamalari
PREF=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X PATCH "$API/me/notification-prefs" \
  -d '{"newRequest":false,"quietFrom":"22:00","quietTo":"07:00"}' | jqv '.quietFrom')
check "bildirishnoma sozlamasi saqlandi" "$([ "$PREF" = "22:00" ] && echo 1)" "$PREF"

code=$(status "${CLINIC[@]}" "${JSON[@]}" -X PATCH "$API/me/notification-prefs" -d '{"quietFrom":"25:99"}')
check "noto'g'ri vaqt rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

echo
echo "9. Profil, komissiya va hujjat tekshiruvi"

# To'liq profil: telefon, sayt, ish vaqti, jihozlar, suratlar
PROF=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X PATCH "$API/clinic" \
  -d '{"phone":"+998901234567","website":"https://klinikatop.uz","workHours":"09:00 - 18:00","beds":40,"foundedYear":2015,"equipment":["MRT","UZI apparati"]}')
PHONE=$(echo "$PROF" | jqv '.phone')
check "klinika telefoni saqlandi" "$([ "$PHONE" = "+998901234567" ] && echo 1)" "$PHONE"

EQ=$(echo "$PROF" | jqv '.equipment.length')
check "jihozlar ro'yxati saqlandi" "$([ "$EQ" = 2 ] && echo 1)" "$EQ ta"

BEDS=$(echo "$PROF" | jqv '.beds')
check "yotoq o'rinlari saqlandi" "$([ "$BEDS" = 40 ] && echo 1)" "$BEDS"

# Telefon kiritilgach verifikatsiya ro'yxatidagi band bajarildi
PHONE_OK=$(curl -s "${CLINIC[@]}" "$API/clinic/verification" | jqv '.items.find(i=>i.key==="phone").done')
check "verifikatsiya ro'yxati telefonni ko'rdi" "$([ "$PHONE_OK" = "true" ] && echo 1)" "$PHONE_OK"

code=$(status "${CLINIC[@]}" "${JSON[@]}" -X PATCH "$API/clinic" -d '{"foundedYear":1500}')
check "haqiqatga to'g'ri kelmaydigan yil rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

# Komissiya: qarzdan ortiq to'lov rad etiladi
OUT=$(curl -s "${CLINIC[@]}" "$API/clinic/revenue" | jqv '.outstandingUzs')
check "to'lanmagan komissiya hisoblandi" "$([ -n "$OUT" ] && echo 1)" "$OUT so'm"

code=$(status "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/clinic/commission/pay" \
  -d "{\"amountUzs\":$((OUT + 1000000)),\"method\":\"bank\"}")
check "qarzdan ortiq to'lov rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

if [ "$OUT" -gt 0 ] 2>/dev/null; then
  PAID=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/clinic/commission/pay" \
    -d "{\"amountUzs\":$OUT,\"method\":\"bank\",\"reference\":\"TXN-001\"}" | jqv '.outstandingUzs')
  check "to'lovdan keyin qarz nolga tushdi" "$([ "$PAID" = 0 ] && echo 1)" "$PAID"

  HIST=$(curl -s "${CLINIC[@]}" "$API/clinic/revenue" | jqv '.commissionPayments.length')
  check "to'lov tarixga yozildi" "$([ "$HIST" -ge 1 ] 2>/dev/null && echo 1)" "$HIST ta"
fi

# Moderator hujjatni ko'radi va qaror qabul qiladi
DOC_ID=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/files" \
  -d "{\"name\":\"litsenziya.png\",\"mimeType\":\"image/png\",\"kind\":\"other\",\"dataBase64\":\"$PNG\"}" | jqv '.id')
CDOC=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/clinic/documents" \
  -d "{\"kind\":\"license\",\"fileId\":\"$DOC_ID\"}" | jqv '.id')
check "klinika hujjat qo'shdi" "$([ -n "$CDOC" ] && echo 1)" "id=$CDOC"

MOD_N=$(curl -s "${MOD[@]}" "$API/admin/clinics/$CLINIC_ID/documents" | jqv '.length')
check "moderator hujjatlarni ko'radi" "$([ "$MOD_N" -ge 1 ] 2>/dev/null && echo 1)" "$MOD_N ta"

code=$(status "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/documents/$CDOC" -d '{"status":"rejected"}')
check "sababsiz rad etish rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

DST=$(curl -s "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/documents/$CDOC" \
  -d '{"status":"approved"}' | jqv '.status')
check "moderator hujjatni tasdiqladi" "$([ "$DST" = "approved" ] && echo 1)" "$DST"

code=$(status "${CLINIC[@]}" -X DELETE "$API/clinic/documents/$CDOC")
check "tasdiqlangan hujjatni o'chirib bo'lmaydi (409)" "$([ "$code" = 409 ] && echo 1)" "$code"

code=$(status "${CLINIC[@]}" "$API/admin/clinics/$CLINIC_ID/documents")
check "klinika moderator marshrutiga kira olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

# Rad etilgan klinika hujjatni tuzatib qayta yuklasa navbatga QAYTADI —
# aks holda ariza abadiy rad etilgan holda qolib ketardi
# Navbatdan chiqish sharti: kutilayotgan hujjat QOLMASLIGI kerak.
# Avvalgi yugurishlardan qolganlarini tasdiqlab, toza holatdan boshlaymiz.
for pend in $(curl -s "${MOD[@]}" "$API/admin/clinics/$CLINIC_ID/documents" \
                | jqv '.filter(d=>d.status==="pending").map(d=>d.id).join(" ")'); do
  curl -s "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/documents/$pend" -d '{"status":"approved"}' > /dev/null
done

curl -s "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/verifications/$CLINIC_ID" \
  -d '{"status":"rejected","note":"Litsenziya o‘qilmayapti"}' > /dev/null
GONE=$(curl -s "${MOD[@]}" "$API/admin/verifications" | jqv ".filter(c=>c.id===$CLINIC_ID).length")
check "rad etilgan klinika navbatdan chiqdi" "$([ "$GONE" = 0 ] && echo 1)" "$GONE"

FIX_FILE=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/files" \
  -d "{\"name\":\"tuzatilgan.png\",\"mimeType\":\"image/png\",\"kind\":\"other\",\"dataBase64\":\"$PNG\"}" | jqv '.id')
curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/clinic/documents" \
  -d "{\"kind\":\"license\",\"fileId\":\"$FIX_FILE\"}" > /dev/null
BACK=$(curl -s "${MOD[@]}" "$API/admin/verifications" | jqv ".filter(c=>c.id===$CLINIC_ID).length")
check "yangi hujjat bilan navbatga qaytdi" "$([ "$BACK" = 1 ] && echo 1)" "$BACK"

# Hujjatda fayl turi ham keladi — moldal to'g'ri belgi ko'rsatishi uchun
MIME=$(curl -s "${MOD[@]}" "$API/admin/clinics/$CLINIC_ID/documents" | jqv '[0].fileMimeType')
check "hujjat fayl turini olib keldi" "$([ "$MIME" = "image/png" ] && echo 1)" "$MIME"

curl -s "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/verifications/$CLINIC_ID" \
  -d '{"status":"approved"}' > /dev/null

echo
echo "10. Rol chegaralari"

# Bemor klinika va moderator marshrutlariga kira olmasligi kerak
for ep in clinic clinic/revenue clinic/templates clinic/analytics; do
  code=$(status "${PATIENT[@]}" "$API/$ep")
  check "bemor /$ep ga kira olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"
done

code=$(status "${PATIENT[@]}" "$API/admin/metrics")
check "bemor moderator ko'rsatkichlarini ko'ra olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

code=$(status "${PATIENT[@]}" "$API/admin/users")
check "bemor foydalanuvchilar ro'yxatini ko'ra olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

# Klinika operatori moliyaviy amallarga tegmaydi (faqat administrator)
code=$(status "${CLINIC[@]}" "$API/clinic/revenue")
check "klinika administratori daromadni ko'radi (200)" "$([ "$code" = 200 ] && echo 1)" "$code"

# Autentifikatsiyasiz hech narsa ochilmaydi
for ep in clinic/revenue admin/metrics me; do
  code=$(status "$API/$ep")
  check "sessiyasiz /$ep yopiq (401)" "$([ "$code" = 401 ] && echo 1)" "$code"
done

echo
echo "11. Biznes shartlari (admin)"

# Klinikalar ro'yxati — admin uchun barcha kerakli ma'lumot bitta so'rovda
CL=$(curl -s "${MOD[@]}" "$API/admin/clinics")
CL_N=$(echo "$CL" | jqv '.length')
check "admin klinikalar ro'yxatini oldi" "$([ "$CL_N" -ge 1 ] 2>/dev/null && echo 1)" "$CL_N ta"

EFF=$(echo "$CL" | jqv '[0].effectiveCommissionPercent')
check "amaldagi komissiya hisoblandi" "$([ -n "$EFF" ] && echo 1)" "$EFF%"

FILT=$(curl -s "${MOD[@]}" "$API/admin/clinics?filter=approved" | jqv '.every(c=>c.verification==="approved")')
check "filtr ishlaydi (approved)" "$([ "$FILT" = "true" ] && echo 1)" "$FILT"

code=$(status "${PATIENT[@]}" "$API/admin/clinics")
check "bemor klinikalar ro'yxatini ko'ra olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

SET=$(curl -s "${MOD[@]}" "$API/admin/settings")
DEF_COMM=$(echo "$SET" | jqv '.commissionPercent')
check "platforma sozlamalari qaytdi" "$([ -n "$DEF_COMM" ] && echo 1)" "komissiya=$DEF_COMM%"

NEW=$(curl -s "${MOD[@]}" "${JSON[@]}" -X PATCH "$API/admin/settings" \
  -d '{"commissionPercent":7,"trialMonths":6,"autoConfirmDays":14}' | jqv '.commissionPercent')
check "admin umumiy foizni o'zgartirdi" "$([ "$NEW" = 7 ] && echo 1)" "$NEW%"

code=$(status "${MOD[@]}" "${JSON[@]}" -X PATCH "$API/admin/settings" -d '{"commissionPercent":80}')
check "haddan katta foiz rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

PCT=$(curl -s "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/clinics/$CLINIC_ID/commission" \
  -d '{"percent":3}' | jqv '.percent')
check "klinikaga xos foiz belgilandi" "$([ "$PCT" = 3 ] && echo 1)" "$PCT%"

TRIAL=$(curl -s "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/clinics/$CLINIC_ID/trial" \
  -d '{"months":6}' | jqv '.until')
check "sinov davri berildi" "$([ -n "$TRIAL" ] && echo 1)" "${TRIAL:0:10}"

PLAN=$(curl -s "${CLINIC[@]}" "$API/clinic" | jqv '.clinic.plan')
check "tarif 'trial' bo'ldi" "$([ "$PLAN" = "trial" ] && echo 1)" "$PLAN"

# Klinika obunasiz ham so'rovni ko'radi, lekin taklif yubora olmaydi
curl -s "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/clinics/$CLINIC_ID/suspend" -d '{}' > /dev/null 2>&1
NOSUB_REQ=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d '{"operationId":1,"cityId":1,"urgency":"normal","conditionText":"Obunasiz koinish sinovi uchun tavsif matni.","acceptTerms":true}' | jqv '.id')
SEES=$(curl -s "${CLINIC[@]}" "$API/clinic/requests" | jqv ".filter(r=>r.id===$NOSUB_REQ).length")
check "obunasiz klinika so'rovni ko'radi" "$([ "$SEES" = 1 ] && echo 1)" "$SEES"

curl -s "${PATIENT[@]}" -X POST "$API/requests/$NOSUB_REQ/cancel" > /dev/null

# Foizni asl holiga qaytaramiz — keyingi yugurishlar buzilmasin
curl -s "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/clinics/$CLINIC_ID/commission" -d '{"percent":null}' > /dev/null
curl -s "${MOD[@]}" "${JSON[@]}" -X PATCH "$API/admin/settings" -d '{"commissionPercent":5}' > /dev/null
curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/clinic/subscription" -d '{"plan":"pro","months":1}' > /dev/null

echo
echo "12. Xavfsizlik"

# Imzosiz kirishning HAMMA yo'li yopiq
code=$(status "${JSON[@]}" -H "x-dev-user: 900001" "$API/me")
check "imzosiz 'x-dev-user' ishlamaydi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

code=$(status "${JSON[@]}" -H "x-init-data: auth_date=1&user=%7B%22id%22%3A1%7D&hash=deadbeef" "$API/me")
check "soxta imzo rad etiladi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Imzoni o'zgartirsak — buziladi
TAMPER=$(npx tsx "$ROOT/server/src/test/sign.ts" 900001 | sed 's/900001/900003/')
code=$(status "${JSON[@]}" -H "x-init-data: $TAMPER" "$API/me")
check "buzilgan imzo rad etiladi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Imzo oxiriga axlat qo'shilsa ham rad etilishi kerak.
# Node'ning hex tahlilchisi yaroqsiz belgini jimgina tashlab yuboradi,
# shuning uchun hash shakli alohida tekshiriladi.
VALID=$(npx tsx "$ROOT/server/src/test/sign.ts" 900001)
code=$(status "${JSON[@]}" -H "x-init-data: ${VALID}xyz" "$API/me")
check "imzo oxiridagi axlat rad etiladi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

code=$(status "${JSON[@]}" -H "x-init-data: $(echo "$VALID" | sed 's/hash=.*/hash=zzzz/')" "$API/me")
check "hash shakli noto'g'ri bo'lsa rad etiladi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Telegramning yangi mijozlari `signature` maydonini ham yuboradi va u
# data-check-string ga KIRADI. Ilgari uni chiqarib tashlardik — shu sababli
# haqiqiy Telegram foydalanuvchilari ilovaga kira olmasdi.
SIG=$(npx tsx "$ROOT/server/src/test/sign.ts" 900001 signature)
code=$(status "${JSON[@]}" -H "x-init-data: $SIG" "$API/me")
check "signature maydoni bilan imzo qabul qilinadi (200)" "$([ "$code" = 200 ] && echo 1)" "$code"

# Eskirgan imzo (24 soatdan katta)
OLD=$(npx tsx -e "
import {signInitData} from '$ROOT/server/src/test/initData';
import {config} from '$ROOT/server/src/lib/config';
const old = Math.floor(Date.now()/1000) - 90000;
process.stdout.write(signInitData({id:900001,first_name:'Aziz'}, config.telegram.botToken, old));
")
code=$(status "${JSON[@]}" -H "x-init-data: $OLD" "$API/me")
check "eskirgan imzo rad etiladi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Xavfsizlik sarlavhalari
HDRS=$(curl -s -D - -o /dev/null "$API/health")
for h in "x-content-type-options: nosniff" "x-frame-options: DENY" "referrer-policy: no-referrer"; do
  echo "$HDRS" | grep -qi "$h" && ok=1 || ok=
  check "sarlavha: ${h%%:*}" "$ok" "$(echo "$HDRS" | grep -io "${h%%:*}: .*" | tr -d '\r')"
done

echo "$HDRS" | grep -qi "x-powered-by" && leak=1 || leak=
check "x-powered-by yashirilgan" "$([ -z "$leak" ] && echo 1)" "$([ -n "$leak" ] && echo 'ochiq' || echo 'yopiq')"

# Tezlik cheklovi — AI eng qimmat marshrut.
# Ataylab BEGONA foydalanuvchi bilan: cheklov foydalanuvchi bo'yicha yuritiladi,
# shuning uchun bu bemorning byudjetini yemaydi va to'plamni qayta yugurtirish
# mumkin bo'lib qoladi.
RL=""
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  RL=$(status "${STRANGER[@]}" "${JSON[@]}" -X POST "$API/ai/chat" -d '{"turns":[{"role":"user","content":"cheklov sinovi"}]}')
done
check "AI marshruti cheklandi (429)" "$([ "$RL" = 429 ] && echo 1)" "$RL"

echo
echo "13. Telegram webhook"

# Sirsiz kirish yopiq — bu marshrut ochiq internetda turadi
code=$(status "${JSON[@]}" -X POST "$API/telegram/webhook" -d '{"message":{"chat":{"id":1},"text":"/start"}}')
check "sirsiz webhook rad etiladi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

code=$(status "${JSON[@]}" -H "x-telegram-bot-api-secret-token: notogri" \
  -X POST "$API/telegram/webhook" -d '{"message":{"chat":{"id":1},"text":"/start"}}')
check "noto'g'ri sir rad etiladi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# initData bilan ham o'tmaydi — himoya boshqacha
code=$(status "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/telegram/webhook" -d '{}')
check "initData webhook uchun yaramaydi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# To'g'ri sir bilan — yangilanish qabul qilinadi va 200 qaytadi.
# Telegram 200 dan boshqa javob olsa xabarni cheksiz qayta yuboradi.
SEC=$(grep -m1 '^TELEGRAM_WEBHOOK_SECRET=' "$ROOT/.env" | cut -d= -f2-)
code=$(status "${JSON[@]}" -H "x-telegram-bot-api-secret-token: $SEC" \
  -X POST "$API/telegram/webhook" -d '{"message":{"chat":{"id":1},"from":{"id":1},"text":"/start"}}')
check "to'g'ri sir bilan qabul qilinadi (200)" "$([ "$code" = 200 ] && echo 1)" "$code"

# Begona kontakt rad etiladi: boshqa odamning raqamini yuborib bo'lmaydi
code=$(status "${JSON[@]}" -H "x-telegram-bot-api-secret-token: $SEC" \
  -X POST "$API/telegram/webhook" \
  -d '{"message":{"chat":{"id":1},"from":{"id":1},"contact":{"phone_number":"+998901112233","user_id":999}}}')
check "begona kontaktda ham 200 (Telegram qayta yubormasin)" "$([ "$code" = 200 ] && echo 1)" "$code"

echo
echo "14. Bemor profili va tibbiy anketa"

# Telegram raqami o'zgartirilmaydi — `phone` maydoni umuman qabul qilinmaydi
BEFORE=$(curl -s "${PATIENT[@]}" "$API/me" | jqv '.user.phone')
curl -s "${PATIENT[@]}" "${JSON[@]}" -X PATCH "$API/me" -d '{"phone":"+998900000000"}' > /dev/null
AFTER=$(curl -s "${PATIENT[@]}" "$API/me" | jqv '.user.phone')
check "Telegram raqami o'zgartirilmaydi" "$([ "$BEFORE" = "$AFTER" ] && echo 1)" "$AFTER"

EXTRA=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X PATCH "$API/me" \
  -d '{"extraPhone":"+998901234567"}' | jqv '.extraPhone')
check "qo'shimcha raqam saqlandi" "$([ "$EXTRA" = "+998901234567" ] && echo 1)" "$EXTRA"

code=$(status "${PATIENT[@]}" "${JSON[@]}" -X PATCH "$API/me" -d '{"birthYear":1700}')
check "haqiqatga to'g'ri kelmaydigan yil rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

code=$(status "${PATIENT[@]}" "${JSON[@]}" -X PATCH "$API/me" -d '{"gender":"other"}')
check "noma'lum jins rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

# Tibbiy anketa
MED=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X PATCH "$API/me/medical" \
  -d '{"chronicConditions":["Gipertoniya"],"allergies":["Penitsillin"],"bloodType":"A+","heightCm":178}' | jqv '.bloodType')
check "tibbiy anketa saqlandi" "$([ "$MED" = "A+" ] && echo 1)" "$MED"

KEEP=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X PATCH "$API/me/medical" \
  -d '{"allergies":["Yod"]}' | jqv '.chronicConditions.length')
check "qisman yangilash qolganini saqladi" "$([ "$KEEP" = 1 ] && echo 1)" "$KEEP"

code=$(status "${PATIENT[@]}" "${JSON[@]}" -X PATCH "$API/me/medical" -d '{"heightCm":300}')
check "haqiqatga to'g'ri kelmaydigan bo'y rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

code=$(status "${STRANGER[@]}" "$API/me/medical")
check "anketa faqat o'ziniki (begona bo'sh oladi)" "$([ "$code" = 200 ] && echo 1)" "$code"

# So'rov kimga
FRIEND=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d '{"operationId":1,"cityId":1,"urgency":"normal","conditionText":"Onamning biqinida ogriq bor, tekshiruvda tosh topildi.","forSelf":false,"subjectName":"Malika Karimova","subjectBirthYear":1958,"subjectGender":"female","acceptTerms":true}' | jqv '.id')
SUBJ=$(curl -s "${PATIENT[@]}" "$API/requests/$FRIEND" | jqv '.request.subjectName')
check "tanish uchun so'rov saqlandi" "$([ "$SUBJ" = "Malika Karimova" ] && echo 1)" "$SUBJ"
curl -s "${PATIENT[@]}" -X POST "$API/requests/$FRIEND/cancel" > /dev/null

# O'ziga bo'lsa begona ism yozilmaydi
MINE=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d '{"operationId":1,"cityId":1,"urgency":"normal","conditionText":"Ozimning biqinimda ogriq, tekshiruvda tosh topildi.","forSelf":true,"subjectName":"Begona ism","acceptTerms":true}' | jqv '.id')
MSUBJ=$(curl -s "${PATIENT[@]}" "$API/requests/$MINE" | jqv '.request.subjectName')
check "o'ziga bo'lsa begona ism yozilmadi" "$([ -z "$MSUBJ" ] && echo 1)" "${MSUBJ:-bo_sh}"
curl -s "${PATIENT[@]}" -X POST "$API/requests/$MINE/cancel" > /dev/null

echo
echo "15. Klinika arizasi (ochiq veb-forma)"

# Ochiq marshrut autentifikatsiyasiz ishlaydi
REF=$(status "$API/public/reference")
check "ma'lumotnoma autentifikatsiyasiz ochiladi (200)" "$([ "$REF" = 200 ] && echo 1)" "$REF"

LIC="LIC-$(date +%s)"
PHONE="99890$(date +%H%M%S)"
EMAIL="klinika-$(date +%s)@test.local"
APP=$(curl -s "${JSON[@]}" -X POST "$API/public/clinic-application" \
  -d "{\"name\":\"Sinov Klinikasi\",\"cityId\":1,\"address\":\"Toshkent\",\"licenseNo\":\"$LIC\",\"contactName\":\"Aziz\",\"contactPhone\":\"$PHONE\",\"contactEmail\":\"$EMAIL\",\"operationIds\":[1]}" | jqv '.id')
check "ariza autentifikatsiyasiz qabul qilindi" "$([ -n "$APP" ] && echo 1)" "#$APP"

# Email endi IXTIYORIY — kirish identifikatori telefon raqami
code=$(status "${JSON[@]}" -X POST "$API/public/clinic-application" \
  -d "{\"name\":\"Emailsiz\",\"cityId\":1,\"address\":\"Toshkent\",\"licenseNo\":\"LIC-NOMAIL-$(date +%s)\",\"contactName\":\"Ali\",\"contactPhone\":\"99891$(date +%H%M%S)\",\"operationIds\":[1]}")
check "emailsiz ariza qabul qilinadi (201)" "$([ "$code" = 201 ] && echo 1)" "$code"

# Bir xil litsenziya bilan takror ariza
code=$(status "${JSON[@]}" -X POST "$API/public/clinic-application" \
  -d "{\"name\":\"Takror\",\"cityId\":1,\"address\":\"Toshkent\",\"licenseNo\":\"$LIC\",\"contactName\":\"Aziz\",\"contactPhone\":\"+998901112233\",\"contactEmail\":\"takror-$EMAIL\",\"operationIds\":[1]}")
check "takroriy litsenziya rad etiladi (409)" "$([ "$code" = 409 ] && echo 1)" "$code"

# Yo'nalishsiz ariza
code=$(status "${JSON[@]}" -X POST "$API/public/clinic-application" \
  -d '{"name":"Yonalishsiz","cityId":1,"address":"Toshkent","licenseNo":"LIC-X","contactName":"A","contactPhone":"+998901112233","contactEmail":"x@test.local","operationIds":[]}')
check "yo'nalishsiz ariza rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

# Ochiq marshrut faqat YOZUV uchun: GET ta'riflanmagan, shuning uchun
# so'rov autentifikatsiyaga tushadi va 401 qaytadi. Muhimi — 200 EMAS:
# arizalar ro'yxati ochiq internetdan o'qilmaydi.
code=$(status "$API/public/clinic-application")
check "arizalarni ochiq o'qib bo'lmaydi" "$([ "$code" != 200 ] && echo 1)" "$code"

code=$(status "$API/admin/applications")
check "arizalar ro'yxati autentifikatsiyasiz yopiq (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

code=$(status "${PATIENT[@]}" "$API/admin/applications")
check "bemor arizalarni ko'ra olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

# ── Tasdiqlash: klinika, veb hisob va parol havolasi bir vaqtda ──
SETUP=$(curl -s "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/applications/$APP/approve" | jqv '.connectCode')
check "tasdiqlangach parol havolasi berildi" "$([ -n "$SETUP" ] && echo 1)" "$SETUP"

code=$(status "${MOD[@]}" "${JSON[@]}" -X POST "$API/admin/applications/$APP/approve")
check "ikkinchi marta tasdiqlab bo'lmaydi (409)" "$([ "$code" = 409 ] && echo 1)" "$code"

# Parol o'rnatilmaguncha kirish mumkin emas
code=$(status "${JSON[@]}" -X POST "$API/web/login" -d "{\"login\":\"$PHONE\",\"password\":\"hech-qanday-parol\"}")
check "parolsiz hisobga kirib bo'lmaydi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Qisqa parol rad etiladi
code=$(status "${JSON[@]}" -X POST "$API/web/setup" -d "{\"token\":\"$SETUP\",\"password\":\"qisqa\"}")
check "qisqa parol rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

PWD_NEW="klinika-sinov-2026"
code=$(status "${JSON[@]}" -X POST "$API/web/setup" -d "{\"token\":\"$SETUP\",\"password\":\"$PWD_NEW\"}")
check "parol o'rnatildi (200)" "$([ "$code" = 200 ] && echo 1)" "$code"

# Havola bir martalik
code=$(status "${JSON[@]}" -X POST "$API/web/setup" -d "{\"token\":\"$SETUP\",\"password\":\"$PWD_NEW\"}")
check "havola ikkinchi marta ishlamaydi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# ── Kirish ──
NEW_TOKEN=$(curl -s "${JSON[@]}" -X POST "$API/web/login" -d "{\"login\":\"$PHONE\",\"password\":\"$PWD_NEW\"}" | jqv '.token')
check "yangi klinika kabinetga kirdi" "$([ -n "$NEW_TOKEN" ] && echo 1)" ""

code=$(status "${JSON[@]}" -X POST "$API/web/login" -d "{\"login\":\"$PHONE\",\"password\":\"boshqa-parol-butunlay\"}")
check "noto'g'ri parol rad etiladi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

code=$(status "${JSON[@]}" -X POST "$API/web/login" -d "{\"login\":\"998900000777\",\"password\":\"$PWD_NEW\"}")
check "mavjud bo'lmagan hisob ham 401 (mavjudligi oshkor bo'lmaydi)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Raqam boshqa shaklda yozilsa ham bir xil hisobga tushadi
ALT=$(curl -s "${JSON[@]}" -X POST "$API/web/login" \
  -d "{\"login\":\"+${PHONE}\",\"password\":\"$PWD_NEW\"}" | jqv '.token')
check "raqam boshqa shaklda ham ishlaydi" "$([ -n "$ALT" ] && echo 1)" ""

# Telegram ko'prigi: imzosiz ochilmaydi
code=$(status "${JSON[@]}" -X POST "$API/web/telegram" -d '{}')
check "Telegram ko'prigi imzosiz yopiq (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Ikkala belgi BIR VAQTDA yuborilsa: veb sessiya ustun bo'lmasligi va
# bemor imzosi klinika kabinetini ochmasligi kerak
code=$(status "${PATIENT[@]}" "${CLINIC[@]}" "$API/me")
check "ikki xil kirish belgisi rad etiladi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

# Bemor imzosi bilan — raqami bor, lekin klinika emas
STAND=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/web/telegram" -d '{}' | jqv '.standing.kind')
check "bemor uchun klinika topilmadi" "$([ "$STAND" = "none" ] || [ "$STAND" = "no_phone" ] && echo 1)" "$STAND"

NEW=(-H "authorization: Bearer $NEW_TOKEN")
CAB=$(curl -s "${NEW[@]}" "$API/clinic" | jqv '.clinic.name')
check "kabinet ochildi" "$([ "$CAB" = "Sinov Klinikasi" ] && echo 1)" "$CAB"

# Klinika hisobi admin paneliga kira olmaydi
code=$(status "${NEW[@]}" "$API/admin/applications")
check "klinika admin paneliga kira olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

# Telegram imzosi kabinetga yaramaydi
code=$(status "${PATIENT[@]}" "$API/clinic")
check "Telegram imzosi kabinetga yaramaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

# Chiqish sessiyani darhol bekor qiladi
curl -s "${NEW[@]}" -X POST "$API/web/logout" > /dev/null
# Token bekor bo'lgach so'rov autentifikatsiyasiz hisoblanadi
code=$(status "${NEW[@]}" "$API/clinic")
check "chiqqandan keyin sessiya ishlamaydi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Tasdiqlangan arizani o'chirib bo'lmaydi — undan klinika yaratilgan
code=$(status "${MOD[@]}" -X DELETE "$API/admin/applications/$APP")
check "tasdiqlangan arizani o'chirib bo'lmaydi (409)" "$([ "$code" = 409 ] && echo 1)" "$code"

echo
echo "16. So'rovni o'chirish"

# Cheklov olib tashlangan.
# Eski chegara "3 ta faol so'rov" edi, shuning uchun to'rttasi bir
# vaqtda ochiq tura olishi to'g'ridan-to'g'ri isbot.
DEL_IDS=""
for i in 1 2 3 4; do
  RID=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
    -d '{"operationId":1,"cityId":1,"budgetUzs":9000000,"urgency":"normal","attachments":[],"aiSuggested":false,"conditionText":"Holatim: qorin ong tomonida ogriq, tekshiruvda tosh topildi.","acceptTerms":true}' | jqv '.id')
  DEL_IDS="$DEL_IDS $RID"
done

ACTIVE=$(curl -s "${PATIENT[@]}" "$API/requests" \
  | jqv ".filter(function(r){return r.status==='NEW'||r.status==='COLLECTING'}).length")
check "faol so'rovlar eski chegaradan oshdi" "$([ -n "$ACTIVE" ] && [ "$ACTIVE" -gt 3 ] && echo 1)" "$ACTIVE"

FIRST=$(echo $DEL_IDS | awk '{print $1}')

# Begona odam o'chira olmaydi
code=$(status "${STRANGER[@]}" -X DELETE "$API/requests/$FIRST")
check "begona so'rovni o'chirib bo'lmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

# Egasi o'chiradi
code=$(status "${PATIENT[@]}" -X DELETE "$API/requests/$FIRST")
check "egasi o'chirdi (204)" "$([ "$code" = 204 ] && echo 1)" "$code"

# O'chirilgan so'rov endi ochilmaydi
code=$(status "${PATIENT[@]}" "$API/requests/$FIRST")
check "o'chirilgan so'rov topilmaydi (404)" "$([ "$code" = 404 ] && echo 1)" "$code"

# Qolganlarini tozalaymiz
for r in $(echo $DEL_IDS | cut -d' ' -f2-); do
  curl -s "${PATIENT[@]}" -X DELETE "$API/requests/$r" > /dev/null
done

echo
echo "17. Hisob xavfsizligi"

# NEW_TOKEN yuqorida chiqish sinovida yopilgan — yangi sessiya ochamiz
SEC_TOKEN=$(curl -s "${JSON[@]}" -X POST "$API/web/login" \
  -d "{\"login\":\"$PHONE\",\"password\":\"$PWD_NEW\"}" | jqv '.token')
SEC=(-H "authorization: Bearer $SEC_TOKEN")
check "yangi sessiya ochildi" "$([ -n "$SEC_TOKEN" ] && echo 1)" ""

# Sessiyalar ro'yxati
SESS=$(curl -s "${SEC[@]}" "$API/web/sessions" | jqv '.length')
check "ochiq sessiyalar ko'rinadi" "$([ -n "$SESS" ] && [ "$SESS" -ge 1 ] && echo 1)" "$SESS"

# 2FA sozlashni boshlash
OTP=$(curl -s "${SEC[@]}" "${JSON[@]}" -X POST "$API/web/totp/start" -d '{}' | jqv '.otpauth')
check "2FA sozlash boshlandi" "$(echo "$OTP" | grep -q '^otpauth://totp/' && echo 1)" "$OTP"

# Noto'g'ri kod rad etiladi
code=$(status "${SEC[@]}" "${JSON[@]}" -X POST "$API/web/totp/confirm" -d '{"code":"000000"}')
check "noto'g'ri kod rad etiladi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Sessiyasiz kirib bo'lmaydi
code=$(status "${JSON[@]}" -X POST "$API/web/totp/start" -d '{}')
check "sessiyasiz 2FA sozlab bo'lmaydi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Yaroqsiz token ham 401
code=$(status -H "authorization: Bearer yaroqsiz-token" "${JSON[@]}" -X POST "$API/web/totp/start" -d '{}')
check "yaroqsiz token rad etiladi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Parol: joriy parolsiz almashtirilmaydi
code=$(status "${SEC[@]}" "${JSON[@]}" -X POST "$API/web/password" \
  -d '{"currentPassword":"butunlay-boshqa","newPassword":"yangi-parol-2026"}')
check "joriy parolsiz almashtirilmaydi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

# Qisqa parol rad etiladi
code=$(status "${SEC[@]}" "${JSON[@]}" -X POST "$API/web/password" \
  -d "{\"currentPassword\":\"$PWD_NEW\",\"newPassword\":\"qisqa\"}")
check "qisqa parol rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

# Bemor bu marshrutlarga umuman kira olmaydi
code=$(status "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/web/totp/start" -d '{}')
check "bemor 2FA marshrutiga kirmaydi (401)" "$([ "$code" = 401 ] && echo 1)" "$code"

echo
echo "18. Taklif tafsilotlari va narx o'zgarishi"

OVER_REQ=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d '{"operationId":1,"cityId":1,"budgetUzs":5000000,"urgency":"normal","attachments":[],"aiSuggested":false,"conditionText":"Holatim: qorin ong tomonida ogriq, tekshiruvda tosh topildi.","acceptTerms":true}' | jqv '.id')

# Klinika bemor holatini taklif berishdan OLDIN ko'radi.
# So'rov OCHIQ bo'lishi kerak — yopilgani klinika ro'yxatida qolmaydi.
PCASE=$(curl -s "${CLINIC[@]}" "$API/clinic/requests/$OVER_REQ")
check "bemor yoshi ko'rinadi" "$(echo "$PCASE" | jqv '.patientCase.ageYears' | grep -qE '^[0-9]+$' && echo 1)" \
  "$(echo "$PCASE" | head -c 90)"
check "jinsi ko'rinadi" "$(echo "$PCASE" | jqv '.patientCase.gender' | grep -qE 'male|female' && echo 1)" ""
check "ism uzatilmaydi" "$(echo "$PCASE" | jqv '.patientCase' | grep -qv 'irstName' && echo 1)" ""

# Budjetdan yuqori narx: sababsiz rad, sabab bilan qabul

code=$(status "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/offers" \
  -d "{\"requestId\":$OVER_REQ,\"priceUzs\":7000000,\"includes\":[\"Operatsiya\"],\"advantages\":[],\"leadTimeDays\":5}")
check "budjetdan yuqori narx sababsiz rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

TOMORROW=$(date -d '+3 days' +%Y-%m-%d)
OVER_OFFER=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/offers" \
  -d "{\"requestId\":$OVER_REQ,\"priceUzs\":7000000,\"includes\":[\"Operatsiya\",\"Ozim yozgan xizmat\"],\"advantages\":[\"Oliy toifali jarroh\"],\"leadTimeDays\":5,\"proposedDates\":[\"$TOMORROW\"],\"aboveBudgetReason\":\"Robot yordamida operatsiya va bir kecha yotoq narxga kiradi\"}")
check "sabab bilan qabul qilindi" "$(echo "$OVER_OFFER" | jqv '.priceUzs' | grep -q '7000000' && echo 1)" ""
check "erkin matnli band saqlandi" "$(echo "$OVER_OFFER" | grep -q 'Ozim yozgan xizmat' && echo 1)" ""
check "taklif qilingan sana saqlandi" "$(echo "$OVER_OFFER" | grep -q "$TOMORROW" && echo 1)" ""

# O'tmish sanasi tashlanadi
PAST_OFFER=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X PATCH "$API/offers/$(echo "$OVER_OFFER" | jqv '.id')" \
  -d '{"proposedDates":["2020-01-01"]}')
check "o'tmish sanasi tashlandi" "$(echo "$PAST_OFFER" | grep -qv '2020-01-01' && echo 1)" ""

# Narx o'zgarishi: ikki tomon roziligi
OVER_DEAL=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests/$OVER_REQ/choose" \
  -d "{\"offerId\":$(echo "$OVER_OFFER" | jqv '.id')}" | jqv '.id')

code=$(status "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/deals/$OVER_DEAL/price-change" \
  -d '{"newPriceUzs":8000000,"reason":"qisqa"}')
check "qisqa sabab rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

CHANGE=$(curl -s "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/deals/$OVER_DEAL/price-change" \
  -d '{"newPriceUzs":8000000,"reason":"Tekshiruvda qoshimcha churra aniqlandi, uni ham olamiz"}' | jqv '.id')
check "o'zgarish taklif qilindi" "$([ -n "$CHANGE" ] && echo 1)" ""

# Taklif qilgan tomon o'zi qabul qila olmaydi
code=$(status "${CLINIC[@]}" "${JSON[@]}" -X POST "$API/deals/price-change/$CHANGE/respond" -d '{"accept":true}')
check "taklif qilgan tomon o'zi qabul qilolmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

ACCEPTED=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/deals/price-change/$CHANGE/respond" -d '{"accept":true}' | jqv '.status')
check "bemor qabul qildi" "$([ "$ACCEPTED" = "accepted" ] && echo 1)" "$ACCEPTED"

NEW_PRICE=$(curl -s "${PATIENT[@]}" "$API/deals/$OVER_DEAL" | jqv '.deal.agreedPriceUzs')
check "bitim narxi yangilandi" "$([ "$NEW_PRICE" = "8000000" ] && echo 1)" "$NEW_PRICE"

# Uchinchi shaxs tarixni ko'ra olmaydi
code=$(status "${STRANGER[@]}" "$API/deals/$OVER_DEAL/price-changes")
check "begona narx tarixini ko'ra olmaydi (403)" "$([ "$code" = 403 ] && echo 1)" "$code"

echo
echo "19. Sana oralig'i"

# O'tgan sana rad etiladi
code=$(status "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d '{"operationId":1,"cityId":1,"budgetUzs":9000000,"urgency":"normal","attachments":[],"aiSuggested":false,"conditionText":"Holatim: qorin ong tomonida ogriq, tekshiruvda tosh topildi.","acceptTerms":true,"dateFrom":"2020-01-01"}')
check "o'tgan sanali so'rov rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

# Sana bor bo'lsa moslashuvchanlik o'chadi — mijoz zid qiymat yuborsa ham
D1=$(date -d '+4 days' +%Y-%m-%d)
D2=$(date -d '+8 days' +%Y-%m-%d)
DR=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d "{\"operationId\":1,\"cityId\":1,\"budgetUzs\":9000000,\"urgency\":\"normal\",\"attachments\":[],\"aiSuggested\":false,\"conditionText\":\"Holatim: qorin ong tomonida ogriq, tekshiruvda tosh topildi.\",\"acceptTerms\":true,\"dateFrom\":\"$D1\",\"dateTo\":\"$D2\",\"dateFlexible\":true}")
check "sana bor — moslashuvchan emas" "$(echo "$DR" | jqv '.dateFlexible' | grep -q false && echo 1)" \
  "$(echo "$DR" | jqv '.dateFlexible')"

# Sanasiz so'rov moslashuvchan bo'ladi
FR=$(curl -s "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d '{"operationId":1,"cityId":1,"budgetUzs":9000000,"urgency":"normal","attachments":[],"aiSuggested":false,"conditionText":"Holatim: qorin ong tomonida ogriq, tekshiruvda tosh topildi.","acceptTerms":true,"dateFlexible":false}')
check "sanasiz — moslashuvchan" "$(echo "$FR" | jqv '.dateFlexible' | grep -q true && echo 1)" \
  "$(echo "$FR" | jqv '.dateFlexible')"

# Teskari tartib rad etiladi
code=$(status "${PATIENT[@]}" "${JSON[@]}" -X POST "$API/requests" \
  -d "{\"operationId\":1,\"cityId\":1,\"budgetUzs\":9000000,\"urgency\":\"normal\",\"attachments\":[],\"aiSuggested\":false,\"conditionText\":\"Holatim: qorin ong tomonida ogriq, tekshiruvda tosh topildi.\",\"acceptTerms\":true,\"dateFrom\":\"$D2\",\"dateTo\":\"$D1\"}")
check "teskari tartib rad etiladi (400)" "$([ "$code" = 400 ] && echo 1)" "$code"

# Tozalash
for r in $DR $FR; do
  curl -s "${PATIENT[@]}" -X DELETE "$API/requests/$(echo "$r" | jqv '.id')" > /dev/null 2>&1
done

# ── Tozalash ──
# Test yaratgan arizalar kunlik IP chegarasini yeb qo'ymasligi uchun
# rad etilganlarini o'chiramiz. Bu moderatorning spam tozalash yo'li.
for a in $(curl -s "${MOD[@]}" "$API/admin/applications?status=rejected" | jqv '.map(x=>x.id).join(" ")'); do
  curl -s "${MOD[@]}" -X DELETE "$API/admin/applications/$a" > /dev/null
done
for a in $(curl -s "${MOD[@]}" "$API/admin/applications?status=pending" | jqv '.map(x=>x.id).join(" ")'); do
  curl -s "${MOD[@]}" -X DELETE "$API/admin/applications/$a" > /dev/null
done

echo
echo "──────────────────────────────────────────────────"
echo "HTTP natija: $pass o'tdi, $fail yiqildi"
[ "$fail" -eq 0 ]
