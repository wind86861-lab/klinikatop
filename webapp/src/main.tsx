import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isCabinetPath } from './lib/session';
import { initTelegram } from './lib/telegram';
import { restoreTheme } from './screens/Settings';
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
const WebApp = lazy(() => import('./WebApp').then((m) => ({ default: m.WebApp })));

// Telegram SDK har ikkala ildizga ham kerak: bemor u orqali ishlaydi,
// kabinet esa klinika botdan kirganda `initData` ni oladi.
initTelegram();
restoreTheme();

/*
 * Boshlang'ich ekranni index.html chizadi va u DARHOL ko'rinadi.
 * React ulangach uni almashtiramiz — shunda oq ekran bo'lmaydi.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        {cabinet ? (
          <Suspense fallback={<div className="boot" />}>
            <WebApp />
          </Suspense>
        ) : (
          <App />
        )}
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
