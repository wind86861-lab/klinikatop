/**
 * Verifikatsiya guruhi — kabinetning 2, 3 va 4-ekranlari.
 *
 *   VerificationStatus  — holat va nima yetishmayotgani
 *   VerificationDocs    — hujjat yuklash va ro'yxati
 *   ClinicOperations    — qaysi operatsiyalarni bajaraman
 *
 * Uchtasi bitta faylda, chunki ular bitta savolga xizmat qiladi: klinika
 * so'rov olishga tayyormi? Tayyor bo'lmasa boshqa ekranlarning ma'nosi yo'q.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api, clinicApi } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { EASE, popVariants, spring } from '@/lib/motion';
import { formatDate } from '@/lib/format';
import { categoryName, opName } from '@/i18n';
import { FileOpenButton, FileThumb } from '@/components/wizard/FileThumb';
import {
  Button,
  Card,
  Chip,
  Field,
  IconAlert,
  IconCheck,
  IconClock,
  IconShield,
  Input,
  Notice,
  Screen,
  Skeleton,
} from '@/ui';
import { Async, useResource } from './shell';
import { CLINIC_DOC_KINDS, type ClinicDocKind, type Operation, type StoredFile } from '@shared/types';

/* ═════════════════  3-ekran: verifikatsiya holati  ═════════════════ */

export function VerificationStatus() {
  const { t } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => clinicApi.verification());

  return (
    <Screen onBack={() => navigate('/clinic/more')} title={t('ver.title')} subtitle={t('ver.sub')}>
      <Async resource={res} skeleton={<Skeleton h={220} />}>
        {(data) => {
          const tone: 'success' | 'danger' | 'warning' =
            data.status === 'approved' ? 'success' : data.status === 'rejected' ? 'danger' : 'warning';
          const Icon = data.status === 'approved' ? IconShield : data.status === 'rejected' ? IconAlert : IconClock;

          return (
            <>
              <motion.div variants={popVariants} initial="initial" animate="animate">
                <Card className={`ver-hero ver-hero--${tone}`}>
                  <span className="ver-hero__icon">
                    <Icon size={30} />
                  </span>
                  <strong className="ver-hero__title">{t(`ver.status.${data.status}` as any)}</strong>
                  <p className="ver-hero__text">{t(`ver.${data.status}Text` as any)}</p>
                </Card>
              </motion.div>

              {/* Rad etilgan bo'lsa sabab eng muhim ma'lumot */}
              {data.note && <Notice tone="danger">{data.note}</Notice>}

              <h2 className="section-title">{t('ver.checklist')}</h2>
              <Card className="stack" style={{ gap: 2 }}>
                {data.items.map((item) => (
                  <div key={item.key} className={`check-row ${item.done ? 'is-done' : ''}`}>
                    <span className="check-row__mark">{item.done ? <IconCheck size={14} /> : '—'}</span>
                    <span>{t(`ver.item.${item.key}` as any)}</span>
                  </div>
                ))}
              </Card>

              <Notice tone={data.complete ? 'info' : 'warning'}>
                {data.complete ? t('ver.complete') : t('ver.incomplete')}
              </Notice>

              <Button variant="secondary" block onClick={() => navigate('/clinic/verification/documents')}>
                {t('ver.goDocs')}
              </Button>
            </>
          );
        }}
      </Async>
    </Screen>
  );
}

/* ═════════════════  2-ekran: verifikatsiya hujjatlari  ═════════════════ */

