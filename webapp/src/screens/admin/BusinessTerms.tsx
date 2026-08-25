/**
 * Admin: klinikalar boshqaruvi va platforma sozlamalari.
 *
 * Nima uchun kerak: komissiya foizi va sinov muddati bazada saqlanadi va
 * kod'siz o'zgartirilishi kerak edi — lekin ularni o'zgartiradigan ekran
 * yo'q edi. Birinchi klinikalarni qabul qilishda admin har safar
 * dasturchiga murojaat qilishi to'g'ri kelardi.
 *
 * Ikkita ekran bitta faylda, chunki ular bitta savolga xizmat qiladi:
 * platforma qaysi shartlar bilan ishlaydi va shu klinika uchun shartlar
 * qanday.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { popVariants, spring } from '@/lib/motion';
import { formatDate } from '@/lib/format';
import { cityName } from '@/i18n';
import {
  Button,
  Card,
  Chip,
  Field,
  IconCheck,
  IconShield,
  Input,
  Notice,
  Section,
  Segment,
  Sheet,
  Skeleton,
} from '@/ui';
import { Async, useResource } from '@/screens/clinic/shell';
import {
  ADMIN_CLINIC_FILTERS,
  type AdminClinicFilter,
  type AdminClinicRow,
  type PlatformSettings,
} from '@shared/types';

/* ═════════════════  Klinikalar boshqaruvi  ═════════════════ */

