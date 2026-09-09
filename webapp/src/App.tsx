import { Suspense, lazy, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { tg } from '@/lib/telegram';
import { ErrorState, Screen, Toaster } from '@/ui';
import { Onboarding } from '@/screens/Onboarding';
import { Register } from '@/screens/Register';
import { Home } from '@/screens/Home';
import { MyRequests } from '@/screens/MyRequests';
import { MyDeals } from '@/screens/MyDeals';
import { Profile } from '@/screens/Profile';
import { Blocked, NotFound, OfflineBanner, Splash } from '@/screens/SystemStates';
import { Login } from '@/screens/Login';

/*
 * ── Chuqur ekranlar alohida yuklanadi ──
 *
 * Yuqoridagilar — birinchi ekran va pastki menyu manzillari: ular
 * darhol kerak va kechikish sezilsa menyu "yopishqoq" bo'lib qoladi.
 *
 * Quyidagilar esa ataylab kiriladigan ekranlar. Sehrgar bir o'zi 833
 * qator, bitim ekrani 615 — bularning hammasi ilova ochilishida
 * yuklanardi, garchi odam ularga kirmasligi ham mumkin edi.
 *
 * Kechikish sezilmasligi uchun ular bo'sh vaqtda oldindan yuklab
 * qo'yiladi (pastdagi `useEffect` ga qarang) — ya'ni bosilganda
 * odatda allaqachon tayyor turadi.
 */
const NewRequest = lazy(() => import('@/screens/NewRequest').then((mod) => ({ default: mod.NewRequest })));
const RequestDetail = lazy(() =>
  import('@/screens/RequestDetail').then((mod) => ({ default: mod.RequestDetail })),
);
const DealScreen = lazy(() => import('@/screens/DealScreen').then((mod) => ({ default: mod.DealScreen })));
const Notifications = lazy(() =>
  import('@/screens/Notifications').then((mod) => ({ default: mod.Notifications })),
);
const MedicalProfileScreen = lazy(() =>
  import('@/screens/MedicalProfile').then((mod) => ({ default: mod.MedicalProfileScreen })),
);
const Settings = lazy(() => import('@/screens/Settings').then((mod) => ({ default: mod.Settings })));

/*
 * Bosh sahifa — faqat brauzerdan kirilganda. Mini App'da hech qachon
 * ko'rinmaydi, shuning uchun uning kodi ham u yerga tushmaydi.
 */
const Landing = lazy(() => import('@/screens/Landing').then((mod) => ({ default: mod.Landing })));

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

  /* Telegram ichidamizmi — bosh sahifa shunga qarab hal qilinadi */
  const insideTelegram = Boolean(tg?.initData);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /*
   * Chuqur ekranlarni BO'SH VAQTDA oldindan yuklaymiz.
   *
   * Kodni bo'lakka ajratish yuklanishni tezlashtiradi, lekin bosilgan
   * paytda kutish paydo qiladi — bu almashtirish, yutuq emas. Shuning
   * uchun brauzer bo'shashi bilan bo'laklar fonda olib qo'yiladi: ilova
   * yengil ochiladi VA tugma bosilganda ekran darhol chiqadi.
   *
   * `requestIdleCallback` — brauzer haqiqatan bo'sh bo'lgandagina
   * ishlaydi va asosiy ishga xalaqit bermaydi. Safari'da u yo'q,
   * shuning uchun oddiy kechikish bilan zaxira yo'l.
   */
  useEffect(() => {
    if (!ready || !user) return;

    const warm = () => {
      void import('@/screens/NewRequest');
      void import('@/screens/RequestDetail');
      void import('@/screens/DealScreen');
    };

    const idle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;

    if (idle) {
      const handle = idle(warm, { timeout: 4000 });
      return () => (window as any).cancelIdleCallback?.(handle);
    }

    const timer = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(timer);
  }, [ready, user]);

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

  /*
   * Brauzerdan kirgan odam BOSH SAHIFANI ko'radi.
   *
   * Bu ilova Telegram Mini App: haqiqiy ish o'sha yerda. Lekin
   * `klinikatop.uz` ni brauzerda ochadigan odam ham bor — havolani
   * ko'rgan bemor, qidiruvdan kelgan klinika egasi. Ilgari ular
   * "Telegramda oching" degan bo'sh quti ko'rardi va nima uchun
   * ochishlari kerakligini bilmasdi.
   *
   * Tekshiruv `initData` bo'yicha, sessiya bo'yicha emas: Telegram
   * ichida sessiya hali yo'q bo'lishi mumkin va u yerda bosh sahifa
   * emas, kirish ekrani kerak.
   *
   * Sahifa alohida bo'lakda: uni faqat brauzerdan kirgan odam
   * ko'radi va Mini App'ga og'irlik qilmasligi kerak.
   */
  if (!insideTelegram) {
    return (
      <Suspense fallback={<Splash />}>
        <Landing />
      </Suspense>
    );
  }

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
        <Suspense fallback={<Splash />}>
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
        </Suspense>
      </AnimatePresence>

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
