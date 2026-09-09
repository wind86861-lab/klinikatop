/**
 * Kamera — sahifaning O'ZIDA.
 *
 * ── Nega tizim kamerasi emas ──
 *
 * Avval `<input type="file" capture="environment">` ishlatilgandi:
 * bu standart yo'l va telefon brauzerida kamerani to'g'ridan-to'g'ri
 * ochadi. Lekin Telegram WebView `capture` ni E'TIBORSIZ qoldiradi
 * va o'rniga oddiy fayl tanlagichni ko'rsatadi — ya'ni bemor
 * "Rasmga olish" tugmasini bosib, galereyaga tushib qolardi.
 *
 * Shuning uchun kamera oqimi `getUserMedia` bilan olinadi va ramka
 * shu yerda chiziladi. Ruxsatni Telegramning o'zi so'raydi.
 *
 * ── Nega suratdan keyin ko'rib chiqish bor ──
 *
 * Bu yerda odam qog'ozdagi YOZUVNI suratga oladi. Xira yoki qiyshiq
 * chiqqan rasm klinikaga hech narsa bermaydi, lekin buni faqat
 * ko'rib bilish mumkin. Shuning uchun surat darhol yuborilmaydi:
 * avval kattaroq ko'rsatiladi, keyin "Ishlatish" yoki "Qayta olish".
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/app';
import { haptic } from '@/lib/telegram';
import { Button } from '@/ui';

/**
 * Suratning eng uzun tomoni.
 *
 * Kamera 4000px bera oladi, lekin qog'ozdagi matn uchun 2000 yetarli
 * va fayl uch barobar yengil bo'ladi — sekin internetda bu farq
 * yuklashning o'tishi yoki o'tmasligini hal qiladi.
 */
const MAX_SIDE = 2000;
const QUALITY = 0.9;

export function CameraSheet({
  open,
  onClose,
  onShot,
}: {
  open: boolean;
  onClose: () => void;
  /** `dataBase64` — vergulsiz, sof base64 */
  onShot: (shot: { dataBase64: string; mimeType: string; name: string }) => void;
}) {
  const { t } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<'starting' | 'live' | 'preview' | 'error'>('starting');
  const [shot, setShot] = useState<string | null>(null);

  /* Oqimni to'xtatish — kamera chirog'i yonib qolmasin */
  const stop = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setPhase('starting');
    setShot(null);

    navigator.mediaDevices
      ?.getUserMedia({
        video: {
          // Orqa kamera: old kamera bilan qog'ozni olish deyarli imkonsiz
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1920 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        setPhase('live');
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [open]);

  if (!open) return null;

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);

    setShot(canvas.toDataURL('image/jpeg', QUALITY));
    setPhase('preview');
    haptic.press();
  };

  const accept = () => {
    if (!shot) return;
    onShot({
      dataBase64: shot.slice(shot.indexOf(',') + 1),
      mimeType: 'image/jpeg',
      name: `yollanma-${Date.now()}.jpg`,
    });
    stop();
    onClose();
  };

  const close = () => {
    stop();
    onClose();
  };

  return (
    <div className="cam" role="dialog" aria-modal="true" aria-label={t('wz.ref.camera')}>
      <button type="button" className="cam__close" onClick={close} aria-label={t('common.cancel')}>
        ✕
      </button>

      {phase === 'error' ? (
        <div className="cam__msg">
          <p>{t('wz.ref.denied')}</p>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <>
          {/* Surat olingach video to'xtatilmaydi: "qayta olish" darhol ishlasin */}
          <video
            ref={videoRef}
            className="cam__view"
            playsInline
            muted
            autoPlay
            hidden={phase === 'preview'}
          />
          {phase === 'preview' && shot && <img className="cam__view" src={shot} alt="" />}

          <div className="cam__bar">
            {phase === 'preview' ? (
              <div className="cam__choice">
                <Button variant="secondary" onClick={() => setPhase('live')}>
                  {t('wz.ref.retake')}
                </Button>
                <Button onClick={accept}>{t('wz.ref.use')}</Button>
              </div>
            ) : (
              <button
                type="button"
                className="cam__shutter"
                onClick={capture}
                disabled={phase !== 'live'}
                aria-label={t('wz.ref.camera')}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Brauzer kamera oqimini bera oladimi — tugma shunga qarab tanlanadi. */
export const cameraSupported = () =>
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
