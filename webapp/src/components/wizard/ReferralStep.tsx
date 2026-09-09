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
import { useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { Button, Notice, Skeleton } from '@/ui';
import { FileThumb } from './FileThumb';
import { CameraSheet, cameraSupported } from './CameraSheet';
import type { StoredFile } from '@shared/types';

const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024;

export function ReferralStep({
  draft,
  patch,
}: {
  draft: { files: StoredFile[] };
  patch: (p: { files: StoredFile[] }) => void;
}) {
  const { t, toast } = useApp();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [camera, setCamera] = useState(false);

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

  const remove = (id: string) => {
    haptic.tap();
    patch({ files: draft.files.filter((f) => f.id !== id) });
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

      <Notice tone="info">{t('wz.ref.hint')}</Notice>

      <CameraSheet
        open={camera}
        onClose={() => setCamera(false)}
        onShot={(shot) => void uploadShot(shot)}
      />
    </>
  );
}
