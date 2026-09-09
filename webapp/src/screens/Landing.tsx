/**
 * Bosh sahifa — brauzerdan kirgan odam uchun.
 *
 * Ilova Telegram Mini App: haqiqiy ish o'sha yerda bo'ladi. Lekin
 * `klinikatop.uz` ni brauzerda ochgan odam ham bor — havolani
 * ko'rgan bemor, qidiruvdan kelgan klinika egasi, tanishi aytgan
 * odam. Ilgari ular bitta "Telegramda oching" degan quti ko'rardi
 * va nima uchun ochishlari kerakligini bilmasdi.
 *
 * Sahifaning yagona vazifasi — ishonch berish va BOTGA yuborish.
 * Shuning uchun tuzilishi qisqa: nima qilamiz, raqamlar, qanday
 * ishlaydi, klinikalar uchun yo'l.
 *
 * Raqamlar HAQIQIY va serverdan keladi. Platforma yangi, sonlar
 * kichik — shuning uchun urg'u katalog kengligida: u haqiqatan
 * katta va bo'rttirishga hojat yo'q.
 */
import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { EASE } from '@/lib/motion';
import { useApp } from '@/store/app';

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
    stepsTitle: ru ? 'Как это работает' : 'Qanday ishlaydi',
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
    clinicTitle: ru ? 'Вы клиника?' : 'Siz klinikamisiz?',
    clinicText: ru
      ? 'Получайте заявки пациентов из своего города и отвечайте своей ценой. Проверка — вручную, каждая клиника подтверждается.'
      : 'O‘z shahringizdagi bemor so‘rovlarini oling va o‘z narxingiz bilan javob bering. Tekshiruv qo‘lda — har klinika tasdiqlanadi.',
    clinicCta: ru ? 'Оставить заявку' : 'Ariza qoldirish',
    clinicLogin: ru ? 'Вход в кабинет' : 'Kabinetga kirish',
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
      <header className="lp__top">
        <span className="lp__mark">KlinikaTop</span>
        <a className="lp__topLink" href="/kabinet">
          {t.clinicLogin}
        </a>
      </header>

      {/* ── Sarlavha ── */}
      <section className="lp__hero">
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
      </section>

      {/* ── Raqamlar ── */}
      {cards.length > 0 && (
        <section className="lp__stats">
          {cards.map((c, i) => (
            <m.div
              key={c.label}
              className="lp__stat"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE, delay: 0.05 * i }}
            >
              <span className="lp__statValue num">{c.value}</span>
              <span className="lp__statLabel">{c.label}</span>
            </m.div>
          ))}
        </section>
      )}

      {/*
        Bitim va baho FAQAT bor bo'lganda ko'rsatiladi.
        "0 bitim" degan quti ishonch bermaydi — u yo'qligini
        e'lon qiladi.
      */}
      {stats && (stats.deals > 0 || stats.ratingAvg !== null) && (
        <section className="lp__proof">
          {stats.deals > 0 && (
            <span>
              <strong className="num">{num(stats.deals)}</strong>{' '}
              {ru ? 'завершённых сделок' : 'yakunlangan bitim'}
            </span>
          )}
          {stats.ratingAvg !== null && (
            <span>
              <strong className="num">★ {stats.ratingAvg}</strong>{' '}
              {ru ? `по ${num(stats.reviews)} отзывам` : `${num(stats.reviews)} ta sharh bo‘yicha`}
            </span>
          )}
          {stats.avgResponseMinutes !== null && (
            <span>
              {ru ? 'Ответ в среднем за ' : 'O‘rtacha javob '}
              <strong className="num">
                {stats.avgResponseMinutes} {ru ? 'мин' : 'daqiqa'}
              </strong>
            </span>
          )}
        </section>
      )}

      {/* ── Qanday ishlaydi ── */}
      <section className="lp__how">
        <h2 className="lp__h2">{t.stepsTitle}</h2>
        <div className="lp__steps">
          {t.steps.map(([title, text], i) => (
            <div className="lp__step" key={title}>
              <span className="lp__stepNum num">{i + 1}</span>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

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
        <a href="/kabinet">{t.clinicLogin}</a>
      </footer>
    </div>
  );
}
