# Serverga qo'yish

KlinikaTop `137.184.103.148` da banisa.uz bilan **yonma-yon**, butunlay ajratilgan
holda ishlaydi.

## Ajratish nuqtalari

| | KlinikaTop | banisa.uz |
|---|---|---|
| Foydalanuvchi | `klinikatop` (tizim, kirishsiz) | `root` |
| Port | `127.0.0.1:8791` | `*:5000` |
| Papka | `/opt/klinikatop`, `/var/lib/klinikatop` | `/root/banisa` |
| Baza | SQLite fayl | PostgreSQL |
| Boshqaruv | systemd | PM2 |
| Xotira chegarasi | 384 MB (`MemoryMax`) | — |

`ProtectSystem=strict` va `ReadWritePaths=/var/lib/klinikatop` tufayli KlinikaTop
banisa.uz fayllariga **yoza olmaydi**.

## Serverdagi fayllar

```
/opt/klinikatop/                    ilova (dist, webapp, node_modules)
/var/lib/klinikatop/klinikatop.db        baza
/var/lib/klinikatop/uploads/        tibbiy hujjatlar (chmod 750)
/var/backups/klinikatop/            zaxira nusxalar, 14 kun saqlanadi
/etc/klinikatop.env                 muhit o'zgaruvchilari (chmod 640)
/etc/systemd/system/klinikatop.service
/etc/systemd/system/klinikatop-backup.{service,timer}
/etc/nginx/sites-available/klinikatop   ← domen kelgach yoqiladi
```

## Yangilanish yuborish

```bash
bash deploy/deploy.sh
```

Skript avval lokal testlarni yuritadi, keyin build qiladi, so'ng serverga
yuboradi. Migratsiyadan **oldin** avtomatik zaxira nusxa oladi.

## Zaxira nusxa

Har kuni 03:30 da (`klinikatop-backup.timer`). SQLite'ning `backup` API'si
ishlatiladi — ilova ishlab turganda ham izchil nusxa oladi. Hujjatlar
`tar.gz` ga yig'iladi. 14 kundan eskisi o'chiriladi.

Qo'lda: `systemctl start klinikatop-backup.service`

Tiklash:
```bash
systemctl stop klinikatop
cp /var/backups/klinikatop/klinikatop-YYYY-MM-DD-HH-MM-SS.db /var/lib/klinikatop/klinikatop.db
tar -xzf /var/backups/klinikatop/uploads-YYYY-....tar.gz -C /var/lib/klinikatop/
chown -R klinikatop:klinikatop /var/lib/klinikatop
systemctl start klinikatop
```

## Ishga tushirish uchun qolgani

1. **Bot tokeni** — @BotFather dan, `/etc/klinikatop.env` dagi `TELEGRAM_BOT_TOKEN`
2. **Domen** — DNS A yozuvi `137.184.103.148` ga
3. Bitta buyruq — qolganini skript qiladi:

```bash
bash deploy/activate-domain.sh klinikatop.uz
```

Skript avval DNS haqiqatan shu serverga qarayotganini tekshiradi, keyin
nginx blokini yoqadi (xato bo'lsa **qaytaradi**, banisa.uz buzilmasin),
sertifikat oladi, `.env` ni to'ldiradi va tekshiruv natijasini ko'rsatadi.

4. @BotFather da Mini App manzilini `https://<domen>` qilib qo'yish
