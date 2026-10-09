/**
 * Yo'naltiruvchi shifokor kabineti — Telegram Mini App ichida.
 *
 * Botda `/shifokor` → `/doctor`. Bu yerda qaror:
 *
 *   Telegramdan tashqarida      → "botda oching"
 *   profil yo'q                 → `/doctor/register`
 *   pending / in_review         → holat ekrani (kutish)
 *   rejected                    → sabab + yangi hujjat yuklash
 *   approved                    → kabinet
 *
 * Tavsiya yaratish serverda ham to'silgan (`assertApprovedDoctor`) —
 * bu ekran faqat ishlamaydigan tugmani ko'rsatmaslik uchun.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { api, fetchDoctorDocument } from '@/lib/api';
import { haptic, tg } from '@/lib/telegram';
import { formatSize, prepareLicense, type LicenseFile } from '@/lib/docFile';
import { formatDate } from '@/lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  IconTrash,
  Input,
  Notice,
  Screen,
  Segment,
  Sheet,
  SkeletonCard,
  Stepper,
  Textarea,
} from '@/ui';
import { DoctorWorkspace } from './DoctorCases';
import type { DoctorDocKind, ReferringDoctor, ReferringDoctorDocument } from '@shared/types';

const BOT_URL = 'https://t.me/klinikatop_bot';

type Me = { doctor: ReferringDoctor | null; phoneVerified: boolean };

function useDoctorMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setMe(await api.doctorMe());
    } catch (err: any) {
      setError(err?.message ?? 'Xatolik');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return { me, setMe, error, reload: load };
}

/** Shifokor kabineti faqat Telegram orqali — brauzerda botga yo'naltiramiz */
function OnlyTelegram() {
  const { t } = useApp();
  return (
    <Screen title={t('rdoc.title')}>
      <EmptyState
        icon="🩺"
        title={t('rdoc.title')}
        text={t('rdoc.onlyTelegram')}
        action={
          <a className="btn btn--primary" href={BOT_URL} target="_blank" rel="noreferrer">
            {t('rdoc.openBot')}
          </a>
        }
      />
    </Screen>
  );
}

