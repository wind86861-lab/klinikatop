/**
 * Tibbiy anketa — to'liq ixtiyoriy.
 *
 * Bemor uni to'ldirmasdan ham so'rov yubora oladi. To'ldirilgan bo'lsa
 * klinika aniqroq taklif beradi: surunkali kasallik ham tayyorgarlikka,
 * ham narxga ta'sir qiladi, allergiya esa dori tanlashga.
 *
 * Shuning uchun ekran "majburiy forma" emas, "xohlasangiz to'ldiring"
 * ohangida tuzilgan va istalgan paytda yopib ketish mumkin.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { Button, Card, Chip, Field, IconPlus, Input, Notice, Screen, Skeleton, Textarea } from '@/ui';
import { Async, useResource } from './clinic/shell';
import { BLOOD_TYPES, type MedicalProfile as Profile } from '@shared/types';

export function MedicalProfileScreen() {
  const { t, toast } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => api.medicalProfile());

  const [draft, setDraft] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);

  const dirty = Object.keys(draft).length > 0;
  const set = <K extends keyof Profile>(key: K, v: Profile[K]) => setDraft((d) => ({ ...d, [key]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const fresh = await api.saveMedicalProfile(draft);
      res.set(fresh);
      setDraft({});
      haptic.success();
      toast(t('med.saved'), 'success');
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      onBack={() => navigate('/profile')}
      title={t('med.title')}
      subtitle={t('med.sub')}
      footer={
        <Button block loading={saving} disabled={!dirty} onClick={save}>
          {t('common.save')}
        </Button>
      }
    >
      <Async resource={res} skeleton={<Skeleton h={340} />}>
        {(profile) => {
          const list = (key: keyof Profile) => (draft[key] ?? profile[key]) as string[];
          const num = (key: keyof Profile) =>
            (draft[key] !== undefined ? draft[key] : profile[key]) as number | null;

          return (
            <>
              <Notice tone="info">{t('med.why')}</Notice>

              <ListField
                label={t('med.chronic')}
                hint={t('med.chronicHint')}
                items={list('chronicConditions')}
                onChange={(v) => set('chronicConditions', v)}
                addLabel={t('med.add')}
                suggestions={['Qandli diabet', 'Gipertoniya', 'Astma', 'Yurak kasalligi']}
              />

              <ListField
                label={t('med.surgeries')}
                hint={t('med.surgeriesHint')}
                items={list('pastSurgeries')}
                onChange={(v) => set('pastSurgeries', v)}
                addLabel={t('med.add')}
              />

              <ListField
                label={t('med.allergies')}
                hint={t('med.allergiesHint')}
                items={list('allergies')}
                onChange={(v) => set('allergies', v)}
                addLabel={t('med.add')}
                suggestions={['Penitsillin', 'Yod', 'Novokain']}
              />

              <ListField
                label={t('med.medications')}
                hint={t('med.medicationsHint')}
                items={list('medications')}
                onChange={(v) => set('medications', v)}
                addLabel={t('med.add')}
              />

              <Card className="stack">
                <Field label={t('med.bloodType')}>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {BLOOD_TYPES.map((b) => (
                      <Chip
                        key={b}
                        size="sm"
                        active={(draft.bloodType ?? profile.bloodType) === b}
                        onClick={() => set('bloodType', (draft.bloodType ?? profile.bloodType) === b ? null : b)}
                      >
                        {b}
                      </Chip>
                    ))}
                  </div>
                </Field>

                <div className="row" style={{ gap: 'var(--s-2)' }}>
                  <Field label={t('med.height')}>
                    <Input
                      inputMode="numeric"
                      value={num('heightCm') ?? ''}
                      onChange={(e) =>
                        set('heightCm', e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null)
                      }
                    />
                  </Field>
                  <Field label={t('med.weight')}>
                    <Input
                      inputMode="numeric"
                      value={num('weightKg') ?? ''}
                      onChange={(e) =>
                        set('weightKg', e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null)
                      }
                    />
                  </Field>
                </div>
              </Card>

              <Field label={t('med.notes')} hint={t('med.notesHint')}>
                <Textarea
                  rows={4}
                  maxLength={2000}
                  value={(draft.notes ?? profile.notes) ?? ''}
                  onChange={(e) => set('notes', e.target.value || null)}
                />
              </Field>

              <Notice tone="warning">{t('med.privacy')}</Notice>
            </>
          );
        }}
      </Async>
    </Screen>
  );
}

/**
 * Erkin matnli ro'yxat.
 *
 * Tayyor variantlar taklif qilinadi, lekin majburlamaydi: tibbiyotda
 * ro'yxat hech qachon to'liq bo'lmaydi, shuning uchun o'z so'zi bilan
 * yozish imkoni har doim ochiq qoladi.
 */
function ListField({
  label,
  hint,
  items,
  onChange,
  addLabel,
  suggestions,
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
  suggestions?: string[];
}) {
  const unused = (suggestions ?? []).filter((s) => !items.includes(s));

  return (
    <Field label={label} hint={hint}>
      <div className="stack" style={{ gap: 6 }}>
        <AnimatePresence initial={false}>
          {items.map((item, i) => (
            <motion.div
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
                maxLength={200}
                onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
              />
              <button
                className="doc-row__remove"
                aria-label="×"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        {unused.length > 0 && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {unused.map((s) => (
              <Chip key={s} size="sm" onClick={() => onChange([...items, s])}>
                + {s}
              </Chip>
            ))}
          </div>
        )}

        <Button variant="ghost" size="sm" icon={<IconPlus size={14} />} onClick={() => onChange([...items, ''])}>
          {addLabel}
        </Button>
      </div>
    </Field>
  );
}
