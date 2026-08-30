/**
 * Quvvat, analitika va moliya — kabinetning 14, 15, 16 va 17-ekranlari.
 *
 *   Calendar      — qaysi kunda nechta operatsiya qila olaman
 *   Analytics     — konversiya, javob tezligi, yo'qotish sabablari
 *   Subscription  — tarif va uning chegaralari
 *   Revenue       — tushum, komissiya, sof daromad
 *
 * To'rttasi ham bitta savolga javob beradi: klinika qancha ishlay oladi va
 * shundan qancha qoladi.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api, clinicApi } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { popVariants, spring } from '@/lib/motion';
import { formatDate, money } from '@/lib/format';
import {
  Button,
  Card,
  Chip,
  CountUp,
  Field,
  IconCheck,
  IconShield,
  Input,
  Notice,
  Screen,
  Section,
  Segment,
  Sheet,
  Skeleton,
} from '@/ui';
import { Async, ClinicTabBar, Meter, StatTile, useResource } from './shell';
import { PLAN_LIMITS, type SubscriptionPlan } from '@shared/types';

const UZ_MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
];
const RU_MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/* ═════════════════  14-ekran: bo'sh kunlar  ═════════════════ */

export function Calendar() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();

  const [monthOffset, setMonthOffset] = useState(0);
  const base = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const from = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const to = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${lastDay}`;

  const res = useResource(() => clinicApi.slots(from, to), [from, to]);
  const [editing, setEditing] = useState<string | null>(null);
  const [capacity, setCapacity] = useState(1);
  const [note, setNote] = useState('');

  const openDay = (date: string) => {
    const slot = res.data?.find((s) => s.date === date);
    setCapacity(slot?.capacity ?? 1);
    setNote(slot?.note ?? '');
    setEditing(date);
    haptic.press();
  };

  const save = async () => {
    if (!editing) return;
    try {
      await clinicApi.setSlot(editing, capacity, note.trim() || null);
      haptic.success();
      toast(t('cal.saved'), 'success');
      setEditing(null);
      res.reload();
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  const clear = async () => {
    if (!editing) return;
    await clinicApi.deleteSlot(editing);
    haptic.tap();
    setEditing(null);
    res.reload();
  };

  // Dushanbadan boshlanadigan hafta — O'zbekistonda shunday
  const firstWeekday = (new Date(from).getDay() + 6) % 7;
  const months = lang === 'ru' ? RU_MONTHS : UZ_MONTHS;

  return (
    <Screen onBack={() => navigate('/clinic/more')} title={t('cal.title')} subtitle={t('cal.sub')}>
      <div className="between">
        <Button size="sm" variant="ghost" onClick={() => setMonthOffset((m) => m - 1)}>
          ‹
        </Button>
        <strong>
          {months[base.getMonth()]} {base.getFullYear()}
        </strong>
        <Button size="sm" variant="ghost" onClick={() => setMonthOffset((m) => m + 1)}>
          ›
        </Button>
      </div>

      <Async resource={res} skeleton={<Skeleton h={280} />}>
        {(slots) => (
          <>
            <div className="cal-grid">
              {Array.from({ length: firstWeekday }).map((_, i) => (
                <span key={`pad-${i}`} />
              ))}

              {Array.from({ length: lastDay }).map((_, i) => {
                const day = i + 1;
                const date = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const slot = slots.find((s) => s.date === date);
                const full = slot ? slot.booked >= slot.capacity : false;

                return (
                  <m.button
                    key={date}
                    type="button"
                    className={`cal-day ${slot ? (full ? 'is-full' : 'is-open') : ''}`}
                    whileTap={{ scale: 0.93 }}
                    transition={spring}
                    onClick={() => openDay(date)}
                  >
                    <span className="cal-day__n num">{day}</span>
                    {slot && (
                      <span className="cal-day__cap num">
                        {slot.booked}/{slot.capacity}
                      </span>
                    )}
                  </m.button>
                );
              })}
            </div>

            {slots.length === 0 && <Notice tone="info">{t('cal.emptyText')}</Notice>}
          </>
        )}
      </Async>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={t('cal.setDay')}>
        <div className="stack">
          {editing && <strong>{formatDate(editing, lang)}</strong>}

          <Field label={t('cal.capacity')}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {[0, 1, 2, 3, 5, 8].map((n) => (
                <Chip key={n} size="sm" active={capacity === n} onClick={() => setCapacity(n)}>
                  {n}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label={t('cal.note')}>
            <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <Button block onClick={save}>
            {t('common.save')}
          </Button>
          <Button variant="ghost" block onClick={clear}>
            {t('cal.clearDay')}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}

/* ═════════════════  15-ekran: analitika  ═════════════════ */

export function Analytics() {
  const { t, lang } = useApp();
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const res = useResource(() => clinicApi.analytics(days), [days]);

  return (
    <Screen onBack={() => navigate('/clinic/more')} title={t('an.title')} subtitle={t('an.sub')}>
      <Segment
        value={String(days)}
        onChange={(v) => setDays(Number(v))}
        options={[
          { value: '7', label: t('an.window', { n: 7 }) },
          { value: '30', label: t('an.window', { n: 30 }) },
          { value: '90', label: t('an.window', { n: 90 }) },
        ]}
      />

      <Async resource={res} skeleton={<Skeleton h={340} />}>
        {(a) => (
          <>
            <div className="tile-grid">
              <StatTile
                label={t('an.responseRate')}
                value={`${Math.round(a.responseRate * 100)}%`}
                tone={a.responseRate >= 0.5 ? 'good' : 'warn'}
              />
              <StatTile
                label={t('an.winRate')}
                value={`${Math.round(a.winRate * 100)}%`}
                tone={a.winRate >= 0.3 ? 'good' : 'warn'}
              />
              <StatTile
                label={t('an.avgResponse')}
                value={a.avgResponseMinutes != null ? t('an.minutes', { n: a.avgResponseMinutes }) : '—'}
              />
              <StatTile
                label={t('an.avgOffer')}
                value={a.avgOfferUzs != null ? money(a.avgOfferUzs, lang) : '—'}
              />
            </div>

            {/* Voronka: ko'rildi → taklif → yutildi */}
            <Section title={t('an.funnel')}>
              <Card className="stack">
                <FunnelRow label={t('an.seen')} value={a.requestsSeen} max={a.requestsSeen} tone="primary" />
                <FunnelRow label={t('an.sent')} value={a.offersSent} max={a.requestsSeen} tone="accent" />
                <FunnelRow label={t('an.won')} value={a.offersWon} max={a.requestsSeen} tone="success" />
              </Card>
            </Section>

            {a.lostByPercent != null && a.lostByPercent > 0 && (
              <Notice tone="warning">{t('an.lostBy', { v: `${a.lostByPercent}%` })}</Notice>
            )}

            {a.topOperations.length > 0 && (
              <Section title={t('an.topOps')}>
                <Card className="stack" style={{ gap: 10 }}>
                  {a.topOperations.map((op) => (
                    <div key={op.operationId} className="stack" style={{ gap: 4 }}>
                      <div className="between">
                        <span className="truncate">{op.name}</span>
                        <span className="tiny num">
                          {op.wins}/{op.requests}
                        </span>
                      </div>
                      <Meter value={op.requests > 0 ? op.wins / op.requests : 0} tone="success" />
                    </div>
                  ))}
                </Card>
              </Section>
            )}

            {a.requestsSeen === 0 && <Notice tone="info">{t('an.noData')}</Notice>}
          </>
        )}
      </Async>
    </Screen>
  );
}

function FunnelRow({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: 'primary' | 'accent' | 'success';
}) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="between">
        <span className="tiny">{label}</span>
        <strong className="num">{value}</strong>
      </div>
      <Meter value={max > 0 ? value / max : 0} tone={tone} />
    </div>
  );
}

/* ═════════════════  16-ekran: obuna  ═════════════════ */

export function Subscription() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => api.dashboard());
  const [busy, setBusy] = useState<SubscriptionPlan | null>(null);

  const activate = async (plan: SubscriptionPlan) => {
    setBusy(plan);
    try {
      await api.subscribe(plan, 1);
      haptic.success();
      toast(t('sub.activated'), 'success');
      res.reload();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen onBack={() => navigate('/clinic/more')} title={t('sub.title')} subtitle={t('sub.sub')}>
      <Async resource={res} skeleton={<Skeleton h={300} />}>
        {(dash) => {
          const s = dash.subscription;
          return (
            <>
              <m.div variants={popVariants} initial="initial" animate="animate">
                <Card className="stack">
                  <div className="between">
                    <span className="tiny">{t('sub.current')}</span>
                    <span className={`badge badge--${s.status === 'active' ? 'success' : 'muted'}`}>
                      {t(`sub.status.${s.status}` as any)}
                    </span>
                  </div>

                  <strong style={{ fontSize: 'var(--t-2xl)' }}>
                    {s.plan ? t(`sub.plan.${s.plan}` as any) : t('sub.status.none')}
                  </strong>

                  {s.until && (
                    <span className="tiny">
                      {s.plan === 'trial'
                        ? t('sub.trialUntil', { v: formatDate(s.until, lang) })
                        : t('sub.until', { v: formatDate(s.until, lang) })}
                    </span>
                  )}

                  {s.offersLimit > 0 && (
                    <>
                      <Meter value={s.offersUsed / s.offersLimit} tone={s.offersUsed / s.offersLimit > 0.85 ? 'accent' : 'primary'} />
                      <span className="tiny">{t('sub.offersUsed', { used: s.offersUsed, limit: s.offersLimit })}</span>
                    </>
                  )}
                </Card>
              </m.div>

              <Section title={t('sub.choose')}>
                {(['basic', 'pro'] as SubscriptionPlan[]).map((plan) => {
                  const limits = PLAN_LIMITS[plan];
                  const active = s.plan === plan && s.status === 'active';

                  return (
                    <Card key={plan} className={`plan-card ${active ? 'is-active' : ''}`}>
                      <div className="between">
                        <strong>{t(`sub.plan.${plan}` as any)}</strong>
                        <span className="num">
                          {money(limits.priceUzs, lang)} <span className="tiny">/ {t('sub.perMonth')}</span>
                        </span>
                      </div>

                      <ul className="plan-card__features">
                        <li>
                          <IconCheck size={13} /> {t('sub.feature.offers', { n: limits.monthlyOffers })}
                        </li>
                        {limits.boosted && (
                          <li>
                            <IconCheck size={13} /> {t('sub.feature.boost')}
                          </li>
                        )}
                        {limits.analytics && (
                          <li>
                            <IconCheck size={13} /> {t('sub.feature.analytics')}
                          </li>
                        )}
                      </ul>

                      <Button
                        block
                        size="sm"
                        variant={active ? 'secondary' : 'primary'}
                        disabled={active}
                        loading={busy === plan}
                        onClick={() => activate(plan)}
                      >
                        {active ? t('sub.status.active') : t('sub.activate')}
                      </Button>
                    </Card>
                  );
                })}
              </Section>
            </>
          );
        }}
      </Async>
    </Screen>
  );
}

/* ═════════════════  17-ekran: daromad  ═════════════════ */

export function Revenue() {
  const { t, lang, toast } = useApp();
  const res = useResource(() => clinicApi.revenue());

  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'bank' | 'cash' | 'payme' | 'click'>('bank');
  const [reference, setReference] = useState('');
  const [sending, setSending] = useState(false);

  const amountNumber = Number(amount.replace(/\D/g, '')) || 0;

  const pay = async () => {
    setSending(true);
    try {
      const fresh = await clinicApi.payCommission(amountNumber, method, reference.trim() || null);
      res.set(fresh);
      haptic.success();
      toast(t('rev.paySaved'), 'success');
      setPaying(false);
      setAmount('');
      setReference('');
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen title={t('rev.title')} subtitle={t('rev.sub')} tabBar={<ClinicTabBar />}>
      <Async
        resource={res}
        skeleton={<Skeleton h={280} />}
        isEmpty={(d) => d.totals.confirmedDeals === 0}
        empty={{ title: t('rev.empty'), text: t('rev.emptyText') }}
      >
        {(rev) => (
          <>
            <m.div variants={popVariants} initial="initial" animate="animate">
              <Card className="stack" style={{ textAlign: 'center' }}>
                <span className="tiny">{t('rev.net')}</span>
                <div className="num" style={{ fontSize: 'var(--t-3xl)' }}>
                  <CountUp value={rev.totals.netUzs} format={(n) => money(n, lang)} />
                </div>
                <span className="tiny">{t('rev.deals', { n: rev.totals.confirmedDeals })}</span>
              </Card>
            </m.div>

            <div className="tile-grid">
              <StatTile label={t('rev.gross')} value={money(rev.totals.grossUzs, lang)} />
              <StatTile
                label={t('rev.commission')}
                value={money(rev.totals.commissionUzs, lang)}
                hint={`${rev.commissionPercent}%`}
              />
            </div>

            <Notice tone="info">{t('rev.commissionNote', { n: rev.commissionPercent })}</Notice>

            {rev.outstandingUzs > 0 ? (
              <Card className="stack">
                <div className="between">
                  <span className="row" style={{ gap: 8 }}>
                    <IconShield size={17} /> {t('rev.outstanding')}
                  </span>
                  <strong className="num">{money(rev.outstandingUzs, lang)}</strong>
                </div>
                {/*
                  Topshirilgan, lekin admin hali tasdiqlamagan summa alohida
                  ko'rsatiladi — aks holda klinika "to'ladim, nega qarz
                  kamaymadi?" deb o'ylaydi.
                */}
                {rev.pendingCommissionUzs > 0 && (
                  <div className="between">
                    <span className="tiny">{t('rev.pending')}</span>
                    <span className="num tiny">{money(rev.pendingCommissionUzs, lang)}</span>
                  </div>
                )}
                <Button
                  size="sm"
                  block
                  disabled={rev.outstandingUzs - rev.pendingCommissionUzs <= 0}
                  onClick={() => {
                    setAmount(String(rev.outstandingUzs - rev.pendingCommissionUzs));
                    setPaying(true);
                  }}
                >
                  {t('rev.pay')}
                </Button>
              </Card>
            ) : (
              <Notice tone="info">{t('rev.allPaid')}</Notice>
            )}

            {rev.paidCommissionUzs > 0 && (
              <div className="tile-grid">
                <StatTile label={t('rev.paid')} value={money(rev.paidCommissionUzs, lang)} tone="good" />
                <StatTile label={t('rev.subPaid')} value={money(rev.subscription.paidUzs, lang)} />
              </div>
            )}

            {rev.commissionPayments.length > 0 && (
              <Section title={t('rev.payHistory')}>
                <Card className="stack" style={{ gap: 2 }}>
                  {rev.commissionPayments.map((payment) => (
                    <div key={payment.id} className="month-row">
                      <span className="month-row__label">{formatDate(payment.createdAt, lang)}</span>
                      <span className="tiny">
                        {t(`rev.method.${payment.method}` as any)}
                        {payment.reference ? ` · ${payment.reference}` : ''}
                        {payment.status === 'declared' && ` · ${t('rev.st.declared')}`}
                        {payment.status === 'rejected' &&
                          ` · ${t('rev.st.rejected')}${payment.reviewNote ? `: ${payment.reviewNote}` : ''}`}
                      </span>
                      <span className="num">{money(payment.amountUzs, lang)}</span>
                    </div>
                  ))}
                </Card>
              </Section>
            )}

            <Sheet open={paying} onClose={() => setPaying(false)} title={t('rev.pay')}>
              <div className="stack">
                <Notice tone="warning">{t('rev.gatewayNote')}</Notice>

                <Field label={t('rev.payAmount')}>
                  <Input
                    inputMode="numeric"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>

                <Field label={t('rev.payMethod')}>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {(['bank', 'cash', 'payme', 'click'] as const).map((m) => (
                      <Chip key={m} size="sm" active={method === m} onClick={() => setMethod(m)}>
                        {t(`rev.method.${m}` as any)}
                      </Chip>
                    ))}
                  </div>
                </Field>

                <Field label={t('rev.payRef')} hint={t('rev.payRefHint')}>
                  <Input value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
                </Field>

                <Button
                  block
                  loading={sending}
                  disabled={amountNumber <= 0 || amountNumber > rev.outstandingUzs - rev.pendingCommissionUzs}
                  onClick={pay}
                >
                  {t('rev.pay')}
                </Button>
              </div>
            </Sheet>

            <Section title={t('rev.byMonth')}>
              <Card className="stack" style={{ gap: 2 }}>
                <AnimatePresence initial={false}>
                  {rev.months.map((row) => (
                    <m.div
                      key={row.month}
                      className="month-row"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={spring}
                    >
                      <span className="month-row__label">{row.month}</span>
                      <span className="tiny">{t('rev.deals', { n: row.deals })}</span>
                      <span className="num">{money(row.netUzs, lang)}</span>
                    </m.div>
                  ))}
                </AnimatePresence>
              </Card>
            </Section>

          </>
        )}
      </Async>
    </Screen>
  );
}
