import { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Route, Routes, useLocation, useNavigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { tg } from '@/lib/telegram';
import { patientToken, setPatientToken } from '@/lib/session';
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
/* Saytga kirish paroli — botda /parol yoki profil menyusidan */
const WebPassword = lazy(() => import('@/screens/WebPassword').then((mod) => ({ default: mod.WebPassword })));
/* Shifokor kabineti — botda /shifokor. Bemorlarning ko'pchiligiga kerak emas, shuning uchun alohida bo'lak */
const DoctorCabinet = lazy(() =>
  import('@/screens/doctor/DoctorCabinet').then((mod) => ({ default: mod.DoctorCabinet })),
);
const DoctorRegister = lazy(() =>
  import('@/screens/doctor/DoctorCabinet').then((mod) => ({ default: mod.DoctorRegister })),
);
const DoctorNewCase = lazy(() => import('@/screens/doctor/DoctorCases').then((mod) => ({ default: mod.DoctorNewCase })));
const DoctorCaseDetail = lazy(() =>
  import('@/screens/doctor/DoctorCases').then((mod) => ({ default: mod.DoctorCaseDetail })),
);
/* Bemor: shifokor yaratgan so'rovga rozilik (botdagi xabar tugmasi) */
const DoctorInvite = lazy(() => import('@/screens/DoctorInvite').then((mod) => ({ default: mod.DoctorInvite })));

/*
 * Eski kirish ekrani — FAQAT lokal ishlab chiqish uchun (u yerda
 * statik sayt yo'q). Prodda brauzer kirishi `/royxatdan-otish/` da.
 */
const PhoneLogin = lazy(() => import('@/screens/PhoneLogin').then((mod) => ({ default: mod.PhoneLogin })));

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
  /* Brauzerda kirgan bemor bormi — bir marta o'qiladi */
  const [browserSession] = useState(() => Boolean(patientToken()));

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

    /*
     * Shifokor kabineti bemor onboarding'idan ozod: shifokor bu yerga
     * bemor sifatida emas keladi va bemor anketasini to'ldirishga
     * majbur bo'lmasligi kerak.
     */
    if (path.startsWith('/doctor')) return;

    if (!user.onboardedAt && path !== '/onboarding') {
      // Qaytish manzili saqlanadi: onboarding → anketa → o'sha sahifa
      navigate('/onboarding', { replace: true, state: { next: path === '/' ? '/' : path } });
      return;
    }

    const exempt = path === '/register' || path === '/onboarding';

    if (user.onboardedAt && !user.profileCompletedAt && !exempt) {
      navigate('/register', { replace: true, state: { next: path === '/' ? '/' : path } });
    }
  }, [ready, user, location.pathname, navigate]);

  /*
   * Brauzerda sessiyasiz odam — ilova emas, SAYT ko'radi.
   *
   * Tanishtiruv ham, kirish/ro'yxatdan o'tish ham endi statik saytda
   * (`/`, `/royxatdan-otish/`). Ilovadagi eski bosh sahifa va kirish
   * ekrani olib tashlandi: ikki xil dizayn bir vaqtda yashab, odam
   * qaysi manzilni ochganiga qarab boshqa-boshqa sayt ko'rardi.
   *
   * Tekshiruv `initData` bo'yicha: Telegram ichida sessiya hali
   * bo'lmasligi mumkin va u yerda `<Login />` kerak, sayt emas.
   * Sessiya `localStorage` dan bir marta o'qiladi — kirish sahifasi
   * shuning uchun `/app` ni to'liq qayta yuklaydi.
   */
  /*
   * Shifokor kabineti FAQAT Telegram orqali — brauzerda kirish sahifasiga
   * emas, "botda oching" ekraniga (ekranning o'zi buni ko'rsatadi).
   */
  if (!insideTelegram && location.pathname.startsWith('/doctor')) {
    return (
      <Suspense fallback={<Splash />}>
        {location.pathname.startsWith('/doctor/register') ? <DoctorRegister /> : <DoctorCabinet />}
      </Suspense>
    );
  }

  if (!insideTelegram && (!browserSession || location.pathname === '/kirish')) {
    if (import.meta.env.PROD) {
      window.location.replace('/kirish/');
      return <Splash />;
    }
    return (
      <Suspense fallback={<Splash />}>
        <PhoneLogin />
      </Suspense>
    );
  }

  if (!ready) return <Splash />;

  // Sessiya yo'q — bu xato emas, kirish kerak. Ilgari bu yerda
  // "initData yaroqsiz" chiqib, foydalanuvchi boshi berk ko'chaga tushardi.
  /*
   * Brauzerdagi bemor tokeni eskirgan: eski "Telegramda oching" ekrani
   * o'rniga token tozalanadi va kirish sahifasiga yuboriladi.
   */
  if (!insideTelegram && needsAuth && import.meta.env.PROD) {
    setPatientToken(null);
    window.location.replace('/kirish/');
    return <Splash />;
  }
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
            {/*
              Mini App manzili. "/" endi ochiq sayt (statik HTML, SEO) —
              Telegram ham, brauzerda kirgan bemor ham ilovani shu yerdan ochadi.
            */}
            <Route path="/app" element={<Home />} />
            <Route path="/requests" element={<MyRequests />} />
            <Route path="/deals" element={<MyDeals />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/medical" element={<MedicalProfileScreen />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile/password" element={<WebPassword />} />

            {/* Bemor oqimlari */}
            <Route path="/new" element={<NewRequest />} />
            <Route path="/request/:id" element={<RequestDetail />} />
            <Route path="/deal/:id" element={<DealScreen />} />
            <Route path="/notifications" element={<Notifications />} />

            {/* Yo'naltiruvchi shifokor */}
            <Route path="/doctor" element={<DoctorCabinet />} />
            <Route path="/doctor/register" element={<DoctorRegister />} />
            <Route path="/doctor/new" element={<DoctorNewCase />} />
            <Route path="/doctor/case/:id" element={<DoctorCaseDetail />} />
            <Route path="/invite/:token" element={<DoctorInvite />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AnimatePresence>

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
