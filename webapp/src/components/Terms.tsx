/**
 * Ommaviy oferta: qabul qilish katakchasi va to'liq matn varag'i.
 * Bemor har so'rov yuborishda qabul qiladi — versiya serverda yoziladi.
 */
import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { Button, IconCheck, Notice, Sheet, Skeleton } from '@/ui';
import type { TermsDocument } from '@shared/types';

/** Qabul katakchasi — "to'liq o'qish" havolasi bilan. */
export function TermsCheckbox({
  accepted,
  onChange,
  onOpen,
}: {
  accepted: boolean;
  onChange: (v: boolean) => void;
  onOpen: () => void;
}) {
  const { t } = useApp();

  return (
    <div className="stack" style={{ gap: 6 }}>
      <button
        type="button"
        className={`terms-check ${accepted ? 'terms-check--on' : ''}`}
        onClick={() => {
          haptic.select();
          onChange(!accepted);
        }}
        aria-pressed={accepted}
      >
        <m.span
          className="terms-check__box"
          animate={{ scale: accepted ? [1, 1.15, 1] : 1 }}
          transition={spring}
        >
          <IconCheck size={14} />
        </m.span>
        <span className="terms-check__text">{t('terms.accept')}</span>
      </button>

      <button
        type="button"
        className="btn btn--ghost"
        style={{ alignSelf: 'flex-start', minHeight: 32 }}
        onClick={onOpen}
      >
        {t('terms.read')} →
      </button>
    </div>
  );
}

/** To'liq matn — pastdan chiqadigan varaqda. */
export function TermsSheet({
  open,
  onClose,
  onAccept,
}: {
  open: boolean;
  onClose: () => void;
  /** Berilsa varaq oxirida qabul tugmasi chiqadi */
  onAccept?: () => void;
}) {
  const { t, lang } = useApp();
  const [doc, setDoc] = useState<TermsDocument | null>(null);

  useEffect(() => {
    if (!open || doc) return;
    void api.terms().then(setDoc).catch(() => setDoc(null));
    // Til o'zgarsa matn ham qayta olinadi
  }, [open, doc]);

  useEffect(() => {
    setDoc(null);
  }, [lang]);

  return (
    <Sheet open={open} onClose={onClose} title={t('terms.title')}>
      {!doc ? (
        <div className="stack">
          <Skeleton h={14} w="40%" />
          <Skeleton h={64} />
          <Skeleton h={120} />
        </div>
      ) : (
        <>
          <p className="tiny">{t('terms.version', { v: doc.version, date: doc.updatedAt })}</p>

          {/* Qisqacha mohiyat — to'liq matnni o'qimasa ham asosiyni ko'radi */}
          <Notice tone="info">
            <span className="stack" style={{ gap: 4 }}>
              <strong>{t('terms.summary')}</strong>
              {doc.summary.map((line) => (
                <span key={line}>• {line}</span>
              ))}
            </span>
          </Notice>

          {doc.sections.map((section) => (
            <div className="terms-section" key={section.title}>
              <h3>{section.title}</h3>
              {section.body.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          ))}

          {onAccept && (
            <Button
              block
              onClick={() => {
                haptic.success();
                onAccept();
                onClose();
              }}
            >
              {t('terms.acceptShort')}
            </Button>
          )}
        </>
      )}
    </Sheet>
  );
}
