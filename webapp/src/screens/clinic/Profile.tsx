/**
 * Obro' va jamoa — kabinetning 18, 19, 20 va 21-ekranlari.
 *
 *   ClinicProfile  — bemor taklifni ko'rganda o'qiydigan ma'lumot
 *   Doctors        — kim operatsiya qiladi
 *   ClinicReviews  — sharhlar va ularga javob
 *   Team           — kim klinika nomidan ishlay oladi
 */
import { useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api, clinicApi, type ClinicProfileBody } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { popVariants, spring } from '@/lib/motion';
import { formatDate } from '@/lib/format';
import { opName } from '@/i18n';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Field,
  IconCheck,
  IconPlus,
  Input,
  Notice,
  Screen,
  Section,
  Segment,
  Sheet,
  Skeleton,
  Stars,
  Textarea,
} from '@/ui';
import { FileThumb } from '@/components/wizard/FileThumb';
import { FilePickerButton, uploadAsBase64 } from './Verification';
import { Async, StatTile, useResource } from './shell';
import type { Doctor, Operation, OperatorRole, Review } from '@shared/types';

/* ═════════════════  18-ekran: klinika profili  ═════════════════ */

export function ClinicProfile() {
  const { t, toast } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => api.clinic());

  /**
   * Forma serverdan kelgan qiymatlar ustida ishlaydi: `draft` faqat
   * O'ZGARTIRILGAN maydonlarni saqlaydi. Shuning uchun boshqa qurilmada
   * qilingan o'zgarish qayta yuklashda yo'qolmaydi.
   */
  const [draft, setDraft] = useState<Partial<ClinicProfileBody>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const dirty = Object.keys(draft).length > 0;
  const set = <K extends keyof ClinicProfileBody>(key: K, v: ClinicProfileBody[K]) =>
    setDraft((d) => ({ ...d, [key]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api.updateClinic(draft);
      haptic.success();
      toast(t('cp.saved'), 'success');
      setDraft({});
      res.reload();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const addPhoto = async (file: File, current: string[]) => {
    setUploading(true);
    try {
      const stored = await uploadAsBase64(file);
      set('photos', [...current, stored.id]);
      haptic.success();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Screen
      onBack={() => navigate('/clinic/more')}
      title={t('cp.title')}
      subtitle={t('cp.sub')}
      footer={
        <Button block loading={saving} disabled={!dirty} onClick={save}>
          {t('common.save')}
        </Button>
      }
    >
      <Async resource={res} skeleton={<Skeleton h={320} />}>
        {({ clinic }) => {
          const photos = draft.photos ?? clinic.photos;
          const equipment = draft.equipment ?? clinic.equipment;
          const str = <K extends keyof ClinicProfileBody>(key: K, fallback: string) =>
            (draft[key] as string | null | undefined) ?? fallback;

          return (
            <>
              <div className="tile-grid">
                <StatTile label={t('rv.avg')} value={clinic.ratingAvg.toFixed(1)} hint={t('rv.count', { n: clinic.ratingCount })} />
                <StatTile label={t('home.deals')} value={clinic.dealsCount} />
              </div>

              <Field label={t('cp.name')}>
                <Input value={str('name', clinic.name)} maxLength={200} onChange={(e) => set('name', e.target.value)} />
              </Field>

              <Field label={t('cp.address')}>
                <Input value={str('address', clinic.address)} maxLength={300} onChange={(e) => set('address', e.target.value)} />
              </Field>

              <Field label={t('cp.phone')} hint={t('cp.phoneHint')}>
                <Input
                  type="tel"
                  value={str('phone', clinic.phone ?? '')}
                  maxLength={40}
                  placeholder="+998 __ ___ __ __"
                  onChange={(e) => set('phone', e.target.value || null)}
                />
              </Field>

              <Field label={t('cp.website')}>
                <Input
                  type="url"
                  value={str('website', clinic.website ?? '')}
                  maxLength={200}
                  onChange={(e) => set('website', e.target.value || null)}
                />
              </Field>

              <Field label={t('cp.workHours')}>
                <Input
                  value={str('workHours', clinic.workHours ?? '')}
                  maxLength={120}
                  placeholder="09:00 – 18:00"
                  onChange={(e) => set('workHours', e.target.value || null)}
                />
              </Field>

              <div className="row" style={{ gap: 'var(--s-2)' }}>
                <Field label={t('cp.beds')}>
                  <Input
                    inputMode="numeric"
                    value={draft.beds !== undefined ? (draft.beds ?? '') : (clinic.beds ?? '')}
                    onChange={(e) => set('beds', e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null)}
                  />
                </Field>
                <Field label={t('cp.founded')}>
                  <Input
                    inputMode="numeric"
                    maxLength={4}
                    value={draft.foundedYear !== undefined ? (draft.foundedYear ?? '') : (clinic.foundedYear ?? '')}
                    onChange={(e) => set('foundedYear', e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null)}
                  />
                </Field>
              </div>

              <Field label={t('cp.about')}>
                <Textarea
                  rows={5}
                  value={str('about', clinic.about)}
                  maxLength={1500}
                  onChange={(e) => set('about', e.target.value)}
                />
              </Field>

              {/* Jihozlar — har biri alohida qator */}
              <Field label={t('cp.equipment')} hint={t('cp.equipmentHint')}>
                <div className="stack" style={{ gap: 6 }}>
                  <AnimatePresence initial={false}>
                    {equipment.map((item, i) => (
                      <m.div
                        key={i}
                        layout
                        className="row"
                        style={{ gap: 6 }}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={spring}
                      >
                        <Input
                          value={item}
                          maxLength={120}
                          onChange={(e) => set('equipment', equipment.map((v, j) => (j === i ? e.target.value : v)))}
                        />
                        <button
                          className="doc-row__remove"
                          aria-label={t('common.cancel')}
                          onClick={() => set('equipment', equipment.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      </m.div>
                    ))}
                  </AnimatePresence>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<IconPlus size={14} />}
                    onClick={() => set('equipment', [...equipment, ''])}
                  >
                    {t('ob.addLine')}
                  </Button>
                </div>
              </Field>

              {/* Suratlar */}
              <Field label={t('cp.photos')} hint={t('cp.photosHint')}>
                <div className="stack" style={{ gap: 8 }}>
                  {photos.length > 0 && (
                    <div className="photo-grid">
                      <AnimatePresence initial={false}>
                        {photos.map((fileId) => (
                          <m.div
                            key={fileId}
                            layout
                            className="photo-tile"
                            initial={{ opacity: 0, scale: 0.94 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={spring}
                          >
                            <PhotoPreview fileId={fileId} />
                            <button
                              className="photo-tile__remove"
                              aria-label={t('cp.removePhoto')}
                              onClick={() => set('photos', photos.filter((id) => id !== fileId))}
                            >
                              ×
                            </button>
                          </m.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}

                  <FilePickerButton
                    label={uploading ? t('wz.docs.uploading') : t('cp.addPhoto')}
                    accept="image/*"
                    disabled={uploading || photos.length >= 12}
                    onPick={(file) => addPhoto(file, photos)}
                  />
                </div>
              </Field>

              <Notice tone="info">{t('ver.sub')}</Notice>
            </>
          );
        }}
      </Async>
    </Screen>
  );
}

/** Yuklangan surat — himoyalangan fayl, blob orqali ko'rsatiladi. */
function PhotoPreview({ fileId }: { fileId: string }) {
  return (
    <FileThumb
      file={{ id: fileId, name: '', mimeType: 'image/jpeg', sizeBytes: 0, kind: 'other', label: null, createdAt: '' }}
    />
  );
}

/* ═════════════════  19-ekran: shifokorlar  ═════════════════ */

export function Doctors() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => clinicApi.doctors());
  const opsRes = useResource(() => api.operations({}));
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null);

  const remove = async (id: number) => {
    if (!confirm(t('doc.deleteConfirm'))) return;
    try {
      await clinicApi.deleteDoctor(id);
      haptic.tap();
      toast(t('doc.deleted'), 'success');
      res.reload();
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  return (
    <Screen
      onBack={() => navigate('/clinic/more')}
      title={t('doc.title')}
      subtitle={t('doc.sub')}
      footer={
        <Button block icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
          {t('doc.new')}
        </Button>
      }
    >
      <Async
        resource={res}
        isEmpty={(d) => d.length === 0}
        empty={{ title: t('doc.empty'), text: t('doc.emptyText') }}
      >
        {(list) => (
          <AnimatePresence initial={false}>
            {list.map((doctor) => (
              <m.div key={doctor.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={spring}>
                <Card className="stack" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 12 }}>
                    {doctor.photoFileId ? (
                      <div className="photo-tile photo-tile--sm">
                        <FileThumb
                          file={{ id: doctor.photoFileId, name: '', mimeType: 'image/jpeg', sizeBytes: 0, kind: 'other', label: null, createdAt: '' }}
                        />
                      </div>
                    ) : (
                      <Avatar name={doctor.fullName} />
                    )}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong className="truncate">{doctor.fullName}</strong>
                      <span className="tiny" style={{ display: 'block' }}>
                        {doctor.specialty}
                        {doctor.experienceYears != null && ` · ${t('doc.years', { n: doctor.experienceYears })}`}
                      </span>
                    </span>
                    {!doctor.active && <span className="badge badge--muted">{t('doc.inactive')}</span>}
                  </div>

                  {doctor.bio && <p className="tiny clamp-2">{doctor.bio}</p>}

                  {doctor.operationIds.length > 0 && (
                    <span className="tiny">
                      {doctor.operationIds
                        .map((id) => opsRes.data?.find((o: Operation) => o.id === id))
                        .filter(Boolean)
                        .slice(0, 3)
                        .map((op) => opName(op as Operation, lang))
                        .join(' · ')}
                    </span>
                  )}

                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(doctor)}>
                      {t('common.edit')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(doctor.id)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </Card>
              </m.div>
            ))}
          </AnimatePresence>
        )}
      </Async>

      <DoctorSheet
        editing={editing}
        operations={opsRes.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          toast(t('doc.saved'), 'success');
          res.reload();
        }}
      />
    </Screen>
  );
}

function DoctorSheet({
  editing,
  operations,
  onClose,
  onSaved,
}: {
  editing: Doctor | 'new' | null;
  operations: Operation[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang, toast } = useApp();
  const doctor = editing === 'new' || editing === null ? null : editing;

  const [fullName, setFullName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [years, setYears] = useState('');
  const [bio, setBio] = useState('');
  const [ops, setOps] = useState<number[]>([]);
  const [active, setActive] = useState(true);
  const [photoFileId, setPhotoFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState<number | 'new' | null>(null);

  const key = editing === 'new' ? 'new' : (doctor?.id ?? null);
  if (editing !== null && seeded !== key) {
    setSeeded(key);
    setFullName(doctor?.fullName ?? '');
    setSpecialty(doctor?.specialty ?? '');
    setYears(doctor?.experienceYears != null ? String(doctor.experienceYears) : '');
    setBio(doctor?.bio ?? '');
    setOps(doctor?.operationIds ?? []);
    setActive(doctor?.active ?? true);
    setPhotoFileId(doctor?.photoFileId ?? null);
  }

  const save = async () => {
    setSaving(true);
    const body = {
      fullName: fullName.trim(),
      specialty: specialty.trim(),
      experienceYears: years ? Number(years) : null,
      photoFileId,
      bio: bio.trim() || null,
      operationIds: ops,
      active,
    };
    try {
      if (doctor) await clinicApi.updateDoctor(doctor.id, body);
      else await clinicApi.createDoctor(body);
      haptic.success();
      onSaved();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={editing !== null} onClose={onClose} title={doctor ? t('common.edit') : t('doc.new')}>
      <div className="stack">
        <Field label={t('doc.photo')}>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            {photoFileId ? (
              <div className="photo-tile photo-tile--sm">
                <FileThumb
                  file={{ id: photoFileId, name: '', mimeType: 'image/jpeg', sizeBytes: 0, kind: 'other', label: null, createdAt: '' }}
                />
                <button className="photo-tile__remove" aria-label={t('cp.removePhoto')} onClick={() => setPhotoFileId(null)}>
                  ×
                </button>
              </div>
            ) : (
              <Avatar name={fullName || '—'} />
            )}
            <span style={{ flex: 1 }}>
              <FilePickerButton
                label={uploading ? t('wz.docs.uploading') : t('doc.addPhoto')}
                accept="image/*"
                disabled={uploading}
                onPick={async (file) => {
                  setUploading(true);
                  try {
                    const stored = await uploadAsBase64(file);
                    setPhotoFileId(stored.id);
                    haptic.success();
                  } catch (err: any) {
                    haptic.error();
                    toast(err?.message ?? t('common.error'), 'error');
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </span>
          </div>
        </Field>

        <Field label={t('doc.fullName')}>
          <Input value={fullName} maxLength={160} onChange={(e) => setFullName(e.target.value)} />
        </Field>

        <Field label={t('doc.specialty')}>
          <Input value={specialty} maxLength={120} onChange={(e) => setSpecialty(e.target.value)} />
        </Field>

        <Field label={t('doc.experience')}>
          <Input inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value.replace(/\D/g, ''))} />
        </Field>

        <Field label={t('doc.bio')}>
          <Textarea rows={3} value={bio} maxLength={1000} onChange={(e) => setBio(e.target.value)} />
        </Field>

        <Field label={t('doc.operations')}>
          <div className="scroll-x">
            <div className="row" style={{ gap: 6 }}>
              {operations
                .filter((o) => o.slug !== 'unknown')
                .slice(0, 30)
                .map((op) => (
                  <Chip
                    key={op.id}
                    size="sm"
                    active={ops.includes(op.id)}
                    onClick={() => setOps((prev) => (prev.includes(op.id) ? prev.filter((x) => x !== op.id) : [...prev, op.id]))}
                  >
                    {ops.includes(op.id) && <IconCheck size={11} />} {opName(op, lang)}
                  </Chip>
                ))}
            </div>
          </div>
        </Field>

        <label className="toggle-row">
          <span className="toggle-row__text">
            <span className="toggle-row__title">{t('doc.active')}</span>
          </span>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        </label>

        <Button block loading={saving} disabled={fullName.trim().length < 3} onClick={save}>
          {t('common.save')}
        </Button>
      </div>
    </Sheet>
  );
}

/* ═════════════════  20-ekran: sharhlar  ═════════════════ */

export function ClinicReviews() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => api.clinicReviews());

  const [replyTo, setReplyTo] = useState<Review | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!replyTo) return;
    setSending(true);
    try {
      const fresh = await clinicApi.replyReview(replyTo.id, body.trim());
      res.set(fresh);
      haptic.success();
      toast(t('rv.replied'), 'success');
      setReplyTo(null);
      setBody('');
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen onBack={() => navigate('/clinic/more')} title={t('rv.title')} subtitle={t('rv.sub')}>
      <Async
        resource={res}
        isEmpty={(d) => d.length === 0}
        empty={{ title: t('rv.empty'), text: t('rv.emptyText') }}
      >
        {(list) => (
          <AnimatePresence initial={false}>
            {list.map((review) => (
              <m.div key={review.id} layout variants={popVariants} initial="initial" animate="animate">
                <Card className="stack" style={{ gap: 8 }}>
                  <div className="between">
                    <span className="row" style={{ gap: 8 }}>
                      <Avatar name={review.patientName} size="sm" />
                      <strong>{review.patientName}</strong>
                    </span>
                    <Stars value={review.average} readOnly />
                  </div>

                  {review.body && <p className="tiny">{review.body}</p>}
                  <span className="tiny">{formatDate(review.createdAt, lang)}</span>

                  {review.reply ? (
                    <div className="review-reply">
                      <span className="review-reply__label">{t('rv.yourReply')}</span>
                      <p className="tiny">{review.reply.body}</p>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setReplyTo(review);
                        setBody('');
                      }}
                    >
                      {t('rv.reply')}
                    </Button>
                  )}
                </Card>
              </m.div>
            ))}
          </AnimatePresence>
        )}
      </Async>

      <Sheet open={replyTo !== null} onClose={() => setReplyTo(null)} title={t('rv.reply')}>
        <div className="stack">
          <Textarea
            rows={4}
            value={body}
            placeholder={t('rv.replyPh')}
            maxLength={1000}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button block loading={sending} disabled={body.trim().length < 5} onClick={send}>
            {t('common.send')}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}

/* ═════════════════  21-ekran: jamoa  ═════════════════ */

export function Team() {
  const { t, lang, user, toast } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => clinicApi.operators());

  /*
   * Xodim qo'shish — unga ish hisobi ochiladi.
   *
   * Ilgari bu taklifnoma kodi berardi va xodim uni Telegramda kiritardi.
   * Endi xodimning kabineti ham, kirishi ham veb: unga email va parol
   * o'rnatish havolasi beriladi. Havola bir marta ko'rsatiladi.
   */
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<OperatorRole>('clinic_operator');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  const addOperator = async () => {
    setBusy(true);
    try {
      const created = await clinicApi.addOperator({
        phone: phone.trim(),
        email: email.trim() || null,
        fullName: fullName.trim(),
        role,
      });
      haptic.success();
      setAdding(false);
      setPhone('');
      setEmail('');
      setFullName('');
      setIssued(`${window.location.origin}/kabinet/parol?token=${created.setupToken}`);
      res.reload();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: number) => {
    if (!confirm(t('team.removeConfirm'))) return;
    try {
      await clinicApi.removeOperator(userId);
      haptic.tap();
      toast(t('team.removed'), 'success');
      res.reload();
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      haptic.success();
      toast(t('team.copied'), 'success');
    } catch {
      /* clipboard yopiq bo'lsa kod baribir ekranda ko'rinib turadi */
    }
  };

  return (
    <Screen
      onBack={() => navigate('/clinic/more')}
      title={t('team.title')}
      subtitle={t('team.sub')}
      footer={
        <Button block icon={<IconPlus size={16} />} onClick={() => setAdding(true)}>
          {t('team.invite')}
        </Button>
      }
    >
      <Async resource={res} skeleton={<Skeleton h={240} />}>
        {(data) => (
          <>
            <Section title={t('team.title')}>
              {data.operators.map((operator) => (
                <Card key={operator.userId} className="stack" style={{ gap: 6 }}>
                  <div className="row" style={{ gap: 12 }}>
                    <Avatar name={operator.firstName} size="sm" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong className="truncate">
                        {operator.firstName} {operator.lastName ?? ''}
                        {operator.userId === user?.id && <span className="tiny"> · {t('team.you')}</span>}
                      </strong>
                      <span className="tiny" style={{ display: 'block' }}>
                        {t(`team.role.${operator.role}` as any)} ·{' '}
                        {operator.lastSeenAt
                          ? t('team.lastSeen', { v: formatDate(operator.lastSeenAt, lang) })
                          : t('team.never')}
                      </span>
                    </span>
                  </div>

                  <span className="tiny">{t(`team.roleHint.${operator.role}` as any)}</span>

                  {operator.userId !== user?.id && (
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          clinicApi
                            .setOperatorRole(
                              operator.userId,
                              operator.role === 'clinic_admin' ? 'clinic_operator' : 'clinic_admin',
                            )
                            .then(res.reload)
                            .catch((e) => toast(e?.message ?? t('common.error'), 'error'))
                        }
                      >
                        {t(`team.role.${operator.role === 'clinic_admin' ? 'clinic_operator' : 'clinic_admin'}` as any)}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(operator.userId)}>
                        {t('team.remove')}
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </Section>

          </>
        )}
      </Async>

      <Sheet open={adding} onClose={() => setAdding(false)} title={t('team.invite')}>
        <div className="stack">
          <Field label={t('team.fullName')}>
            <Input value={fullName} maxLength={160} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label={t('team.phone')} hint={t('team.phoneHint')}>
            <Input
              type="tel"
              inputMode="tel"
              placeholder="+998 __ ___ __ __"
              value={phone}
              maxLength={32}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label="Email · ixtiyoriy">
            <Input type="email" value={email} maxLength={160} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Segment
            value={role}
            onChange={(v) => setRole(v as OperatorRole)}
            options={[
              { value: 'clinic_operator', label: t('team.role.clinic_operator') },
              { value: 'clinic_admin', label: t('team.role.clinic_admin') },
            ]}
          />
          <Button
            block
            loading={busy}
            disabled={fullName.trim().length < 2 || phone.replace(/\D/g, '').length < 9}
            onClick={addOperator}
          >
            {t('team.invite')}
          </Button>
        </div>
      </Sheet>

      {/* Havola bir marta ko'rsatiladi — qayta ochib bo'lmaydi */}
      <Sheet open={issued !== null} onClose={() => setIssued(null)} title={t('team.inviteCode')}>
        <div className="stack">
          <Notice tone="warning">{t('team.inviteHint')}</Notice>
          <Card>
            <code className="setup-link">{issued}</code>
          </Card>
          <Button block onClick={() => issued && copy(issued)}>
            {t('team.copy')}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}
