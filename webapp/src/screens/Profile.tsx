/** Profil bo'limi — shaxsiy ma'lumot, statistika va rol almashtirish. */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { popVariants, spring } from '@/lib/motion';
import { cityName } from '@/i18n';
import { TabBar } from '@/components/TabBar';
import { TermsSheet } from '@/components/Terms';
import { Meter } from './clinic/shell';
import {
  Avatar,
  Button,
  Card,
  CountUp,
  IconBell,
  IconClinic,
  IconInfo,
  IconShield,
  IconStethoscope,
  Screen,
  Skeleton,
} from '@/ui';
import { medicalProfileFilled, type DealDetail, RequestWithMeta } from '@shared/types';

export function Profile() {
  const { t, lang, user, session, cities } = useApp();
  const navigate = useNavigate();

  const [requests, setRequests] = useState<RequestWithMeta[] | null>(null);
  const [deals, setDeals] = useState<DealDetail[] | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);

  useEffect(() => {
    void Promise.all([api.requests(), api.deals()])
      .then(([r, d]) => {
        setRequests(r);
        setDeals(d);
      })
      .catch(() => {
        setRequests([]);
        setDeals([]);
      });
  }, []);

  if (!user) return null;

  const city = cities.find((c) => c.id === user.cityId);
  const confirmed = (deals ?? []).filter((d) => d.status === 'CONFIRMED');
  const reviewed = confirmed.filter((d) => d.hasReview).length;

  // Tejalgan: kelishilgandan qancha kam to'langan
  const saved = confirmed.reduce(
    (sum, d) => sum + Math.max(0, d.agreedPriceUzs - (d.confirmedAmountUzs ?? d.agreedPriceUzs)),
    0,
  );

  const isModerator = user.roles.some((r) => r === 'moderator' || r === 'admin');

  // Anketa to'ldirilganmi — profil ekranida holatini ko'rsatish uchun
  const [medicalFilled, setMedicalFilled] = useState(false);
  // Asosiy profil doim to'liq (aks holda ilovaga kirib bo'lmaydi), anketa ixtiyoriy
  const completedSteps = 1 + (medicalFilled ? 1 : 0);
  useEffect(() => {
    void api
      .medicalProfile()
      .then((p) => setMedicalFilled(medicalProfileFilled(p)))
      .catch(() => setMedicalFilled(false));
  }, []);

  return (
    <Screen title={t('profile.title')} tabBar={<TabBar role="patient" />}>
      {/* Shaxsiy kartochka */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <Card className="row" style={{ gap: 'var(--s-4)' }}>
          <Avatar name={`${user.firstName} ${user.lastName ?? ''}`} url={user.photoUrl} size="lg" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--t-lg)' }} className="truncate">
              {user.firstName} {user.lastName ?? ''}
            </div>
            <div className="tiny truncate">
              {city ? cityName(city, lang) : '—'}
              {user.username && ` · @${user.username}`}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Bonus va tejash */}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi__label">{t('profile.bonus')}</div>
          <div className="kpi__value" style={{ color: 'var(--accent)' }}>
            <CountUp value={user.bonusPoints} format={(n) => String(Math.round(n))} />
          </div>
        </div>
        <div className="kpi">
          <div className="kpi__label">{t('profile.saved')}</div>
          <div className="kpi__value" style={{ color: saved > 0 ? 'var(--success)' : 'var(--muted)' }}>
            {money(saved, lang)}
          </div>
        </div>
      </div>

      {/* Faollik */}
      {requests === null ? (
        <Skeleton h={64} />
      ) : (
        <Card className="row" style={{ justifyContent: 'space-around', textAlign: 'center' }}>
          <Stat label={t('profile.requests')} value={requests.length} />
          <Stat label={t('profile.deals')} value={(deals ?? []).length} />
          <Stat label={t('profile.reviews')} value={reviewed} />
        </Card>
      )}

      {/*
        To'ldirilganlik.
        Bemor nima yetishmayotganini bilishi kerak — aks holda "to'liq
        to'ldirish" degan narsa ko'rinmay qoladi. Tibbiy anketa ixtiyoriy,
        shuning uchun u alohida, yumshoqroq ohangda ko'rsatiladi.
      */}
      {!medicalFilled && (
        <motion.div variants={popVariants} initial="initial" animate="animate">
          <Card className="stack" style={{ gap: 8 }}>
            <div className="between">
              <strong>{t('profile.completeness')}</strong>
              <span className="tiny num">{completedSteps}/2</span>
            </div>
            <Meter value={completedSteps / 2} tone={completedSteps === 2 ? 'success' : 'accent'} />
            <span className="tiny">{t('profile.completenessHint')}</span>
            <Button size="sm" variant="secondary" block onClick={() => navigate('/profile/medical')}>
              {t('profile.completeNow')}
            </Button>
          </Card>
        </motion.div>
      )}

      {/* Menyu */}
      <div className="menu-group">
        <MenuRow
          icon={<IconUserEdit />}
          title={t('profile.edit')}
          onClick={() => navigate('/register', { state: { next: '/profile' } })}
        />
        {/*
          Tibbiy anketa profilning bir qismi — shuning uchun shu yerda,
          "Ma'lumotlarni tahrirlash" yonida. Ilgari eng pastda turardi va
          ko'zga tashlanmasdi.
        */}
        <MenuRow
          icon={<IconStethoscope size={18} />}
          title={t('med.open')}
          sub={medicalFilled ? t('med.filled') : t('med.empty')}
          onClick={() => navigate('/profile/medical')}
        />
        <MenuRow icon={<IconGear />} title={t('profile.settings')} onClick={() => navigate('/settings')} />
        <MenuRow
          icon={<IconBell size={18} />}
          title={t('home.notifications')}
          onClick={() => navigate('/notifications')}
        />
        <MenuRow icon={<IconInfo size={18} />} title={t('profile.terms')} onClick={() => setTermsOpen(true)} />
      </div>

      {/* Rol almashtirish — alohida ilova emas */}
      <div className="menu-group">
        {session?.clinic ? (
          <MenuRow
            icon={<IconClinic size={18} />}
            title={t('profile.switchClinic')}
            sub={session.clinic.name}
            onClick={() => navigate('/clinic')}
          />
        ) : (
          <MenuRow
            icon={<IconClinic size={18} />}
            title={t('profile.registerClinic')}
            onClick={() => navigate('/clinic/register')}
          />
        )}
        {isModerator && (
          <MenuRow
            icon={<IconShield size={18} />}
            title={t('profile.switchAdmin')}
            onClick={() => navigate('/admin')}
          />
        )}
      </div>

      <TermsSheet open={termsOpen} onClose={() => setTermsOpen(false)} />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="num" style={{ fontSize: 'var(--t-xl)' }}>
        <CountUp value={value} format={(n) => String(Math.round(n))} />
      </div>
      <div className="tiny">{label}</div>
    </div>
  );
}

export function MenuRow({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  onClick: () => void;
}) {
  return (
    <button className="menu-row" onClick={onClick}>
      <span className="menu-row__icon">{icon}</span>
      <span className="menu-row__body">
        <span className="menu-row__title" style={{ display: 'block' }}>
          {title}
        </span>
        {sub && (
          <span className="menu-row__sub" style={{ display: 'block' }}>
            {sub}
          </span>
        )}
      </span>
      <span className="menu-row__chevron">›</span>
    </button>
  );
}

const IconUserEdit = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const IconGear = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);
