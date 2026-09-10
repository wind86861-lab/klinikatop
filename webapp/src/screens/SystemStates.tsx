/**
 * Tizim holatlari — xato yuz berganda foydalanuvchi bo'sh ekran ko'rmasin.
 */
import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { useNavigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { spring } from '@/lib/motion';
import { Button, EmptyState, IconAlert, IconInfo, IconShield, Screen } from '@/ui';

export function NotFound() {
  const { t } = useApp();
  const navigate = useNavigate();
  return (
    <Screen>
      <EmptyState
        icon={<IconInfo size={30} />}
        title={t('sys.notFound')}
        action={
          <Button size="sm" onClick={() => navigate('/', { replace: true })}>
            {t('sys.toHome')}
          </Button>
        }
      />
    </Screen>
  );
}

export function Forbidden() {
  const { t } = useApp();
  const navigate = useNavigate();
  return (
    <Screen>
      <EmptyState
        icon={<IconShield size={30} />}
        title={t('sys.forbidden')}
        action={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            {t('common.back')}
          </Button>
        }
      />
    </Screen>
  );
}

export function Blocked() {
  const { t } = useApp();
  return (
    <Screen>
      <EmptyState icon={<IconAlert size={30} />} title={t('sys.blocked')} text={t('sys.blockedText')} />
    </Screen>
  );
}

/**
 * Offline chizig'i — ilova ustida doimiy turadi.
 * Kesh kontenti o'qilaveradi, faqat yozish amallar xato beradi.
 */
export function OfflineBanner() {
  const { t } = useApp();
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (!offline) return null;

  return (
    <m.div
      initial={{ y: -40 }}
      animate={{ y: 0 }}
      exit={{ y: -40 }}
      transition={spring}
      role="status"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 95,
        padding: 'calc(var(--safe-top) + 6px) var(--s-4) 6px',
        background: 'var(--warning)',
        color: '#2a1a05',
        fontSize: 'var(--t-xs)',
        fontWeight: 600,
        textAlign: 'center',
      }}
    >
      {t('sys.offline')}
    </m.div>
  );
}

/** Splash — bootstrap ishlayotgan payt. */
export function Splash() {
  const { t } = useApp();
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(160deg, var(--primary), var(--primary-deep))',
        color: '#fff',
      }}
    >
      <div style={{ textAlign: 'center', display: 'grid', gap: 'var(--s-4)', justifyItems: 'center' }}>
        <m.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={spring}
          style={{
            width: 84,
            height: 84,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(255,255,255,.14)',
          }}
        >
          <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4.8 2.3A2 2 0 003 4.3v4.4a5 5 0 0010 0V4.3a2 2 0 00-1.8-2" />
            <path d="M8 13.7V16a5 5 0 0010 0v-1" />
            <circle cx="20" cy="11" r="2" />
          </svg>
        </m.div>

        <m.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.08 }}
          style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--t-2xl)', letterSpacing: '-0.02em' }}
        >
          {t('appName')}
        </m.div>

        <m.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1.1, ease: 'easeInOut', repeat: Infinity }}
          style={{ width: 96, height: 2, borderRadius: 2, background: 'rgba(255,255,255,.5)' }}
        />
      </div>
    </div>
  );
}
