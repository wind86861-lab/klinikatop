/**
 * Dizayn tizimi primitivlari.
 * Har bir komponent motion tizimidagi bitta easing va spring'ga bo'ysunadi.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AnimatePresence, m, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { EASE, DUR, ease, itemVariants, listVariants, popVariants, scrimVariants, sheetVariants, spring } from '@/lib/motion';
import { haptic } from '@/lib/telegram';

/* ─────────────────────────  Tugma  ───────────────────────── */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading,
  icon,
  children,
  className = '',
  onClick,
  disabled,
  ...rest
}: ButtonProps) {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || loading) return;
    haptic.tap();

    // Bosilgan nuqtadan tarqaladigan to'lqin — har tegish javob beradi
    const rect = e.currentTarget.getBoundingClientRect();
    const id = Date.now();
    setRipples((r) => [...r, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    window.setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 550);

    onClick?.(e);
  };

  return (
    <m.button
      whileTap={{ scale: disabled || loading ? 1 : 0.97 }}
      transition={spring}
      className={`btn btn--${variant} ${size === 'sm' ? 'btn--sm' : ''} ${block ? 'btn--block' : ''} ${className}`}
      onClick={handleClick}
      disabled={disabled || loading}
      {...(rest as any)}
    >
      {ripples.map((r) => (
        <m.span
          key={r.id}
          className="btn__ripple"
          style={{ left: r.x, top: r.y }}
          initial={{ width: 0, height: 0, opacity: 0.3 }}
          animate={{ width: 320, height: 320, opacity: 0 }}
          transition={{ duration: 0.55, ease: EASE }}
        />
      ))}
      {loading ? <span className="btn__spinner" aria-hidden /> : icon}
      {children}
    </m.button>
  );
}

/* ─────────────────────────  Kartochka  ───────────────────────── */

export function Card({
  children,
  className = '',
  variant = 'default',
  onClick,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'flat' | 'glass';
  onClick?: () => void;
} & Record<string, unknown>) {
  const modifier = variant === 'default' ? '' : `card--${variant}`;

  // Bosiladigan kartochka klaviatura bilan ham ishlashi kerak (a11y)
  const interactive = Boolean(onClick);

  return (
    <div
      className={`card ${modifier} ${interactive ? 'card--interactive' : ''} ${className}`}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick!();
              }
            }
          : undefined
      }
      {...(rest as any)}
    >
      {children}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="stack">
      <div className="between">
        <h2 className="section-title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ─────────────────────────  Chip  ───────────────────────── */

export function Chip({
  active,
  onClick,
  children,
  size,
  className,
  /** Ko'rinadi va tanlangan, lekin o'zgartirib bo'lmaydi */
  locked,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  size?: 'sm';
  className?: string;
  locked?: boolean;
}) {
  return (
    <m.button
      type="button"
      whileTap={locked ? undefined : { scale: 0.95 }}
      transition={spring}
      className={`chip ${active ? 'chip--active' : ''} ${size === 'sm' ? 'chip--sm' : ''} ${className ?? ''}`}
      onClick={() => {
        if (locked) return;
        haptic.select();
        onClick?.();
      }}
      aria-pressed={active}
      aria-disabled={locked || undefined}
    >
      {children}
    </m.button>
  );
}

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/* ─────────────────────────  Maydonlar  ───────────────────────── */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label && <label className="field__label">{label}</label>}
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`input ${props.className ?? ''}`} />
);

export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={`textarea ${props.className ?? ''}`} />
);

/**
 * Ro'yxatdan tanlash. Telefonda tizimning o'z g'ildiragi ochiladi — bu
 * 14 ta viloyatni chiplar bilan terishdan tez va tanish.
 */
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <div className="select">
    <select {...props} className={`input select__el ${props.className ?? ''}`} />
    <IconChevron size={16} />
  </div>
);

/* ─────────────────────────  Segment (tab)  ───────────────────────── */

