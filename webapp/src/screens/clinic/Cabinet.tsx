/**
 * Kabinet boshi va tizim ekranlari — 5, 22, 23 va "Boshqa" menyusi.
 *
 *   Dashboard         — bugungi holat va tez amallar
 *   MoreMenu          — qolgan 18 ta ekranga kirish nuqtasi
 *   NotificationPrefs — qaysi hodisada xabar kelsin
 *   ClinicSettings    — til, oferta, yordam
 *
 * Pastki panelga beshta yorliq sig'adi, kabinetda esa 23 ekran bor.
 * "Boshqa" shu farqni yopadi: guruhlangan ro'yxat, har biri bitta tegish.
 */
import { useState } from 'react';
import { m } from 'framer-motion';
import { useNavigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { api, clinicApi } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { popVariants, spring } from '@/lib/motion';
import { formatDate, money } from '@/lib/format';
import { TermsSheet } from '@/components/Terms';
import {
  Card,
  Chip,
  CountUp,
  Field,
  IconAlert,
  IconBell,
  IconChat,
  IconCheck,
  IconClinic,
  IconClock,
  IconInbox,
  IconInfo,
  IconPlus,
  IconSearch,
  IconShield,
  IconSparkle,
  IconStar,
  IconStethoscope,
  IconWallet,
  Input,
  Notice,
  Screen,
  Section,
  Skeleton,
} from '@/ui';
import { Async, ClinicTabBar, Meter, NavRow, StatTile, useResource } from './shell';
import { requestTitle } from '@shared/types';
import type { Lang, NotificationPrefs as Prefs } from '@shared/types';
import { Security } from '@/screens/web/Security';

/* ═════════════════  5-ekran: dashboard  ═════════════════ */

export function Dashboard() {
  const { t, lang, user } = useApp();
  const navigate = useNavigate();

  const res = useResource(async () => {
    const [dash, requests, deals] = await Promise.all([
      api.dashboard(),
      api.clinicRequests(true),
      api.clinicDeals(),
    ]);
    return { dash, requests, deals };
  });

  return (
    <Screen
      title={t('clinic.title')}
      subtitle={user?.firstName}
      tabBar={<ClinicTabBar />}
    >
      <Async resource={res} skeleton={<Skeleton h={340} />}>
        {({ dash, requests, deals }) => {
          const s = dash.subscription;
          const blocked = s.status !== 'active';
          const upcoming = deals
            .filter((d) => d.scheduledAt && d.status === 'AGREED')
            .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
            .slice(0, 3);

          return (
            <>
              {/* Obuna yoki verifikatsiya to'siq bo'lsa — eng tepada */}
              {blocked && (
                <m.div variants={popVariants} initial="initial" animate="animate">
                  <Notice tone="warning">
                    {t(`sub.status.${s.status}` as any)} — {t('sub.sub')}
                  </Notice>
                </m.div>
              )}

              <div className="tile-grid">
                <StatTile
                  label={t('dash.newRequests')}
                  value={<CountUp value={dash.kpi.incomingRequests} />}
                  tone={dash.kpi.incomingRequests > 0 ? 'good' : undefined}
                />
                <StatTile label={t('an.winRate')} value={`${dash.kpi.winRatePercent}%`} />
                <StatTile label={t('rev.net')} value={money(dash.kpi.revenueUzs, lang)} />
                <StatTile
                  label={t('an.avgResponse')}
                  value={dash.kpi.avgResponseMinutes != null ? t('an.minutes', { n: dash.kpi.avgResponseMinutes }) : '—'}
                />
              </div>

              {s.offersLimit > 0 && (
                <Card className="stack" style={{ gap: 6 }}>
                  <div className="between">
                    <span className="tiny">{t('sub.offersUsed', { used: s.offersUsed, limit: s.offersLimit })}</span>
                    <span className="tiny">{s.until ? formatDate(s.until, lang) : ''}</span>
                  </div>
                  <Meter
                    value={s.offersUsed / s.offersLimit}
                    tone={s.offersUsed / s.offersLimit > 0.85 ? 'accent' : 'primary'}
                  />
                </Card>
              )}

              <Section title={t('dash.today')}>
                {requests.length === 0 ? (
                  <Notice tone="info">{t('dash.noToday')}</Notice>
                ) : (
                  requests.slice(0, 3).map((request) => (
                    <Card key={request.id} onClick={() => navigate(`/clinic/requests/${request.id}`)} className="stack" style={{ gap: 4 }}>
                      <div className="between">
                        <strong className="truncate">{requestTitle(request, lang)}</strong>
                        <span className="live-pill">
                          <i /> {t('feed.live')}
                        </span>
                      </div>
                      <span className="tiny">
                        {request.budgetUzs ? money(request.budgetUzs, lang) : t('budget.skip')}
                      </span>
                    </Card>
                  ))
                )}
              </Section>

              {upcoming.length > 0 && (
                <Section title={t('dash.upcoming')}>
                  {upcoming.map((deal) => (
                    <Card key={deal.id} onClick={() => navigate(`/clinic/deals/${deal.id}`)} className="between">
                      <span className="truncate">{deal.patientName}</span>
                      <span className="tiny">{formatDate(deal.scheduledAt!, lang)}</span>
                    </Card>
                  ))}
                </Section>
              )}

              <Section title={t('dash.quick')}>
                <NavRow icon={<IconInbox size={18} />} title={t('feed.title')} to="/clinic/requests" />
                <NavRow icon={<IconSparkle size={18} />} title={t('tpl.title')} to="/clinic/templates" />
                <NavRow icon={<IconClock size={18} />} title={t('cal.title')} to="/clinic/calendar" />
              </Section>
            </>
          );
        }}
      </Async>
    </Screen>
  );
}

/* ═════════════════  "Boshqa" menyusi  ═════════════════ */

export function MoreMenu() {
  const { t } = useApp();

  return (
    <Screen title={t('cab.more')} tabBar={<ClinicTabBar />}>
      <Section title={t('cab.workflow')}>
        <NavRow icon={<IconSparkle size={18} />} title={t('tpl.title')} hint={t('tpl.sub')} to="/clinic/templates" />
        <NavRow icon={<IconSearch size={18} />} title={t('mo.title')} hint={t('mo.sub')} to="/clinic/offers" />
        <NavRow icon={<IconClock size={18} />} title={t('cal.title')} hint={t('cal.sub')} to="/clinic/calendar" />
      </Section>

      <Section title={t('cab.finance')}>
        <NavRow icon={<IconChat size={18} />} title={t('an.title')} hint={t('an.sub')} to="/clinic/analytics" />
        <NavRow icon={<IconWallet size={18} />} title={t('sub.title')} hint={t('sub.sub')} to="/clinic/subscription" />
      </Section>

      <Section title={t('cab.reputation')}>
        <NavRow icon={<IconClinic size={18} />} title={t('cp.title')} hint={t('cp.sub')} to="/clinic/profile" />
        <NavRow icon={<IconStethoscope size={18} />} title={t('doc.title')} hint={t('doc.sub')} to="/clinic/doctors" />
        <NavRow icon={<IconStar size={18} />} title={t('rv.title')} hint={t('rv.sub')} to="/clinic/reviews" />
      </Section>

      <Section title={t('cab.team')}>
        <NavRow icon={<IconPlus size={18} />} title={t('team.title')} hint={t('team.sub')} to="/clinic/team" />
        <NavRow icon={<IconShield size={18} />} title={t('ver.title')} hint={t('ver.sub')} to="/clinic/verification" />
        <NavRow icon={<IconCheck size={18} />} title={t('ops.title')} hint={t('ops.sub')} to="/clinic/operations" />
        <NavRow icon={<IconCheck size={18} />} title={t('lab.title')} hint={t('lab.navHint')} to="/clinic/lab-services" />
      </Section>

      <Section title={t('cab.system')}>
        <NavRow icon={<IconBell size={18} />} title={t('np.title')} hint={t('np.sub')} to="/clinic/notifications" />
        <NavRow icon={<IconInfo size={18} />} title={t('cs.title')} hint={t('cs.help')} to="/clinic/settings" />
      </Section>
    </Screen>
  );
}

/* ═════════════════  22-ekran: bildirishnomalar  ═════════════════ */

const PREF_KEYS = ['newRequest', 'offerChosen', 'dealUpdate', 'message', 'review', 'subscription'] as const;

export function NotificationPrefs() {
  const { t, toast } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => clinicApi.notificationPrefs());

  const save = async (patch: Partial<Prefs>) => {
    try {
      const next = await clinicApi.setNotificationPrefs(patch);
      res.set(next);
      haptic.tap();
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  return (
    <Screen onBack={() => navigate('/clinic/more')} title={t('np.title')} subtitle={t('np.sub')}>
      <Async resource={res} skeleton={<Skeleton h={280} />}>
        {(prefs) => (
          <>
            <Card className="stack" style={{ gap: 2 }}>
              {PREF_KEYS.map((key) => (
                <label key={key} className="toggle-row">
                  <span className="toggle-row__text">
                    <span className="toggle-row__title">{t(`np.${key}` as any)}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs[key]}
                    onChange={(e) => save({ [key]: e.target.checked } as Partial<Prefs>)}
                  />
                </label>
              ))}
            </Card>

            <Section title={t('np.quiet')}>
              <Card className="stack">
                <p className="tiny">{t('np.quietHint')}</p>
                <div className="row" style={{ gap: 'var(--s-2)' }}>
                  <Field label={t('np.quietFrom')}>
                    <Input
                      type="time"
                      value={prefs.quietFrom ?? ''}
                      onChange={(e) => save({ quietFrom: e.target.value || null })}
                    />
                  </Field>
                  <Field label={t('np.quietTo')}>
                    <Input
                      type="time"
                      value={prefs.quietTo ?? ''}
                      onChange={(e) => save({ quietTo: e.target.value || null })}
                    />
                  </Field>
                </div>
                {!prefs.quietFrom && !prefs.quietTo && <span className="tiny">{t('np.quietOff')}</span>}
              </Card>
            </Section>
          </>
        )}
      </Async>
    </Screen>
  );
}

/* ═════════════════  23-ekran: sozlamalar va yordam  ═════════════════ */

const FAQ = [
  ['cs.faq.q1', 'cs.faq.a1'],
  ['cs.faq.q2', 'cs.faq.a2'],
  ['cs.faq.q3', 'cs.faq.a3'],
] as const;

export function ClinicSettings() {
  const { t, lang, setLang } = useApp();
  const navigate = useNavigate();
  const [terms, setTerms] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Screen onBack={() => navigate('/clinic/more')} title={t('cs.title')} subtitle={t('cs.help')}>
      <Section title={t('cs.lang')}>
        <div className="row" style={{ gap: 6 }}>
          {(['uz', 'ru'] as Lang[]).map((code) => (
            <Chip key={code} active={lang === code} onClick={() => void setLang(code)}>
              {code === 'uz' ? "O'zbekcha" : 'Русский'}
            </Chip>
          ))}
        </div>
      </Section>

      {/*
        Xavfsizlik klinika uchun ham kerak: kabinetda bemorlarning
        tibbiy ma'lumoti va bitim tarixi bor.
      */}
      <Security />

      <Section title={t('cs.faq')}>
        <Card className="stack" style={{ gap: 2 }}>
          {FAQ.map(([q, a]) => (
            <div key={q} className="faq">
              <button
                type="button"
                className="faq__q"
                aria-expanded={open === q}
                onClick={() => {
                  haptic.tap();
                  setOpen(open === q ? null : q);
                }}
              >
                <span>{t(q)}</span>
                <span className={`faq__mark ${open === q ? 'is-open' : ''}`}>+</span>
              </button>
              <m.div
                className="faq__a"
                initial={false}
                animate={{ height: open === q ? 'auto' : 0, opacity: open === q ? 1 : 0 }}
                transition={spring}
                style={{ overflow: 'hidden' }}
              >
                <p className="tiny">{t(a)}</p>
              </m.div>
            </div>
          ))}
        </Card>
      </Section>

      <Section title={t('cs.support')}>
        <NavRow icon={<IconInfo size={18} />} title={t('cs.terms')} onClick={() => setTerms(true)} />
        <NavRow icon={<IconAlert size={18} />} title={t('cs.support')} hint={t('cs.supportHint')} to="/clinic/more" />
      </Section>

      <p className="tiny" style={{ textAlign: 'center' }}>
        {t('cs.version')} 1.0.0
      </p>

      <TermsSheet open={terms} onClose={() => setTerms(false)} />
    </Screen>
  );
}
