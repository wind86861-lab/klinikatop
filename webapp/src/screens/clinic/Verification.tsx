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
import { m } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api, clinicApi } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { popVariants } from '@/lib/motion';
import { formatDate } from '@/lib/format';
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
  Section,
  Screen,
  Skeleton,
} from '@/ui';
import { Async, useResource } from './shell';
import {
  CLINIC_DOC_KINDS,
  REQUIRED_DOC_KINDS,
  type ClinicDocKind,
  type ClinicDocument,
  type StoredFile,
} from '@shared/types';
import { CatalogBrowser } from '@/components/CatalogBrowser';

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
              <m.div variants={popVariants} initial="initial" animate="animate">
                <Card className={`ver-hero ver-hero--${tone}`}>
                  <span className="ver-hero__icon">
                    <Icon size={30} />
                  </span>
                  <strong className="ver-hero__title">{t(`ver.status.${data.status}` as any)}</strong>
                  <p className="ver-hero__text">{t(`ver.${data.status}Text` as any)}</p>
                </Card>
              </m.div>

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

  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  /** Qaysi tur yuklanayotgani — faqat o'sha qatorda "Yuklanmoqda" ko'rsatish uchun */
  const [kind, setKind] = useState<ClinicDocKind | null>(null);

  const upload = async (file: File, docKind: ClinicDocKind, docLabel: string | null) => {
    setBusy(true);
    setKind(docKind);
    try {
      const stored = await uploadAsBase64(file);
      await clinicApi.addDocument({ kind: docKind, label: docLabel, fileId: stored.id });
      haptic.success();
      toast(t('ver.docAdded'), 'success');
      setLabel('');
      res.reload();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
      setKind(null);
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

  /*
   * Ikkita hujjat MAJBURIY, qolgani ixtiyoriy. Ilgari beshala turi bir
   * xil tugma bo'lib turardi va qaysi biri kerakligi faqat sarlavha
   * ostidagi kichkina matndan bilinardi — klinika nima yuklashini
   * o'ylab qolardi.
   *
   * Endi ekran savolga javob beradi: "menda nima yetishmayapti?"
   */
  const uploaded = res.data?.documents ?? [];
  const has = (k: ClinicDocKind) => uploaded.some((d) => d.kind === k && d.status !== 'rejected');
  const doneRequired = REQUIRED_DOC_KINDS.filter(has).length;

  return (
    <Screen
      onBack={() => navigate('/clinic/verification')}
      title={t('ver.docsTitle')}
      subtitle={t('ver.docsProgress', { n: doneRequired, total: REQUIRED_DOC_KINDS.length })}
    >
      <Async resource={res} skeleton={<Skeleton h={220} />}>
        {(data) => {
          const docsOf = (k: ClinicDocKind) => data.documents.filter((d) => d.kind === k);

          return (
            <>
              {/* ── Majburiy hujjatlar ── */}
              <Section title={t('ver.required')}>
                <div className="stack stack--tight">
                  {REQUIRED_DOC_KINDS.map((k) => (
                    <DocSlot
                      key={k}
                      kind={k}
                      docs={docsOf(k)}
                      busy={busy && kind === k}
                      onPick={(file) => upload(file, k, null)}
                      onRemove={remove}
                    />
                  ))}
                </div>
              </Section>

              {/* ── Ixtiyoriy ── */}
              <Section title={t('ver.optional')} action={<span className="tiny">{t('ver.optionalHint')}</span>}>
                <div className="stack stack--tight">
                  {CLINIC_DOC_KINDS.filter((k) => !REQUIRED_DOC_KINDS.includes(k) && k !== 'other').map((k) => (
                    <DocSlot
                      key={k}
                      kind={k}
                      docs={docsOf(k)}
                      busy={busy && kind === k}
                      onPick={(file) => upload(file, k, null)}
                      onRemove={remove}
                    />
                  ))}
                </div>
              </Section>

              {/* ── Boshqa: nomi kerak, shuning uchun alohida ── */}
              <Section title={t('ver.kind.other')}>
                <div className="stack stack--tight">
                  {docsOf('other').map((doc) => (
                    <DocRow key={doc.id} doc={doc} onRemove={remove} />
                  ))}
                  <Field label={t('ver.docName')}>
                    <Input
                      value={label}
                      maxLength={120}
                      placeholder={t('ver.docNamePh')}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </Field>
                  <FilePickerButton
                    label={busy && kind === 'other' ? t('wz.docs.uploading') : t('ver.addDoc')}
                    disabled={busy || label.trim().length < 2}
                    onPick={(file) => upload(file, 'other', label.trim())}
                  />
                </div>
              </Section>

              <p className="tiny">{t('ver.fileLimit')}</p>
              {/*
                Bu yerda ilgari BEMOR matni turardi ("hujjat so'rovingizni
                olgan klinikalarga ko'rinadi") — klinika o'z litsenziyasini
                yuklayotganda bu ma'nosiz edi.
              */}
              <Notice tone="info">{t('ver.docsPrivacy')}</Notice>
            </>
          );
        }}
      </Async>
    </Screen>
  );
}

/* ─────────────────────────  Bitta hujjat turi  ───────────────────────── */

/**
 * Bitta hujjat turi uchun qator: nomi, holati va amal.
 *
 * Yuklangan bo'lsa holati ko'rinadi, yo'q bo'lsa yuklash tugmasi —
 * ya'ni klinika ro'yxatga bir marta qarab nima qolganini biladi.
 */
function DocSlot({
  kind,
  docs,
  busy,
  onPick,
  onRemove,
}: {
  kind: ClinicDocKind;
  docs: ClinicDocument[];
  busy: boolean;
  onPick: (file: File) => void;
  onRemove: (id: number) => void;
}) {
  const { t } = useApp();
  const live = docs.filter((d) => d.status !== 'rejected');
  const rejected = docs.filter((d) => d.status === 'rejected');

  /*
   * Bitta tur ostida FAQAT amaldagi hujjat ko'rsatiladi.
   *
   * Klinika litsenziyani tuzatib qayta yuklasa, eskisi ham ro'yxatda
   * qolardi va vaqt o'tib bitta tur ostida o'nlab bir xil qator
   * yig'ilardi. Amalda kerak bo'lgani bitta: hozir kuchda turgani.
   *
   * Rad etilganlar esa KO'RSATILADI — ular ish talab qiladi, sababini
   * o'qib qayta yuborish kerak.
   */
  const current = live[0] ?? null;
  const older = live.length - 1;

  return (
    <Card className="stack" style={{ gap: 8 }}>
      <div className="between">
        <strong>{t(`ver.kind.${kind}` as any)}</strong>
        {current ? (
          <span className={`badge badge--${current.status === 'approved' ? 'success' : 'accent'}`}>
            {t(`ver.status.${current.status}` as any)}
          </span>
        ) : (
          <span className="badge badge--muted">{t('ver.missing')}</span>
        )}
      </div>

      {current && <DocRow doc={current} onRemove={onRemove} />}
      {older > 0 && <span className="tiny">{t('ver.olderVersions', { n: older })}</span>}

      {rejected.map((doc) => (
        <div key={doc.id} className="stack" style={{ gap: 4 }}>
          <DocRow doc={doc} onRemove={onRemove} />
          {doc.note && <Notice tone="warning">{doc.note}</Notice>}
        </div>
      ))}

      {!current && (
        <FilePickerButton label={busy ? t('wz.docs.uploading') : t('ver.addDoc')} disabled={busy} onPick={onPick} />
      )}
    </Card>
  );
}

function DocRow({ doc, onRemove }: { doc: ClinicDocument; onRemove: (id: number) => void }) {
  const { t, lang } = useApp();
  /*
   * Nom uch bosqichda: klinika yozgani → fayl nomi → sana.
   * Ba'zi fayllarda nom bo'sh keladi, o'shanda qator nomsiz qolib
   * ketardi — sana hech bo'lmasa qaysi hujjat ekanini ajratadi.
   */
  const named = doc.label || doc.fileName;
  const name = named || formatDate(doc.createdAt, lang);
  return (
    <div className="doc-row">
      <FileThumb
        file={{
          id: doc.fileId,
          name: doc.fileName,
          mimeType: doc.fileMimeType,
          sizeBytes: 0,
          kind: 'other',
          label: null,
          createdAt: doc.createdAt,
        }}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="doc-row__name truncate">{name}</span>
        <span className="doc-row__meta">
          {t(`ver.status.${doc.status}` as any)}
          {/* Nom sanadan olingan bo'lsa uni ikkinchi marta yozmaymiz */}
          {named && ` · ${formatDate(doc.createdAt, lang)}`}
        </span>
      </span>
      {doc.status !== 'approved' && (
        <button className="doc-row__remove" onClick={() => onRemove(doc.id)} aria-label={t('common.cancel')}>
          ×
        </button>
      )}
    </div>
  );
}

/* ═════════════════  4-ekran: yo'nalishlar  ═════════════════ */

export function ClinicOperations() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();

  const res = useResource(async () => {
    const [me, tree] = await Promise.all([api.clinic(), api.catalogTree()]);
    return {
      clinic: me.clinic,
      operationIds: me.operationIds,
      externalOperationIds: me.externalOperationIds ?? [],
      tree,
    };
  });

  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [saving, setSaving] = useState(false);

  const current = selected ?? new Set(res.data?.operationIds ?? []);

  const toggle = (id: number) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
    haptic.tap();
  };

  /**
   * Butun bo'limni yoqish yoki bo'shatish.
   *
   * Katalog kattalashgach bu zarur bo'ldi: "Katarakta" ni to'liq
   * qiladigan klinika 5 ta yozuvni bittalab bosishi kerak emas.
   */
  const toggleMany = (ops: { id: number }[]) => {
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
          /*
           * banisa'dan kelgan yo'nalishlar QULFLANGAN, lekin ekran
           * emas.
           *
           * Ilgari ulangan klinikaga butun sahifa yopilardi. Bu esa
           * imkoniyatni tortib olardi: KlinikaTop katalogi banisa
           * katalogidan kengroq va klinika bu yerda faqat shu yerda
           * bor yo'nalishni ham qo'sha olishi kerak. Server ham
           * shunga moslandi — saqlash faqat `manual` qatorlarni
           * almashtiradi, banisa'nikiga tegmaydi.
           */
          const external = data.externalOperationIds;

          return (
            <>
              {external.length > 0 && (
                <Notice tone="info">{t('ops.fromBanisa', { n: external.length })}</Notice>
              )}
              {current.size > 0 && <Notice tone="info">{t('ops.matchHint', { n: current.size })}</Notice>}

              {/*
                Bemor bilan BIR XIL ko'rinish: u "Katarakta" bo'limidan
                tanlaydi, klinika esa o'sha bo'limni yoqadi. Ikki xil
                tuzilma bo'lsa, nima uchun so'rov kelmayotgani
                tushunarsiz bo'lardi.
              */}
              <CatalogBrowser
                tree={data.tree}
                lang={lang}
                mode="multi"
                selected={[...current]}
                lockedIds={external}
                onSelect={(op) => toggle(op.id)}
                onToggleMany={toggleMany}
                emptyText={t('ops.noMatch')}
              />
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


/* ═════════════════  Tahlil xizmatlari  ═════════════════ */

/**
 * Klinika qaysi tekshiruvni qaysi organ bo'yicha qiladi.
 *
 * Ikki daraja, chunki bitta ro'yxat yetarli emas edi: MRT
 * qiladigan klinika qon tahlilini qilmasligi mumkin, garchi
 * ikkalasi ham "jigar" bo'lsa ham.
 *
 * Har tekshiruv o'z organlari bilan guruh bo'lib turadi va sarlavha
 * bosilsa butun guruh yoqiladi — MRT ni to'liq qiladigan klinika
 * o'nta katakni bittalab bosishi kerak emas.
 */
export function ClinicLabServices() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();

  const res = useResource(() => api.clinicLabServices());
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  const key = (testId: number, organId: number) => `${testId}:${organId}`;
  const current =
    selected ?? new Set((res.data?.selected ?? []).map((s) => key(s.testId, s.organId)));

  const organName = (id: number) => {
    const o = res.data?.organs.find((x) => x.id === id);
    return o ? (lang === 'ru' ? o.nameRu : o.nameUz) : String(id);
  };

  const toggle = (testId: number, organId: number) => {
    const next = new Set(current);
    const k = key(testId, organId);
    next.has(k) ? next.delete(k) : next.add(k);
    setSelected(next);
    haptic.tap();
  };

  const toggleTest = (testId: number, organIds: number[]) => {
    const allOn = organIds.every((o) => current.has(key(testId, o)));
    const next = new Set(current);
    for (const o of organIds) {
      if (allOn) next.delete(key(testId, o));
      else next.add(key(testId, o));
    }
    setSelected(next);
    haptic.tap();
  };

  const save = async () => {
    setSaving(true);
    try {
      const services = [...current].map((k) => {
        const [testId, organId] = k.split(':').map(Number);
        return { testId, organId };
      });
      await api.saveClinicLabServices(services);
      haptic.success();
      toast(t('lab.saved'), 'success');
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
      title={t('lab.title')}
      onBack={() => navigate(-1)}
      footer={
        <Button block loading={saving} onClick={save}>
          {t('common.save')}
        </Button>
      }
    >
      {res.loading && (
        <div className="stack">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      )}
      {res.error && <Notice tone="danger">{res.error}</Notice>}

      {res.data && (
        <>
          <Notice tone="info">{t('lab.hint')}</Notice>

          <div className="stack" style={{ gap: 'var(--s-3)' }}>
            {res.data.tests.map((test) => {
              const on = test.organIds.filter((o) => current.has(key(test.id, o))).length;
              return (
                <Card key={test.id} className="stack" style={{ gap: 'var(--s-2)' }}>
                  <button type="button" className="labtest__head" onClick={() => toggleTest(test.id, test.organIds)}>
                    <span className="organrow__icon">{test.icon}</span>
                    <strong style={{ flex: 1, textAlign: 'left' }}>
                      {lang === 'ru' ? test.nameRu : test.nameUz}
                    </strong>
                    <span className="tiny">
                      {on}/{test.organIds.length}
                    </span>
                  </button>

                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {test.organIds.map((organId) => (
                      <Chip
                        key={organId}
                        size="sm"
                        active={current.has(key(test.id, organId))}
                        onClick={() => toggle(test.id, organId)}
                      >
                        {organName(organId)}
                      </Chip>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>

          {current.size === 0 && <Notice tone="warning">{t('lab.none')}</Notice>}
        </>
      )}
    </Screen>
  );
}
