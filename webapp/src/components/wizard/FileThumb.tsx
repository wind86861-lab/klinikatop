/**
 * Himoyalangan fayl eskizi.
 *
 * Fayl auth sarlavhasi bilan olinadi va object URL yasaladi — `<img src>`
 * sarlavha yubora olmaydi, shuning uchun to'g'ridan-to'g'ri havola ishlamaydi.
 */
import { useEffect, useState } from 'react';
import { fetchFileObjectUrl } from '@/lib/api';
import type { StoredFile } from '@shared/types';

export function useFileObjectUrl(file: StoredFile | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let created: string | null = null;

    void fetchFileObjectUrl(file.id)
      .then((objectUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        created = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [file?.id]);

  return url;
}

export function FileThumb({ file }: { file: StoredFile }) {
  const isImage = file.mimeType.startsWith('image/');
  const url = useFileObjectUrl(isImage ? file : null);

  if (!isImage) return <span className="doc-row__thumb doc-row__thumb--pdf">PDF</span>;
  if (!url) return <span className="doc-row__thumb skeleton" />;
  return <img className="doc-row__thumb" src={url} alt="" />;
}

/** Faylni yangi oynada ochadi — blob URL orqali. */
export function FileOpenButton({ file, children }: { file: StoredFile; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      const url = await fetchFileObjectUrl(file.id);
      window.open(url, '_blank', 'noopener');
      // Brauzer oynani ochib olgach URL kerak emas
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="doc-row" onClick={open} disabled={busy} style={{ textAlign: 'left' }}>
      {children}
    </button>
  );
}
