/**
 * Klinika kabinetining umumiy qismlari.
 *
 * Kabinet 23 ta ekrandan iborat va ularning hammasi bitta shakl bo'yicha
 * quriladi: yuklanish → bo'sh → xato → ma'lumot. Shu to'rt holatni har
 * ekranda qaytadan yozmaslik uchun `useResource` va `Async` shu yerda turadi.
 *
 * Pastki navigatsiya faqat beshta asosiy bo'limni ko'rsatadi — qolganiga
 * "Boshqa" ekrani orqali kiriladi. Telefon ekranida beshtadan ortiq yorliq
 * o'qilmay qoladi.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { spring } from '@/lib/motion';
import { haptic } from '@/lib/telegram';
import {
  Card,
  EmptyState,
  ErrorState,
  IconChat,
  IconChevron,
  IconClinic,
  IconInbox,
  IconWallet,
  SkeletonList,
} from '@/ui';

/* ─────────────────────────  Ma'lumot yuklash  ───────────────────────── */

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  set: (next: T) => void;
}

/**
 * Bitta so'rovni yuklash va uning to'rt holatini kuzatish.
 *
 * `reload` qo'lda chaqiriladi — masalan, shifokor qo'shilgandan keyin.
 * `set` esa serverdan qaytgan yangi qiymatni qayta so'ramasdan qo'yadi.
 */
export function useResource<T>(load: () => Promise<T>, deps: unknown[] = []): Resource<T> {
  const { t } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    load()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? t('common.error'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, set: setData };
}

/**
 * To'rt holatni bitta joyda hal qiladi: yuklanmoqda / xato / bo'sh / ma'lumot.
 * Har ekran shuni o'rab qo'yadi va faqat oxirgi holatni yozadi.
 */
export function Async<T>({
  resource,
  empty,
  isEmpty,
  skeleton,
  children,
}: {
  resource: Resource<T>;
  empty?: { title: string; text?: string; action?: ReactNode };
  isEmpty?: (data: T) => boolean;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { t } = useApp();

  if (resource.loading && resource.data === null) {
    return <>{skeleton ?? <SkeletonList count={3} />}</>;
  }

  if (resource.error && resource.data === null) {
    return <ErrorState message={resource.error} onRetry={resource.reload} retryLabel={t('common.retry')} />;
  }

  if (resource.data === null) return null;

  if (empty && isEmpty?.(resource.data)) {
    return (
      <EmptyState icon={<IconInbox size={26} />} title={empty.title} text={empty.text} action={empty.action} />
    );
  }

  return <>{children(resource.data)}</>;
}

/* ─────────────────────────  Navigatsiya  ───────────────────────── */

export const CLINIC_TABS = [
  { to: '/clinic', key: 'nav.dashboard', icon: IconClinic, end: true },
  { to: '/clinic/requests', key: 'nav.clinicRequests', icon: IconInbox, end: false },
  { to: '/clinic/deals', key: 'nav.clinicDeals', icon: IconChat, end: false },
  { to: '/clinic/revenue', key: 'nav.money', icon: IconWallet, end: false },
  { to: '/clinic/more', key: 'nav.more', icon: IconChevron, end: false },
] as const;

export function ClinicTabBar() {
  const { t } = useApp();

  return (
    <nav className="tabbar" aria-label={t('clinic.title')}>
      {CLINIC_TABS.map(({ to, key, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `tabbar__item ${isActive ? 'is-active' : ''}`}
          onClick={() => haptic.select()}
        >
          <Icon size={21} />
          <span>{t(key as any)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Ro'yxat qatori — "Boshqa" ekranida va sozlamalarda ishlatiladi. */
export function NavRow({
  icon,
  title,
  hint,
  to,
  onClick,
  right,
  tone,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  to?: string;
  onClick?: () => void;
  right?: ReactNode;
  tone?: 'danger';
}) {
  const navigate = useNavigate();
  const go = () => {
    haptic.press();
    if (to) navigate(to);
    else onClick?.();
  };

  return (
    <motion.button
      type="button"
      className={`nav-row ${tone === 'danger' ? 'nav-row--danger' : ''}`}
      onClick={go}
      whileTap={{ scale: 0.985 }}
      transition={spring}
    >
      {icon && <span className="nav-row__icon">{icon}</span>}
      <span className="nav-row__text">
        <span className="nav-row__title">{title}</span>
        {hint && <span className="nav-row__hint">{hint}</span>}
      </span>
      {right ?? <span className="nav-row__go"><IconChevron size={17} /></span>}
    </motion.button>
  );
}

/* ─────────────────────────  Ko'rsatkich plitkasi  ───────────────────────── */

export function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'good' | 'warn';
}) {
  return (
    <Card className="stat-tile">
      <span className="stat-tile__label">{label}</span>
      <strong className={`stat-tile__value ${tone ? `is-${tone}` : ''}`}>{value}</strong>
      {hint && <span className="stat-tile__hint">{hint}</span>}
    </Card>
  );
}

/** Foizni ko'rsatuvchi ingichka chiziq — konversiya va yutish darajasi uchun. */
export function Meter({ value, tone = 'primary' }: { value: number; tone?: 'primary' | 'accent' | 'success' }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="meter" role="presentation">
      <motion.span
        className={`meter__fill meter__fill--${tone}`}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: pct }}
        transition={{ ...spring, delay: 0.1 }}
      />
    </div>
  );
}