export function VerificationDocs() {
  const { t, toast } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => clinicApi.verification());

  const [kind, setKind] = useState<ClinicDocKind>('license');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const needsLabel = kind === 'other';

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const stored = await uploadAsBase64(file);
      await clinicApi.addDocument({ kind, label: needsLabel ? label.trim() : null, fileId: stored.id });
      haptic.success();
      toast(t('ver.docAdded'), 'success');
      setLabel('');
      res.reload();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await clinicApi.removeDocument(id);
      haptic.tap();
      res.reload();
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  return (
    <Screen
      onBack={() => navigate('/clinic/verification')}
      title={t('ver.docsTitle')}
      subtitle={t('ver.docsSub')}
    >
      <Field label={t('wz.docs.label')}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {CLINIC_DOC_KINDS.map((k) => (
            <Chip key={k} size="sm" active={kind === k} onClick={() => setKind(k)}>
              {t(`ver.kind.${k}` as any)}
            </Chip>
          ))}
        </div>
      </Field>

      <AnimatePresence initial={false}>
        {needsLabel && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            style={{ overflow: 'hidden' }}
          >
            <Field label={t('ver.docName')}>
              <Input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
            </Field>
          </motion.div>
        )}
      </AnimatePresence>

      <FilePickerButton
        label={busy ? t('wz.docs.uploading') : t('ver.addDoc')}
        disabled={busy || (needsLabel && label.trim().length < 2)}
        onPick={upload}
      />

      <Async
        resource={res}
        isEmpty={(d) => d.documents.length === 0}
        empty={{ title: t('ver.noDocs'), text: t('ver.docsSub') }}
      >
        {(data) => (
          <AnimatePresence initial={false}>
            {data.documents.map((doc) => (
              <motion.div
                key={doc.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={spring}
                className="doc-row"
              >
                <FileThumb file={{ id: doc.fileId, name: doc.fileName, mimeType: doc.fileMimeType, sizeBytes: 0, kind: 'other', label: null, createdAt: doc.createdAt }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="doc-row__name truncate">
                    {doc.label || t(`ver.kind.${doc.kind}` as any)}
                  </span>
                  <span className="doc-row__meta">
                    {doc.fileName} · {t(`ver.status.${doc.status}` as any)}
                  </span>
                </span>
                {doc.status !== 'approved' && (
                  <button className="doc-row__remove" onClick={() => remove(doc.id)} aria-label={t('common.cancel')}>
                    ×
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </Async>

      <Notice tone="info">{t('wz.docs.privacy')}</Notice>
    </Screen>
  );
}

/* ═════════════════  4-ekran: yo'nalishlar  ═════════════════ */

export function ClinicOperations() {
  const { t, lang, toast, categories } = useApp();
  const navigate = useNavigate();

  const res = useResource(async () => {
    const [clinic, operations] = await Promise.all([api.clinic(), api.operations({})]);
    return { clinic, operations };
  });

  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  /** Yopilgan kategoriyalar — sukut bo'yicha hammasi ochiq */
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const current = selected ?? new Set(res.data?.clinic.operationIds ?? []);

  const toggle = (id: number) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
    haptic.tap();
  };

  /**
   * Kategoriyani butunlay tanlash yoki bo'shatish.
   *
   * Katalog kattalashgach bu zarur bo'ldi: "Oftalmologiya" ni to'liq
   * qiladigan klinika 12 ta yo'nalishni bittalab bosishi kerak edi.
   */
  const toggleCategory = (ops: Operation[]) => {
    const allOn = ops.every((op) => current.has(op.id));
    const next = new Set(current);
    for (const op of ops) {
      if (allOn) next.delete(op.id);
      else next.add(op.id);
    }
    setSelected(next);
    haptic.tap();
  };

  const save = async () => {
    if (current.size === 0) {
      toast(t('ops.minOne'), 'error');
      return;
    }
    setSaving(true);
    try {
      await api.updateClinic({ operationIds: [...current] });
      haptic.success();
      toast(t('ops.saved'), 'success');
      navigate(-1);
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      onBack={() => navigate(-1)}
      title={t('ops.title')}
      subtitle={t('ops.sub')}
      footer={
        <Button block loading={saving} disabled={current.size === 0} onClick={save}>
          {t('ops.saveOps')} · {t('ops.selected', { n: current.size })}
        </Button>
      }
    >
      <Async resource={res} skeleton={<Skeleton h={320} />}>
        {(data) => {
          // "Bilmayman" sentineli katalogda ko'rinmasligi kerak — u bemor uchun
          const list: Operation[] = data.operations.filter((op: Operation) => op.slug !== 'unknown');
          const q = query.trim().toLowerCase();
          const filtered = q
            ? list.filter((op: Operation) => opName(op, lang).toLowerCase().includes(q))
            : list;

          const grouped = filtered.reduce<Record<number, Operation[]>>(
            (acc: Record<number, Operation[]>, op: Operation) => {
              (acc[op.categoryId] ??= []).push(op);
              return acc;
            },
            {},
          );

          /*
           * Kategoriyalar tanlanganlari yuqorida turadi.
           *
           * Klinika o'z yo'nalishlarini tez-tez qaraydi, boshqalarini esa
           * kamdan-kam. 20+ kategoriya bo'lganda bu farqni qiladi.
           */
          const sections = Object.entries(grouped)
            .map(([id, ops]) => {
              const categoryId = Number(id);
              const chosen = ops.filter((op) => current.has(op.id)).length;
              const category = categories.find((c) => c.id === categoryId);
              return { categoryId, ops, chosen, name: category ? categoryName(category, lang) : '' };
            })
            .sort((a, b) => (b.chosen > 0 ? 1 : 0) - (a.chosen > 0 ? 1 : 0) || a.name.localeCompare(b.name));

          return (
            <>
              <Input
                value={query}
                placeholder={t('ops.searchPh')}
                aria-label={t('ops.searchPh')}
                onChange={(e) => setQuery(e.target.value)}
              />

              {current.size > 0 && (
                <Notice tone="info">{t('ops.matchHint', { n: current.size })}</Notice>
              )}

              {sections.map(({ categoryId, ops, chosen, name }) => {
                // Qidiruv paytida hamma narsa ochiq — natijani yashirish mantiqsiz
                const isOpen = q.length > 0 || !collapsed.has(categoryId);
                const allOn = ops.every((op) => current.has(op.id));

                return (
                  <div key={categoryId} className="opgroup">
                    <button
                      type="button"
                      className="opgroup__head"
                      onClick={() => {
                        const next = new Set(collapsed);
                        next.has(categoryId) ? next.delete(categoryId) : next.add(categoryId);
                        setCollapsed(next);
                      }}
                    >
                      <span className={`opgroup__caret ${isOpen ? 'is-open' : ''}`}>›</span>
                      <strong className="truncate">{name}</strong>
                      <span className={`opgroup__count ${chosen > 0 ? 'is-on' : ''} num`}>
                        {chosen}/{ops.length}
                      </span>
                    </button>

                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: EASE }}
                          style={{ overflow: 'hidden' }}
                        >
                          <div className="opgroup__body">
                            <button
                              type="button"
                              className="opgroup__all"
                              onClick={() => toggleCategory(ops)}
                            >
                              {allOn ? t('ops.clearAll') : t('ops.selectAll')}
                            </button>

                            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                              {ops.map((op: Operation) => (
                                <Chip
                                  key={op.id}
                                  size="sm"
                                  active={current.has(op.id)}
                                  onClick={() => toggle(op.id)}
                                >
                                  {current.has(op.id) && <IconCheck size={12} />} {opName(op, lang)}
                                </Chip>
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              {filtered.length === 0 && <Notice tone="info">{t('ops.noMatch')}</Notice>}
            </>
          );
        }}
      </Async>
    </Screen>
  );
}

/* ═════════════════  Umumiy: fayl tanlash  ═════════════════ */

export function FilePickerButton({
  label,
  disabled,
  accept = 'image/*,application/pdf',
  onPick,
}: {
  label: string;
  disabled?: boolean;
  accept?: string;
  onPick: (file: File) => void | Promise<void>;
}) {
  const id = useMemo(() => `fp-${Math.random().toString(36).slice(2)}`, []);

  return (
    <>
      <input
        id={id}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPick(file);
          e.target.value = '';
        }}
      />
      <Button
        variant="secondary"
        block
        disabled={disabled}
        onClick={() => document.getElementById(id)?.click()}
      >
        {label}
      </Button>
    </>
  );
}

/** Faylni base64 qilib serverga yuklaydi — Telegram WebView'da eng ishonchli yo'l. */
export async function uploadAsBase64(file: File, kind: 'uzi' | 'other' = 'other'): Promise<StoredFile> {
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  return api.uploadFile({
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    kind,
    dataBase64,
  });
}

export { FileOpenButton, formatDate };
