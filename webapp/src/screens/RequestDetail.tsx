/**
 * So'rov ekrani: kutish radari → real-time takliflar oqimi → taqqoslash → tanlov.
 * WebSocket orqali jonli yangilanadi.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { channelFor, onServerEvent, subscribe } from '@/lib/ws';
import { money, timeLeft } from '@/lib/format';
import { haptic } from '@/lib/telegram';
import { incomingVariants, popVariants, spring } from '@/lib/motion';
import { cityName, opName } from '@/i18n';
import { OfferCard } from '@/components/OfferCard';
import { Radar } from '@/components/Visuals';
import {
  Badge,
  Button,
  Card,
  Chip,
  CountUp,
  EmptyState,
  ErrorState,
  IconCheck,
  IconClock,
  IconInbox,
  Notice,
  Screen,
  Sheet,
  SkeletonList,
} from '@/ui';
import type { OfferWithClinic, PriceStats, RequestWithMeta } from '@shared/types';

type Sort = 'price' | 'rating' | 'speed';

export function RequestDetail() {
  const { id } = useParams();
  const requestId = Number(id);
  const navigate = useNavigate();
  const { t, lang, toast } = useApp();

  const [request, setRequest] = useState<RequestWithMeta | null>(null);
  const [offers, setOffers] = useState<OfferWithClinic[]>([]);
  const [stats, setStats] = useState<PriceStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<Sort>('price');
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [choosing, setChoosing] = useState<OfferWithClinic | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [, forceTick] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.request(requestId);
      setRequest(data.request);
      setOffers(data.offers);
      setStats(data.stats);
    } catch (err: any) {
      setError(err?.message ?? t('common.error'));
    }
  }, [requestId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Jonli yangilanish: yangi taklif, ko'rildi hisoblagichi, holat o'zgarishi
  useEffect(() => {
    if (!Number.isFinite(requestId)) return;
    const unsubscribe = subscribe(channelFor.request(requestId));

    const off = onServerEvent((event) => {
      if (event.type === 'offer:new' && event.requestId === requestId) {
        setOffers((prev) => (prev.some((o) => o.id === event.offer.id) ? prev : [...prev, event.offer]));
        setFreshIds((prev) => new Set(prev).add(event.offer.id));
        haptic.success();
        toast(t('offers.newArrived'), 'success');
      } else if (event.type === 'offer:updated' && event.requestId === requestId) {
        setOffers((prev) => prev.map((o) => (o.id === event.offer.id ? event.offer : o)));
      } else if (event.type === 'request:progress' && event.requestId === requestId) {
        setRequest((prev) =>
          prev
            ? {
                ...prev,
                broadcastCount: event.broadcastCount,
                viewedCount: event.viewedCount,
                offersCount: event.offersCount,
              }
            : prev,
        );
      } else if (event.type === 'request:status' && event.requestId === requestId) {
        setRequest((prev) => (prev ? { ...prev, status: event.status } : prev));
      }
    });

    return () => {
      unsubscribe();
      off();
    };
  }, [requestId, t, toast]);

  // Taymer har daqiqada qayta chiziladi
  useEffect(() => {
    const timer = window.setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const sorted = useMemo(() => {
    const list = [...offers];
    if (sort === 'price') list.sort((a, b) => a.priceUzs - b.priceUzs);
    else if (sort === 'rating') list.sort((a, b) => b.clinic.ratingAvg - a.clinic.ratingAvg);
    else list.sort((a, b) => a.leadTimeDays - b.leadTimeDays);
    return list;
  }, [offers, sort]);

  const toggleCompare = (offerId: number) => {
    haptic.select();
    setCompareIds((prev) =>
      prev.includes(offerId) ? prev.filter((x) => x !== offerId) : prev.length >= 3 ? prev : [...prev, offerId],
    );
  };

  const confirmChoice = async () => {
    if (!choosing) return;
    setSubmitting(true);
    try {
      const deal = await api.chooseOffer(requestId, choosing.id);
      haptic.strong();
      navigate(`/deal/${deal.id}`, { replace: true });
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
      setSubmitting(false);
      setChoosing(null);
    }
  };

  if (error) {
    return (
      <Screen title={t('offers.title')} onBack={() => navigate('/')}>
        <ErrorState message={error} retryLabel={t('common.retry')} onRetry={load} />
      </Screen>
    );
  }

  if (!request) {
    return (
      <Screen title={t('offers.title')} onBack={() => navigate('/')}>
        <SkeletonList count={3} />
      </Screen>
    );
  }

  /*
   * O'chirish bekor qilishdan boshqa narsa: bekor qilingan so'rov
   * ro'yxatda qoladi, o'chirilgani butunlay yo'q bo'ladi — fayllari
   * bilan birga. Bitim tuzilgan so'rov o'chirilmaydi va tugma ham
   * ko'rsatilmaydi; server buni alohida tekshiradi.
   */
  const remove = async () => {
    setDeleting(true);
    try {
      await api.deleteRequest(requestId);
      haptic.success();
      toast(t('request.deleted'), 'success');
      navigate('/requests', { replace: true });
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const left = timeLeft(request.expiresAt, lang);
  const waiting = offers.length === 0 && (request.status === 'NEW' || request.status === 'COLLECTING');
  const closed = request.status === 'CHOSEN' || request.status === 'COMPLETED' || request.status === 'CANCELLED';

  return (
    <Screen
      title={opName(request.operation, lang)}
      subtitle={`${cityName(request.city, lang)} · ${money(request.budgetUzs, lang)}`}
      onBack={() => navigate('/')}
      footer={
        compareIds.length >= 2 ? (
          <Button block variant="secondary" onClick={() => setCompareOpen(true)}>
            {t('offers.compare')} ({compareIds.length})
          </Button>
        ) : undefined
      }
    >
      {/* Kutish holati: radar + jonli hisoblagichlar */}
      {waiting && (
        <motion.div variants={popVariants} initial="initial" animate="animate" className="stack">
          <Card className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            <Radar
              clinics={Array.from({ length: request.broadcastCount }, (_, i) => ({
                id: i,
                name: `${i + 1}`,
              }))}
              viewedIds={new Set(Array.from({ length: request.viewedCount }, (_, i) => i))}
            />

            <h2 style={{ fontSize: 'var(--t-lg)' }}>{t('wait.title')}</h2>

            <div className="row" style={{ gap: 'var(--s-4)', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Stat value={request.broadcastCount} label={t('wait.sent', { n: '' }).replace('  ', ' ')} />
              <Stat value={request.viewedCount} label={t('wait.viewed', { n: '' }).replace('  ', ' ')} />
              <Stat value={request.offersCount} label={t('wait.offers', { n: '' }).replace('  ', ' ')} />
            </div>

            {!left.expired && (
              <div className="row tiny" style={{ gap: 5 }}>
                <IconClock size={13} /> {t('wait.timer')}: {left.text}
              </div>
            )}
          </Card>

          <Notice tone="info">{t('wait.hint')}</Notice>
        </motion.div>
      )}

      {/* Takliflar oqimi */}
      {offers.length > 0 && (
        <>
          <div className="between">
            <h2 className="section-title">
              {t('offers.title')} · {offers.length}
            </h2>
            <div className="row" style={{ gap: 4 }}>
              {(['price', 'rating', 'speed'] as Sort[]).map((s) => (
                <Chip key={s} size="sm" active={sort === s} onClick={() => setSort(s)}>
                  {t(`offers.sort.${s}` as any)}
                </Chip>
              ))}
            </div>
          </div>

          {compareIds.length < 2 && <p className="tiny">{t('compare.hint')}</p>}

          {/* FLIP: saralanganda kartalar o'rin almashadi */}
          <motion.div className="stack" layout>
            <AnimatePresence initial={false}>
              {sorted.map((offer) => (
                <motion.div
                  key={offer.id}
                  layout
                  variants={incomingVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={spring}
                >
                  <OfferCard
                    offer={offer}
                    isNew={freshIds.has(offer.id)}
                    selectable={!closed}
                    selected={compareIds.includes(offer.id)}
                    onToggleSelect={() => toggleCompare(offer.id)}
                    onChoose={closed ? undefined : () => setChoosing(offer)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </>
      )}

      {!waiting && offers.length === 0 && (
        <EmptyState icon={<IconInbox size={32} />} title={t('offers.empty')} text={t('offers.emptyText')} />
      )}

      {closed && request.status === 'CANCELLED' && (
        <Notice tone="warning">{t('status.CANCELLED')}</Notice>
      )}

      {/*
        O'chirish — eng pastda va ohista.
        Bu qaytarib bo'lmaydigan amal, uni tasodifan bosish oson
        bo'lmasligi kerak. Bitim tuzilgan so'rovda umuman chiqmaydi.
      */}
      {request.status !== 'CHOSEN' && request.status !== 'COMPLETED' && (
        <button type="button" className="danger-link" onClick={() => setConfirmDelete(true)}>
          {t('request.delete')}
        </button>
      )}

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('request.delete')}>
        <div className="stack">
          <Notice tone="danger">{t('request.deleteWarn')}</Notice>
          {offers.length > 0 && (
            <p className="tiny">{t('request.deleteOffers', { n: offers.length })}</p>
          )}
          <Button block variant="danger" loading={deleting} onClick={remove}>
            {t('request.deleteConfirm')}
          </Button>
          <Button block variant="ghost" onClick={() => setConfirmDelete(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Sheet>

      {/* Taqqoslash varag'i */}
      <Sheet open={compareOpen} onClose={() => setCompareOpen(false)} title={t('compare.title')}>
        <CompareTable offers={offers.filter((o) => compareIds.includes(o.id))} stats={stats} onChoose={(o) => {
          setCompareOpen(false);
          setChoosing(o);
        }} />
      </Sheet>

      {/* Tanlovni tasdiqlash */}
      <Sheet open={Boolean(choosing)} onClose={() => setChoosing(null)} title={t('offers.chooseTitle')}>
        {choosing && (
          <>
            <Card variant="flat" className="stack">
              <div className="between">
                <strong>{choosing.clinic.name}</strong>
                {choosing.clinic.verified && <Badge tone="verified">{t('offers.verified')}</Badge>}
              </div>
              <div className="offer__price">{money(choosing.priceUzs, lang)}</div>
              <div className="offer__includes">
                {choosing.includes.map((i) => (
                  <span className="badge badge--neutral" key={i}>
                    <IconCheck size={11} /> {i}
                  </span>
                ))}
              </div>
            </Card>
            <Notice tone="info">{t('offers.chooseText')}</Notice>
            <Button block loading={submitting} onClick={confirmChoice}>
              {t('common.confirm')}
            </Button>
            <Button block variant="ghost" onClick={() => setChoosing(null)}>
              {t('common.cancel')}
            </Button>
          </>
        )}
      </Sheet>
    </Screen>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="num" style={{ fontSize: 'var(--t-xl)' }}>
        <CountUp value={value} format={(n) => String(Math.round(n))} />
      </div>
      <div className="tiny">{label}</div>
    </div>
  );
}

/* ─────────────────────────  Taqqoslash jadvali  ───────────────────────── */

function CompareTable({
  offers,
  stats,
  onChoose,
}: {
  offers: OfferWithClinic[];
  stats: PriceStats | null;
  onChoose: (o: OfferWithClinic) => void;
}) {
  const { t, lang } = useApp();

  if (offers.length < 2) {
    return <EmptyState title={t('compare.empty')} />;
  }

  const cheapest = Math.min(...offers.map((o) => o.priceUzs));
  const bestRating = Math.max(...offers.map((o) => o.clinic.ratingAvg));
  const fastest = Math.min(...offers.map((o) => o.leadTimeDays));

  return (
    <>
      {stats?.median != null && (
        <p className="tiny">
          {t('budget.median')}: {money(stats.median, lang)}
        </p>
      )}

      <div className="scroll-x">
        <div className="compare">
          {offers.map((offer, index) => (
            <motion.div
              className="compare__col"
              key={offer.id}
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring, delay: index * 0.07 }}
            >
              <Card variant="flat" className="stack">
                <strong className="truncate">{offer.clinic.name}</strong>

                <CompareRow label={t('compare.price')} best={offer.priceUzs === cheapest} delay={index * 0.05}>
                  {money(offer.priceUzs, lang)}
                </CompareRow>

                <CompareRow
                  label={t('compare.rating')}
                  best={offer.clinic.ratingAvg === bestRating && bestRating > 0}
                  delay={index * 0.05 + 0.04}
                >
                  ★ {offer.clinic.ratingAvg > 0 ? offer.clinic.ratingAvg.toFixed(1) : '—'}
                </CompareRow>

                <CompareRow label={t('compare.time')} best={offer.leadTimeDays === fastest} delay={index * 0.05 + 0.08}>
                  {t('offers.leadTime', { n: offer.leadTimeDays })}
                </CompareRow>

                <CompareRow label={t('compare.included')} delay={index * 0.05 + 0.12}>
                  <span className="stack" style={{ gap: 3 }}>
                    {offer.includes.map((i) => (
                      <span key={i} className="tiny" style={{ color: 'var(--ink)' }}>
                        <IconCheck size={11} /> {i}
                      </span>
                    ))}
                  </span>
                </CompareRow>

                <Button size="sm" block onClick={() => onChoose(offer)}>
                  {t('offers.choose')}
                </Button>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
}

function CompareRow({
  label,
  best,
  delay,
  children,
}: {
  label: string;
  best?: boolean;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className={`compare__row ${best ? 'compare__row--best' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.24 }}
    >
      <div className="compare__rowlabel">{label}</div>
      <div style={{ fontSize: 'var(--t-sm)', fontWeight: best ? 700 : 500 }}>{children}</div>
    </motion.div>
  );
}
