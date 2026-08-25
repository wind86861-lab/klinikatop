/** Global holat: sessiya, til, katalog keshi, toast'lar. */
import { create } from 'zustand';
import { api, type Bootstrap } from '@/lib/api';
import { translate, type TranslationKey } from '@/i18n';
import { telegramLang } from '@/lib/telegram';
import { connectWs, disconnectWs, onServerEvent } from '@/lib/ws';
import type { City, Lang, Notification, OperationCategory, ServerEvent, User } from '@shared/types';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

interface AppState {
  ready: boolean;
  error: string | null;
  /** Sessiya yo'q — kirish ekrani ko'rsatiladi */
  needsAuth: boolean;
  user: User | null;
  session: Bootstrap | null;
  lang: Lang;

  cities: City[];
  categories: OperationCategory[];

  unread: number;
  notifications: Notification[];
  toasts: Toast[];

  bootstrap: () => Promise<void>;
  setLang: (lang: Lang) => Promise<void>;
  refreshSession: () => Promise<void>;
  loadNotifications: () => Promise<void>;
  markAllRead: () => Promise<void>;
  toast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  error: null,
  needsAuth: false,
  user: null,
  session: null,
  lang: (localStorage.getItem('klinikatop.lang') as Lang | null) ?? telegramLang(),

  cities: [],
  categories: [],

  unread: 0,
  notifications: [],
  toasts: [],

  async bootstrap() {
    try {
      const [session, cities, categories] = await Promise.all([
        api.me(),
        api.cities(),
        api.categories(),
      ]);

      // Til: saqlangan tanlov ustun, aks holda profildagi til
      const stored = localStorage.getItem('klinikatop.lang') as Lang | null;
      const lang = stored ?? session.user.lang;

      set({ session, user: session.user, unread: session.unread, cities, categories, lang, ready: true, error: null });

      connectWs();
      subscribeToLiveUpdates();
    } catch (err: any) {
      // 401 — bu xato emas, shunchaki sessiya yo'q: kirish ekraniga yuboramiz.
      // Aks holda foydalanuvchi "initData yaroqsiz" degan boshi berk
      // ko'chaga tushadi va nima qilishni bilmaydi.
      if (err?.status === 401) {
        set({ ready: true, error: null, needsAuth: true });
        return;
      }
      set({ ready: true, error: err?.message ?? 'Ulanib bo‘lmadi' });
    }
  },

  async setLang(lang) {
    localStorage.setItem('klinikatop.lang', lang);
    set({ lang });
    try {
      await api.setLang(lang);
    } catch {
      // Til lokal saqlandi — server bilan keyingi safar sinxronlanadi
    }
  },

  async refreshSession() {
    const session = await api.me();
    set({ session, user: session.user, unread: session.unread });
  },

  async loadNotifications() {
    const { items, unread } = await api.notifications();
    set({ notifications: items, unread });
  },

  async markAllRead() {
    const { unread } = await api.readNotifications();
    set({
      unread,
      notifications: get().notifications.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
    });
  },

  toast(message, tone = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    window.setTimeout(() => get().dismissToast(id), 4000);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  t(key, params) {
    return translate(get().lang, key, params);
  },
}));

/** Bildirishnomalar oqimi — soatga qaramay yangilanadi. */
function subscribeToLiveUpdates() {
  onServerEvent((event: ServerEvent) => {
    if (event.type !== 'notification') return;
    const store = useApp.getState();
    store.loadNotifications().catch(() => {});
    store.toast(store.t(`notif.${event.notification.type}` as TranslationKey, event.notification.params));
  });
}

export function teardownApp() {
  disconnectWs();
}

/** Qulay yorliq: `const t = useT()`. */
export const useT = () => useApp((s) => s.t);
export const useLang = () => useApp((s) => s.lang);
