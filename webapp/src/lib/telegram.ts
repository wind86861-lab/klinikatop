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

export const haptic = {
  tap: () => !reducedMotion() && tg?.HapticFeedback.impactOccurred('light'),
  press: () => !reducedMotion() && tg?.HapticFeedback.impactOccurred('medium'),
  strong: () => !reducedMotion() && tg?.HapticFeedback.impactOccurred('heavy'),
  select: () => !reducedMotion() && tg?.HapticFeedback.selectionChanged(),
  success: () => !reducedMotion() && tg?.HapticFeedback.notificationOccurred('success'),
  warning: () => !reducedMotion() && tg?.HapticFeedback.notificationOccurred('warning'),
  error: () => !reducedMotion() && tg?.HapticFeedback.notificationOccurred('error'),
};

/* ── Telegram tugmalari ── */

export function useTelegramBackButton(onBack: (() => void) | null) {
  if (!tg) return;
  if (onBack) {
    tg.BackButton.show();
    tg.BackButton.onClick(onBack);
  } else {
    tg.BackButton.hide();
  }
  return () => {
    if (onBack) tg.BackButton.offClick(onBack);
  };
}

export function telegramLang(): 'uz' | 'ru' {
  const code = tg?.initDataUnsafe?.user?.language_code ?? navigator.language;
  return code?.startsWith('ru') ? 'ru' : 'uz';
}
