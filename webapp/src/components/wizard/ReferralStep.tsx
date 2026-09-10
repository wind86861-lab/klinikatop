/**
 * Yo'llanma bosqichi — shifokor yozgan qog'ozni rasmga olish.
 *
 * Bu oqimning butun mazmuni shu bitta ekranda. Bemor katalogdan
 * hech narsa tanlamaydi: qo'lidagi qog'ozda "gemogramma, koagulogramma,
 * qalqonsimon bez UZI" deb yozilgan bo'lishi mumkin va uni ro'yxatdan
 * birma-bir izlash — ko'pchilik uchun umuman bajarib bo'lmaydigan ish.
 * Rasm esa bir tegishda tayyor.
 *
 * ── Kamera nima uchun sahifaning o'zida ──
 *
 * Avval `<input type="file" capture="environment">` ishlatilgandi —
 * standart yo'l va telefon brauzerida kamerani darhol ochadi. Lekin
 * TELEGRAM WEBVIEW `capture` ni e'tiborsiz qoldiradi va oddiy fayl
 * tanlagichni ko'rsatadi: bemor "Rasmga olish" ni bosib, galereyaga
 * tushib qolardi. Shuning uchun kamera `CameraSheet` ichida
 * `getUserMedia` bilan ochiladi.
 *
 * `<input capture>` baribir qoladi — zaxira sifatida. Kamera oqimi
 * yo'q brauzerda yoki ruxsat berilmaganda tugma o'shanga o'tadi,
 * ya'ni bemor hech qachon boshi berk ko'chaga tushmaydi.
 *
 * Galereya esa alohida input: `capture` bor bo'lsa brauzer galereyani
 * taklif qilmaydi, shuning uchun ikkovini bitta tugmaga
 * birlashtirib bo'lmaydi.
 */
import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { Button, Field, Input, Notice, Skeleton } from '@/ui';
import { FileThumb } from './FileThumb';
import { CameraSheet, cameraSupported } from './CameraSheet';
import type { StoredFile } from '@shared/types';

const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024;

const MAX_ITEMS = 30;

