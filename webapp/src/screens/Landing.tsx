/**
 * Bosh sahifa — brauzerdan kirgan odam uchun.
 *
 * Ilova Telegram Mini App: haqiqiy ish o'sha yerda bo'ladi. Lekin
 * `klinikatop.uz` ni brauzerda ochgan odam ham bor — havolani
 * ko'rgan bemor, qidiruvdan kelgan klinika egasi, tanishi aytgan
 * odam. Sahifaning vazifasi — ishonch berish va BOTGA yuborish.
 *
 * ── Nega ilovaning suratlari ──
 *
 * Marketpleysda eng ishonarli dalil — odam nimani ko'rishini
 * ko'rsatish: haqiqiy takliflar, haqiqiy narxlar, "eng arzon"
 * belgisi. Sotib olingan surat yoki chizma buni bermaydi.
 *
 * Suratlar ilovaning O'ZIDAN olingan. Klinika nomlari olishdan
 * oldin neytrallashtirilgan: haqiqiy brendni ruxsatsiz reklama
 * qilib bo'lmaydi.
 *
 * Og'irligi hisobga olingan — uchalasi WebP, jami ~67 KB.
 * Birinchi ekrandagisi darhol, qolgani ko'rinishga kelganda
 * yuklanadi (`loading="lazy"`), o'lchami esa oldindan berilgan:
 * rasm kelganda maket sakramaydi.
 *
 * ── Nega pastdagi bo'limlarda animatsiya yo'q ──
 *
 * `framer-motion` bu ilovada KECHIKTIRIB yuklanadi (`LazyMotion`).
 * Kirish animatsiyasi `opacity: 0` dan boshlanadi, ya'ni o'sha
 * bo'lak kelguncha kontent KO'RINMAYDI. Sekin internetda bu
 * marketing sahifasining yarmi bir necha soniya bo'sh turishi
 * demak. Kontentning ko'rinishi hech qachon animatsiyaga bog'liq
 * bo'lmasligi kerak — pastdagi bo'limlar oddiy chiziladi.
 *
 * Sarlavhadagi harakat qoladi: u ekranning eng tepasida va
 * ilgaridan shunday edi.
 *
 * Raqamlar HAQIQIY va serverdan keladi. Platforma yangi, sonlar
 * kichik — shuning uchun urg'u katalog kengligida: u haqiqatan
 * katta va bo'rttirishga hojat yo'q.
 */
import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { EASE } from '@/lib/motion';
import { useApp } from '@/store/app';
import { IconCheck } from '@/ui';
import shotOffers from '@/assets/offers.webp';
import shotWizard from '@/assets/wizard.webp';
import shotHome from '@/assets/home.webp';

interface Stats {
  clinics: number;
  cities: number;
  operations: number;
  labTests: number;
  deals: number;
  ratingAvg: number | null;
  reviews: number;
  avgResponseMinutes: number | null;
  botUrl: string | null;
}

const BASE = import.meta.env.VITE_API_URL ?? '';

/** "1 240" — uch xonali guruhlar ajratilgan son */
const num = (n: number) => n.toLocaleString('uz-UZ').replace(/,/g, ' ');

/** Telefon ramkasi — sof CSS, rasm emas */
function Phone({
  src,
  alt,
  eager,
  className = '',
}: {
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
}) {
  return (
    <div className={`lp__phone ${className}`}>
      <img
        className="lp__phoneScreen"
        src={src}
        alt={alt}
        width={520}
        height={1000}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    </div>
  );
}

