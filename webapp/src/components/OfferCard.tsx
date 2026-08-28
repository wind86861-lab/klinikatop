import { motion } from 'framer-motion';
import { formatDate, money, responseSpeed } from '@/lib/format';
import { spring } from '@/lib/motion';
import { Avatar, Badge, Button, Card, IconCheck, IconClock, IconShield } from '@/ui';
import { useApp } from '@/store/app';
import type { OfferWithClinic } from '@shared/types';

export function OfferCard({
  offer,
  selected,
  selectable,
  onToggleSelect,
  onChoose,
  isNew,
}: {
  offer: OfferWithClinic;
  selected?: boolean;
  selectable?: boolean;
  onToggleSelect?: () => void;
  onChoose?: () => void;
  /** Ko'z oldida kelgan taklif — ustidan yorug'lik yugurib o'tadi */
  isNew?: boolean;
}) {
  const { t, lang } = useApp();
  const speed = responseSpeed(offer.clinic.avgResponseMinutes, lang);

  return (
    <Card className="offer stack">
      {isNew && <span className="offer__shine" aria-hidden />}

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Avatar name={offer.clinic.name} url={offer.clinic.logoUrl} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <strong className="truncate">{offer.clinic.name}</strong>
            {offer.clinic.verified && (
              <Badge tone="verified">
                <IconShield size={11} /> {t('offers.verified')}
              </Badge>
            )}
          </div>
          <div className="tiny">
            ★ {offer.clinic.ratingAvg > 0 ? offer.clinic.ratingAvg.toFixed(1) : '—'}
            {offer.clinic.ratingCount > 0 && ` · ${t('offers.reviews', { n: offer.clinic.ratingCount })}`}
          </div>
        </div>

        {selectable && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            transition={spring}
            onClick={onToggleSelect}
            aria-pressed={selected}
            aria-label={t('offers.compare')}
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              display: 'grid',
              placeItems: 'center',
              background: selected ? 'var(--primary)' : 'var(--bg-elevated)',
              color: selected ? '#fff' : 'var(--muted)',
              flex: '0 0 auto',
            }}
          >
            {selected && <IconCheck size={15} />}
          </motion.button>
        )}
      </div>

      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div className="offer__price">{money(offer.priceUzs, lang)}</div>
        <div className="row" style={{ gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {offer.badges.map((b) => (
            <Badge key={b} tone={b}>
              {t(`offers.badge.${b}` as any)}
            </Badge>
          ))}
        </div>
      </div>

      {/* Shaffoflik: narxga nima kirishi doim ko'rinadi */}
      <div>
        <div className="tiny" style={{ marginBottom: 5 }}>
          {t('offers.includes')}
        </div>
        <div className="offer__includes">
          {offer.includes.map((item) => (
            <span className="badge badge--neutral" key={item}>
              <IconCheck size={11} /> {item}
            </span>
          ))}
        </div>
      </div>

      {offer.advantages.length > 0 && (
        <div className="offer__includes">
          {offer.advantages.map((item) => (
            <span className="badge badge--verified" key={item}>
              {item}
            </span>
          ))}
        </div>
      )}

      {/*
        Budjetdan yuqori narx uchun izoh — narxning YONIDA turadi.
        Bemor "nega qimmatroq" degan savolga javobni shu yerda topsin,
        aks holda u shunchaki eng arzonini tanlaydi.
      */}
      {offer.aboveBudgetReason && (
        <div className="offer__why">
          <span className="offer__whyTag">Nega qimmatroq</span>
          <span>{offer.aboveBudgetReason}</span>
        </div>
      )}

      {/* Klinika taklif qilgan aniq kunlar */}
      {offer.proposedDates.length > 0 && (
        <div className="offer__dates">
          <span className="tiny">Taklif qilingan kunlar</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {offer.proposedDates.map((d) => (
              <span className="badge badge--neutral num" key={d}>
                {formatDate(d, lang)}
              </span>
            ))}
          </div>
        </div>
      )}

      {offer.note && <p className="tiny" style={{ color: 'var(--body)' }}>{offer.note}</p>}

      <div className="row tiny" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 4 }}>
          <IconClock size={13} /> {t('offers.leadTime', { n: offer.leadTimeDays })}
        </span>
        {speed && <span>{speed}</span>}
      </div>

      {onChoose && (
        <Button block onClick={onChoose}>
          {t('offers.choose')}
        </Button>
      )}
    </Card>
  );
}
