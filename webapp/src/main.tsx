import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { WebApp } from './WebApp';
import { isCabinetPath } from './lib/session';
import { initTelegram } from './lib/telegram';
import { restoreTheme } from './screens/Settings';
import './styles/global.css';
import './styles/components.css';

/**
 * Ikki mustaqil ilova, bitta manzil.
 *
 * Bemor Telegram ichida ishlaydi, klinika va admin esa brauzerda. Ular
 * bir daraxtda emas: manzilga qarab BITTASI yuklanadi. Shuning uchun
 * bemor ekranida klinika kodi umuman mavjud bo'lmaydi va aksincha —
 * rollar orasida "bir bosishda o'tish" jismonan mumkin emas.
 */
const cabinet = isCabinetPath(window.location.pathname);

// Telegram SDK faqat bemor ilovasiga kerak. Brauzerda uni yuklash
// keraksiz va `window.Telegram` yo'qligi haqida ogohlantirish beradi.
if (!cabinet) initTelegram();

restoreTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>{cabinet ? <WebApp /> : <App />}</BrowserRouter>
  </React.StrictMode>,
);
