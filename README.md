# KlinikaTop — tibbiy taklif platformasi

Bemor bitta so'rov qoldiradi → klinikalar narx va afzalliklari bilan taklif yuboradi →
bemor eng mosini o'zi tanlaydi. Telegram Mini App.

**Yadro g'oya:** bemor emas, klinikalar bir-biri bilan raqobatlashadi. Bu narxni
tabiiy tushiradi va tibbiy narxlarni shaffof qiladi.

---

## Tez boshlash

```bash
npm install
npm run seed          # katalog + cold-start narxlar + demo klinikalar
npm run dev           # server :8080  ·  webapp :5173
```

Brauzerda ochish (Telegram tashqarisida, ishlab chiqish uchun):

```
http://localhost:5173/?dev=900001      # bemor sifatida
http://localhost:5173/?dev=900002      # klinika sifatida
http://localhost:5173/?dev=900003      # moderator sifatida
```

`?dev=<id>` faqat `ALLOW_DEV_AUTH=true` bo'lganda ishlaydi va production'da o'chirilgan.

Moderator/admin roli faqat qo'lda beriladi:

```bash
npm run grant -- 900003 moderator
```

## Sozlash

`.env.example` dan `.env` yarating. Muhim kalitlar:

| Kalit | Ma'nosi |
|---|---|
| `TELEGRAM_BOT_TOKEN` | bo'sh bo'lsa — dev auth, push yuborilmaydi |
| `ALLOW_DEV_AUTH` | production'da **albatta** `false` |
| `ANTHROPIC_API_KEY` | bo'sh bo'lsa AI lokal heuristikaga tushadi |
| `COMMISSION_PERCENT` | tasdiqlangan bitimdan olinadigan foiz (5) |
| `REQUEST_TTL_HOURS` | so'rov javob kutish muddati (24) |

## Test

```bash
npm test          # 53 ta tekshiruv: mantiq, lifecycle, qoidalar
npm run test:http # 26 ta tekshiruv: marshrutlar, huquqlar (server ishlab turishi kerak)
npm run typecheck
```

---

## Arxitektura

```
shared/types.ts        yagona shartnoma: modellar, lifecycle, WS hodisalari
server/                Express + SQLite + WebSocket + Claude API
  db/                  schema.sql, seed, migratsiya
  services/            biznes mantiq (bu yerda qoidalar majburlanadi)
  routes/              yupqa HTTP qatlami — validatsiya va chaqiruv
webapp/                React + Vite + Framer Motion (Telegram Mini App)
  ui/                  dizayn tizimi primitivlari
  screens/             ekranlar
```

Mantiq **servislarda**, marshrutlarda emas. Shuning uchun `npm test` marshrutsiz
ham qoidalarni to'liq tekshira oladi.

### Yadro qoidalari (kodda majburlangan)

| Qoida | Qayerda |
|---|---|
| So'rov: `NEW → COLLECTING → CHOSEN → COMPLETED / CANCELLED` | `services/requests.ts` |
| Bitim: `SELECTED → AGREED → PERFORMED → CONFIRMED` (bosqich o'tkazib bo'lmaydi) | `services/deals.ts` |
| Matching: operatsiya **+** shahar **+** faol obuna **+** tasdiqlangan klinika | `services/matching.ts` |
| Taklifda "narxga nima kiradi" — majburiy | `services/offers.ts` |
| Bitta klinika bitta so'rovga bitta faol taklif | DB `uq_offer_active` |
| Chat faqat tanlovdan **keyin** ochiladi | `services/chat.ts` |
| Telefon/havola chatda yashiriladi, narx yashirilmaydi | `services/chat.ts` → `redact()` |
| Komissiya faqat **tasdiqlangan** bitimning real summasidan | `services/deals.ts` |
| Narx statistikasi faqat tasdiqlangan bitimlardan; yetmasa "taxminiy" belgisi | `services/priceStats.ts` |
| Sharh faqat tasdiqlangan bitim egasidan, bitimga bitta | `services/reviews.ts` |
| AI tashxis qo'ymaydi — har javobda ogohlantirish | `services/ai.ts` |

### Narx shaffofligi

Ikki manba **aralashmaydi** va foydalanuvchiga qaysi biri ekani ko'rsatiladi:

- `source: 'manual'` — cold start, bozor tadqiqoti asosidagi taxminiy oraliq
- `source: 'deals'` — oxirgi 30 kundagi real tasdiqlangan to'lovlar

`MIN_DEALS_FOR_PRICE_STATS` (5) tadan kam bitim bo'lsa — `lowConfidence: true`.

### AI

Claude API (`claude-opus-5`) strukturaviy chiqish bilan: model faqat katalogdagi
`slug` ro'yxatidan tanlaydi, natija zod bilan qayta tekshiriladi. API kaliti
bo'lmasa yoki javob kechiksa (25 s) — kalit so'z heuristikasiga tushadi, ya'ni
platforma AI'siz ham to'liq ishlaydi.

### Realtime

Bitta WebSocket, ko'p kanal (`user:`, `request:`, `deal:`, `clinic:`).
Har obuna server tomonda **egalik bo'yicha** tekshiriladi — bemor faqat o'z
so'rovini eshitadi (tibbiy maxfiylik).

---

## Ishlab chiqilmagan (keyingi bosqichlar)

- To'lov integratsiyasi (depozit/escrow) — hozir obuna qo'lda faollashtiriladi
- Fayl yuklash (analiz surati) — maydonlar tayyor, saqlash qatlami yo'q
- Rassrochka hamkorligi, referral, bo'sh slot boshqaruvi