export function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const groupId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  /**
   * "Pill" o'lchami faol tugmadan o'lchab olinadi — teng ulush emas.
   * Aks holda uzun yorliq ("So'rovlar oqimi") pilldan chiqib ketadi.
   */
  useLayoutEffect(() => {
    const container = containerRef.current;
    const active = container?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!container || !active) return;

    const update = () => setPill({ left: active.offsetLeft, width: active.offsetWidth });
    update();
    // Faol tab ekrandan chiqib qolmasin
    active.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });

    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [value, options.length]);

  return (
    <div className="segment" role="tablist" ref={containerRef}>
      {pill && (
        <m.div
          className="segment__pill"
          initial={false}
          animate={{ left: pill.left, width: pill.width }}
          transition={spring}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          id={`${groupId}-${o.value}`}
          aria-selected={o.value === value}
          className={`segment__btn ${o.value === value ? 'segment__btn--active' : ''}`}
          onClick={() => {
            haptic.select();
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────  Skeleton  ───────────────────────── */

export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return (
    <div
      className="skeleton"
      style={{ height: h, width: w, borderRadius: r ?? 'var(--r-sm)' }}
      aria-hidden
    />
  );
}

/** Kontent shakli — bo'sh spinner o'rniga. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card stack">
      <Skeleton h={22} w="55%" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} h={13} w={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </div>
  );
}

export function SkeletonList({ count = 3, lines = 3 }: { count?: number; lines?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}

/* ─────────────────────────  Varaq (bottom sheet)  ───────────────────────── */

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  // Varaq ochiqda orqa fon skroll qilmasin
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.div
            className="scrim"
            variants={scrimVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={onClose}
          />
          <m.div
            className="sheet"
            variants={sheetVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 550) {
                haptic.tap();
                onClose();
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="sheet__grip" />
            {title && (
              <div className="sheet__head">
                <h2 style={{ fontSize: 'var(--t-lg)' }}>{title}</h2>
              </div>
            )}
            <div className="sheet__body">{children}</div>
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ─────────────────────────  Stepper  ───────────────────────── */

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="stepper">
      {steps.map((label, i) => (
        <div className="stepper__step" key={label}>
          {i < steps.length - 1 && (
            <div className="stepper__line">
              <m.div
                className="stepper__line-fill"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: i < current ? 1 : 0 }}
                transition={{ duration: DUR.page, ease: EASE }}
              />
            </div>
          )}
          <m.div
            className={`stepper__dot ${i < current ? 'stepper__dot--done' : ''} ${
              i === current ? 'stepper__dot--current' : ''
            }`}
            initial={false}
            animate={{ scale: i === current ? 1.08 : 1 }}
            transition={spring}
          >
            {i < current ? <IconCheck size={13} /> : i + 1}
          </m.div>
          <span className={`stepper__label ${i <= current ? 'stepper__label--active' : ''}`}>{label}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────  Raqam animatsiyasi  ───────────────────────── */

/** Raqam sakramaydi — oqib o'zgaradi. */
export function CountUp({
  value,
  format = (n: number) => Math.round(n).toLocaleString('ru-RU'),
  className = '',
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const motionValue = useMotionValue(value);
  const smooth = useSpring(motionValue, { stiffness: 120, damping: 22 });
  const text = useTransform(smooth, (v) => format(v));

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  return <m.span className={className}>{text}</m.span>;
}

/* ─────────────────────────  Holatlar  ───────────────────────── */

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <m.div className="state" variants={popVariants} initial="initial" animate="animate">
      {icon && <div className="state__art">{icon}</div>}
      <div className="state__title">{title}</div>
      {text && <p className="state__text">{text}</p>}
      {action}
    </m.div>
  );
}

export function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel: string }) {
  return (
    <EmptyState
      icon={<IconAlert size={30} />}
      title={message}
      action={onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>{retryLabel}</Button> : undefined}
    />
  );
}

/* ─────────────────────────  Avatar  ───────────────────────── */

export function Avatar({ name, url, size }: { name: string; url?: string | null; size?: 'sm' | 'lg' }) {
  const cls = `avatar ${size ? `avatar--${size}` : ''}`;
  if (url) return <img className={cls} src={url} alt={name} loading="lazy" />;
  return (
    <div className={cls} aria-hidden>
      {name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')}
    </div>
  );
}

/* ─────────────────────────  Yulduzlar  ───────────────────────── */

export function Stars({
  value,
  onChange,
  size = 'md',
  readOnly,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: 'md' | 'lg';
  readOnly?: boolean;
}) {
  return (
    <div className={`stars ${size === 'lg' ? 'stars--lg' : ''}`} role={readOnly ? 'img' : 'radiogroup'} aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <m.button
          key={n}
          type="button"
          disabled={readOnly}
          className={`stars__btn ${n <= value ? 'stars__btn--on' : ''}`}
          // Bosilganda "pop" + ketma-ket yonish
          animate={n <= value ? { scale: [1, 1.35, 1] } : { scale: 1 }}
          transition={{ ...spring, delay: n <= value ? n * 0.03 : 0 }}
          onClick={() => {
            if (readOnly) return;
            haptic.select();
            onChange?.(n);
          }}
          aria-label={String(n)}
        >
          <IconStar size={size === 'lg' ? 34 : 16} filled={n <= value} />
        </m.button>
      ))}
    </div>
  );
}

/* ─────────────────────────  Ogohlantirish paneli  ───────────────────────── */

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <span aria-hidden style={{ flex: '0 0 auto', marginTop: 1 }}>
        {tone === 'info' ? <IconInfo size={17} /> : <IconAlert size={17} />}
      </span>
      <span>{children}</span>
    </div>
  );
}

