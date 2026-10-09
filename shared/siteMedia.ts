/**
 * klinikatop.uz ochiq sahifalaridagi media joylari (slotlar).
 *
 * Sayt statik HTML, lekin rasm va videolar admin panelidan
 * almashtiriladi — qayta build kerak emas. Bu ro'yxat YAGONA manba:
 *   • server faqat shu kalitlarga yozishga ruxsat beradi
 *   • admin panel shu ro'yxatni ko'rsatadi
 *   • sayt komponentlari (`site/src`) aynan shu kalitlarni ishlatadi
 *
 * Yangi joy qo'shilsa — shu yerga ham, sayt komponentiga ham.
 */

/** image — rasm, video — takrorlanuvchi fon video fayli (mp4/webm), youtube — to'liq video */
export type SiteMediaKind = 'image' | 'video' | 'youtube';

export interface SiteMediaSlot {
  key: string;
  kind: SiteMediaKind;
  /** Admin panelida ko'rinadigan nom */
  label: string;
  /** Qaysi sahifa va qayerda */
  where: string;
  /** Tavsiya etilgan o'lcham — rasm uchun */
  size?: string;
  /** SVG ham qabul qilinadimi (logo uchun) — xavfli teglar serverda rad etiladi */
  svg?: boolean;
  group: 'Brend' | 'Bosh sahifa' | 'Klinikalar sahifasi';
}

export const SITE_MEDIA_SLOTS: SiteMediaSlot[] = [
  {
    key: 'logo',
    kind: 'image',
    label: 'Logo',
    where: 'Butun sayt: menyu, bosh ekran, footer, 5-bosqichdagi radar va brauzer yorlig‘idagi belgi (favicon). Yuklanmaguncha standart logo turadi.',
    size: 'SVG (tavsiya) yoki shaffof PNG, kvadratga yaqin, 512×512',
    svg: true,
    group: 'Brend',
  },
  {
    key: 'logo-light',
    kind: 'image',
    label: 'Logo — to‘q fon uchun',
    where: 'Qora/to‘q fondagi bloklar (sahifa oxiridagi chaqiruv). Ixtiyoriy: bo‘sh bo‘lsa asosiy logo ishlatiladi.',
    size: 'SVG yoki shaffof PNG, oq yoki och rangli',
    svg: true,
    group: 'Brend',
  },
  {
    key: 'hero-app',
    kind: 'image',
    label: 'Asosiy ekran surati',
    where: 'Bosh sahifa → sarlavha ostidagi markaziy panel (takliflar ro‘yxati o‘rniga)',
    size: '1600×1000',
    group: 'Bosh sahifa',
  },
  ...[1, 2, 3, 4, 5].map((n) => ({
    key: `step-${n}`,
    kind: 'image' as const,
    label: `${n}-bosqich ekrani`,
    where: `Bosh sahifa → "5 bosqichda to‘g‘ri tanlov" → telefon ichidagi ${n}-sahna`,
    size: '780×1600 (telefon ekrani)',
    group: 'Bosh sahifa' as const,
  })),
  {
    key: 'video-home',
    kind: 'youtube',
    label: 'Bosh sahifa videosi (YouTube)',
    where: 'Bosh sahifa → sarlavha ostidagi katta ramka: video shu yerda ovozsiz, takrorlanib o‘ynaydi; bosilsa ovozi bilan ochiladi. Qo‘yilmaguncha ramkada ilova namunasi turadi.',
    group: 'Bosh sahifa',
  },
  {
    key: 'clinic-hero',
    kind: 'image',
    label: 'Kabinet (sarlavha yonida)',
    where: 'Klinikalar sahifasi → sarlavha yonidagi panel',
    size: '1400×1000',
    group: 'Klinikalar sahifasi',
  },
  ...['So‘rovlar taxtasi', 'Taklif yuborish', 'Bitimlar va kalendar', 'Analitika'].map((name, i) => ({
    key: `cabinet-${i + 1}`,
    kind: 'image' as const,
    label: `Kabinet: ${name}`,
    where: 'Klinikalar sahifasi → "Hammasi bitta kabinetda"',
    size: '1600×1000',
    group: 'Klinikalar sahifasi' as const,
  })),
  {
    key: 'video-clinic',
    kind: 'youtube',
    label: 'Klinikalar sahifasi videosi (YouTube)',
    where: 'Klinikalar sahifasi → "Kabinet bilan tanishing". ID qo‘yilmaguncha bo‘lim yashirin.',
    group: 'Klinikalar sahifasi',
  },
];

export const SITE_MEDIA_KEYS = new Set(SITE_MEDIA_SLOTS.map((s) => s.key));

export interface SiteMediaItem {
  key: string;
  kind: SiteMediaKind;
  /** Rasm manzili (versiya bilan — kesh yangilansin) */
  url: string | null;
  youtubeId: string | null;
  altUz: string;
  altRu: string;
  updatedAt: string;
}
