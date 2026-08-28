/**
 * Klinika taklif qiladigan kunlar.
 *
 * To'liq taqvim emas, ataylab: klinika bir necha kunni tez belgilashi
 * kerak, oy bo'ylab sayr qilish emas. Shuning uchun oldingi ikki hafta
 * qatorda ko'rsatiladi — real rejalashtirish shu oraliqda bo'ladi.
 *
 * Bemor ko'rsatgan oraliq ajratib turadi: klinika uni qidirib
 * topmasligi kerak, aks holda bemorga noqulay kun taklif qilinadi va
 * kelishuv cho'ziladi.
 */
import type { Lang } from '@shared/types';

const DAY_MS = 24 * 3600_000;
const DAYS_AHEAD = 14;
const MAX_PICKED = 6;

const WEEKDAY: Record<Lang, string[]> = {
  uz: ['Yak', 'Du', 'Se', 'Cho', 'Pay', 'Ju', 'Sha'],
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function DatePicker({
  value,
  onChange,
  preferFrom,
  preferTo,
  lang,
}: {
  value: string[];
  onChange: (dates: string[]) => void;
  /** Bemor ko'rsatgan oraliq — ajratib ko'rsatiladi */
  preferFrom?: string | null;
  preferTo?: string | null;
  lang: Lang;
}) {
  // Ertadan boshlaymiz: bugunga operatsiya rejalashtirilmaydi
  const start = new Date(Date.now() + DAY_MS);

  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const date = new Date(start.getTime() + i * DAY_MS);
    return { date, key: iso(date) };
  });

  const from = preferFrom?.slice(0, 10) ?? null;
  const to = preferTo?.slice(0, 10) ?? from;

  const toggle = (key: string) => {
    if (value.includes(key)) {
      onChange(value.filter((d) => d !== key));
      return;
    }
    if (value.length >= MAX_PICKED) return;
    onChange([...value, key].sort());
  };

  return (
    <div className="dp">
      <div className="dp__row">
        {days.map(({ date, key }) => {
          const picked = value.includes(key);
          // Bemor so'ragan oraliqqa tushadimi
          const preferred = Boolean(from && key >= from && key <= (to ?? from));

          return (
            <button
              key={key}
              type="button"
              className={`dp__day ${picked ? 'is-picked' : ''} ${preferred ? 'is-preferred' : ''}`}
              onClick={() => toggle(key)}
            >
              <span className="dp__wd">{WEEKDAY[lang][date.getDay()]}</span>
              <span className="dp__num num">{date.getDate()}</span>
            </button>
          );
        })}
      </div>

      <span className="tiny">
        {value.length === 0
          ? 'Kun tanlanmasa, sanani keyin kelishasiz'
          : `${value.length} kun tanlandi${value.length >= MAX_PICKED ? ' — ko‘pi shu' : ''}`}
      </span>
    </div>
  );
}
