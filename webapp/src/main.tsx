import React, { Suspense, lazy } from 'react';
import { LazyMotion } from 'framer-motion';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isCabinetPath } from './lib/session';
import { initTelegram } from './lib/telegram';
import { applyTheme, watchSystemTheme, watchTelegramTheme } from './lib/theme';
import './styles/global.css';
import './styles/components.css';

/**
 * Ikki mustaqil ilova, bitta manzil.
 *
 * Bemor Telegram ichida ishlaydi, klinika va admin esa brauzerda.
 * Manzilga qarab BITTASI yuklanadi — shuning uchun bemor ekranida
 * klinika kodi umuman mavjud bo'lmaydi va aksincha.
 */
const cabinet = isCabinetPath(window.location.pathname);

/**
 * Kabinet ALOHIDA yuklanadi.
 *
 * Klinika kabineti 23 ekran, admin paneli yana o'nlab — bularning
 * hammasi bemorning telefoniga tushishi kerak emas. Bemor ularga
 * hech qachon kirmaydi, lekin har ochganda kutib turardi.
 *
 * Telefonda sekin internetda bu farq bir necha soniya.
 */
const WebApp = lazy(() => import('./WebApp').then((mod) => ({ default: mod.WebApp })));

// Telegram SDK har ikkala ildizga ham kerak: bemor u orqali ishlaydi,
// kabinet esa klinika botdan kirganda `initData` ni oladi.
initTelegram();

/*
 * Mavzu Telegram ulangandan KEYIN qo'yiladi: `auto` holatda u
 * Telegram aytgan rangni oladi. Ramka rangi ham shu yerda
 * o'rnatiladi — ilova bilan bir xil bo'lishi kafolatlanadi.
 */
applyTheme();
watchTelegramTheme();
watchSystemTheme();

/*
 * Boshlang'ich ekranni index.html chizadi va u DARHOL ko'rinadi.
 * React ulangach uni almashtiramiz — shunda oq ekran bo'lmaydi.
 */
/**
 * Animatsiya imkoniyatlari birinchi bo'yoqdan KEYIN keladi.
 *
 * `strict` — `motion` komponentini ishlatishni taqiqlaydi. Bu ataylab:
 * bitta joyda `motion` qolib ketsa, u butun kutubxonani qaytarib
 * tortadi va yutuq bilinmay yo'qoladi. Strict rejimda bunday xato
 * darhol ko'rinadi.
 */
const loadMotion = () => import('./lib/motionFeatures').then((mod) => mod.domMax);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LazyMotion features={loadMotion} strict>
        <BrowserRouter>
          {cabinet ? (
            <Suspense fallback={<div className="boot" />}>
              <WebApp />
            </Suspense>
          ) : (
            <App />
          )}
        </BrowserRouter>
      </LazyMotion>
    </ErrorBoundary>
  </React.StrictMode>,
);