export function DoctorCabinet() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();
  const { me, setMe, error, reload } = useDoctorMe();

  const insideTelegram = Boolean(tg?.initData);

  // Profil yo'q — to'g'ridan-to'g'ri formaga
  useEffect(() => {
    if (me && !me.doctor && me.phoneVerified) navigate('/doctor/register', { replace: true });
  }, [me, navigate]);

  if (!insideTelegram) return <OnlyTelegram />;

  if (error) {
    return (
      <Screen title={t('rdoc.title')}>
        <ErrorState message={error} retryLabel={t('common.retry')} onRetry={reload} />
      </Screen>
    );
  }

  if (!me || (!me.doctor && me.phoneVerified)) {
    return (
      <Screen title={t('rdoc.title')}>
        <SkeletonCard lines={4} />
      </Screen>
    );
  }

  if (!me.doctor) {
    return (
      <Screen title={t('rdoc.title')}>
        <EmptyState
          icon="📱"
          title={t('rdoc.phoneTitle')}
          text={t('rdoc.phoneText')}
          // Mini App bot ichida ochilgan — yopilsa odam botga qaytadi
          action={<Button onClick={() => tg?.close()}>{t('rdoc.openBot')}</Button>}
        />
      </Screen>
    );
  }

  const doctor = me.doctor;
  const update = (d: ReferringDoctor) => setMe({ ...me, doctor: d });

  return (
    <Screen title={t('rdoc.title')} subtitle={`${doctor.firstName} ${doctor.lastName}`}>
      <div className="stack">
        {/* Tasdiqlangan shifokorga holat kartasi kerak emas — kabinet darhol ishga tushadi */}
        {doctor.status !== 'approved' && <StatusCard doctor={doctor} />}

        {/* Tasdiqlangan — ish joyi: yangi so'rov, statistika, so'rovlar ro'yxati */}
        {doctor.status === 'approved' && <DoctorWorkspace />}

        <Card className="stack" style={{ gap: 8 }}>
          <div className="between">
            <strong>{t('rdoc.yourData')}</strong>
            <button type="button" className="link-btn" onClick={() => navigate('/doctor/register')}>
              {t('rdoc.edit')}
            </button>
          </div>
          <div className="app-rows">
            <Row label={t('rdoc.firstName')} value={`${doctor.firstName} ${doctor.lastName}`} />
            <Row label={t('rdoc.specialty')} value={doctor.specialty} />
            <Row label={t('rdoc.workplace')} value={doctor.workplace} />
          </div>
          {doctor.bio && <p className="tiny" style={{ whiteSpace: 'pre-line' }}>{doctor.bio}</p>}
          <span className="tiny">{formatDate(doctor.createdAt, lang)}</span>
        </Card>

        <Documents
          doctor={doctor}
          onChange={(d) => {
            update(d);
          }}
          onError={(m) => toast(m, 'error')}
        />
      </div>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="app-row">
      <span className="tiny">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function StatusCard({ doctor }: { doctor: ReferringDoctor }) {
  const { t } = useApp();
  const steps = [t('rdoc.step1'), t('rdoc.step2'), t('rdoc.step3')];

  switch (doctor.status) {
    case 'pending':
      return (
        <Card className="stack rdoc-status">
          <span className="rdoc-status__icon" aria-hidden="true">🎉</span>
          <strong>{t('rdoc.pendingTitle')}</strong>
          <p className="tiny">{t('rdoc.pendingText')}</p>
          <Stepper steps={steps} current={1} />
        </Card>
      );
    case 'in_review':
      return (
        <Card className="stack rdoc-status">
          <span className="rdoc-status__icon" aria-hidden="true">🔄</span>
          <strong>{t('rdoc.reviewTitle')}</strong>
          <p className="tiny">{t('rdoc.reviewText')}</p>
          <Stepper steps={steps} current={1} />
          {doctor.rejectReason && (
            <Notice tone="warning">
              {t('rdoc.prevReason')}: {doctor.rejectReason}
            </Notice>
          )}
        </Card>
      );
    case 'rejected':
      return (
        <Card className="stack rdoc-status">
          <span className="rdoc-status__icon" aria-hidden="true">❌</span>
          <strong>{t('rdoc.rejectedTitle')}</strong>
          {doctor.rejectReason && (
            <Notice tone="danger">
              {t('rdoc.reason')}: {doctor.rejectReason}
            </Notice>
          )}
          <p className="tiny">{t('rdoc.rejectedText')}</p>
        </Card>
      );
    case 'approved':
      return (
        <Card className="stack rdoc-status">
          <span className="rdoc-status__icon" aria-hidden="true">✅</span>
          <strong>{t('rdoc.approvedTitle')}</strong>
          <p className="tiny">{t('rdoc.approvedText')}</p>
        </Card>
      );
  }
}

/* ─────────────────────────  Hujjatlar  ───────────────────────── */

function Documents({
  doctor,
  onChange,
  onError,
}: {
  doctor: ReferringDoctor;
  onChange: (d: ReferringDoctor) => void;
  onError: (message: string) => void;
}) {
  const { t, toast } = useApp();
  const [kind, setKind] = useState<DoctorDocKind>('bachelor');
  const [file, setFile] = useState<LicenseFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ doc: ReferringDoctorDocument; url: string } | null>(null);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await api.doctorAddDocument({ kind, name: file.name, dataBase64: file.dataBase64 }));
      setFile(null);
      haptic.success();
      toast(t('rdoc.uploaded'), 'success');
    } catch (err: any) {
      haptic.error();
      onError(err?.message ?? t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: ReferringDoctorDocument) => {
    try {
      onChange(await api.doctorDeleteDocument(doc.id));
      toast(t('rdoc.deleted'), 'success');
    } catch (err: any) {
      onError(err?.message ?? t('common.error'));
    }
  };

  const open = async (doc: ReferringDoctorDocument) => {
    try {
      setViewing({ doc, url: await fetchDoctorDocument(doc.id) });
    } catch (err: any) {
      onError(err?.message ?? t('common.error'));
    }
  };

  const close = () => {
    if (viewing) URL.revokeObjectURL(viewing.url);
    setViewing(null);
  };

  return (
    <Card className="stack" style={{ gap: 10 }}>
      <strong>{t('rdoc.documents')}</strong>

      {doctor.documents.map((doc) => (
        <div className="rdoc-doc" key={doc.id}>
          <span className="cs__fileThumb cs__fileThumb--pdf">{doc.mime === 'application/pdf' ? 'PDF' : 'IMG'}</span>
          <button type="button" className="rdoc-doc__meta" onClick={() => open(doc)}>
            <strong>{doc.kind === 'master' ? t('rdoc.master') : t('rdoc.bachelor')}</strong>
            <span className="tiny truncate">
              {doc.name} · {formatSize(doc.size)}
            </span>
          </button>
          <button type="button" className="rdoc-doc__del" aria-label={t('rdoc.remove')} onClick={() => remove(doc)}>
            <IconTrash size={16} />
          </button>
        </div>
      ))}

      <div className="rdoc-add stack" style={{ gap: 8 }}>
        <span className="tiny">{t('rdoc.addDoc')}</span>
        <Segment
          value={kind}
          onChange={(v) => setKind(v as DoctorDocKind)}
          options={[
            { value: 'bachelor', label: t('rdoc.bachelor') },
            { value: 'master', label: t('rdoc.master') },
          ]}
        />
        <DocPicker file={file} onPick={setFile} onError={onError} />
        {file && (
          <Button block loading={busy} onClick={upload}>
            {t('rdoc.upload')}
          </Button>
        )}
      </div>

      <Sheet open={viewing !== null} onClose={close} title={viewing?.doc.name ?? ''}>
        {viewing && (
          <div className="stack">
            {viewing.doc.mime.startsWith('image/') && viewing.doc.mime !== 'image/heic' ? (
              <img className="rdoc-preview" src={viewing.url} alt="" />
            ) : null}
            <a className="btn btn--secondary btn--block" href={viewing.url} download={viewing.doc.name}>
              {t('rdoc.download')}
            </a>
          </div>
        )}
      </Sheet>
    </Card>
  );
}

