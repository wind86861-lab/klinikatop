/**
 * Telegram Mini App ko'prigi.
 * Brauzerda (Telegram tashqarisida) ochilsa — xavfsiz mock rejim,
 * shunda ishlab chiqish va test brauzerda ham davom etadi.
 */

type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type NotificationStyle = 'error' | 'success' | 'warning';

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; language_code?: string } };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  viewportStableHeight?: number;
  isExpanded: boolean;
  ready(): void;
  expand(): void;
  close(): void;
  /** t.me havolasini Telegram ichida ochish (ulashish oynasi) */
  openTelegramLink?(url: string): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton: {
    setText(t: string): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback: {
    impactOccurred(style: HapticStyle): void;
    notificationOccurred(type: NotificationStyle): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export const tg = window.Telegram?.WebApp;
export const inTelegram = Boolean(tg?.initData);

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  /*
   * Mavzu bu yerda QO'YILMAYDI.
   *
   * Ilgari u shu yerda ham, sozlamalar ekranida ham qo'yilardi va
   * ikkovi kelishmay qolardi: ilova yorug', Telegram ramkasi qorong'i.
   * Endi qaror bitta joyda — `lib/theme.ts`.
   */
}


export function currentScheme(): 'light' | 'dark' {
  if (tg) return tg.colorScheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/* ── Haptics: har muhim harakat javob beradi ── */

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/*
 * Ixtiyoriy zanjir HAR BO'G'INDA turishi shart.
 *
 * Ilgari faqat `tg?` bor edi: `tg?.HapticFeedback.impactOccurred(...)`.
 * Telegram 6.0 da (va ba'zi mijozlarda) `HapticFeedback` umuman yo'q —
 * u holda bu qator "Cannot read properties of undefined" bilan
 * yiqilardi. Tebranish — bezak, u ilovani to'xtatmasligi kerak.
 */
export const haptic = {
  tap: () => !reducedMotion() && tg?.HapticFeedback?.impactOccurred?.('light'),
  press: () => !reducedMotion() && tg?.HapticFeedback?.impactOccurred?.('medium'),
  strong: () => !reducedMotion() && tg?.HapticFeedback?.impactOccurred?.('heavy'),
  select: () => !reducedMotion() && tg?.HapticFeedback?.selectionChanged?.(),
  success: () => !reducedMotion() && tg?.HapticFeedback?.notificationOccurred?.('success'),
  warning: () => !reducedMotion() && tg?.HapticFeedback?.notificationOccurred?.('warning'),
  error: () => !reducedMotion() && tg?.HapticFeedback?.notificationOccurred?.('error'),
};

/* ── Telegram tugmalari ── */

export function useTelegramBackButton(onBack: (() => void) | null) {
  // Eski mijozlarda `BackButton` bo'lmasligi mumkin — xuddi haptic kabi
  const back = tg?.BackButton;
  if (!back) return;
  if (onBack) {
    back.show?.();
    back.onClick?.(onBack);
  } else {
    back.hide?.();
  }
  return () => {
    if (onBack) back.offClick?.(onBack);
  };
}

export function telegramLang(): 'uz' | 'ru' {
  const code = tg?.initDataUnsafe?.user?.language_code ?? navigator.language;
  return code?.startsWith('ru') ? 'ru' : 'uz';
}
