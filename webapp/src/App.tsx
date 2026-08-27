import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { ErrorState, Screen, Toaster } from '@/ui';
import { Onboarding } from '@/screens/Onboarding';
import { Register } from '@/screens/Register';
import { Home } from '@/screens/Home';
import { MyRequests } from '@/screens/MyRequests';
import { MyDeals } from '@/screens/MyDeals';
import { Profile } from '@/screens/Profile';
import { MedicalProfileScreen } from '@/screens/MedicalProfile';
import { Settings } from '@/screens/Settings';
import { NewRequest } from '@/screens/NewRequest';
import { RequestDetail } from '@/screens/RequestDetail';
import { DealScreen } from '@/screens/DealScreen';
import { Notifications } from '@/screens/Notifications';
import { Blocked, NotFound, OfflineBanner, Splash } from '@/screens/SystemStates';
import { Login } from '@/screens/Login';

/**
 * Bemor ilovasi — Telegram Mini App.
 *
 * Bu yerda faqat bemor bor. Klinika kabineti va admin paneli boshqa
 * ildizda (`WebApp.tsx`) va bu daraxtga umuman import qilinmaydi.
 */
export function App() {
  const { ready, error, needsAuth, user, toasts, dismissToast, bootstrap, t } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /**
   * Kirish oqimi: onboarding → bemor profili → ilova.
   * Ikkalasi ham server tomonda majburlanadi, bu faqat yo'naltirish.
   */
  useEffect(() => {
    if (!ready || !user) return;
    const path = location.pathname;

    if (!user.onboardedAt && path !== '/onboarding') {
      navigate('/onboarding', { replace: true });
      return;
    }

    const exempt = path === '/register' || path === '/onboarding';

    if (user.onboardedAt && !user.profileCompletedAt && !exempt) {
      navigate('/register', { replace: true, state: { next: path === '/' ? '/' : path } });
    }
  }, [ready, user, location.pathname, navigate]);

  if (!ready) return <Splash />;

  // Sessiya yo'q — bu xato emas, kirish kerak. Ilgari bu yerda
  // "initData yaroqsiz" chiqib, foydalanuvchi boshi berk ko'chaga tushardi.
  if (needsAuth || (!error && !user)) return <Login />;

  if (error || !user) {
    return (
      <Screen title={t('appName')}>
        <ErrorState message={error ?? t('common.error')} retryLabel={t('common.retry')} onRetry={() => bootstrap()} />
      </Screen>
    );
  }

  if (user.blockedAt) return <Blocked />;

  return (
    <>
      <OfflineBanner />

      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={location.pathname}>
          {/* Kirish */}
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/register" element={<Register />} />

          {/* Bemor bo'limlari */}
          <Route path="/" element={<Home />} />
          <Route path="/requests" element={<MyRequests />} />
          <Route path="/deals" element={<MyDeals />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/medical" element={<MedicalProfileScreen />} />
          <Route path="/settings" element={<Settings />} />

          {/* Bemor oqimlari */}
          <Route path="/new" element={<NewRequest />} />
          <Route path="/request/:id" element={<RequestDetail />} />
          <Route path="/deal/:id" element={<DealScreen />} />
          <Route path="/notifications" element={<Notifications />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AnimatePresence>

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