/* ─────────────────────────  Ro'yxat animatsiyasi  ───────────────────────── */

export function AnimatedList({ children, className = 'stack' }: { children: ReactNode; className?: string }) {
  return (
    <m.div className={className} variants={listVariants} initial="initial" animate="animate">
      {children}
    </m.div>
  );
}

export function AnimatedItem({
  children,
  layoutId,
  className,
}: {
  children: ReactNode;
  layoutId?: string;
  className?: string;
}) {
  return (
    <m.div layout layoutId={layoutId} variants={itemVariants} exit="exit" className={className}>
      {children}
    </m.div>
  );
}

/* ─────────────────────────  Toast  ───────────────────────── */

export function Toaster({ toasts, onDismiss }: { toasts: { id: number; message: string; tone: string }[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toaster" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <m.div
            key={t.id}
            className={`toast toast--${t.tone}`}
            initial={{ opacity: 0, y: -24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={spring}
            onClick={() => onDismiss(t.id)}
          >
            <span className="toast__dot" />
            <span>{t.message}</span>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────────────  Ekran karkasi  ───────────────────────── */

const ScreenCtx = createContext<{ scrollRef: React.RefObject<HTMLDivElement> } | null>(null);
export const useScreen = () => useContext(ScreenCtx);

export function Screen({
  title,
  subtitle,
  onBack,
  actions,
  children,
  footer,
  tabBar,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Pastki navigatsiya — bo'lim ekranlarida beriladi */
  tabBar?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <ScreenCtx.Provider value={{ scrollRef }}>
      <m.div
        // Yopishqoq panel bor bo'lsa kontentga qo'shimcha pastki bo'shliq kerak,
        // aks holda oxirgi element panel ortida qolib ketadi
        className={`screen ${footer ? 'screen--with-footer' : ''} ${tabBar ? 'screen--tabbed' : ''}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={ease}
      >
        {title && (
          <header className="app-header">
            <div className="row">
              {onBack && (
                <button className="app-header__back" onClick={onBack} aria-label="Orqaga">
                  <IconBack size={18} />
                </button>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 className="app-header__title truncate">{title}</h1>
                {subtitle && <div className="app-header__sub truncate">{subtitle}</div>}
              </div>
              {actions}
            </div>
          </header>
        )}
        <div className="content" ref={scrollRef}>
          {children}
        </div>
        {footer && <div className="action-bar">{footer}</div>}
        {tabBar}
      </m.div>
    </ScreenCtx.Provider>
  );
}

/* ─────────────────────────  Ikonalar (inline SVG — tashqi yuk yo'q)  ───────────────────────── */

const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const IconBack = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const IconChevron = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconCheck = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const IconPlus = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconTrash = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
    <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
);

export const IconSearch = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-3.6-3.6" />
  </svg>
);

export const IconSend = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);

export const IconBell = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 01-3.4 0" />
  </svg>
);

export const IconStar = ({ size = 20, filled = false }) => (
  <svg {...svg(size)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21l1.2-6.9-5-4.9 6.9-1L12 2z" />
  </svg>
);

export const IconInfo = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

export const IconAlert = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

export const IconChat = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z" />
  </svg>
);

export const IconStethoscope = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M4.8 2.3A2 2 0 003 4.3v4.4a5 5 0 0010 0V4.3a2 2 0 00-1.8-2" />
    <path d="M8 13.7V16a5 5 0 0010 0v-1" />
    <circle cx="20" cy="11" r="2" />
  </svg>
);

export const IconClinic = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M3 21h18M5 21V7l7-4 7 4v14" />
    <path d="M12 10v4M10 12h4" />
  </svg>
);

export const IconChart = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="M7 15l3.5-4 3 3L20 7" />
  </svg>
);

export const IconWallet = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M20 12V8H6a2 2 0 010-4h12v4" />
    <path d="M4 6v12a2 2 0 002 2h14v-4" />
    <path d="M18 12a2 2 0 000 4h4v-4h-4z" />
  </svg>
);

export const IconShield = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

export const IconClock = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const IconSparkle = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
  </svg>
);

export const IconInbox = ({ size = 20 }) => (
  <svg {...svg(size)}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.5 5.1L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.5-6.9A2 2 0 0016.8 4H7.2a2 2 0 00-1.7 1.1z" />
  </svg>
);
