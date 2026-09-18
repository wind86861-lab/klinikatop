/**
 * Veb ildiz — klinika kabineti va admin paneli.
 *
 * Bemor ilovasidan (`App.tsx`) BUTUNLAY ajratilgan: alohida ildiz
 * komponent, alohida kirish, alohida sessiya. Ikkalasi bir daraxtda
 * turmaydi, shuning uchun bemor ekraniga klinika tugmasi tasodifan
 * chiqib qolishi mumkin emas — u yerda bunday komponent umuman yo'q.
 *
 * Ochiq sahifalar, qolgani veb sessiya talab qiladi:
 *   /klinika        — ariza formasi
 *   /kabinet        — klinika kirishi
 *   /admin/login    — administrator kirishi (alohida eshik)
 *   /kabinet/parol  — birinchi kirishda parol o'rnatish
 */
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { ErrorState, Screen, Toaster } from '@/ui';
import { webToken } from '@/lib/session';
import { tg } from '@/lib/telegram';
import { TelegramGate } from '@/screens/web/TelegramGate';
import { ClinicSignup } from '@/screens/ClinicSignup';
import { BanisaLink } from '@/screens/web/BanisaLink';
import { CabinetLogin } from '@/screens/web/CabinetLogin';
import { SetPassword } from '@/screens/web/SetPassword';
import { Dashboard, MoreMenu, NotificationPrefs, ClinicSettings } from '@/screens/clinic/Cabinet';
import { VerificationStatus, VerificationDocs, ClinicOperations, ClinicLabServices } from '@/screens/clinic/Verification';
import { RequestsFeed, OfferBuilder, Templates, MyOffers } from '@/screens/clinic/Work';
import { DealsBoard, ClinicDeal, ClinicChat } from '@/screens/clinic/Deals';
import { Calendar, Analytics, Subscription, Revenue } from '@/screens/clinic/Money';
import { ClinicProfile, Doctors, ClinicReviews, Team } from '@/screens/clinic/Profile';
import { ClinicRequest } from '@/screens/clinic/ClinicRequest';
import { AdminHome } from '@/screens/admin/AdminHome';
import { Blocked, NotFound, OfflineBanner, Splash } from '@/screens/SystemStates';
import { RequireRole } from '@/components/RequireRole';
import type { Role } from '@shared/types';

/*
 * Kabinet ekranlariga administrator KIRMAYDI.
 *
 * Ilgari bu ro'yxatda `admin` ham bor edi. Amalda u baribir ish
 * bermasdi (adminda klinika yo'q, `needsClinic` uni qaytarardi),
 * lekin ikki dunyo o'rtasidagi chegarani xiralashtirardi. Server
 * ham endi admin sessiyasini `/api/clinic` ga qo'ymaydi — mijoz
 * tomondagi ro'yxat shunga mos bo'lishi kerak.
 */
const CLINIC_ROLES: Role[] = ['clinic_admin', 'clinic_operator'];
const ADMIN_ROLES: Role[] = ['admin'];

