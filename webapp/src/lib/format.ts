import type { Lang } from '@shared/types';

/** 14 000 000 → "14 mln so'm" (qisqa) yoki "14 000 000 so'm" (to'liq). */
export function money(amount: number | null | undefined, lang: Lang = 'uz', short = true): string {
  if (amount == null) return lang === 'ru' ? '—' : '—';
  const unit = lang === 'ru' ? 'сум' : 'so‘m';

  if (short && amount >= 1_000_000) {
    const mln = amount / 1_000_000;
    const s = mln % 1 === 0 ? String(mln) : mln.toFixed(1).replace('.0', '');
    return `${s} ${lang === 'ru' ? 'млн' : 'mln'} ${unit}`;
  }
  if (short && amount >= 1_000) return `${Math.round(amount / 1000)} ${lang === 'ru' ? 'тыс' : 'ming'} ${unit}`;
  return `${groupDigits(amount)} ${unit}`;
}

export function groupDigits(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Qolgan vaqt: "3 soat 12 daqiqa" — taymer uchun. */
export function timeLeft(iso: string, lang: Lang = 'uz'): { text: string; expired: boolean; ms: number } {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { text: lang === 'ru' ? 'истекло' : 'tugadi', expired: true, ms: 0 };

  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;

  if (h >= 24) {
    const d = Math.floor(h / 24);
    return { text: lang === 'ru' ? `${d} дн.` : `${d} kun`, expired: false, ms };
  }
  if (h > 0) {
    return {
      text: lang === 'ru' ? `${h} ч ${m} мин` : `${h} soat ${m} daqiqa`,
      expired: false,
      ms,
    };
  }
  return { text: lang === 'ru' ? `${m} мин` : `${m} daqiqa`, expired: false, ms };
}

export function relativeTime(iso: string, lang: Lang = 'uz'): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return lang === 'ru' ? 'только что' : 'hozir';
  if (min < 60) return lang === 'ru' ? `${min} мин назад` : `${min} daqiqa oldin`;
  const h = Math.floor(min / 60);
  if (h < 24) return lang === 'ru' ? `${h} ч назад` : `${h} soat oldin`;
  const d = Math.floor(h / 24);
  if (d < 7) return lang === 'ru' ? `${d} дн. назад` : `${d} kun oldin`;
  return formatDate(iso, lang);
}

/**
 * O'zbek oy nomlari qo'lda beriladi: `Intl` `uz-UZ` uchun qisqa oyni
 * "M09" ko'rinishida qaytaradi, bu foydalanuvchiga tushunarsiz.
 */
const UZ_MONTHS = [
  'yan',
  'fev',
  'mar',
  'apr',
  'may',
  'iyn',
  'iyl',
  'avg',
  'sen',
  'okt',
  'noy',
  'dek',
];

export function formatDate(iso: string, lang: Lang = 'uz'): string {
  const d = new Date(iso);
  if (lang === 'ru') {
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return `${d.getDate()} ${UZ_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTime(iso: string, lang: Lang = 'uz'): string {
  const d = new Date(iso);
  if (lang === 'ru') {
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return `${d.getDate()} ${UZ_MONTHS[d.getMonth()]}, ${clockTime(iso)}`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "5 soat" kabi javob tezligi ko'rsatkichi. */
export function responseSpeed(minutes: number | null, lang: Lang = 'uz'): string | null {
  if (minutes == null) return null;
  if (minutes < 60) return lang === 'ru' ? `отвечает за ~${minutes} мин` : `~${minutes} daqiqada javob beradi`;
  const h = Math.round(minutes / 60);
  return lang === 'ru' ? `отвечает за ~${h} ч` : `~${h} soatda javob beradi`;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