export function ReferralStep({
  draft,
  patch,
}: {
  draft: { files: StoredFile[]; referralItems: string[] };
  patch: (p: Partial<{ files: StoredFile[]; referralItems: string[] }>) => void;
}) {
  const { t, toast } = useApp();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [camera, setCamera] = useState(false);
  const [item, setItem] = useState('');

  const full = draft.files.length >= MAX_FILES;

  const readAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleFiles = async (fileList: FileList | null, input: HTMLInputElement | null) => {
    if (!fileList?.length) return;
    const room = MAX_FILES - draft.files.length;
    const picked = Array.from(fileList).slice(0, Math.max(0, room));

    if (!picked.length) {
      toast(t('wz.ref.limit'), 'error');
      return;
    }

    setUploading(true);
    const added: StoredFile[] = [];

    for (const file of picked) {
      if (file.size > MAX_BYTES) {
        toast(`${file.name} — ${t('wz.ref.limit')}`, 'error');
        continue;
      }
      try {
        added.push(
          await api.uploadFile({
            name: file.name,
            mimeType: file.type || 'image/jpeg',
            /*
             * Turi har doim "shifokor xulosasi": klinika ro'yxatda
             * buni ko'rib, nima ekanini so'ramasdan tushunadi.
             */
            kind: 'xulosa',
            label: t('wz.ref.fileLabel'),
            dataBase64: await readAsBase64(file),
          }),
        );
      } catch (err: any) {
        toast(err?.message ?? t('common.error'), 'error');
      }
    }

    if (added.length) {
      haptic.success();
      patch({ files: [...draft.files, ...added] });
    }
    setUploading(false);
    // Bir xil faylni qayta tanlash ham hodisa bersin
    if (input) input.value = '';
  };

  /** Kamera bergan kadr — fayl tanlash oqimidan o'tmaydi, to'g'ridan-to'g'ri yuklanadi */
  const uploadShot = async (shot: { dataBase64: string; mimeType: string; name: string }) => {
    setUploading(true);
    try {
      const stored = await api.uploadFile({
        ...shot,
        kind: 'xulosa',
        label: t('wz.ref.fileLabel'),
      });
      haptic.success();
      patch({ files: [...draft.files, stored] });
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setUploading(false);
    }
  };

  /*
   * Kamera oqimi bor bo'lsa o'zimiznikini ochamiz, aks holda
   * tizim tanlagichiga o'tamiz. Ikkinchisi Telegramda galereyani
   * ochib qo'yishi mumkin, lekin hech narsadan ko'ra yaxshiroq.
   */
  const openCamera = () => {
    if (cameraSupported()) setCamera(true);
    else cameraRef.current?.click();
  };

  /*
   * Kamera oqimi ochilmadi — tizim tanlagichiga o'tamiz.
   *
   * Telegram WebView `capture` ni e'tiborsiz qoldirib galereyani
   * ochib qo'yishi mumkin, lekin bu ham hech narsadan yaxshiroq:
   * ilgari bu holatda bemor "Bekor qilish" dan boshqa yo'l
   * topolmasdi.
   */
  const fallbackToSystem = useCallback(
    (reason: string) => {
      setCamera(false);
      toast(t('wz.ref.cameraFallback'), 'info');
      // Sabab konsolda qoladi: qurilmada nima bo'lganini bilish uchun
      console.warn('[kamera] oqim ishlamadi:', reason);
      cameraRef.current?.click();
    },
    [t, toast],
  );

  const remove = (id: string) => {
    haptic.tap();
    patch({ files: draft.files.filter((f) => f.id !== id) });
  };

  /* ── Qo'lda yozilgan analizlar ── */

  const addItem = () => {
    const value = item.replace(/\s+/g, ' ').trim();
    if (value.length < 2) return;

    if (draft.referralItems.length >= MAX_ITEMS) {
      toast(t('wz.ref.itemsLimit'), 'error');
      return;
    }
    // Takror qo'shilmasin — klinikaga "ikki marta kerakmi?" degan savol bermasin
    if (draft.referralItems.some((x) => x.toLowerCase() === value.toLowerCase())) {
      setItem('');
      return;
    }

    haptic.select();
    patch({ referralItems: [...draft.referralItems, value] });
    setItem('');
  };

  const removeItem = (value: string) => {
    haptic.tap();
    patch({ referralItems: draft.referralItems.filter((x) => x !== value) });
  };

  return (
    <>
      <div className="wz-head">
        <h1 className="wz-head__title">{t('wz.ref.title')}</h1>
        <p className="wz-head__sub">{t('wz.ref.sub')}</p>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        /*
         * `environment` — orqa kamera. Old kamera bilan qog'ozni
         * suratga olish deyarli imkonsiz, lekin brauzer aksini
         * aytmasa old kamerani ochib qo'yishi mumkin.
         */
        capture="environment"
        hidden
        onChange={(e) => void handleFiles(e.target.files, e.target)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void handleFiles(e.target.files, e.target)}
      />

      <div className="stack" style={{ gap: 'var(--s-2)' }}>
        <Button block loading={uploading} disabled={full} onClick={openCamera}>
          {t('wz.ref.camera')}
        </Button>
        <Button
          variant="secondary"
          block
          disabled={full || uploading}
          onClick={() => galleryRef.current?.click()}
        >
          {t('wz.ref.gallery')}
        </Button>
      </div>

      {uploading && <Skeleton h={72} />}

      {draft.files.length > 0 && (
        <div className="between">
          <h2 className="section-title">{t('wz.ref.uploaded')}</h2>
          <span className="tiny num">
            {draft.files.length}/{MAX_FILES}
          </span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {draft.files.map((file) => (
          <m.div
            key={file.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={spring}
            className="doc-row"
          >
            <FileThumb file={file} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="doc-row__name truncate">{file.name}</span>
              <span className="doc-row__meta">
                {Math.max(1, Math.round(file.sizeBytes / 1024))} KB
              </span>
            </span>
            <button className="doc-row__remove" onClick={() => remove(file.id)} aria-label={t('common.cancel')}>
              ×
            </button>
          </m.div>
        ))}
      </AnimatePresence>

      {/*
        ── Qo'lda yozish ──

        Rasm har doim ham imkoni bo'lmaydi: qog'oz yo'q, shifokor
        og'zaki aytgan, yoki suratda yozuv o'qilmayapti. Shunday
        paytda bemor analiz nomlarini o'zi yig'ib yuborsa, klinika
        baribir aniq narsaga narx bera oladi.

        Ro'yxat — bandma-band, erkin matn emas: klinika har birini
        alohida ko'rishi va o'ziga borini belgilashi kerak.
      */}
      <div className="ref-or">
        <span>{t('wz.ref.or')}</span>
      </div>

      <Field label={t('wz.ref.manual')} hint={t('wz.ref.manualHint')}>
        <div className="row row--gap">
          <Input
            value={item}
            placeholder={t('wz.ref.itemPh')}
            maxLength={120}
            onChange={(e) => setItem(e.target.value)}
            /*
             * Enter ham qo'shsin: ro'yxat yig'ayotgan odam
             * klaviaturadan qo'lini uzmasligi kerak.
             */
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addItem();
              }
            }}
          />
          <Button
            variant="secondary"
            disabled={item.trim().length < 2}
            onClick={addItem}
          >
            {t('wz.ref.itemAdd')}
          </Button>
        </div>
      </Field>

      {draft.referralItems.length > 0 && (
        <>
          <div className="between">
            <h2 className="section-title">{t('wz.ref.itemsTitle')}</h2>
            <span className="tiny num">
              {draft.referralItems.length}/{MAX_ITEMS}
            </span>
          </div>

          <AnimatePresence initial={false}>
            {draft.referralItems.map((value, i) => (
              <m.div
                key={value}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={spring}
                className="doc-row"
              >
                <span className="ref-item__num num">{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="doc-row__name">{value}</span>
                </span>
                <button
                  className="doc-row__remove"
                  onClick={() => removeItem(value)}
                  aria-label={t('common.cancel')}
                >
                  ×
                </button>
              </m.div>
            ))}
          </AnimatePresence>
        </>
      )}

      <Notice tone="info">{t('wz.ref.hint')}</Notice>

      <CameraSheet
        open={camera}
        onClose={() => setCamera(false)}
        onShot={(shot) => void uploadShot(shot)}
        onFallback={fallbackToSystem}
      />
    </>
  );
}
