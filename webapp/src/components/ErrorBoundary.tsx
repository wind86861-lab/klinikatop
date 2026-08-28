/**
 * Render xatosini ushlaydi.
 *
 * ═══ Nima uchun kerak ═══
 *
 * React'da komponent render paytida xato bersa, butun daraxt yechib
 * tashlanadi va foydalanuvchi TO'LIQ OQ ekranni ko'radi. Hech qanday
 * xabar yo'q, hech qanday tugma yo'q — ilova shunchaki yo'qoladi.
 *
 * Telegram ichida bu ayniqsa yomon: u yerda brauzerning yangilash
 * tugmasi ham yo'q. Odam ilovani yopib qayta ochishdan boshqa nima
 * qilishni bilmaydi va ko'pincha umuman qaytmaydi.
 *
 * Bu chegara bitta ish qiladi: xato yuz berganda ekranda NIMADIR
 * qoladi va qayta urinish yo'li ko'rinadi.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /*
     * Xato konsolga yoziladi. Telegram ichida uni ko'rish qiyin, lekin
     * odam kompyuterda ochsa yoki biz uzoqdan tekshirsak — shu yerda
     * turadi. Serverga yuborish ataylab qilinmadi: tibbiy ilovada
     * xato matnida bemor ma'lumoti bo'lishi mumkin.
     */
    console.error('[ilova] render xatosi:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="crash">
        <div className="crash__box">
          <span className="crash__mark">KlinikaTop</span>
          <h1 className="crash__title">Nimadir noto‘g‘ri ketdi</h1>
          <p className="crash__text">
            Ilovani qayta yuklang. Muammo takrorlansa, bizga yozing — tuzatamiz.
          </p>

          <button className="crash__btn" onClick={() => window.location.reload()}>
            Qayta yuklash
          </button>

          <a className="crash__link" href="https://t.me/klinikatop_bot" target="_blank" rel="noreferrer">
            Yordam
          </a>
        </div>
      </div>
    );
  }
}
