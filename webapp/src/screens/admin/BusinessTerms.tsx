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
import { useMemo, useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { formatDate } from '@/lib/format';
import { cityName } from '@/i18n';
import {
  Button,
  Card,
  Chip,
  Field,
  IconShield,
  Input,
  Notice,
  Section,
  Segment,
  Sheet,
  Skeleton,
} from '@/ui';
import { Async, useResource } from '@/screens/clinic/shell';
import { DataTable, Empty, PageHeader, RowMenu, Tag } from './ui';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ADMIN_CLINIC_FILTERS,
  type AdminClinicFilter,
  type AdminClinicRow,
  type PlatformSettings,
} from '@shared/types';

/* ═════════════════  Klinikalar boshqaruvi  ═════════════════ */

export function AdminClinics() {
  const { t, lang, cities, toast, user } = useApp();
  const [filter, setFilter] = useState<AdminClinicFilter>('all');
  const res = useResource(() => api.adminClinics(filter), [filter]);

  const [editing, setEditing] = useState<AdminClinicRow | null>(null);
  const [mode, setMode] = useState<'commission' | 'trial'>('commission');

  const open = (clinic: AdminClinicRow, which: 'commission' | 'trial') => {
    setEditing(clinic);
    setMode(which);
    haptic.press();
  };

  /*
   * Obunani to'xtatish — server tomonida `requireRole('admin')`.
   * Shuning uchun tugma ham faqat adminga ko'rsatiladi: moderator
   * bosib, keyin 403 olishi kerak emas.
   */
  const isSuperAdmin = user?.roles.includes('admin') ?? false;

  const suspend = async (clinic: AdminClinicRow) => {
    try {
      await api.suspendClinic(clinic.id, 'Admin tomonidan to‘xtatildi');
      haptic.success();
      toast(t('ac.saved'), 'success');
      res.reload();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    }
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

  /*
   * Ustunlar komponentdan TASHQARIDA emas, ichida: ular `cities`, `t` va
   * `decide` ga tayanadi. `useMemo` bo'lmasa har chizishda jadval
   * ustunlarni yangi deb bilib holatini (saralash, sahifa) tashlab
   * yuboradi.
   */
  const columns = useMemo<ColumnDef<AdminClinicRow, any>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('ac.col.clinic'),
        cell: (c) => {
          const row = c.row.original;
          const city = cities.find((x) => x.id === row.cityId);
          return (
            <div>
              <div className="atable__name">{row.name}</div>
              <div className="atable__sub">{city ? cityName(city, lang) : '—'}</div>
            </div>
          );
        },
      },
      {
        accessorKey: 'verification',
        header: t('ac.col.status'),
        size: 130,
        cell: (c) => {
          const v = c.getValue() as AdminClinicRow['verification'];
          return (
            <Tag tone={v === 'approved' ? 'good' : v === 'rejected' ? 'bad' : 'warn'}>
              {t(`ver.status.${v}` as any)}
            </Tag>
          );
        },
      },
      {
        accessorKey: 'pendingDocuments',
        header: t('ac.col.docs'),
        size: 90,
        cell: (c) => {
          const n = c.getValue() as number;
          // Nol qiymat e'tiborni tortmasin — faqat ish borini ko'rsatamiz
          return n > 0 ? <Tag tone="warn">{n}</Tag> : <span className="muted">—</span>;
        },
      },
      {
        accessorKey: 'dealsCount',
        header: t('ac.col.deals'),
        size: 90,
        cell: (c) => <span className="num">{c.getValue() as number}</span>,
      },
      {
        accessorKey: 'offersCount',
        header: t('ac.col.offers'),
        size: 90,
        cell: (c) => <span className="num">{c.getValue() as number}</span>,
      },
      {
        accessorKey: 'effectiveCommissionPercent',
        header: t('ac.col.commission'),
        size: 120,
        cell: (c) => {
          const row = c.row.original;
          return (
            <span className="num">
              {row.effectiveCommissionPercent}%
              {row.commissionPercent != null && <span className="atable__sub"> {t('ac.commissionOwn')}</span>}
            </span>
          );
        },
      },
      {
        id: 'trial',
        header: t('ac.col.trial'),
        size: 130,
        accessorFn: (r) => r.trialUntil ?? '',
        cell: (c) => {
          const v = c.row.original.trialUntil;
          const on = v && new Date(v) > new Date();
          return on ? (
            <span className="tiny">{formatDate(v!, lang)}</span>
          ) : (
            <span className="muted">—</span>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 150,
        enableSorting: false,
        cell: (c) => {
          const row = c.row.original;
          return (
            /*
             * Jadvalda o'nlab qator bor: har birida to'ldirilgan yashil
             * tugma bo'lsa, ekran butunlay tugmaga aylanadi va nima
             * muhimligi bilinmay qoladi. Shuning uchun asosiy amal ham
             * ikkilamchi ko'rinishda — u baribir yagona yashil element.
             */
            <div className="arow-actions">
              {row.verification !== 'approved' && (
                <Button size="sm" variant="secondary" onClick={() => decide(row)}>
                  {t('ac.approve')}
                </Button>
              )}
              <RowMenu
                items={[
                  { label: t('ac.setCommission'), onClick: () => open(row, 'commission') },
                  { label: t('ac.grantTrial'), onClick: () => open(row, 'trial') },
                  ...(isSuperAdmin
                    ? [{ label: t('ac.suspend'), onClick: () => suspend(row), danger: true }]
                    : []),
                ]}
              />
            </div>
          );
        },
      },
    ],
    [cities, lang, t],
  );

  return (
    <div className="stack">
      <PageHeader
        title={t('admin.tabClinics')}
        description={t('ac.desc')}
        actions={
          <div className="row" style={{ gap: 6 }}>
            {ADMIN_CLINIC_FILTERS.map((f) => (
              <Chip key={f} size="sm" active={filter === f} onClick={() => setFilter(f)}>
                {t(`ac.filter.${f}` as any)}
              </Chip>
            ))}
          </div>
        }
      />

      <Async resource={res} skeleton={<Skeleton h={320} />}>
        {(list) => (
          <DataTable
            data={list}
            columns={columns}
            searchPlaceholder={t('ac.search')}
            empty={<Empty title={t('ac.empty')} />}
          />
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
    </div>
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
