/**
 * Marshrut qo'riqchisi.
 *
 * Nima uchun kerak: server ma'lumotni allaqachon himoyalaydi (403 qaytaradi),
 * lekin mijoz tomonda tekshiruv bo'lmasa panel QOBIG'I baribir chiziladi —
 * begona odam "Moderator paneli" degan sarlavhani va bo'lim nomlarini ko'radi.
 * Bu ma'lumot sizib chiqishi: tizimda qanday panellar borligini oshkor qiladi.
 *
 * Shuning uchun bu yerda ikki qatlam ishlaydi:
 *   • huquqi yo'q bo'lsa — ekran umuman chizilmaydi, bosh sahifaga qaytariladi
 *   • sessiya hali yuklanmagan bo'lsa — hech narsa ko'rsatilmaydi (miltillamasin)
 *
 * Bu SERVER tekshiruvining o'rnini bosmaydi — faqat uning ustiga qo'shiladi.
 * Mijoz tomonidagi har qanday tekshiruvni chetlab o'tish mumkin.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useApp } from '@/store/app';
import { Splash } from '@/screens/SystemStates';
import type { Role } from '@shared/types';

export function RequireRole({
  roles,
  needsClinic,
  children,
}: {
  /** Shu rollardan biri yetarli */
  roles: Role[];
  /** Klinikaga biriktirilgan bo'lishi ham shartmi */
  needsClinic?: boolean;
  children: React.ReactNode;
}) {
  const { ready, user } = useApp();
  const location = useLocation();

  // Sessiya hali kelmagan — qaror qabul qilishga erta
  if (!ready) return <Splash />;

  if (!user) return <Navigate to="/kabinet" replace />;

  const allowed = user.roles.some((role) => roles.includes(role));
  if (!allowed) {
    // Bosh sahifaga qaytaramiz. Qaysi manzilga urinilgani `state` da qoladi —
    // kerak bo'lsa keyin xabar ko'rsatish uchun.
    return <Navigate to="/kabinet" replace state={{ denied: location.pathname }} />;
  }

  /*
   * Klinikaga biriktirilmagan ish hisobi — bu ma'lumot xatosi, chunki
   * hisob har doim klinika bilan birga yaratiladi. Kirish sahifasiga
   * qaytaramiz: u yerdan boshqa hisob bilan kirish mumkin.
   */
  if (needsClinic && !user.clinicId) {
    return <Navigate to="/kabinet" replace />;
  }

  return <>{children}</>;
}
