/**
 * Veb kabinet sessiyasi — klinika va admin uchun.
 *
 * Token `localStorage` da saqlanadi va har so'rovda `Authorization`
 * sarlavhasida yuboriladi. Cookie ishlatilmaydi: cookie'ni brauzer
 * boshqa saytdan yuborilgan so'rovga ham o'zi qo'shib yuboradi va bu
 * CSRF hujumiga yo'l ochadi. Sarlavhani esa faqat bizning kodimiz
 * qo'yadi.
 */
const KEY = 'klinikatop.web';

/*
 * Bemorning brauzer sessiyasi — BOSHQA kalit.
 *
 * Bitta kalit bo'lsa, klinika xodimi kabinetga kirgan brauzerda
 * bemor ilovasini ochganda ikkovi bir-birini o'chirardi. Ikki kalit
 * ikki hisobni yonma-yon saqlaydi va `authHeaders` qaysi birini
 * yuborishni manzil bo'yicha hal qiladi.
 */
const PATIENT_KEY = 'klinikatop.patient';

export function patientToken(): string | null {
  try {
    return localStorage.getItem(PATIENT_KEY);
  } catch {
    return null;
  }
}

export function setPatientToken(token: string | null) {
  try {
    if (token) localStorage.setItem(PATIENT_KEY, token);
    else localStorage.removeItem(PATIENT_KEY);
  } catch {
    /* shaxsiy rejim — sessiya faqat shu varaqda yashaydi */
  }
}

export function webToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setWebToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* shaxsiy rejimda saqlash yopiq bo'lishi mumkin */
  }
}

/** Bu manzil veb kabinetga tegishlimi — Telegram ilovasiga emas. */
export function isCabinetPath(pathname: string): boolean {
  return (
    pathname === '/klinika' ||
    pathname === '/ulanish' ||
    pathname.startsWith('/kabinet') ||
    pathname.startsWith('/clinic') ||
    pathname.startsWith('/admin')
  );
}
