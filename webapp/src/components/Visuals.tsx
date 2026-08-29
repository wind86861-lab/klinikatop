/** Ma'lumotni ko'rsatuvchi vizual komponentlar: radar, narx taqsimoti, ustunli grafik. */
import { m } from 'framer-motion';
import { DUR, EASE, spring } from '@/lib/motion';
import { money } from '@/lib/format';
import { Avatar, IconStethoscope } from '@/ui';
import type { ClinicPublic, Lang, PriceStats } from '@shared/types';

/* ─────────────────────────  Radar: so'rov tarqalmoqda  ───────────────────────── */

export function Radar({
  clinics,
  viewedIds,
}: {
  clinics: { id: number; name: string }[];
  viewedIds: Set<number>;
}) {
  const shown = clinics.slice(0, 8);
  const radius = 88;

  return (
    <div className="radar" aria-hidden>
      {/* Markazdan tarqaladigan to'lqinlar */}
      {[0, 1, 2].map((i) => (
        <span key={i} className="radar__ring" style={{ animationDelay: `${i}s` }} />
      ))}

      <div className="radar__core">
        <IconStethoscope size={32} />
      </div>

      {shown.map((clinic, i) => {
        const angle = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
        const seen = viewedIds.has(clinic.id);
        return (
          <m.div
            key={clinic.id}
            className="radar__satellite"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{
              opacity: 1,
              scale: seen ? 1 : 0.86,
              x: Math.cos(angle) * radius,
              y: Math.sin(angle) * radius,
            }}
            transition={{ ...spring, delay: 0.1 + i * 0.06 }}
          >
            {/* Ko'rgan klinika kulrangdan rangliga "yonadi" */}
            <m.div
              animate={{
                filter: seen ? 'grayscale(0)' : 'grayscale(1)',
                opacity: seen ? 1 : 0.5,
              }}
              transition={{ duration: DUR.base, ease: EASE }}
            >
              <Avatar name={clinic.name} size="sm" />
            </m.div>
          </m.div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────  Narx taqsimoti  ───────────────────────── */

export function PriceChart({
  stats,
  budget,
  lang,
  yourLabel,
}: {
  stats: PriceStats;
  budget: number | null;
  lang: Lang;
  yourLabel: string;
}) {
  if (!stats.histogram.length || stats.min == null || stats.max == null) return null;

  /*
   * Barcha bitimlar bir xil narxda bo'lsa grafik ma'nosini yo'qotadi:
   * ustunlar bir xil balandlikda turadi va o'qning ikki uchida bir xil
   * son yoziladi — odam bo'sh quti ko'radi.
   *
   * Bunday holatda raqamning o'zi ko'proq narsa aytadi.
   */
  if (stats.max - stats.min < 1) {
    return (
      <div className="pricechart__single">
        <span className="tiny">Bozorda kuzatilgan narx</span>
        <strong className="num">{money(stats.min, lang)}</strong>
        {budget != null && (
          <span className="tiny">
            {yourLabel}: {money(budget, lang)}
          </span>
        )}
      </div>
    );
  }

  const maxCount = Math.max(...stats.histogram.map((b) => b.count), 1);
  const span = Math.max(1, stats.max - stats.min);

  // Byudjet markerining grafik bo'ylab pozitsiyasi (0–100%)
  const markerPercent =
    budget == null ? null : Math.min(100, Math.max(0, ((budget - stats.min) / span) * 100));

  return (
    <div>
      <div className="pricechart">
        {stats.histogram.map((bucket, i) => {
          const inBudget = budget != null && budget >= bucket.from;
          return (
            <m.div
              key={i}
              className={`pricechart__bar ${inBudget ? 'pricechart__bar--in' : ''}`}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: Math.max(0.12, bucket.count / maxCount) }}
              transition={{ ...spring, delay: i * 0.05 }}
              style={{ height: '100%' }}
            />
          );
        })}
      </div>

      <div className="pricechart__axis">
        <span>{money(stats.min, lang)}</span>
        <span>{money(stats.max, lang)}</span>
      </div>

      {markerPercent != null && (
        <div className="pricechart__marker">
          <m.div
            className="pricechart__pin"
            initial={false}
            animate={{ left: `${markerPercent}%` }}
            transition={spring}
          >
            <span>▲</span>
            <span>{yourLabel}</span>
          </m.div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────  Haftalik ustunlar  ───────────────────────── */

export function WeeklyBars({
  data,
}: {
  data: { date: string; requests: number; offers: number; wins: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => d.requests + d.offers + d.wins));

  return (
    <div>
      <div className="bars">
        {data.map((day, i) => (
          <div className="bars__col" key={day.date}>
            {(
              [
                ['wins', 'var(--success)'],
                ['offers', 'var(--primary)'],
                ['requests', 'var(--primary-soft)'],
              ] as const
            ).map(([key, color]) => (
              <m.div
                key={key}
                className="bars__seg"
                style={{ background: color, height: `${(day[key] / max) * 100}%` }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ ...spring, delay: i * 0.04 }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="pricechart__axis">
        {data.map((d) => (
          <span key={d.date}>{new Date(d.date).getDate()}</span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────  Reyting satri  ───────────────────────── */

export function RatingLine({ clinic, lang }: { clinic: ClinicPublic; lang: Lang }) {
  return (
    <span className="tiny">
      ★ {clinic.ratingAvg > 0 ? clinic.ratingAvg.toFixed(1) : '—'}
      {clinic.ratingCount > 0 && ` · ${clinic.ratingCount}`}
      {clinic.dealsCount > 0 && ` · ${clinic.dealsCount} ${lang === 'ru' ? 'сделок' : 'bitim'}`}
    </span>
  );
}
