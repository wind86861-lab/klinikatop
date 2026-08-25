/**
 * Ommaviy oferta (11-bo'lim: yuridik nuqtalar).
 *
 * Bemor har so'rov yuborishda qabul qiladi. Qaysi versiya va qachon qabul
 * qilingani yoziladi — bu keyinchalik nizoda dalil bo'ladi.
 *
 * Matn o'zgarsa VERSION ham o'zgaradi: eski qabullar eski versiyaga bog'liq qoladi.
 */
import { db } from '../db';
import type { Lang } from '../../../shared/types';

export const TERMS_VERSION = '2026-08-1';

export interface TermsSection {
  title: string;
  body: string[];
}

export interface TermsDocument {
  version: string;
  title: string;
  updatedAt: string;
  summary: string[];
  sections: TermsSection[];
}

const UZ: TermsDocument = {
  version: TERMS_VERSION,
  title: 'Ommaviy oferta',
  updatedAt: '2026-08-01',
  summary: [
    'KlinikaTop — vositachi platforma. Biz tibbiy xizmat ko‘rsatmaymiz va davolamaymiz.',
    'Operatsiya uchun javobgarlik siz tanlagan klinikada.',
    'Tibbiy ma’lumotingiz faqat siz tanlagan klinikaga ko‘rsatiladi.',
    'Platformadan foydalanish bemor uchun bepul.',
  ],
  sections: [
    {
      title: '1. Platformaning roli',
      body: [
        'KlinikaTop — bemor va tibbiy muassasalarni bog‘lovchi axborot platformasi. Platforma tibbiy xizmat ko‘rsatmaydi, tashxis qo‘ymaydi va davolash tayinlamaydi.',
        'Platforma klinikalar tomonidan taqdim etilgan takliflarni yetkazadi. Taklif shartlari, narxi va sifati uchun javobgarlik taklifni bergan klinikada.',
        'Platforma klinikalarning litsenziyasini ro‘yxatdan o‘tkazishda tekshiradi, ammo bu tibbiy natija kafolati emas.',
      ],
    },
    {
      title: '2. Bemorning huquq va majburiyatlari',
      body: [
        'Siz haqqoniy ma’lumot berasiz: ism, familiya, viloyat va tibbiy ehtiyoj tavsifi.',
        'Siz istalgan taklifni tanlash yoki hech birini tanlamaslik huquqiga egasiz. Tanlov majburiy emas.',
        'Taklifni tanlaganingizdan keyin klinika bilan bevosita muloqot ochiladi. Sana va tayyorgarlik siz va klinika o‘rtasida kelishiladi.',
        'Operatsiyadan keyin siz haqiqiy to‘langan summani tasdiqlaysiz. Bu ma’lumot anonim tarzda boshqa bemorlarga narx oralig‘ini ko‘rsatish uchun ishlatiladi.',
      ],
    },
    {
      title: '3. Tibbiy ma’lumot va maxfiylik',
      body: [
        'So‘rovingizdagi tibbiy ma’lumot va yuklangan hujjatlar faqat sizning so‘rovingizga mos klinikalarga ko‘rsatiladi.',
        'Siz taklifni tanlagandan keyin to‘liq ma’lumot faqat tanlangan klinikaga ochiq bo‘ladi. Qolgan klinikalar uchun kirish yopiladi.',
        'Ma’lumotingiz uchinchi shaxslarga sotilmaydi va reklama maqsadida ishlatilmaydi.',
        'Siz istalgan vaqtda ma’lumotlaringizni yuklab olishingiz yoki hisobingizni o‘chirishingiz mumkin.',
      ],
    },
    {
      title: '4. Sun’iy intellekt yordamchisi',
      body: [
        'Platformadagi yordamchi shikoyatingiz asosida operatsiya yo‘nalishini TAXMIN qiladi.',
        'Bu tashxis emas. Yakuniy qarorni faqat litsenziyalangan shifokor qabul qiladi.',
        'Yordamchi taklifi noto‘g‘ri bo‘lsa, siz katalogdan o‘zingiz tanlashingiz mumkin.',
      ],
    },
    {
      title: '5. To‘lov va komissiya',
      body: [
        'Platformadan foydalanish bemor uchun bepul. Bemordan hech qanday to‘lov olinmaydi.',
        'To‘lov to‘g‘ridan-to‘g‘ri klinikaga amalga oshiriladi.',
        'Platforma klinikadan obuna va tasdiqlangan bitimdan foiz oladi. Bu komissiya bemor to‘laydigan narxga qo‘shilmasligi kerak.',
      ],
    },
    {
      title: '6. Muloqot qoidalari',
      body: [
        'Muloqot platforma ichida olib boriladi. Telefon raqam va tashqi havolalar avtomatik yashiriladi.',
        'Bu qoida ikkala tomonni himoya qiladi: nizo yuzaga kelsa, moderator butun yozishmani ko‘ra oladi.',
      ],
    },
    {
      title: '7. Nizolar',
      body: [
        'Kelishmovchilik yuzaga kelsa, har ikki tomon nizo ochishi mumkin.',
        'Moderator yozishma, kelishilgan shartlar va hujjatlar asosida ko‘rib chiqadi.',
        'Moderator qarori platforma doirasida yakuniy hisoblanadi va tomonlarning sud yoki boshqa organlarga murojaat qilish huquqini cheklamaydi.',
      ],
    },
    {
      title: '8. Ofertaning o‘zgarishi',
      body: [
        'Oferta shartlari o‘zgarishi mumkin. Har so‘rov yuborishda joriy versiya ko‘rsatiladi va qabul qilinadi.',
        'Sizning oldingi so‘rovlaringiz o‘sha paytda qabul qilingan versiyaga bo‘ysunadi.',
      ],
    },
  ],
};

