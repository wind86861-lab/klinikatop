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
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/store/app';
import { api, type ClinicDeletionImpact } from '@/lib/api';
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
  Select,
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
  type City,
  type PlatformSettings,
} from '@shared/types';

/* ═════════════════  Klinikalar boshqaruvi  ═════════════════ */

export function AdminClinics() {
  const { t, lang, cities, toast, user } = useApp();
  const [filter, setFilter] = useState<AdminClinicFilter>('all');
  const res = useResource(() => api.adminClinics(filter), [filter]);

  const [editing, setEditing] = useState<AdminClinicRow | null>(null);
  const [mode, setMode] = useState<ClinicSheetMode>('commission');

  const open = (clinic: AdminClinicRow, which: ClinicSheetMode) => {
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
                  { label: t('ac.edit'), onClick: () => open(row, 'edit') },
                  { label: t('ac.setCommission'), onClick: () => open(row, 'commission') },
                  { label: t('ac.grantTrial'), onClick: () => open(row, 'trial') },
                  /*
                   * Parol tiklash va o'chirish — serverda ham
                   * `requireRole('admin')`. Moderatorga ko'rsatib,
                   * keyin 403 berish aldash bo'lardi.
                   */
                  ...(isSuperAdmin
                    ? [
                        { label: t('ac.resetPassword'), onClick: () => open(row, 'password') },
                        { label: t('ac.suspend'), onClick: () => suspend(row), danger: true },
                        { label: t('ac.delete'), onClick: () => open(row, 'delete'), danger: true },
                      ]
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
        cities={cities}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          toast(message ?? t('ac.saved'), 'success');
          res.reload();
        }}
      />
    </div>
  );
}

/**
 * Klinika ustidagi amallar — bitta varaq, beshta rejim.
 *
 * Nima uchun bitta: hammasi bir xil shaklda (klinika → maydon →
 * tasdiqlash) va beshta alohida komponent bir xil ochish/yopish
 * mantig'ini besh marta takrorlardi.
 */
type ClinicSheetMode = 'commission' | 'trial' | 'edit' | 'password' | 'delete';

