/**
 * 3-qadam: tibbiy hujjatlar (UZI, MRT, analiz).
 *
 * Ixtiyoriy, lekin narx aniqligiga kuchli ta'sir qiladi. Fayl base64 shaklida
 * yuboriladi — Telegram WebView'da bu eng ishonchli yo'l va serverga
 * qo'shimcha kutubxona kerak emas.
 */
import { useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { Button, Chip, Field, Input, Notice, Skeleton } from '@/ui';
import { FileOpenButton, FileThumb } from './FileThumb';
import { FILE_KINDS, type FileKind, type StoredFile } from '@shared/types';

const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024;

interface Draftish {
  files: StoredFile[];
}

export function DocumentsStep({
  draft,
  patch,
}: {
  draft: Draftish;
  patch: (p: { files: StoredFile[] }) => void;
}) {
  const { t, toast } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<FileKind>('uzi');
  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);

  // "Boshqa" — klinika hujjat nima ekanini bilishi uchun bemor o'zi nomlaydi
  const needsLabel = kind === 'other';
  const canUpload = draft.files.length < MAX_FILES && (!needsLabel || label.trim().length >= 2);

  const readAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        // "data:image/png;base64,XXXX" → faqat XXXX qismi
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const room = MAX_FILES - draft.files.length;
    const picked = Array.from(fileList).slice(0, Math.max(0, room));

    if (!picked.length) {
      toast(t('wz.docs.limit'), 'error');
      return;
    }

    setUploading(true);
    const added: StoredFile[] = [];

    for (const file of picked) {
      if (file.size > MAX_BYTES) {
        toast(`${file.name} — ${t('wz.docs.limit')}`, 'error');
        continue;
      }
      try {
        const stored = await api.uploadFile({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          kind,
          label: needsLabel ? label.trim() : null,
          dataBase64: await readAsBase64(file),
        });
        added.push(stored);
      } catch (err: any) {
        toast(err?.message ?? t('common.error'), 'error');
      }
    }

    if (added.length) {
      haptic.success();
      patch({ files: [...draft.files, ...added] });
    }
    setUploading(false);
    setLabel('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (id: string) => {
    haptic.tap();
    patch({ files: draft.files.filter((f) => f.id !== id) });
  };

  return (
    <>
      <div className="wz-head">
        <h1 className="wz-head__title">{t('wz.docs.title')}</h1>
        <p className="wz-head__sub">{t('wz.docs.sub')}</p>
      </div>

      {/* Hujjat turi — yuklashdan oldin tanlanadi, klinika nima ekanini biladi */}
      <Field label={t('wz.docs.label')}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {FILE_KINDS.map((k) => (
            <Chip key={k} size="sm" active={kind === k} onClick={() => setKind(k)}>
              {t(`wz.docs.kind.${k}` as any)}
            </Chip>
          ))}
        </div>
      </Field>

      {/* "Boshqa" tanlansa — nomi so'raladi, aks holda hujjat nomsiz qoladi */}
      <AnimatePresence initial={false}>
        {needsLabel && (
          <m.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            style={{ overflow: 'hidden' }}
          >
            <Field label={t('wz.docs.otherName')} hint={t('wz.docs.otherHint')}>
              <Input
                value={label}
                maxLength={120}
                placeholder={t('wz.docs.otherPh')}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
          </m.div>
        )}
      </AnimatePresence>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => void handleFiles(e.target.files)}
      />

      <Button
        variant="secondary"
        block
        loading={uploading}
        disabled={!canUpload}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? t('wz.docs.uploading') : t('wz.docs.add')}
      </Button>

      {uploading && <Skeleton h={56} />}

      {/* Nima yuklangani nomi bilan pastda ko'rinib turadi */}
      {draft.files.length > 0 && (
        <div className="between">
          <h2 className="section-title">{t('wz.docs.uploaded')}</h2>
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
                {file.label || t(`wz.docs.kind.${file.kind}` as any)} ·{' '}
                {Math.max(1, Math.round(file.sizeBytes / 1024))} KB
              </span>
            </span>

            <button className="doc-row__remove" onClick={() => remove(file.id)} aria-label={t('common.cancel')}>
              ×
            </button>
          </m.div>
        ))}
      </AnimatePresence>

      <p className="tiny">{t('wz.docs.limit')}</p>
      <Notice tone="info">{t('wz.docs.privacy')}</Notice>
    </>
  );
}

/** Ilova qilingan hujjatlar ro'yxati — klinika va bitim ekranlarida ishlatiladi. */
export function AttachmentList({ files }: { files: StoredFile[] }) {
  const { t } = useApp();
  if (!files.length) return null;

  return (
    <div className="stack" style={{ gap: 6 }}>
      {files.map((file) => (
        <FileOpenButton key={file.id} file={file}>
          <FileThumb file={file} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="doc-row__name truncate">{file.name}</span>
            <span className="doc-row__meta">{file.label || t(`wz.docs.kind.${file.kind}` as any)}</span>
          </span>
          <span className="doc-row__meta">↗</span>
        </FileOpenButton>
      ))}
    </div>
  );
}