export function AdminClinics() {
  const { t, lang, cities, toast } = useApp();
  const [filter, setFilter] = useState<AdminClinicFilter>('all');
  const res = useResource(() => api.adminClinics(filter), [filter]);

  const [editing, setEditing] = useState<AdminClinicRow | null>(null);
  const [mode, setMode] = useState<'commission' | 'trial'>('commission');

  const open = (clinic: AdminClinicRow, which: 'commission' | 'trial') => {
    setEditing(clinic);
    setMode(which);
    haptic.press();
  };

  const decide = async (clinic: AdminClinicRow) => {
    try {
      await api.decideVerification(clinic.id, 'approved', null);
      haptic.success();
      toast(t('ac.saved'), 'success');
      res.reload();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  return (
    <>
      <div className="scroll-x">
        <div className="row" style={{ gap: 6 }}>
          {ADMIN_CLINIC_FILTERS.map((f) => (
            <Chip key={f} size="sm" active={filter === f} onClick={() => setFilter(f)}>
              {t(`ac.filter.${f}` as any)}
            </Chip>
          ))}
        </div>
      </div>

      <Async
        resource={res}
        skeleton={<Skeleton h={260} />}
        isEmpty={(d) => d.length === 0}
        empty={{ title: t('ac.empty') }}
      >
        {(list) => (
          <AnimatePresence initial={false}>
            {list.map((clinic) => {
              const city = cities.find((c) => c.id === clinic.cityId);
              const onTrial = clinic.trialUntil && new Date(clinic.trialUntil) > new Date();

              return (
                <motion.div key={clinic.id} layout variants={popVariants} initial="initial" animate="animate">
                  <Card className="stack" style={{ gap: 8 }}>
                    <div className="between">
                      <strong className="truncate">{clinic.name}</strong>
                      <span
                        className={`badge badge--${
                          clinic.verification === 'approved'
                            ? 'success'
                            : clinic.verification === 'rejected'
                              ? 'muted'
                              : 'accent'
                        }`}
                      >
                        {t(`ver.status.${clinic.verification}` as any)}
                      </span>
                    </div>

                    <span className="tiny">
                      {city ? cityName(city, lang) : '—'} ·{' '}
                      {t('ac.deals', { n: clinic.dealsCount, o: clinic.offersCount })}
                    </span>

                    {clinic.pendingDocuments > 0 && (
                      <Notice tone="warning">{t('ac.pendingDocs', { n: clinic.pendingDocuments })}</Notice>
                    )}

                    {/* Amaldagi shartlar — bir qarashda ko'rinadi */}
                    <div className="terms-row">
                      <span className="terms-row__label">{t('ac.commission')}</span>
                      <span className="terms-row__value num">
                        {clinic.effectiveCommissionPercent}%
                        <span className="tiny">
                          {' '}
                          {clinic.commissionPercent != null
                            ? `· ${t('ac.commissionOwn')}`
                            : `· ${t('ac.commissionPlatform')}`}
                        </span>
                      </span>
                    </div>

                    <div className="terms-row">
                      <span className="terms-row__label">{t('ac.trial')}</span>
                      <span className="terms-row__value">
                        {onTrial ? t('ac.trialUntil', { v: formatDate(clinic.trialUntil!, lang) }) : t('ac.noTrial')}
                      </span>
                    </div>

                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {clinic.verification !== 'approved' && (
                        <Button size="sm" icon={<IconCheck size={14} />} onClick={() => decide(clinic)}>
                          {t('ac.approve')}
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => open(clinic, 'commission')}>
                        {t('ac.setCommission')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => open(clinic, 'trial')}>
                        {t('ac.grantTrial')}
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </Async>

      <ClinicTermsSheet
        clinic={editing}
        mode={mode}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          toast(t('ac.saved'), 'success');
          res.reload();
        }}
      />
    </>
  );
}

function ClinicTermsSheet({
  clinic,
  mode,
  onClose,
  onSaved,
}: {
  clinic: AdminClinicRow | null;
  mode: 'commission' | 'trial';
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, toast } = useApp();
  const [percent, setPercent] = useState('');
  const [months, setMonths] = useState('6');
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState<number | null>(null);

  if (clinic && seeded !== clinic.id) {
    setSeeded(clinic.id);
    setPercent(clinic.commissionPercent != null ? String(clinic.commissionPercent) : '');
    setMonths('6');
  }

  const save = async () => {
    if (!clinic) return;
    setSaving(true);
    try {
      if (mode === 'commission') {
        // Bo'sh qiymat — umumiy foizga qaytarish
        await api.setClinicCommission(clinic.id, percent.trim() === '' ? null : Number(percent));
      } else {
        await api.grantTrial(clinic.id, Number(months));
      }
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
    <Sheet
      open={clinic !== null}
      onClose={onClose}
      title={mode === 'commission' ? t('ac.setCommission') : t('ac.grantTrial')}
    >
      <div className="stack">
        {clinic && <strong>{clinic.name}</strong>}

        {mode === 'commission' ? (
          <Field label={t('ps.commission')} hint={t('ac.percentHint')}>
            <Input
              inputMode="decimal"
              value={percent}
              placeholder="—"
              onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </Field>
        ) : (
          <Field label={t('ac.months')}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {['1', '3', '6', '12'].map((m) => (
                <Chip key={m} size="sm" active={months === m} onClick={() => setMonths(m)}>
                  {m}
                </Chip>
              ))}
            </div>
          </Field>
        )}

        <Button block loading={saving} onClick={save}>
          {t('common.save')}
        </Button>
      </div>
    </Sheet>
  );
}

/* ═════════════════  Platforma sozlamalari  ═════════════════ */

export function PlatformSettingsScreen() {
  const { t, toast } = useApp();
  const res = useResource(() => api.platformSettings());
  const [draft, setDraft] = useState<Partial<PlatformSettings>>({});
  const [saving, setSaving] = useState(false);

  const dirty = Object.keys(draft).length > 0;
  const set = <K extends keyof PlatformSettings>(key: K, v: number) =>
    setDraft((d) => ({ ...d, [key]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.savePlatformSettings(draft);
      res.set(next);
      setDraft({});
      haptic.success();
      toast(t('ps.saved'), 'success');
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Async resource={res} skeleton={<Skeleton h={280} />}>
      {(settings) => {
        const value = <K extends keyof PlatformSettings>(key: K) => draft[key] ?? settings[key];

        return (
          <>
            <Section title={t('ps.title')}>
              <p className="tiny">{t('ps.sub')}</p>
            </Section>

            <Card className="stack">
              <Field label={t('ps.commission')} hint={t('ps.commissionHint')}>
                <Input
                  inputMode="decimal"
                  value={String(value('commissionPercent'))}
                  onChange={(e) => set('commissionPercent', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                />
              </Field>

              <Field label={t('ps.trialMonths')} hint={t('ps.trialHint')}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {[0, 1, 3, 6, 12].map((m) => (
                    <Chip key={m} size="sm" active={value('trialMonths') === m} onClick={() => set('trialMonths', m)}>
                      {m}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label={t('ps.autoConfirm')} hint={t('ps.autoConfirmHint')}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {[7, 14, 21, 30].map((d) => (
                    <Chip
                      key={d}
                      size="sm"
                      active={value('autoConfirmDays') === d}
                      onClick={() => set('autoConfirmDays', d)}
                    >
                      {d}
                    </Chip>
                  ))}
                </div>
              </Field>
            </Card>

            {/*
              Eng muhim ogohlantirish: foiz bitim tuzilganda qotib qoladi.
              Admin buni bilmasa, o'zgartirgandan keyin eski bitimlar ham
              yangi foiz bo'yicha hisoblanadi deb o'ylashi mumkin.
            */}
            <Notice tone="warning">{t('ps.warn')}</Notice>

            <Button block loading={saving} disabled={!dirty} onClick={save}>
              {t('common.save')}
            </Button>
          </>
        );
      }}
    </Async>
  );
}

export { IconShield, Segment, spring };