export function WebApp() {
  const { ready, error, user, toasts, dismissToast, bootstrap, t } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  /** Kirish talab qilmaydigan sahifalar */
  const open =
    path === '/klinika' ||
    path === '/ulanish' ||
    path === '/admin/login' ||
    path.startsWith('/kabinet');

  /*
   * Sessiyasiz odam qaysi kirish sahifasiga tushadi.
   *
   * Admin paneliga urinib ko'rgan odam klinika kirish sahifasida emas,
   * o'z eshigida paydo bo'lishi kerak — aks holda u yerda "ariza
   * qoldiring" degan, unga hech qanday aloqasi yo'q yo'l ko'rsatiladi.
   */
  const loginPath = path.startsWith('/admin') ? '/admin/login' : '/kabinet';

  /*
   * Token localStorage'da, lekin uni holatda ham ushlaymiz: Telegram
   * ko'prigi uni ish paytida yozadi va React qayta chizishi kerak.
   */
  const [token, setToken] = useState<string | null>(() => webToken());

  /*
   * Telegram ichida ochilganda parol so'ralmaydi: bot tugmasi orqali
   * kelgan klinika egasining raqamini Telegram allaqachon tasdiqlagan.
   * Brauzerda esa `tg.initData` bo'lmaydi va oddiy kirish ishlaydi.
   */
  const insideTelegram = Boolean(tg?.initData);

  useEffect(() => {
    if (!open && token) void bootstrap();
  }, [open, token, bootstrap]);

  // Brauzerda sessiya yo'q bo'lsa kirish sahifasiga
  useEffect(() => {
    if (!open && !token && !insideTelegram) navigate(loginPath, { replace: true });
  }, [open, token, insideTelegram, loginPath, navigate]);

  if (path === '/klinika') return <ClinicSignup />;
  // banisa.uz'dan ulanish — bir bosishda
  if (path === '/ulanish') return <BanisaLink />;
  if (path === '/kabinet/parol') return <SetPassword />;
  if (path === '/admin/login') return <CabinetLogin scope="admin" />;
  if (path.startsWith('/kabinet')) return <CabinetLogin scope="clinic" />;

  // Telegram ichidamiz va sessiya hali yo'q — raqam bo'yicha kiramiz
  if (!token && insideTelegram) {
    return <TelegramGate onReady={() => setToken(webToken())} />;
  }

  if (!token || !ready) return <Splash />;

  if (error || !user) {
    return (
      <Screen title="KlinikaTop">
        <ErrorState
          message={error ?? t('common.error')}
          retryLabel={t('common.retry')}
          onRetry={() => bootstrap()}
        />
      </Screen>
    );
  }

  if (user.blockedAt) return <Blocked />;

  return (
    <>
      <OfflineBanner />

      {/*
        `AnimatePresence` bu yerda ATAYLAB YO'Q.

        Ilgari `Routes` uning to'g'ridan-to'g'ri bolasi edi, `mode="wait"`
        bilan. Bu rejim eski daraxt to'liq chiqib ketishini kutadi va
        yangisini shundan keyingina mount qiladi. Tab bar'dagi
        `layoutId` li belgi esa o'z o'rnini YANGI daraxtdagi juftiga
        uzatmoqchi bo'ladi — u hali yo'q. Natija: eski ekran chiqmaydi,
        yangisi kirmaydi, manzil esa allaqachon yangi. Kabinetda tugma
        bosilardi, sahifa esa o'tmasdi — besh kun prodda shunday turdi.

        `Screen` da chiqish animatsiyasi yo'q, faqat kirish; ya'ni
        `AnimatePresence` bu yerda hech narsa bermasdi, faqat shu
        tuzoqni. `key` esa qoladi: manzil o'zgarsa ekran qayta
        mount bo'lib, kirish animatsiyasi qayta o'ynaydi.

        Bemor ilovasida (`App.tsx`) xuddi shu belgi ishlaydi, chunki u
        yerda `Routes` `Suspense` ichida — `AnimatePresence` almashinuvni
        ko'rmaydi ham. Bu tasodif, kafolat emas.
      */}
        <Routes location={location} key={location.pathname}>
            {/* ── Klinika kabineti — 23 ekran, 8 soha ── */}
            {/* Klinika kabineti — 23 ekran, 8 soha bo'yicha */}

            {/* Ro'yxatdan o'tish va verifikatsiya (1–4) */}
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
              path="/clinic/lab-services"
              element={
                <RequireRole roles={CLINIC_ROLES} needsClinic>
                  <ClinicLabServices />
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


          {/* Kabinet ildizi — darajaga qarab */}
          <Route
            path="/"
            element={<Navigate to={user.roles.includes('clinic_admin') || user.roles.includes('clinic_operator') ? '/clinic' : '/admin'} replace />}
          />

          <Route path="*" element={<NotFound />} />
        </Routes>

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
