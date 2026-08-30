# nginx sozlamasi

`klinikatop.conf` — prodda `/etc/nginx/sites-enabled/klinikatop` da turgan
faylning nusxasi.

## Nima uchun repo'da

Bu fayl uzoq vaqt faqat SERVERDA yashadi va bu bir marta qimmatga tushdi:
`index.html` uchun `Cache-Control` sarlavhasi yo'q edi, brauzer uni evristik
bilan keshlab qo'ydi va eski qobiq allaqachon o'chirilgan JS faylni
chaqirdi — ilova umuman ochilmadi (qora ekran). Sozlama repo'da bo'lganda
bunday qoida ko'rib chiqiladi va tasodifan yo'qolmaydi.

## Qo'llash

`deploy/deploy.sh` nginx'ga TEGMAYDI — u faqat kod va statik fayllarni
yuboradi. Sozlama qo'lda qo'llanadi:

```sh
scp deploy/nginx/klinikatop.conf root@SERVER:/etc/nginx/sites-available/klinikatop
ssh root@SERVER 'nginx -t && systemctl reload nginx'
```

`nginx -t` dan o'tmasa qayta yuklamang: `reload` buzuq sozlama bilan eski
jarayonni saqlab qoladi, lekin keyingi `restart` da sayt butunlay o'chadi.

## Ikkita qoida — ularga tegmang

**`location = /index.html` → `no-cache, must-revalidate`.** Har deploy'da
JS fayllar yangi hash bilan yoziladi va eskilari o'chiriladi. `index.html`
keshlansa, eski qobiq yo'q bo'lgan skriptni chaqiradi va ilova ochilmaydi.

**`location /assets/` → `immutable`.** Bu esa aksincha: fayllar hash bilan
nomlangan, ya'ni mazmuni o'zgarsa nomi ham o'zgaradi. Shuning uchun ularni
bir yil keshlash xavfsiz va kerak.

Ikkalasi birga ishlaydi: qobiq har safar tekshiriladi, og'ir fayllar esa
qayta yuklanmaydi.

## banisa.uz

Bir serverda ikkita mahsulot turadi. nginx so'rovni `server_name` bo'yicha
ajratadi va bu fayl faqat `klinikatop.uz` ni boshqaradi — banisa'ning
sozlamasiga tegilmaydi.
