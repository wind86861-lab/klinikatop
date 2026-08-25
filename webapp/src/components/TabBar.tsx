/**
 * Pastki navigatsiya — har rol o'z bo'limlarini oladi.
 * Foydalanuvchi har doim qayerdaligini va yana qayerga bora olishini ko'radi.
 */
import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import {
  IconBell,
  IconChat,
  IconClinic,
  IconInbox,
  IconShield,
  IconStethoscope,
  IconWallet,
} from '@/ui';
import type { TranslationKey } from '@/i18n';
import type { ReactNode } from 'react';

export type TabRole = 'patient' | 'clinic' | 'admin';

interface Tab {
  path: string;
  labelKey: TranslationKey;
  icon: ReactNode;
  badge?: number;
}

/** Faol bo'limni aniqlash — eng uzun mos prefiks yutadi. */
function activeIndex(tabs: Tab[], pathname: string): number {
  let best = -1;
  let bestLength = -1;
  tabs.forEach((tab, i) => {
    const matches = tab.path === '/' ? pathname === '/' : pathname.startsWith(tab.path);
    if (matches && tab.path.length > bestLength) {
      best = i;
      bestLength = tab.path.length;
    }
  });
  return best;
}

export function TabBar({ role }: { role: TabRole }) {
  const { t, unread } = useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const tabs: Tab[] =
    role === 'clinic'
      ? [
          { path: '/clinic', labelKey: 'nav.clinicPanel', icon: <IconClinic size={20} /> },
          { path: '/clinic/requests', labelKey: 'nav.clinicRequests', icon: <IconInbox size={20} /> },
          { path: '/clinic/deals', labelKey: 'nav.clinicDeals', icon: <IconChat size={20} /> },
          { path: '/clinic/services', labelKey: 'nav.clinicServices', icon: <IconWallet size={20} /> },
          { path: '/clinic/profile', labelKey: 'nav.clinic', icon: <IconStethoscope size={20} /> },
        ]
      : role === 'admin'
        ? [
            { path: '/admin', labelKey: 'nav.verifications', icon: <IconShield size={20} /> },
            { path: '/admin/disputes', labelKey: 'nav.disputes', icon: <IconAlertTab /> },
            { path: '/admin/catalog', labelKey: 'nav.catalog', icon: <IconInbox size={20} /> },
            { path: '/admin/users', labelKey: 'nav.users', icon: <IconStethoscope size={20} /> },
            { path: '/admin/metrics', labelKey: 'nav.metrics', icon: <IconWallet size={20} /> },
          ]
        : [
            { path: '/', labelKey: 'nav.home', icon: <IconStethoscope size={20} /> },
            { path: '/requests', labelKey: 'nav.requests', icon: <IconInbox size={20} /> },
            { path: '/deals', labelKey: 'nav.deals', icon: <IconChat size={20} /> },
            { path: '/notifications', labelKey: 'nav.profile', icon: <IconBell size={20} />, badge: unread },
          ];

  // Bemor uchun 4-bo'lim profil, bildirishnoma sarlavhada — lekin
  // profil ekrani tayyor bo'lgunicha shu joyni bildirishnoma egallaydi
  if (role === 'patient') {
    tabs[3] = { path: '/profile', labelKey: 'nav.profile', icon: <IconProfileTab />, badge: undefined };
  }

  const current = activeIndex(tabs, pathname);

  return (
    <nav className="tabbar" role="navigation" aria-label={t('nav.home')}>
      {tabs.map((tab, i) => {
        const active = i === current;
        return (
          <button
            key={tab.path}
            className={`tabbar__item ${active ? 'tabbar__item--active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              if (active) return;
              haptic.select();
              navigate(tab.path);
            }}
          >
            {active && (
              <motion.span layoutId={`tab-${role}`} className="tabbar__marker" transition={spring} />
            )}
            {tab.icon}
            <span className="tabbar__label">{t(tab.labelKey)}</span>
            {Boolean(tab.badge) && (
              <span className="tabbar__badge">{tab.badge! > 9 ? '9+' : tab.badge}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/* Tab uchun ikkita qo'shimcha ikonka */

const IconProfileTab = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const IconAlertTab = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);
