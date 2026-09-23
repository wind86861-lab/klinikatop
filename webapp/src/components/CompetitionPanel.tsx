/**
 * Raqobat paneli — shu so'rovga kim qancha taklif qilgan.
 *
 * Nima ko'rinishini SERVER hal qiladi (`auction_mode` sozlamasi):
 * bu yerda faqat kelgan narsa chiziladi. Ekranda kesish xavfli
 * bo'lardi — ma'lumot baribir tarmoq javobida ketardi.
 *
 * "Bozor narxi" kartasi bilan adashtirmaslik kerak va shuning uchun
 * ular boshqacha ko'rinadi: u O'TMISH (yakunlangan bitimlar
 * medianasi), bu esa HOZIR — shu so'rovga kelgan jonli takliflar.
 */
import { m } from 'framer-motion';
import { useApp } from '@/store/app';
import { money } from '@/lib/format';
import { spring } from '@/lib/motion';
import { Card } from '@/ui';
import type { RequestCompetition } from '@shared/types';

export function CompetitionPanel({ data }: { data: RequestCompetition }) {
  const { t, lang } = useApp();

  /*
   * Hech kim taklif bermagan bo'lsa panel umuman chizilmaydi:
   * "0 ta taklif" degan bo'sh karta ekranni uzaytiradi, lekin
   * klinikaga hech narsa aytmaydi.
   */
  if (data.count === 0) return null;

  return (
    <Card className="stack">
      <div className="between">
        <h2 className="section-title">{t('comp.title')}</h2>
        <span className="tiny num">{t('comp.count', { n: data.count })}</span>
      </div>

      {/*
        Yopiq auksionda ham klinika o'z O'RNINI biladi — bu o'z
        ma'lumoti, raqobatchiniki emas. Narx oralig'i esa yo'q.
      */}
      {data.myRank !== null && (
        <div className="comp__rank">
          <span className="comp__rankN num">{data.myRank}</span>
          <span className="tiny">{t('comp.yourRank', { n: data.count })}</span>
        </div>
      )}

      {data.mode === 'sealed' ? (
        <p className="tiny">{t('comp.sealed')}</p>
      ) : (
        <>
          {data.minUzs !== null && data.maxUzs !== null && (
            <div className="comp__range">
              <span>
                <span className="tiny">{t('comp.min')}</span>
                <b className="num">{money(data.minUzs, lang)}</b>
              </span>
              <span>
                <span className="tiny">{t('comp.median')}</span>
                <b className="num">{money(data.medianUzs ?? 0, lang)}</b>
              </span>
              <span>
                <span className="tiny">{t('comp.max')}</span>
                <b className="num">{money(data.maxUzs, lang)}</b>
              </span>
            </div>
          )}

          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            {data.offers.map((o, i) => (
              <m.div
                key={o.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
                className={`comp__row ${o.mine ? 'is-mine' : ''}`}
              >
                <span className="comp__pos num">{i + 1}</span>
                <span className="comp__who truncate">
                  {o.mine ? t('comp.mine') : (o.clinicName ?? t('comp.anon', { n: i + 1 }))}
                </span>
                <span className="comp__price num">{money(o.priceUzs, lang)}</span>
              </m.div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
