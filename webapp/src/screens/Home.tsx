/**
 * Bosh sahifa.
 *
 * Uch qatlam: harakat (yangi so'rov) → o'z holating (faol so'rov/bitim) →
 * platforma isboti (narx pulsi va bemorlar fikri). Oxirgi ikkisi real
 * tasdiqlangan bitimlardan quriladi — o'ylab topilgan raqam yo'q.
 */
import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api, type Highlights } from '@/lib/api';
import { money, timeLeft } from '@/lib/format';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { TabBar } from '@/components/TabBar';
import {
  AnimatedItem,
  AnimatedList,
  Button,
  EmptyState,
  ErrorState,
  IconBell,
  IconChat,
  IconCheck,
  IconInbox,
  IconPlus,
  IconStar,
  Skeleton,
  SkeletonList,
} from '@/ui';
import { requestTitle } from '@shared/types';
import type { DealDetail, RequestWithMeta } from '@shared/types';

export function Home() {
  const { t, lang, user, unread } = useApp();
  const navigate = useNavigate();

  const [requests, setRequests] = useState<RequestWithMeta[] | null>(null);
  const [deals, setDeals] = useState<DealDetail[] | null>(null);
  const [highlights, setHighlights] = useState<Highlights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  const load = async () => {
    setError(null);
    try {
      const [r, d] = await Promise.all([api.requests(), api.deals()]);
      setRequests(r);
      setDeals(d);
    } catch (err: any) {
      setError(err?.message ?? t('common.error'));
    }
    // Isbot bloklari alohida — ular yiqilsa asosiy ekran baribir ishlaydi
    api.highlights().then(setHighlights).catch(() => setHighlights(null));
  };

  useEffect(() => {
    void load();
    // Taymer har daqiqada qayta chiziladi
    const timer = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = (requests ?? []).filter((r) => r.status === 'NEW' || r.status === 'COLLECTING');
  const activeDeals = (deals ?? []).filter(
    (d) => d.status !== 'CANCELLED' && d.status !== 'CONFIRMED',
  );

  return (
    <div className="screen screen--tabbed">
      <div className="content" style={{ gap: 'var(--s-3)' }}>
        {/* ── Sarlavha ── */}
        <div className="home-top">
          <div>
            <div className="home-hello">{t('home.greeting')}</div>
            <div className="home-name">{user?.firstName}</div>
          </div>
          <button
            className="home-bell"
            onClick={() => navigate('/notifications')}
            aria-label={t('home.notifications')}
          >
            <IconBell size={19} />
            {unread > 0 && <span className="home-bell__dot" />}
          </button>
        </div>

        {/* ── Asosiy harakat ── */}
        <m.button
          className="home-cta"
          whileTap={{ scale: 0.985 }}
          transition={spring}
          onClick={() => {
            haptic.press();
            navigate('/new');
          }}
        >
          <span>
            <span className="home-cta__title" style={{ display: 'block' }}>
              {t('home.new')}
            </span>
            <span className="home-cta__sub" style={{ display: 'block' }}>
              {t('home.newHint')}
            </span>
          </span>
          <span className="home-cta__plus">
            <IconPlus size={22} />
          </span>
        </m.button>

        {/* ── Narx pulsi: shu hafta nima to'landi ── */}
        <PulseStrip highlights={highlights} />

        {/*
          Rolga qarab panelga kirish — narx pulsidan keyin, ro'yxatdan oldin.
          Klinika xodimi ilovani o'z paneli uchun ochadi, bemor oqimi uchun
          emas; shuning uchun havola pastda emas, ko'z tushadigan joyda turadi.
          Bitta odam ham bemor, ham xodim bo'lishi mumkin — panellar bemor
          ekranini almashtirmaydi, unga QO'SHILADI.
        */}

        {error ? (
          <ErrorState message={error} retryLabel={t('common.retry')} onRetry={load} />
        ) : requests === null ? (
          <SkeletonList count={2} />
        ) : (
          <>
            {/* ── Faol bitimlar ── */}
            {activeDeals.length > 0 && (
              <>
                <div className="home-label">
                  {t('home.deals')}
                  <button className="home-label__link" onClick={() => navigate('/deals')}>
                    {t('common.all')}
                  </button>
                </div>
                <AnimatedList>
                  {activeDeals.slice(0, 2).map((deal) => (
                    <AnimatedItem key={deal.id}>
                      <button className="list-item" onClick={() => navigate(`/deal/${deal.id}`)}>
                        <span
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 11,
                            background: 'var(--primary-soft)',
                            color: 'var(--primary)',
                            display: 'grid',
                            placeItems: 'center',
                            flex: '0 0 auto',
                          }}
                        >
                          <IconChat size={18} />
                        </span>
                        <span className="list-item__body">
                          <span className="list-item__title truncate" style={{ display: 'block' }}>
                            {deal.clinic.name}
                          </span>
                          <span className="list-item__sub truncate" style={{ display: 'block' }}>
                            {requestTitle(deal.request, lang)} · {money(deal.agreedPriceUzs, lang)}
                          </span>
                        </span>
                        <span className="badge badge--neutral">
                          {t(`deal.step.${deal.status}` as any)}
                        </span>
                      </button>
                    </AnimatedItem>
                  ))}
                </AnimatedList>
              </>
            )}

            {/* ── Faol so'rovlar ── */}
            {active.length > 0 && (
              <>
                <div className="home-label">
                  {t('home.active')}
                  <button className="home-label__link" onClick={() => navigate('/requests')}>
                    {t('common.all')}
                  </button>
                </div>
                {active.slice(0, 2).map((request) => (
                  <ActiveRequestCard
                    key={request.id}
                    request={request}
                    onOpen={() => navigate(`/request/${request.id}`)}
                  />
                ))}
              </>
            )}

            {active.length === 0 && activeDeals.length === 0 && (
              <EmptyState
                icon={<IconInbox size={34} />}
                title={t('home.empty')}
                text={t('home.emptyText')}
                action={
                  <Button size="sm" onClick={() => navigate('/new')}>
                    {t('home.new')}
                  </Button>
                }
              />
            )}
          </>
        )}

        {/* ── Bemorlar fikri ── */}
        <Testimonials highlights={highlights} />
      </div>

      <TabBar role="patient" />
    </div>
  );
}