/** Fayl tanlash — klinika arizasidagi bilan bir xil ko'rinish va tayyorlash */
export function DocPicker({
  file,
  onPick,
  onError,
}: {
  file: LicenseFile | null;
  onPick: (f: LicenseFile | null) => void;
  onError: (message: string) => void;
}) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      onPick(await prepareLicense(f));
    } catch (err: any) {
      onError(err?.message ?? t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  if (file) {
    return (
      <div className="cs__file is-picked">
        {file.preview ? (
          <img className="cs__fileThumb" src={file.preview} alt="" />
        ) : (
          <span className="cs__fileThumb cs__fileThumb--pdf">PDF</span>
        )}
        <span className="cs__fileMeta">
          <strong className="truncate">{file.name}</strong>
          <span className="tiny">{formatSize(file.size)}</span>
        </span>
        <button type="button" className="cs__clear" onClick={() => onPick(null)}>
          {t('rdoc.remove')}
        </button>
      </div>
    );
  }

  return (
    <label className={`cs__file ${busy ? 'is-busy' : ''}`}>
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,.heic"
        hidden
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <span className="cs__fileIcon" aria-hidden="true">⬆</span>
      <span className="cs__fileMeta">
        <strong>{busy ? t('rdoc.preparing') : t('rdoc.pick')}</strong>
        <span className="tiny">PDF, JPG, PNG, HEIC</span>
      </span>
    </label>
  );
}

/* ─────────────────────────  Ro'yxatdan o'tish / tahrirlash  ───────────────────────── */

/**
 * Bitta forma ikki ish uchun: birinchi ariza va profilni tahrirlash.
 * Server qayta yuborishni xavfsiz qabul qiladi (profilni yangilaydi),
 * shuning uchun tarmoq uzilib qayta bosilsa ham ikkinchi ariza ochilmaydi.
 */
export function DoctorRegister() {
  const { t, user, toast } = useApp();
  const navigate = useNavigate();
  const { me, error, reload } = useDoctorMe();
  const insideTelegram = Boolean(tg?.initData);

  const [form, setForm] = useState({ firstName: '', lastName: '', specialty: '', workplace: '', bio: '' });
  const [bachelor, setBachelor] = useState<LicenseFile | null>(null);
  const [master, setMaster] = useState<LicenseFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState(false);

  // Bir marta to'ldiramiz: mavjud profil yoki Telegram ismi
  useEffect(() => {
    if (!me || filled) return;
    const d = me.doctor;
    setForm({
      firstName: d?.firstName ?? user?.firstName ?? '',
      lastName: d?.lastName ?? user?.lastName ?? '',
      specialty: d?.specialty ?? '',
      workplace: d?.workplace ?? '',
      bio: d?.bio ?? '',
    });
    setFilled(true);
  }, [me, filled, user]);

  if (!insideTelegram) return <OnlyTelegram />;

  if (error) {
    return (
      <Screen title={t('rdoc.regTitle')}>
        <ErrorState message={error} retryLabel={t('common.retry')} onRetry={reload} />
      </Screen>
    );
  }
  if (!me) {
    return (
      <Screen title={t('rdoc.regTitle')}>
        <SkeletonCard lines={6} />
      </Screen>
    );
  }

  const editing = me.doctor !== null;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const valid =
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.specialty.trim() &&
    form.workplace.trim() &&
    (editing || bachelor !== null);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const documents = editing
        ? []
        : [
            ...(bachelor ? [{ kind: 'bachelor' as const, name: bachelor.name, dataBase64: bachelor.dataBase64 }] : []),
            ...(master ? [{ kind: 'master' as const, name: master.name, dataBase64: master.dataBase64 }] : []),
          ];
      await api.doctorRegister({
        firstName: form.firstName,
        lastName: form.lastName,
        specialty: form.specialty,
        workplace: form.workplace,
        bio: form.bio.trim() || null,
        documents,
      });
      haptic.success();
      if (editing) toast(t('rdoc.saved'), 'success');
      // Kabinet holatni serverdan qayta oladi — eski holat bilan formaga qaytmaydi
      navigate('/doctor', { replace: true });
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!me.phoneVerified && !editing) {
    return (
      <Screen title={t('rdoc.regTitle')}>
        <EmptyState icon="📱" title={t('rdoc.phoneTitle')} text={t('rdoc.phoneText')} />
      </Screen>
    );
  }

  return (
    <Screen
      title={editing ? t('rdoc.editTitle') : t('rdoc.regTitle')}
      subtitle={editing ? undefined : t('rdoc.regSub')}
      onBack={editing ? () => navigate('/doctor') : undefined}
      footer={
        <Button block loading={busy} disabled={!valid} onClick={submit}>
          {editing ? t('rdoc.save') : t('rdoc.submit')}
        </Button>
      }
    >
      <div className="stack">
        <Field label={t('rdoc.firstName')}>
          <Input value={form.firstName} maxLength={80} onChange={set('firstName')} autoComplete="given-name" />
        </Field>
        <Field label={t('rdoc.lastName')}>
          <Input value={form.lastName} maxLength={80} onChange={set('lastName')} autoComplete="family-name" />
        </Field>
        <Field label={t('rdoc.specialty')} hint={t('rdoc.specialtyHint')}>
          <Input value={form.specialty} maxLength={120} onChange={set('specialty')} />
        </Field>
        <Field label={t('rdoc.workplace')} hint={t('rdoc.workplaceHint')}>
          <Input value={form.workplace} maxLength={200} onChange={set('workplace')} />
        </Field>
        <Field label={t('rdoc.bio')} hint={t('rdoc.bioHint')}>
          <Textarea rows={3} value={form.bio} maxLength={1500} onChange={set('bio')} />
        </Field>

        {!editing && (
          <>
            <Field label={t('rdoc.bachelor')} hint={t('rdoc.bachelorHint')}>
              <DocPicker file={bachelor} onPick={setBachelor} onError={(m) => toast(m, 'error')} />
            </Field>
            <Field label={t('rdoc.master')} hint={t('rdoc.masterHint')}>
              <DocPicker file={master} onPick={setMaster} onError={(m) => toast(m, 'error')} />
            </Field>
          </>
        )}
      </div>
    </Screen>
  );
}
