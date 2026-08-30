/**
 * Mavzu — BITTA joyda hal qilinadi.
 *
 * ═══ Nima uchun ═══
 *
 * Ilgari qaror ikki joyga bo'lingan edi: `applyTheme` Telegram
 * aytganini qo'yardi, `restoreTheme` esa saqlangan tanlovni. Ular
 * kelishmasa quyidagi holat chiqardi:
 *
 *   Telegram qorong'i, odam yorug'ni tanlagan
 *   → ilova YORUG' chiziladi (#eaf0ee)
 *   → Telegram o'z ramkasini QORONG'I bo'yaydi (#0c1817)
 *
 * Natijada ekranning yuqorisi va cheti qora, o'rtasi oq bo'lib
 * qolardi. "Fon umuman to'g'ri kelmaydi" degani aynan shu.
 *
 * Endi bitta funksiya ikkalasini birga qiladi: qaysi mavzu
 * qo'llanilsa, Telegram ramkasi ham o'sha rangda bo'ladi.
 */
import { inTelegram, tg } from './telegram';

export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'klinikatop.theme';

/** Har mavzuning fon rangi — tokenlardagi `--bg` bilan bir xil. */
const BG: Record<'light' | 'dark', string> = {
  light: '#eaf0ee',
  dark: '#0c1817',
};

/*
 * Sukut bo'yicha YORUG'.
 *
 * Ilgari `auto` edi va ilova telefon sozlamasiga ergashardi. Amalda
 * ko'p odamning telefoni qorong'i, lekin ilova yorug' rejimda
 * o'ylangan — tibbiy matn, hujjat va narx jadvallari yorug' fonda
 * ancha tiniq. Qorong'ini xohlagan odam sozlamalardan tanlaydi.
 */
export function savedTheme(): Theme {
  try {
    return (localStorage.getItem(KEY) as Theme | null) ?? 'light';
  } catch {
    return 'light';
  }
}

/**
 * Amalda qo'llaniladigan mavzu.
 *
 * `auto` — Telegram aytganini oladi; u ham bo'lmasa tizim sozlamasi.
 */
function resolve(theme: Theme): 'light' | 'dark' {
  if (theme !== 'auto') return theme;

  /*
   * Telegram sxemasiga FAQAT haqiqatan Telegram ichida bo'lsak
   * ishonamiz.
   *
   * Telegram ko'prigi skripti (`telegram-web-app.js`) oddiy brauzerda
   * ham yuklanadi va `colorScheme` ni 'light' deb beradi. Ilgari
   * shunchaki `tg?.colorScheme` tekshirilardi — natijada klinika
   * kabineti brauzerda ochilganda `auto` hech qachon tizim
   * sozlamasiga ergashmasdi, doim 'light' chiqardi.
   */
  if (inTelegram && tg?.colorScheme) return tg.colorScheme === 'dark' ? 'dark' : 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Mavzuni qo'llash: hujjat, Telegram ramkasi va brauzer paneli.
 *
 * Uchalasi BIR chaqiruvda o'rnatiladi — shuning uchun ular hech
 * qachon bir-biridan farq qila olmaydi.
 */
export function applyTheme(theme: Theme = savedTheme()) {
  const actual = resolve(theme);

  /*
   * HAL QILINGAN qiymat belgilanadi — `auto` bo'lganda ham.
   *
   * Ilgari `auto` da belgi olib tashlanardi va CSS `prefers-color-scheme`
   * ga qarardi. Lekin yuqoridagi `resolve` avval TELEGRAM sxemasini
   * oladi. Ikkalasi farq qilsa (Telegram qorong'i, telefonning o'zi
   * yorug') natija bo'linardi: `html` qorong'i bo'yaladi, CSS esa
   * yorug' ranglarni beradi — ekranning bir qismi qora, qolgani oq.
   *
   * Endi bitta qiymat ham belgiga, ham fonga ketadi, ya'ni ular
   * hech qachon farq qila olmaydi. Tizim o'zgarishiga ergashish
   * `watchSystemTheme` bilan qo'lda qilinadi.
   */
  document.documentElement.setAttribute('data-theme', actual);

  const bg = BG[actual];

  /*
   * `html` foni ham shu yerda qo'yiladi.
   *
   * U `index.html` da boshlang'ich ekran uchun qattiq yozilgan va
   * faqat tizim sozlamasiga qarardi. Agar odam sozlamalarda qorong'ini
   * tanlasa, lekin telefoni yorug' bo'lsa, `html` yorug' qolardi — va
   * `body` ning foni endi kanvasga o'tmaydi (`html` da o'z foni
   * bo'lgani uchun). Natijada kontent tugagan joydan pastda oq maydon
   * paydo bo'lardi.
   */
  document.documentElement.style.background = bg;

  tg?.setBackgroundColor?.(bg);
  tg?.setHeaderColor?.(bg);

  // Brauzerda ochilganda manzil paneli ham shu rangda bo'ladi
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* shaxsiy rejimda saqlash yopiq bo'lishi mumkin */
  }
  applyTheme(theme);
}

/**
 * Telegram mavzusi o'zgarganda ergashamiz — faqat `auto` bo'lsa.
 * Odam aniq tanlagan bo'lsa, uning tanlovi ustun turadi.
 */
export function watchTelegramTheme() {
  tg?.onEvent?.('themeChanged', () => {
    if (savedTheme() === 'auto') applyTheme('auto');
  });
}

/**
 * Tizim mavzusi o'zgarganda ergashamiz — faqat `auto` bo'lsa.
 *
 * Bu ilgari CSS `prefers-color-scheme` orqali o'zi bo'lardi. Endi
 * mavzu belgisi doim qo'yilgani uchun (yuqoridagi izohga qarang)
 * o'zgarishni qo'lda eshitamiz.
 */
export function watchSystemTheme() {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', () => {
    if (savedTheme() === 'auto') applyTheme('auto');
  });
}
