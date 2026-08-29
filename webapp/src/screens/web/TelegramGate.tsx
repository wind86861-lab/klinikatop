/**
 * Telegram ichidan kabinetga kirish.
 *
 * Klinika egasi botdagi tugmani bosganda Mini App shu yerda ochiladi.
 * Bu yerda parol so'ralmaydi: uning raqamini Telegram allaqachon
 * tasdiqlagan va o'sha raqamni moderator ariza jarayonida tekshirgan.
 *
 * Ekran uch holatdan birini ko'rsatadi va bu ro'yxat to'liq — klinika
 * egasi botga kirganda har doim NIMADIR ko'radi, "hech narsa
 * bo'lmadi" holati yo'q:
 *
 *   ariza ko'rilmoqda  → kutish kerakligi va qancha vaqt olishi
 *   parol qo'yilmagan  → parol qo'yish tugmasi
 *   tayyor             → kabinet ochiladi
 */
import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { setWebToken } from '@/lib/session';
import { tg } from '@/lib/telegram';
import { EASE } from '@/lib/motion';
import { Button, Notice } from '@/ui';

const BASE = import.meta.env.VITE_API_URL ?? '';

type Standing =
  | { kind: 'none' }
  | { kind: 'no_phone' }
  | { kind: 'pending'; applicationId: number; clinicName: string }
  | { kind: 'rejected'; applicationId: number; clinicName: string; note: string | null }
  | { kind: 'needs_password'; clinicName: string; setupToken: string }
  | { kind: 'ready'; clinicName: string; verification: string };

export function TelegramGate({ onReady }: { onReady: () => void }) {
  const [standing, setStanding] = useState<Standing | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const initData = tg?.initData;
    if (!initData) {
      setFailed(true);
      return;
    }

    fetch(`${BASE}/api/web/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-init-data': initData },
      body: '{}',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (data.token) {
          setWebToken(data.token);
          onReady();
          return;
        }
        setStanding(data.standing ?? { kind: 'none' });
      })
      .catch(() => setFailed(true));
  }, [onReady]);

  if (failed) {
    return (
      <Shell>
        <Notice tone="danger">
          Kirib bo‘lmadi. Botga qaytib <b>/start</b> bosing yoki brauzerda oching.
        </Notice>
        <Button block variant="secondary" onClick={() => (window.location.href = '/kabinet')}>
          Brauzerda ochish
        </Button>
      </Shell>
    );
  }

  if (!standing) {
    return (
      <Shell>
        <m.span
          className="tg-gate__dots"
          animate={{ opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        >
          Tekshirilmoqda…
        </m.span>
      </Shell>
    );
  }

  switch (standing.kind) {
    case 'pending':
      return (
        <Shell title={standing.clinicName}>
          <span className="tg-gate__badge is-wait">Ko‘rib chiqilmoqda</span>
          <p className="tg-gate__text">
            Arizangiz <b className="num">№{standing.applicationId}</b> moderatorda. Litsenziyangiz
            tekshiriladi va shu raqamingizga qo‘ng‘iroq qilinadi — odatda 1–2 ish kuni.
          </p>
        </Shell>
      );

    case 'rejected':
      return (
        <Shell title={standing.clinicName}>
          <span className="tg-gate__badge is-no">Rad etildi</span>
          {standing.note && <Notice tone="danger">{standing.note}</Notice>}
          <p className="tg-gate__text">
            Kamchilikni to‘g‘rilab qayta ariza qoldirishingiz mumkin.
          </p>
          <Button block onClick={() => (window.location.href = '/klinika')}>
            Qayta ariza qoldirish
          </Button>
        </Shell>
      );

    case 'needs_password':
      return (
        <Shell title={standing.clinicName}>
          <span className="tg-gate__badge is-ok">Tasdiqlandi</span>
          <p className="tg-gate__text">
            Kabinetga kirish uchun parol qo‘ying. Bundan keyin brauzerdan ham kira olasiz —
            raqamingiz va shu parol bilan.
          </p>
          <Button
            block
            onClick={() => (window.location.href = `/kabinet/parol?token=${standing.setupToken}`)}
          >
            Parol qo‘yish
          </Button>
        </Shell>
      );

    case 'no_phone':
      return (
        <Shell>
          <p className="tg-gate__text">
            Raqamingiz hali tasdiqlanmagan. Botga qaytib <b>/start</b> bosing va raqamingizni
            yuboring.
          </p>
        </Shell>
      );

    default:
      return (
        <Shell>
          <p className="tg-gate__text">
            Bu raqam bo‘yicha klinika topilmadi. Avval ariza qoldiring.
          </p>
          <Button block onClick={() => (window.location.href = '/klinika')}>
            Ariza qoldirish
          </Button>
        </Shell>
      );
  }
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="tg-gate">
      <m.div
        className="tg-gate__box"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
      >
        <span className="tg-gate__mark">KlinikaTop</span>
        {title && <h1 className="tg-gate__title">{title}</h1>}
        {children}
      </m.div>
    </div>
  );
}