function ClinicTermsSheet({
  clinic,
  mode,
  cities,
  onClose,
  onSaved,
}: {
  clinic: AdminClinicRow | null;
  mode: ClinicSheetMode;
  cities: City[];
  onClose: () => void;
  onSaved: (message?: string) => void;
}) {
  const { t, lang, toast } = useApp();
  const [percent, setPercent] = useState('');
  const [months, setMonths] = useState('6');
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  /* Tahrir maydonlari */
  const [form, setForm] = useState({ name: '', cityId: 0, phone: '', address: '', website: '' });

  /* Parol havolasi — faqat javob kelgach paydo bo'ladi */
  const [link, setLink] = useState<{ phone: string; fullName: string; url: string } | null>(null);

  /* O'chirish: nima yo'qolishi va tasdiq matni */
  const [impact, setImpact] = useState<ClinicDeletionImpact | null>(null);
  const [confirmName, setConfirmName] = useState('');

  /*
   * Varaq boshqa klinika yoki boshqa rejim uchun ochilganda
   * maydonlar YANGILANADI. Kalit ikkovidan yasaladi: bir xil
   * klinikada rejim almashsa ham qayta to'ldirilishi kerak.
   */
  const key = clinic ? `${clinic.id}:${mode}` : null;
  if (key && seeded !== key) {
    setSeeded(key);
    setPercent(clinic!.commissionPercent != null ? String(clinic!.commissionPercent) : '');
    setMonths('6');
    setForm({
      name: clinic!.name,
      cityId: clinic!.cityId,
      phone: clinic!.phone ?? '',
      address: clinic!.address ?? '',
      website: clinic!.website ?? '',
    });
    setLink(null);
    setImpact(null);
    setConfirmName('');
  }

  /*
   * O'chirish oynasi ochilganda yo'qoladigan narsalar sanaladi.
   * Ro'yxatdagi `dealsCount` ga ishonib bo'lmaydi: u faqat yakunlangan
   * bitimlarni sanaydi va yozishmalarni umuman bilmaydi.
   */
  useEffect(() => {
    if (!clinic || mode !== 'delete') return;
    let alive = true;
    void api
      .clinicDeletionImpact(clinic.id)
      .then((x) => alive && setImpact(x))
      .catch(() => alive && setImpact(null));
    return () => {
      alive = false;
    };
  }, [clinic, mode]);

  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    try {
      await fn();
      haptic.success();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const save = () =>
    run(async () => {
      if (!clinic) return;

      if (mode === 'commission') {
        // Bo'sh qiymat — umumiy foizga qaytarish
        await api.setClinicCommission(clinic.id, percent.trim() === '' ? null : Number(percent));
        onSaved();
        return;
      }

      if (mode === 'trial') {
        await api.grantTrial(clinic.id, Number(months));
        onSaved();
        return;
      }

      if (mode === 'edit') {
        await api.updateClinicByAdmin(clinic.id, {
          name: form.name.trim(),
          cityId: form.cityId,
          phone: form.phone.trim() || null,
          address: form.address.trim(),
          website: form.website.trim() || null,
        });
        onSaved();
      }
    });

  const resetPassword = () =>
    run(async () => {
      if (!clinic) return;
      const result = await api.resetClinicPassword(clinic.id);
      /*
       * Havola SHU YERDA yasaladi va faqat ekranda turadi: token
       * parolga teng sir, shuning uchun u jurnalga ham, boshqa
       * hech qayerga ham yozilmaydi.
       */
      setLink({
        phone: result.phone,
        fullName: result.fullName,
        url: `${window.location.origin}/kabinet/parol?token=${result.setupToken}`,
      });
    });

  const remove = () =>
    run(async () => {
      if (!clinic) return;
      await api.deleteClinic(clinic.id, !impact?.empty);
      onSaved(t('ac.deleted'));
    });

  const title =
    mode === 'commission'
      ? t('ac.setCommission')
      : mode === 'trial'
        ? t('ac.grantTrial')
        : mode === 'edit'
          ? t('ac.edit')
          : mode === 'password'
            ? t('ac.resetPassword')
            : t('ac.delete');

  /* O'chirishni tasdiqlash: nomni aynan yozish kerak */
  const confirmed = confirmName.trim().toLowerCase() === (clinic?.name ?? '').trim().toLowerCase();

  return (
    <Sheet open={clinic !== null} onClose={onClose} title={title}>
      <div className="stack">
        {/*
          Qaysi klinika ustida ish ketayotgani. Sarlavha amalni
          aytadi ("Tahrirlash"), bu qator esa kimga tegishli ekanini —
          o'nlab qatorli jadvaldan kelganda bu chalkashmaslik uchun
          kerak.
        */}
        {clinic && (
          <div className="sheet-subject">
            <strong>{clinic.name}</strong>
            <span className="tiny">
              {cities.find((c) => c.id === clinic.cityId)
                ? cityName(cities.find((c) => c.id === clinic.cityId)!, lang)
                : '—'}
            </span>
          </div>
        )}

        {mode === 'commission' && (
          <Field label={t('ps.commission')} hint={t('ac.percentHint')}>
            <Input
              inputMode="decimal"
              value={percent}
              placeholder="—"
              onChange={(e) => setPercent(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </Field>
        )}

        {mode === 'trial' && (
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

        {mode === 'edit' && (
          <>
            <Field label={t('ac.fieldName')}>
              <Input value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="form-pair">
              <Field label={t('ac.fieldCity')} hint={t('ac.cityHint')}>
                <Select
                  value={String(form.cityId)}
                  onChange={(e) => setForm({ ...form, cityId: Number(e.target.value) })}
                >
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {cityName(c, lang)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('ac.fieldPhone')}>
                <Input
                  value={form.phone}
                  inputMode="tel"
                  placeholder="998 90 123 45 67"
                  maxLength={40}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
            </div>
            <Field label={t('ac.fieldAddress')}>
              <Input
                value={form.address}
                maxLength={300}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <Field label={t('ac.fieldWebsite')}>
              <Input
                value={form.website}
                placeholder="klinika.uz"
                maxLength={200}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
            </Field>
          </>
        )}

        {mode === 'password' &&
          (link ? (
            <>
              <Notice tone="warning">{t('ac.linkOnce')}</Notice>
              <Field label={t('ac.linkFor')}>
                <Input readOnly value={`${link.fullName} · ${link.phone}`} />
              </Field>
              <Field label={t('ac.linkField')}>
                <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
              </Field>
              <Button
                variant="secondary"
                block
                onClick={() => {
                  void navigator.clipboard?.writeText(link.url);
                  toast(t('ac.linkCopied'), 'success');
                }}
              >
                {t('ac.linkCopy')}
              </Button>
            </>
          ) : (
            <>
              <Notice tone="info">{t('ac.resetExplain')}</Notice>
              <Button block loading={saving} onClick={resetPassword}>
                {t('ac.resetConfirm')}
              </Button>
            </>
          ))}

        {mode === 'delete' && (
          <>
            {impact === null ? (
              <Skeleton h={120} />
            ) : impact.empty ? (
              <Notice tone="info">{t('ac.deleteEmpty')}</Notice>
            ) : (
              <>
                {/*
                  Sonlar ATAYLAB ro'yxat bo'lib chiqadi: "tarixi bor"
                  degan umumiy gap odamni to'xtatmaydi, "6 bitim, 15
                  taklif, 43 yozishma" esa to'xtatadi.
                */}
                <Notice tone="danger">{t('ac.deleteWarn')}</Notice>
                <div className="stack stack--tight">
                  {(
                    [
                      ['ac.impact.deals', impact.deals],
                      ['ac.impact.offers', impact.offers],
                      ['ac.impact.reviews', impact.reviews],
                      ['ac.impact.messages', impact.messages],
                      ['ac.impact.payments', impact.payments],
                      ['ac.impact.accounts', impact.accounts],
                    ] as [string, number][]
                  )
                    .filter(([, n]) => n > 0)
                    .map(([label, n]) => (
                      <div key={label} className="between">
                        <span>{t(label as any)}</span>
                        <strong className="num">{n}</strong>
                      </div>
                    ))}
                </div>
                <Field label={t('ac.deleteType')} hint={clinic?.name}>
                  <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
                </Field>
              </>
            )}

            <Button
              block
              variant="danger"
              loading={saving}
              disabled={impact === null || (!impact.empty && !confirmed)}
              onClick={remove}
            >
              {t('ac.delete')}
            </Button>
          </>
        )}

        {(mode === 'commission' || mode === 'trial' || mode === 'edit') && (
          /*
           * "Bekor qilish" ham bor: ish stolida varaqni yopish uchun
           * tashqariga bosish yoki Escape kerak edi — ikkalasi ham
           * ko'rinmaydigan bilim.
           */
          <div className="sheet-actions">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button loading={saving} onClick={save}>
              {t('common.save')}
            </Button>
          </div>
        )}
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
