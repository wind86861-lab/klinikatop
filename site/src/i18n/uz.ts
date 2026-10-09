/**
 * Sayt matnlari — o'zbekcha.
 *
 * Hamma matn SHU YERDA: komponentlarda satr yo'q. Rus tili
 * `ru.ts` da aynan shu tuzilishda — biri o'zgarsa, ikkinchisi ham.
 *
 * Raqamlar (komissiya, bepul davr) `site.ts` da: ular biznes
 * qarori va bir joyda turishi kerak.
 */
import { site } from '../site';

export const uz = {
  lang: 'uz' as 'uz' | 'ru',
  locale: 'uz_UZ',
  paths: { home: '/', clinics: '/klinikalar-uchun/', auth: '/royxatdan-otish/', login: '/kirish/' },
  alt: { lang: 'ru', label: 'RU', home: '/ru/', clinics: '/ru/dlya-klinik/', auth: '/ru/registratsiya/', login: '/ru/vkhod/' },

  nav: {
    how: 'Qanday ishlaydi',
    patients: 'Bemorlarga',
    clinics: 'Klinikalar uchun',
    faq: 'Savollar',
    login: 'Kirish',
    cta: 'So‘rov qoldirish',
    menu: 'Menyu',
    close: 'Yopish',
  },

  common: {
    telegram: 'Telegramda ochish',
    browser: 'Brauzerda davom etish',
    sample: 'Namuna',
    soon: 'Video tez orada',
    watch: 'Videoni ko‘rish',
    uploadHint: 'Rasm admin panelidan yuklanadi',
  },

  home: {
    meta: {
      title: 'KlinikaTop — klinikalar narxini solishtiring, eng mos taklifni tanlang',
      description:
        'Bitta so‘rov qoldiring — tekshirilgan klinikalar operatsiya, MRT, tahlil va davolanish uchun narx va shartlari bilan taklif yuboradi. Bemor uchun bepul.',
    },
    hero: {
      title: 'Bitta so‘rov — klinikalar o‘zi taklif yuboradi',
      lead:
        'Operatsiya, MRT, tahlil yoki yo‘llanma — ehtiyojingizni yozing. Tekshirilgan klinikalar narx, muddat va shartlari bilan javob beradi, tanlov sizda.',
      primary: 'So‘rov qoldirish',
      secondary: 'Qanday ishlaydi',
    },
    stats: {
      title: 'Platforma raqamlarda',
      clinics: 'tasdiqlangan klinika',
      operations: 'operatsiya va muolaja',
      labTests: 'tahlil turi',
      cities: 'hudud',
      free: 'so‘m — bemor uchun to‘lov',
      note: 'Raqamlar serverdan jonli olinadi',
    },
    problem: {
      eyebrow: 'Muammo',
      title: 'Tibbiy xizmat narxini bilish hali ham qiyin',
      before: [
        'O‘nlab klinikaga qo‘ng‘iroq qilasiz — har biri boshqacha narx aytadi',
        'Narxga nima kirishini hech kim aniq aytmaydi, keyin qo‘shimcha to‘lovlar chiqadi',
        'Qaysi klinikaga ishonish mumkinligini bilish qiyin',
      ],
      after: [
        'Bitta so‘rov — mos klinikalar o‘zi javob beradi',
        'Har taklifda narxga nima kirishi majburiy yoziladi',
        'Faqat litsenziyasi tekshirilgan klinikalar, haqiqiy bemor sharhlari',
      ],
      beforeLabel: 'Hozir',
      afterLabel: 'KlinikaTop bilan',
    },
    steps: {
      eyebrow: 'Qanday ishlaydi',
      title: '5 bosqichda to‘g‘ri tanlov',
      lead: 'So‘rovdan davolanishgacha — hammasi bir joyda, shaffof va nazorat ostida.',
      items: [
        {
          title: 'Bemor so‘rov yaratadi',
          text: 'Xizmat turini tanlaysiz: operatsiya, tahlil yoki shifokor yo‘llanmasi. Shahar, byudjet va qulay sanani belgilaysiz.',
          points: ['Xizmat yoki tahlil turi', 'Byudjet oralig‘i', 'Qo‘shimcha izoh va hujjatlar'],
        },
        {
          title: 'Tizim mos klinikalarga yuboradi',
          text: 'So‘rov faqat shu xizmatni bajaradigan, sizning hududingizdagi tasdiqlangan klinikalarga boradi. Shaxsiy ma’lumotlaringiz yashirin qoladi.',
          points: ['Xizmat va hudud bo‘yicha saralash', 'Faqat tasdiqlangan klinikalar', 'Tibbiy maxfiylik'],
        },
        {
          title: 'Klinikalar taklif yuboradi',
          text: 'Har klinika narx, muddat va narxga nimalar kirishini yozadi. Klinikalar bir-biri bilan raqobatlashadi — siz emas.',
          points: ['Aniq narx', 'Narxga nima kiradi', 'Bajarish muddati'],
        },
        {
          title: 'Bemor takliflarni solishtiradi',
          text: 'Narx, reyting, sharhlar va shartlarni yonma-yon ko‘rasiz. Bozordagi o‘rtacha narx ham ko‘rsatiladi.',
          points: ['Narx va reyting', 'Haqiqiy sharhlar', 'O‘rtacha bozor narxi'],
        },
        {
          title: 'Bemor yakuniy qarorni qabul qiladi',
          text: 'Eng mos taklifni tanlaysiz — klinika bilan chat ochiladi, sana kelishiladi. Davolanishdan keyin sharh qoldirasiz.',
          points: ['Klinika bilan xavfsiz chat', 'Sana va vaqtni kelishish', 'Sharh va baho'],
        },
      ],
    },
    video: {
      eyebrow: 'Video',
      title: 'KlinikaTop bir daqiqada',
      text: 'So‘rov qoldirishdan klinika tanlashgacha — butun jarayonni qisqa videoda ko‘ring.',
    },
    benefits: {
      eyebrow: 'Bemorlarga',
      title: 'Nega bemorlar KlinikaTop’ni tanlaydi',
      items: [
        { title: 'Tez va oson', text: 'Bitta so‘rov bir necha daqiqa oladi. Takliflar Telegram’ga keladi.' },
        { title: 'Erkin tanlov', text: 'Bir nechta klinika taklifini narx va sifat bo‘yicha solishtirasiz.' },
        { title: 'Butunlay bepul', text: `Bemor uchun platforma bepul. Hech qanday yashirin to‘lov yo‘q.` },
        { title: 'Shaxsiy tibbiy profil', text: 'Tahlil va hujjatlaringiz bir joyda, faqat siz ruxsat berganga ochiq.' },
      ],
    },
    services: {
      eyebrow: 'Xizmatlar',
      title: 'Nima bo‘yicha so‘rov qoldirish mumkin',
      items: [
        {
          title: 'Operatsiya va muolajalar',
          text: 'Jarrohlik, ko‘z, stomatologiya, ginekologiya, ortopediya va boshqa yo‘nalishlar.',
          tags: ['Jarrohlik', 'Ko‘z', 'Stomatologiya', 'Ortopediya'],
        },
        {
          title: 'Tahlil va diagnostika',
          text: 'Qon tahlillari, MRT, MSKT, UZI va boshqa tekshiruvlar — ro‘yxatdan tanlaysiz.',
          tags: ['Qon tahlili', 'MRT', 'MSKT', 'UZI'],
        },
        {
          title: 'Shifokor yo‘llanmasi',
          text: 'Yo‘llanmani rasmga oling — klinikalar undagi hamma tekshiruv uchun narx beradi.',
          tags: ['Rasm orqali', 'Tahlillar ro‘yxati', 'Bitta narx'],
        },
      ],
    },
    clinicsBand: {
      eyebrow: 'Klinikalar uchun',
      title: 'Bemor sizni o‘zi topadi',
      text: 'Reklamaga pul sarflamasdan — tayyor ehtiyoji bor bemorlarga taklif yuboring.',
      items: [
        'Doimiy bemor oqimi',
        'Bo‘sh resurslardan foydalanish',
        'Sog‘lom raqobat muhiti',
        'Aniq statistik tahlil',
      ],
      cta: 'Klinikalar uchun batafsil',
    },
    trust: {
      eyebrow: 'Ishonch',
      title: 'Sog‘lig‘ingiz — jiddiy masala. Biz ham jiddiy yondashamiz',
      items: [
        { title: 'Tekshirilgan klinikalar', text: 'Har klinika litsenziyasi va hujjatlari moderator tomonidan tekshiriladi.' },
        { title: 'Tibbiy maxfiylik', text: 'So‘rovingiz faqat mos klinikalarga boradi. Telefon raqamingiz tanlovgacha yashirin.' },
        { title: 'Haqiqiy sharhlar', text: 'Sharhni faqat shu klinikada haqiqatan davolangan bemor qoldira oladi.' },
        { title: 'AI tashxis qo‘ymaydi', text: 'Sun’iy intellekt faqat to‘g‘ri xizmatni topishga yordam beradi. Tashxis — shifokor ishi.' },
      ],
    },
    partners: {
      eyebrow: 'Hamkorlar',
      title: 'Platformadagi klinikalar',
    },
    faq: {
      eyebrow: 'Savollar',
      title: 'Ko‘p beriladigan savollar',
      items: [
        {
          q: 'KlinikaTop bemor uchun pullikmi?',
          a: 'Yo‘q. Bemor uchun platforma butunlay bepul. Davolanish uchun to‘lovni to‘g‘ridan-to‘g‘ri klinikaga, kelishilgan narxda qilasiz.',
        },
        {
          q: 'So‘rov qoldirish qancha vaqt oladi?',
          a: 'Bir necha daqiqa. Xizmatni tanlaysiz, shahar va byudjetni belgilaysiz — so‘rov darhol mos klinikalarga yuboriladi.',
        },
        {
          q: 'Takliflar qachon keladi?',
          a: 'So‘rov 24 soat davomida taklif yig‘adi. Har yangi taklif haqida Telegram orqali darhol xabar olasiz.',
        },
        {
          q: 'Klinikalar ishonchlimi?',
          a: 'Platformaga faqat litsenziyasi va hujjatlari tekshirilgan klinikalar qo‘shiladi. Sharhlarni esa faqat haqiqatan davolangan bemorlar qoldiradi.',
        },
        {
          q: 'Telefon raqamim kimga ko‘rinadi?',
          a: 'Hech kimga — siz taklifni tanlamaguningizcha. Tanlovdan keyin faqat tanlangan klinika bilan chat ochiladi.',
        },
        {
          q: 'Taklifni tanlaganimdan keyin rad eta olamanmi?',
          a: 'Ha. Tanlov sizni hech narsaga majburlamaydi: klinika bilan kelisha olmasangiz, bitimni bekor qilib, yangi so‘rov qoldirishingiz mumkin.',
        },
        {
          q: 'Telegram bo‘lmasa-chi?',
          a: 'Brauzerdan ham kirish mumkin — telefon raqamingizga kelgan kod bilan.',
        },
        {
          q: 'AI menga tashxis qo‘yadimi?',
          a: 'Yo‘q. AI faqat shikoyatingizga qarab qaysi xizmat kerakligini topishga yordam beradi. Tashxisni faqat shifokor qo‘yadi.',
        },
      ],
    },
    cta: {
      title: 'To‘g‘ri tanlov — sog‘lom kelajak',
      text: 'Birinchi so‘rovingizni hoziroq qoldiring. Bu bepul va bir necha daqiqa oladi.',
    },
  },

  clinics: {
    meta: {
      title: 'Klinikalar uchun — KlinikaTop orqali yangi bemorlarni oling',
      description:
        'Tayyor ehtiyoji bor bemorlarning so‘rovlarini qabul qiling va taklif yuboring. Reklamasiz bemor oqimi, bo‘sh vaqtlarni to‘ldirish va shaffof statistika.',
    },
    hero: {
      eyebrow: 'Klinikalar uchun',
      title: 'Bemor sizni o‘zi topadi',
      lead:
        'KlinikaTop’da bemorlar aniq ehtiyoj bilan so‘rov qoldiradi: xizmat, shahar, byudjet. Siz taklif yuborasiz — bemor sizni tanlaydi. Reklama byudjetisiz.',
      primary: 'Klinikani ulash',
      secondary: 'Kabinetga kirish',
      chips: [`Dastlabki ${site.trialMonths} oy — obunasiz`, 'Komissiya faqat natijadan', 'Tez ulanish'],
    },
    why: {
      eyebrow: 'Afzalliklar',
      title: 'Nega klinikalar KlinikaTop’ni tanlaydi',
      items: [
        { title: 'Doimiy bemor oqimi', text: 'Hududingizdagi, sizning xizmatlaringizga mos so‘rovlar to‘g‘ridan-to‘g‘ri kabinetga keladi.' },
        { title: 'Bo‘sh resurslardan foydalanish', text: 'Shifokor va uskunalarning band bo‘lmagan vaqtini qo‘shimcha daromadga aylantiring.' },
        { title: 'Sog‘lom raqobat', text: 'Sifat va narx asosida adolatli raqobat. Yaxshi xizmat — yuqori reyting — ko‘proq bemor.' },
        { title: 'Aniq statistika', text: 'So‘rovlar, takliflar, konversiya va daromad — hammasi kabinetda, grafik ko‘rinishida.' },
      ],
    },
    flow: {
      eyebrow: 'Jarayon',
      title: 'Klinika uchun qanday ishlaydi',
      items: [
        { title: 'Ariza qoldirasiz', text: 'Klinika ma’lumotlari, litsenziya va xizmatlar ro‘yxati — bir necha daqiqada.' },
        { title: 'Tekshiruvdan o‘tasiz', text: 'Moderator hujjatlarni tekshiradi va kabinetingizni ochadi.' },
        { title: 'So‘rovlarni olasiz', text: 'Mos so‘rov kelishi bilan Telegram va kabinetda xabar olasiz.' },
        { title: 'Taklif yuborasiz', text: 'Narx, muddat va narxga nima kirishini yozasiz. Shablonlar vaqtni tejaydi.' },
        { title: 'Bemorni qabul qilasiz', text: 'Tanlangach, bemor bilan chat ochiladi. Xizmat ko‘rsatiladi, bitim tasdiqlanadi.' },
      ],
    },
    cabinet: {
      eyebrow: 'Kabinet',
      title: 'Hammasi bitta kabinetda',
      text: 'So‘rovlar, takliflar, bitimlar, kalendar, shifokorlar, sharhlar va moliya — kompyuterda ham, telefonda ham.',
      shots: ['So‘rovlar taxtasi', 'Taklif yuborish', 'Bitimlar va kalendar', 'Analitika'],
    },
    pricing: {
      eyebrow: 'Shartlar',
      title: 'Shaffof va adolatli shartlar',
      items: [
        { value: `${site.trialMonths} oy`, title: 'obunasiz ishlash', text: 'Tasdiqlangandan keyin dastlabki davrda obuna to‘lovi yo‘q.' },
        { value: `${site.commissionPercent}%`, title: 'faqat natijadan', text: 'Komissiya faqat bemor tasdiqlagan bitimning haqiqiy summasidan olinadi.' },
        { value: '0', title: 'yashirin to‘lov', text: 'Reklama, “ko‘tarish” yoki joy sotib olish yo‘q. Reyting faqat sifatdan.' },
      ],
    },
    video: {
      eyebrow: 'Video',
      title: 'Kabinet bilan tanishing',
      text: 'Klinika kabinetida so‘rov olishdan bitimni yopishgacha bo‘lgan jarayon.',
    },
    faq: {
      eyebrow: 'Savollar',
      title: 'Klinikalar so‘raydigan savollar',
      items: [
        {
          q: 'Ulanish uchun nima kerak?',
          a: 'Klinika nomi, manzili, litsenziya raqami va uning nusxasi (PDF yoki surat), mas’ul shaxs telefoni. Arizani bir necha daqiqada to‘ldirasiz, moderator tekshirib, kabinetni ochadi.',
        },
        {
          q: 'Qancha turadi?',
          a: `Tasdiqlangandan keyin dastlabki ${site.trialMonths} oy obuna to‘lovi yo‘q. Komissiya faqat bemor tasdiqlagan bitimning haqiqiy summasidan — ${site.commissionPercent}% olinadi.`,
        },
        {
          q: 'Qaysi so‘rovlarni ko‘raman?',
          a: 'Faqat kabinetingizda belgilagan xizmatlaringiz va hududingizga mos so‘rovlarni.',
        },
        {
          q: 'Bemor bilan to‘g‘ridan-to‘g‘ri bog‘lana olamanmi?',
          a: 'Bemor taklifingizni tanlagach, platforma ichida chat ochiladi va shu yerda sana, vaqt va tafsilotlar kelishiladi.',
        },
        {
          q: 'banisa.uz’dagi ma’lumotlarim ulanadimi?',
          a: 'Ha. banisa.uz’da hisobingiz bo‘lsa, klinikani bir tugma bilan ulash mumkin — ma’lumotlar qaytadan kiritilmaydi.',
        },
      ],
    },
    cta: {
      title: 'Klinikangizni bugun ulang',
      text: 'Ariza bir necha daqiqa oladi. Tasdiqlangach, birinchi so‘rovlar darhol kela boshlaydi.',
    },
  },

  auth: {
    meta: {
      title: 'Ro‘yxatdan o‘tish — KlinikaTop',
      description: 'Telegramsiz ham: telefon raqamingiz bilan KlinikaTop’ga kiring yoki ro‘yxatdan o‘ting va klinikalardan taklif oling.',
    },
    eyebrow: 'Ro‘yxatdan o‘tish',
    title: 'Telegramsiz ham — telefon raqamingiz bilan',
    lead: 'Raqamingizni bir marta kod bilan tasdiqlaysiz va parol o‘ylab topasiz. Keyin telefon raqami va parol bilan kirasiz — SMS kutmasdan.',
    points: [
      'Bir necha daqiqada ro‘yxatdan o‘tasiz',
      'Raqamingiz klinikalarga tanlovingizgacha ko‘rinmaydi',
      'Bemor uchun butunlay bepul',
    ],
    steps: ['Telefon', 'Kod', 'Parol', 'Profil'],
    phone: {
      title: 'Telefon raqamingiz',
      sub: 'Shu raqamga tasdiqlash kodi yuboriladi',
      label: 'Telefon raqami',
      submit: 'Kod olish',
    },
    code: {
      title: 'Kodni kiriting',
      subSms: 'SMS orqali {phone} raqamiga 6 xonali kod yuborildi',
      subTg: 'Kod Telegram’dagi KlinikaTop botiga yuborildi ({phone})',
      label: 'Tasdiqlash kodi',
      submit: 'Tasdiqlash',
      resend: 'Kodni qayta yuborish',
      resendIn: 'Qayta yuborish {s} soniyadan keyin',
      change: 'Raqamni o‘zgartirish',
    },
    profile: {
      title: 'Profilingiz',
      sub: 'Klinikalar kimga taklif berayotganini bilishi kerak',
      firstName: 'Ism',
      lastName: 'Familiya',
      city: 'Viloyat',
      cityPick: 'Tanlang',
      birthYear: 'Tug‘ilgan yil',
      gender: 'Jins',
      male: 'Erkak',
      female: 'Ayol',
      submit: 'Ro‘yxatdan o‘tish',
    },
    password: {
      title: 'Parol o‘ylab toping',
      sub: 'Keyingi safar telefon raqamingiz va shu parol bilan kirasiz — SMS kerak bo‘lmaydi',
      label: 'Parol',
      repeat: 'Parolni takrorlang',
      hint: 'Kamida 8 belgi, faqat raqamlardan iborat bo‘lmasin',
      show: 'Ko‘rsatish',
      submit: 'Parolni saqlash',
      mismatch: 'Parollar bir xil emas',
    },
    reset: {
      eyebrow: 'Parolni tiklash',
      title: 'Parolni unutdingizmi?',
      lead: 'Raqamingizga kod yuboramiz, keyin yangi parol o‘rnatasiz.',
      passwordTitle: 'Yangi parol',
    },
    haveAccount: 'Hisobingiz bormi?',
    loginLink: 'Kirish',
    done: 'Tayyor! Ilovaga o‘tyapmiz…',
    noSms: {
      title: 'SMS hozircha ishlamayapti',
      text: 'Telegramsiz ro‘yxatdan o‘tish tez orada ishga tushadi. Hozircha Telegram orqali kiring — bu bir daqiqa oladi.',
      cta: 'Telegram orqali kirish',
    },
    error: 'Xatolik yuz berdi. Qayta urinib ko‘ring.',
    terms: 'Davom etib, siz foydalanish shartlariga rozilik bildirasiz.',
    telegramAlt: 'Telegram orqali kirish',
  },

  login: {
    meta: {
      title: 'Kirish — KlinikaTop',
      description: 'KlinikaTop’ga telefon raqamingiz va parolingiz bilan kiring.',
    },
    eyebrow: 'Kirish',
    title: 'Xush kelibsiz',
    lead: 'Telefon raqamingiz va parolingiz bilan kiring. SMS kutish shart emas.',
    phone: 'Telefon raqami',
    password: 'Parol',
    submit: 'Kirish',
    forgot: 'Parolni unutdingizmi?',
    noAccount: 'Hisobingiz yo‘qmi?',
    register: 'Ro‘yxatdan o‘ting',
    done: 'Kirdingiz! Ilovaga o‘tyapmiz…',
  },

  footer: {
    tagline: 'To‘g‘ri tanlov — sog‘lom kelajak',
    about: 'Bemor va klinikalarni shaffof, raqobatbardosh muhitda bog‘laydigan tibbiy takliflar platformasi.',
    product: 'Platforma',
    company: 'Klinikalar',
    contact: 'Aloqa',
    links: {
      how: 'Qanday ishlaydi',
      faq: 'Savollar',
      app: 'Ilovani ochish',
      clinics: 'Klinikalar uchun',
      signup: 'Ariza qoldirish',
      cabinet: 'Klinika kabineti',
    },
    rights: 'Barcha huquqlar himoyalangan.',
    disclaimer: 'KlinikaTop tibbiy xizmat ko‘rsatmaydi va tashxis qo‘ymaydi. Davolanish bo‘yicha qarorni shifokor bilan birga qabul qiling.',
  },
};

export type Dict = typeof uz;
