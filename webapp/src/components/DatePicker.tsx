/**
 * Klinika taklif qiladigan kunlar.
 *
 * ═══ Bemor oralig'idan CHIQMAYDI ═══
 *
 * Ilgari klinika oldingi ikki hafta ichidan istalgan kunni tanlay
 * olardi. Bemor "1–4 sentabr" desa ham klinika 12-sentabrni taklif
 * qilib yuborardi — bu bemorga umuman yaramaydi va kelishuv boshidan
 * cho'ziladi.
 *
 * Endi bemor oraliq ko'rsatgan bo'lsa, faqat o'sha kunlar ko'rsatiladi.
 * Oraliq yo'q bo'lsa (moslashuvchan) — oldingi ikki hafta.
 *
 * ═══ Kun raqami yolg'iz tushunarsiz ═══
 *
 * Faqat "30 31 1 2" ko'rinsa, qaysi oy ekani noma'lum bo'ladi va oy
 * chegarasida odam adashadi. Shuning uchun har kun ustida oy nomi
 * turadi va u faqat o'zgarganda takrorlanadi.
 */
import type { Lang } from '@shared/types';

const DAY_MS = 24 * 3600_000;
const MAX_PICKED = 6;
/** Bemor sana ko'rsatmagan bo'lsa nechta kun taklif qilinadi */
const FREE_DAYS = 14;

const WEEKDAY: Record<Lang, string[]> = {
  uz: ['Yak', 'Du', 'Se', 'Cho', 'Pay', 'Ju', 'Sha'],
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
};

const MONTH: Record<Lang, string[]> = {
  uz: ['yanv', 'fev', 'mart', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'],
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(s + 'T00:00:00Z');

export function DatePicker({
  value,
  onChange,
  windowFrom,
  windowTo,
  lang,
}: {
  value: string[];
  onChange: (dates: string[]) => void;
  /** Bemor ko'rsatgan oraliq — tanlov shu bilan CHEKLANADI */
  windowFrom?: string | null;
  windowTo?: string | null;
  lang: Lang;
}) {
  // Ertadan boshlaymiz: bugunga operatsiya rejalashtirilmaydi
  const tomorrow = iso(new Date(Date.now() + DAY_MS));

  const from = windowFrom?.slice(0, 10) ?? null;
  const to = windowTo?.slice(0, 10) ?? from;

  /*
   * Oraliq boshi o'tib ketgan bo'lishi mumkin — so'rov bir necha kun
   * turgan bo'lsa. Shunda ertadan boshlaymiz, aks holda ro'yxatda
   * bosib bo'lmaydigan o'tgan kunlar turardi.
   */
  const start = from && from > tomorrow ? from : tomorrow;

  const days: { date: Date; key: string }[] = [];
  if (from && to) {
    for (let d = parse(start); iso(d) <= to; d = new Date(d.getTime() + DAY_MS)) {
      days.push({ date: new Date(d), key: iso(d) });
    }
  } else {
    for (let i = 0; i < FREE_DAYS; i++) {
      const date = new Date(parse(tomorrow).getTime() + i * DAY_MS);
      days.push({ date, key: iso(date) });
    }
  }

  const toggle = (key: string) => {
    if (value.includes(key)) {
      onChange(value.filter((d) => d !== key));
      return;
    }
    if (value.length >= MAX_PICKED) return;
    onChange([...value, key].sort());
  };

  if (days.length === 0) {
    return (
      <span className="tiny">
        Bemor ko‘rsatgan oraliq o‘tib ketgan — sanani chatda kelishasiz.
      </span>
    );
  }

  let lastMonth = -1;

  return (
    <div className="dp">
      <div className="dp__row">
        {days.map(({ date, key }) => {
          const picked = value.includes(key);
          const month = date.getUTCMonth();
          // Oy nomi faqat o'zgarganda — takrorlansa shovqin bo'ladi
          const showMonth = month !== lastMonth;
          lastMonth = month;

          return (
            <button
              key={key}
              type="button"
              className={`dp__day ${picked ? 'is-picked' : ''}`}
              aria-pressed={picked}
              onClick={() => toggle(key)}
            >
              <span className="dp__month">{showMonth ? MONTH[lang][month] : ''}</span>
              <span className="dp__num num">{date.getUTCDate()}</span>
              <span className="dp__wd">{WEEKDAY[lang][date.getUTCDay()]}</span>
            </button>
          );
        })}
      </div>

      <span className="tiny">
        {from
          ? `Bemor so‘ragan oraliq — faqat shu kunlardan tanlanadi`
          : 'Bemor sana ko‘rsatmagan — o‘zingiz taklif qiling'}
        {value.length > 0 && ` · ${value.length} kun tanlandi`}
      </span>
    </div>
  );
}