/* ─────────────────────────  Narx pulsi  ───────────────────────── */

function PulseStrip({ highlights }: { highlights: Highlights | null }) {
  const { t, lang } = useApp();
  const navigate = useNavigate();

  if (!highlights) return <Skeleton h={42} r={13} />;
  const pulse = highlights.pulse;
  if (!pulse) return null;

  const range = `${money(pulse.minUzs, lang)} – ${money(pulse.maxUzs, lang)}`;

  return (
    <m.button
      className="pulse"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      whileTap={{ scale: 0.99 }}
      onClick={() => navigate('/new')}
    >
      <span className="pulse__icon" aria-hidden>
        <IconPulse />
      </span>
      {/* Manba ochiq: real to'lov yoki taxminiy oraliq.
          Operatsiya nomi va narx qalin — ko'z ularga tushadi. */}
      <span className="pulse__text">
        {renderWithBold(
          t(pulse.source === 'deals' ? 'pulse.deals' : 'pulse.manual', {
            operation: pulse.source === 'deals' ? pulse.operationName.toLowerCase() : pulse.operationName,
            range,
          }),
          [pulse.source === 'deals' ? pulse.operationName.toLowerCase() : pulse.operationName, range],
        )}
      </span>
    </m.button>
  );
}

/* ─────────────────────────  Faol so'rov kartasi  ───────────────────────── */

function ActiveRequestCard({
  request,
  onOpen,
}: {
  request: RequestWithMeta;
  onOpen: () => void;
}) {
  const { t, lang, session } = useApp();
  const left = timeLeft(request.expiresAt, lang);

  // Qolgan vaqt ulushi — progres chizig'i shuni ko'rsatadi
  const totalMs = (session?.features.requestTtlHours ?? 24) * 3_600_000;
  const ratio = Math.max(0, Math.min(1, left.ms / totalMs));

  return (
    <m.button
      className="req-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      whileTap={{ scale: 0.99 }}
      onClick={onOpen}
    >
      <span className="req-card__top">
        <span>
          <span className="req-card__title" style={{ display: 'block' }}>
            {requestTitle(request, lang)}
          </span>
          <span className="req-card__price" style={{ display: 'block' }}>
            {money(request.budgetUzs, lang)}
          </span>
        </span>
        <span className="live-pill">
          <span className="live-pill__dot" />
          {t('status.COLLECTING')}
        </span>
      </span>

      <span className="req-card__stats">
        <span className="req-stat">
          <b>{request.viewedCount}</b>
          <small>{t('home.viewing')}</small>
        </span>
        <span className="req-stat req-stat--accent">
          <b>{request.offersCount}</b>
          <small>{t('home.offersCame')}</small>
        </span>
      </span>

      {!left.expired && (
        <span className="req-card__timer" style={{ display: 'block' }}>
          <span className="req-card__timer-row">
            <span>{t('home.expiresIn')}</span>
            <span>{left.text}</span>
          </span>
          <span className="track" style={{ display: 'block' }}>
            <m.span
              className="track__fill"
              style={{ display: 'block' }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: ratio }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            />
          </span>
        </span>
      )}
    </m.button>
  );
}

/* ─────────────────────────  Bemorlar fikri  ───────────────────────── */

function Testimonials({ highlights }: { highlights: Highlights | null }) {
  const { t, lang } = useApp();

  if (!highlights) {
    return (
      <>
        <div className="home-label">{t('home.testimonials')}</div>
        <Skeleton h={140} r={16} />
      </>
    );
  }

  if (highlights.testimonials.length === 0) return null;

  return (
    <>
      <div className="home-label">{t('home.testimonials')}</div>

      <div className="fb-row">
        {highlights.testimonials.map((item, i) => (
          <m.article
            className="fb"
            key={item.id}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring, delay: i * 0.05 }}
          >
            <div className="fb__head">
              <div className="fb__ava" aria-hidden>
                {item.patientName
                  .split(/\s+/)
                  .map((w) => w[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              <div className="fb__who">
                <div className="fb__name">{item.patientName}</div>
                <div className="fb__op">{item.operationName}</div>
              </div>
            </div>

            <div className="fb__stars" aria-label={`${item.rating} / 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} style={{ opacity: n <= Math.round(item.rating) ? 1 : 0.28 }}>
                  <IconStar size={13} filled />
                </span>
              ))}
            </div>

            <p className="fb__text">{item.body}</p>

            <div className="fb__paid">
              <IconCheck size={13} />
              <b>{money(item.paidUzs, lang)}</b> {t('home.paid')}
            </div>
          </m.article>
        ))}
      </div>
    </>
  );
}

/** Berilgan bo'laklarni qalin qiladi — tarjima matnida HTML saqlamaslik uchun. */
function renderWithBold(text: string, bold: string[]) {
  const pattern = bold
    .filter(Boolean)
    .map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  if (!pattern) return text;

  return text.split(new RegExp(`(${pattern})`, 'g')).map((part, i) =>
    bold.includes(part) ? <b key={i}>{part}</b> : <span key={i}>{part}</span>,
  );
}

const IconPulse = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 12h4l3 8 4-16 3 8h4" />
  </svg>
);


/* ─────────────────────────  Panelga kirish  ───────────────────────── */


