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
import { ClinicRequest } from '@/screens/clinic/ClinicRequest';
import { ClinicRegister } from '@/screens/clinic/ClinicRegister';
import { Dashboard, MoreMenu, NotificationPrefs, ClinicSettings } from '@/screens/clinic/Cabinet';
import { VerificationStatus, VerificationDocs, ClinicOperations } from '@/screens/clinic/Verification';
import { RequestsFeed, OfferBuilder, Templates, MyOffers } from '@/screens/clinic/Work';
import { DealsBoard, ClinicDeal, ClinicChat } from '@/screens/clinic/Deals';
import { Calendar, Analytics, Subscription, Revenue } from '@/screens/clinic/Money';
import { ClinicProfile, Doctors, ClinicReviews, Team } from '@/screens/clinic/Profile';
import { AdminHome } from '@/screens/admin/AdminHome';
import { Blocked, NotFound, OfflineBanner, Splash } from '@/screens/SystemStates';
import { Login } from '@/screens/Login';
import { ClinicSignup } from '@/screens/ClinicSignup';
import { RequireRole } from '@/components/RequireRole';
import type { Role } from '@shared/types';

/** Klinika kabinetiga kim kira oladi. */
const CLINIC_ROLES: Role[] = ['clinic_admin', 'clinic_operator', 'admin'];
/** Moderator paneliga kim kira oladi. */
const ADMIN_ROLES: Role[] = ['moderator', 'admin'];

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

    /*
     * Klinika yo'li bemor oqimidan MUSTAQIL.
     *
     * Bot ichidagi "Klinikani ro'yxatdan o'tkazish" tugmasi to'g'ridan-to'g'ri
     * ariza formasiga olib keladi. Klinika egasi bemor uchun yozilgan
     * onboardingni ko'rishi ham, o'z tug'ilgan yilini kiritishi ham
     * mantiqsiz — u yerda boshqa odam ro'yxatdan o'tyapti.
     */
    const clinicPath = path === '/clinic/register';

    if (!user.onboardedAt && path !== '/onboarding' && !clinicPath) {
      navigate('/onboarding', { replace: true });
      return;
    }

    const exempt = path === '/register' || path === '/onboarding' || clinicPath;

    if (user.onboardedAt && !user.profileCompletedAt && !exempt) {
      navigate('/register', { replace: true, state: { next: path === '/' ? '/' : path } });
    }
  }, [ready, user, location.pathname, navigate]);

  /*
   * Klinika arizasi — OCHIQ sahifa.
   *
   * Autentifikatsiya tekshiruvidan OLDIN chiziladi: klinika egasida
   * Telegram bo'lmasligi mumkin va bo'lishi shart emas. Bu yagona
   * shunday sahifa; qolgan hamma narsa imzo talab qiladi.
   */
  if (location.pathname === '/klinika') return <ClinicSignup />;

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

          {/* Klinika */}
          {/* Klinika kabineti — 23 ekran, 8 soha bo'yicha */}

          {/* Ro'yxatdan o'tish va verifikatsiya (1–4) */}
          {/*
            Ariza formasi rol TALAB QILMAYDI — aynan shu yerda odam
            klinika xodimiga aylanadi. `clinic_admin` roli ariza
            yuborilgandan keyin beriladi, oldin emas.
          */}
          <Route path="/clinic/register" element={<ClinicRegister />} />
          <Route
            path="/clinic/verification/documents"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <VerificationDocs />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/verification"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <VerificationStatus />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/operations"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <ClinicOperations />
              </RequireRole>
            }
          />

          {/* So'rovlar bilan ishlash (5–10) */}
          <Route
            path="/clinic"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <Dashboard />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/requests"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <RequestsFeed />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/requests/:id"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <ClinicRequest />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/requests/:id/offer"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <OfferBuilder />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/templates"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <Templates />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/offers"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <MyOffers />
              </RequireRole>
            }
          />

          {/* Bitim boshqaruvi (11–13) */}
          <Route
            path="/clinic/deals"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <DealsBoard />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/deals/:id"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <ClinicDeal />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/deals/:id/chat"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <ClinicChat />
              </RequireRole>
            }
          />

          {/* Quvvat (14) */}
          <Route
            path="/clinic/calendar"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <Calendar />
              </RequireRole>
            }
          />

          {/* Analitika va moliya (15–17) */}
          <Route
            path="/clinic/analytics"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <Analytics />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/subscription"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <Subscription />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/revenue"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <Revenue />
              </RequireRole>
            }
          />

          {/* Obro' va profil (18–20) */}
          <Route
            path="/clinic/profile"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <ClinicProfile />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/doctors"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <Doctors />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/reviews"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <ClinicReviews />
              </RequireRole>
            }
          />

          {/* Jamoa (21) */}
          <Route
            path="/clinic/team"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <Team />
              </RequireRole>
            }
          />

          {/* Sozlamalar va yordam (22–23) */}
          <Route
            path="/clinic/notifications"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <NotificationPrefs />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/settings"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <ClinicSettings />
              </RequireRole>
            }
          />
          <Route
            path="/clinic/more"
            element={
              <RequireRole roles={CLINIC_ROLES} needsClinic>
                <MoreMenu />
              </RequireRole>
            }
          />

          {/* Moderator */}
          <Route
            path="/admin"
            element={
              <RequireRole roles={ADMIN_ROLES}>
                <AdminHome />
              </RequireRole>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AnimatePresence>

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