export function Landing() {
  const { lang } = useApp();
  const ru = lang === 'ru';
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${BASE}/api/public/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setStats(d))
      .catch(() => {
        /* Raqamsiz ham sahifa ishlaydi — asosiysi tugma */
      });
    return () => {
      alive = false;
    };
  }, []);

  const bot = stats?.botUrl ?? null;

  const t = {
    tagline: ru ? 'Клиники предлагают — вы выбираете' : 'Klinikalar taklif qiladi — siz tanlaysiz',
    title: ru ? 'Одна заявка.\nПредложения от клиник.' : 'Bitta so‘rov.\nKlinikalardan takliflar.',
    lead: ru
      ? 'Опишите, что вам нужно — операция или обследование. Подходящие клиники сами пришлют цену и свободные дни. Вы сравниваете и выбираете.'
      : 'Nima kerakligini yozing — operatsiya yoki tekshiruv. Mos klinikalar o‘zi narx va bo‘sh kunlarini yuboradi. Siz taqqoslab tanlaysiz.',
    cta: ru ? 'Открыть в Telegram' : 'Telegramda ochish',
    ctaHint: ru ? 'Бесплатно для пациента' : 'Bemor uchun bepul',
    login: ru ? 'Вход' : 'Kirish',

    stepsTitle: ru ? 'Как это работает' : 'Qanday ishlaydi',
    stepsSub: ru
      ? 'Три шага. Ходить по клиникам и спрашивать цену не нужно.'
      : 'Uch qadam. Klinikama-klinika yurib narx so‘rash kerak emas.',
    steps: ru
      ? [
          ['Заявка', 'Операция или обследование, город и удобные дни. Минута времени.'],
          ['Предложения', 'Клиники присылают цену, что входит и свободные дни.'],
          ['Выбор', 'Сравниваете и выбираете. Дальше — чат с клиникой.'],
        ]
      : [
          ['So‘rov', 'Operatsiya yoki tekshiruv, shahar va qulay kunlar. Bir daqiqa vaqt.'],
          ['Takliflar', 'Klinikalar narx, nima kirishi va bo‘sh kunlarini yuboradi.'],
          ['Tanlov', 'Taqqoslab tanlaysiz. Keyin — klinika bilan chat.'],
        ],

    askTitle: ru ? 'Опишите — и всё' : 'Yozasiz — tamom',
    askList: ru
      ? [
          'Операция, обследование или фото направления врача',
          'Свой бюджет — клиники видят его и отвечают по нему',
          'Город и удобные дни',
        ]
      : [
          'Operatsiya, tekshiruv yoki shifokor yo‘llanmasining rasmi',
          'O‘z byudjetingiz — klinikalar shuni ko‘rib javob beradi',
          'Shahar va qulay kunlar',
        ],

    compareTitle: ru ? 'Сравниваете в одном месте' : 'Bitta joyda taqqoslaysiz',
    compareList: ru
      ? [
          'Цена и что в неё входит — без «уточним на месте»',
          'Рейтинг клиники и отзывы прошлых пациентов',
          'Свободные дни — выбираете удобный',
        ]
      : [
          'Narx va unga nima kirishi — «kelganda aytamiz» yo‘q',
          'Klinika reytingi va oldingi bemorlar sharhi',
          'Bo‘sh kunlar — o‘zingizga qulayini tanlaysiz',
        ],

    clinicTitle: ru ? 'Вы клиника?' : 'Siz klinikamisiz?',
    clinicText: ru
      ? 'Получайте заявки пациентов из своего города и отвечайте своей ценой. Проверка — вручную, каждая клиника подтверждается.'
      : 'O‘z shahringizdagi bemor so‘rovlarini oling va o‘z narxingiz bilan javob bering. Tekshiruv qo‘lda — har klinika tasdiqlanadi.',
    clinicCta: ru ? 'Оставить заявку' : 'Ariza qoldirish',
  };

  const cards: { value: string; label: string }[] = stats
    ? [
        { value: num(stats.operations), label: ru ? 'операций в каталоге' : 'operatsiya katalogda' },
        { value: num(stats.labTests), label: ru ? 'видов обследований' : 'xil tekshiruv' },
        { value: num(stats.clinics), label: ru ? 'проверенных клиник' : 'tasdiqlangan klinika' },
        { value: num(stats.cities), label: ru ? 'областей' : 'viloyat' },
      ]
    : [];

  return (
    <div className="lp">
      {/* ── Ustki qator ── */}
      {/*
        Kabinetga kirish havolasi bu yerda ATAYLAB YO'Q.
        Kirish sahifasi parol bilan himoyalangan, lekin uni bosh
        sahifada ko'rsatish — tanimagan odamni ham o'sha yerga
        chaqirish demak: parol terib ko'rishga urinishlar aynan
        shunday boshlanadi. Klinika o'z havolasini bilib turadi,
        yangisi esa "Ariza qoldirish" orqali keladi.
      */}
      <header className="lp__top">
        <span className="lp__mark">KlinikaTop</span>
        <a className="lp__topLink" href="/kirish">
          {t.login}
        </a>
      </header>

      {/* ── Sarlavha va mahsulot ── */}
      <section className="lp__hero">
        <div className="lp__glow" aria-hidden />

        <m.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <span className="lp__eyebrow">{t.tagline}</span>
          <h1 className="lp__title">{t.title}</h1>
          <p className="lp__lead">{t.lead}</p>

          <div className="lp__actions">
            {bot ? (
              <a className="lp__cta" href={bot}>
                {t.cta}
              </a>
            ) : (
              <span className="lp__cta is-off">{t.cta}</span>
            )}
            <span className="lp__ctaHint">{t.ctaHint}</span>
          </div>
        </m.div>

        {/*
          Ikki telefon: orqadagisi so'rov yuborish, oldingisi
          takliflar. Tartib ataylab — odam avval nimani beradi,
          keyin nimani oladi.
        */}
        <m.div
          className="lp__phoneStack"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
        >
          <Phone
            className="lp__phone--back"
            src={shotWizard}
            alt={ru ? 'Экран заявки' : 'So‘rov ekrani'}
          />
          <Phone
            className="lp__phone--front"
            src={shotOffers}
            alt={ru ? 'Предложения клиник с ценами' : 'Klinikalarning narx takliflari'}
            eager
          />
        </m.div>
      </section>

      {/* ── Raqamlar ── */}
      {cards.length > 0 && (
        <section className="lp__stats">
          {cards.map((c) => (
            <div className="lp__stat" key={c.label}>
              <span className="lp__statValue num">{c.value}</span>
              <span className="lp__statLabel">{c.label}</span>
            </div>
          ))}
        </section>
      )}

      {/* ── Qanday ishlaydi ── */}
      <section className="lp__how">
        <div className="lp__wrap">
          <h2 className="lp__h2">{t.stepsTitle}</h2>
          <p className="lp__h2sub">{t.stepsSub}</p>

          <div className="lp__steps">
            {t.steps.map(([title, text], i) => (
              <div className="lp__step" key={title}>
                <span className="lp__stepNum num">{i + 1}</span>
                <span className="lp__stepTitle">{title}</span>
                <span className="lp__stepText">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Ko'rsatish: so'rov ── */}
      <div className="lp__wrap">
        <section className="lp__show">
          <div className="lp__showText">
            <h2 className="lp__h2">{t.askTitle}</h2>
            <ul className="lp__showList">
              {t.askList.map((line) => (
                <li key={line}>
                  <span className="lp__tick">
                    <IconCheck size={13} />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <Phone src={shotHome} alt={ru ? 'Главный экран' : 'Bosh ekran'} />
        </section>

        {/* ── Ko'rsatish: taqqoslash ── */}
        <section className="lp__show lp__show--flip">
          <div className="lp__showText">
            <h2 className="lp__h2">{t.compareTitle}</h2>
            <ul className="lp__showList">
              {t.compareList.map((line) => (
                <li key={line}>
                  <span className="lp__tick">
                    <IconCheck size={13} />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <Phone src={shotOffers} alt={ru ? 'Сравнение предложений' : 'Takliflarni taqqoslash'} />
        </section>
      </div>

      {/*
        Ishonch qatori — FAQAT haqiqiy son bo'lganda. Nol bitim va
        nol sharhni ko'rsatish ishonch bermaydi, aksincha.
      */}
      {stats && (stats.deals > 0 || stats.ratingAvg !== null) && (
        <div className="lp__proof">
          {stats.deals > 0 && (
            <span>
              <b className="num">{num(stats.deals)}</b> {ru ? 'завершённых сделок' : 'yakunlangan bitim'}
            </span>
          )}
          {stats.ratingAvg !== null && (
            <span>
              ★ <b className="num">{stats.ratingAvg.toFixed(1)}</b>{' '}
              {ru ? `по ${num(stats.reviews)} отзывам` : `${num(stats.reviews)} ta sharh bo‘yicha`}
            </span>
          )}
          {stats.avgResponseMinutes !== null && (
            <span>
              {ru ? 'Средний ответ' : 'O‘rtacha javob'}{' '}
              <b className="num">
                {stats.avgResponseMinutes} {ru ? 'мин' : 'daqiqa'}
              </b>
            </span>
          )}
        </div>
      )}

      {/* ── Klinikalar uchun ── */}
      <section className="lp__clinic">
        <div>
          <h2 className="lp__h2">{t.clinicTitle}</h2>
          <p className="lp__lead">{t.clinicText}</p>
        </div>
        <a className="lp__cta lp__cta--ghost" href="/klinika">
          {t.clinicCta}
        </a>
      </section>

      <footer className="lp__foot">
        <span>KlinikaTop</span>
        <a href="/klinika">{t.clinicCta}</a>
      </footer>
    </div>
  );
}