const RU: TermsDocument = {
  version: TERMS_VERSION,
  title: 'Публичная оферта',
  updatedAt: '2026-08-01',
  summary: [
    'KlinikaTop — посредническая платформа. Мы не оказываем медицинские услуги и не лечим.',
    'Ответственность за операцию несёт выбранная вами клиника.',
    'Ваши медицинские данные видит только выбранная вами клиника.',
    'Для пациента пользование платформой бесплатно.',
  ],
  sections: [
    {
      title: '1. Роль платформы',
      body: [
        'KlinikaTop — информационная платформа, связывающая пациента и медицинские учреждения. Платформа не оказывает медицинских услуг, не ставит диагноз и не назначает лечение.',
        'Платформа передаёт предложения, подготовленные клиниками. За условия, цену и качество отвечает клиника, сделавшая предложение.',
        'Платформа проверяет лицензию клиники при регистрации, но это не является гарантией медицинского результата.',
      ],
    },
    {
      title: '2. Права и обязанности пациента',
      body: [
        'Вы предоставляете достоверные данные: имя, фамилию, регион и описание медицинской потребности.',
        'Вы вправе выбрать любое предложение или не выбирать ни одного. Выбор не является обязательным.',
        'После выбора предложения открывается общение с клиникой. Дата и подготовка согласуются между вами и клиникой.',
        'После операции вы подтверждаете фактически уплаченную сумму. Эти данные используются анонимно, чтобы показывать другим пациентам реальный диапазон цен.',
      ],
    },
    {
      title: '3. Медицинские данные и конфиденциальность',
      body: [
        'Медицинские данные и загруженные документы показываются только клиникам, подходящим под вашу заявку.',
        'После выбора предложения полные данные доступны только выбранной клинике. Остальным доступ закрывается.',
        'Ваши данные не продаются третьим лицам и не используются в рекламных целях.',
        'Вы можете в любой момент выгрузить свои данные или удалить аккаунт.',
      ],
    },
    {
      title: '4. Помощник на основе ИИ',
      body: [
        'Помощник ПРЕДПОЛАГАЕТ направление операции на основе вашей жалобы.',
        'Это не диагноз. Окончательное решение принимает только лицензированный врач.',
        'Если предположение неверно, вы можете выбрать операцию из каталога самостоятельно.',
      ],
    },
    {
      title: '5. Оплата и комиссия',
      body: [
        'Для пациента платформа бесплатна. С пациента не взимается никакая плата.',
        'Оплата производится напрямую клинике.',
        'Платформа получает подписку от клиники и процент с подтверждённой сделки. Эта комиссия не должна включаться в цену для пациента.',
      ],
    },
    {
      title: '6. Правила общения',
      body: [
        'Общение ведётся внутри платформы. Телефонные номера и внешние ссылки скрываются автоматически.',
        'Это правило защищает обе стороны: при споре модератор видит всю переписку.',
      ],
    },
    {
      title: '7. Споры',
      body: [
        'При разногласиях любая из сторон может открыть спор.',
        'Модератор рассматривает его на основании переписки, согласованных условий и документов.',
        'Решение модератора является окончательным в рамках платформы и не ограничивает право сторон обращаться в суд или иные органы.',
      ],
    },
    {
      title: '8. Изменение оферты',
      body: [
        'Условия оферты могут меняться. При каждой отправке заявки показывается и принимается текущая версия.',
        'Ваши прежние заявки регулируются той версией, которая была принята на тот момент.',
      ],
    },
  ],
};

export function getTerms(lang: Lang = 'uz'): TermsDocument {
  return lang === 'ru' ? RU : UZ;
}

/** Qabulni yozib qo'yish — yuridik dalil. */
export function recordAcceptance(
  userId: number,
  requestId: number | null,
  userAgent: string | null,
): void {
  db.prepare(
    `INSERT INTO terms_acceptances (user_id, request_id, version, user_agent) VALUES (?, ?, ?, ?)`,
  ).run(userId, requestId, TERMS_VERSION, userAgent);
}

/** Foydalanuvchi joriy versiyani qabul qilganmi. */
export function hasAcceptedCurrent(userId: number): boolean {
  const row = db
    .prepare(`SELECT 1 FROM terms_acceptances WHERE user_id = ? AND version = ? LIMIT 1`)
    .get(userId, TERMS_VERSION);
  return Boolean(row);
}
