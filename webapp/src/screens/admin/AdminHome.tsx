/**
 * Super-admin paneli.
 *
 * Ilgari ikki daraja bor edi — moderator va admin. Amalda bu faqat
 * chalkashlik keltirardi: ikkovi bir xil ekranlarni ko'rardi va farqni
 * eslab qolish uchun sabab yo'q edi. Endi bitta daraja.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/store/app';
import { api, clinicApi } from '@/lib/api';
import { formatDate, groupDigits, money } from '@/lib/format';
import { haptic } from '@/lib/telegram';
import {
  AnimatedItem,
  AnimatedList,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  IconCheck,
  IconInfo,
  IconSparkle,
  IconWallet,
  IconStethoscope,
  IconChart,
  IconClinic,
  IconAlert,
  IconInbox,
  IconShield,
  Input,
  Notice,
  Section,
  Sheet,
  Skeleton,
  SkeletonList,
  Textarea,
} from '@/ui';
import { FileThumb } from '@/components/wizard/FileThumb';
import { AdminShell, type AdminSection } from './AdminShell';
import { Applications } from './Applications';
import { CatalogSync } from './CatalogSync';
import { RequestStepsScreen } from './RequestSteps';
import { CommissionPayments } from './CommissionPayments';
import { AdminUsers } from './Users';
import { Empty, Kpi, PageHeader } from './ui';
import { Security } from '../web/Security';
import { AdminClinics, PlatformSettingsScreen } from './BusinessTerms';
import type { AdminMetrics, ChatMessage, Clinic, ClinicDocument, Deal, DealDetail } from '@shared/types';

type Tab =
  | 'applications'
  | 'verifications'
  | 'clinics'
  | 'disputes'
  | 'metrics'
  | 'catalog'
  | 'settings'
  | 'security';

export function AdminHome() {
  const { t, toast, user } = useApp();
  const who = user?.firstName ?? 'Administrator';

  const [tab, setTab] = useState<Tab>('applications');
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [pending, setPending] = useState<Clinic[] | null>(null);
  const [disputes, setDisputes] = useState<Deal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState<Clinic | null>(null);
  const [reviewing, setReviewing] = useState<{ deal: DealDetail; messages: ChatMessage[] } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, v, d] = await Promise.all([api.metrics(), api.verifications(), api.disputes()]);
      setMetrics(m);
      setPending(v);
      setDisputes(d);
    } catch (err: any) {
      setError(err?.message ?? t('common.error'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (clinic: Clinic, status: 'approved' | 'rejected', note: string | null) => {
    try {
      await api.decideVerification(clinic.id, status, note);
      haptic.success();
      setRejecting(null);
      await load();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  const openDispute = async (dealId: number) => {
    try {
      const data = await api.dispute(dealId);
      setReviewing(data);
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  const resolve = async (dealId: number, resolution: 'confirm' | 'cancel', amount: number | null, note: string) => {
    try {
      await api.resolveDispute(dealId, resolution, amount, note);
      haptic.success();
      setReviewing(null);
      await load();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  if (error) {
    return (
      <div className="admin admin--bare">
        <ErrorState message={error} retryLabel={t('common.retry')} onRetry={load} />
      </div>
    );
  }

  /*
   * Bo'limlar yon panelda. Tartib ish oqimiga qarab: kunlik ish
   * yuqorida (arizalar, verifikatsiya, nizolar), sozlash pastda.
   * Yonidagi raqam — e'tibor talab qiladigan ishlar soni.
   */
  const sections: AdminSection[] = [
    { id: 'applications', label: t('admin.tabApplications'), group: 'Navbat', icon: <IconInbox size={17} />, render: () => <Applications /> },
    {
      id: 'verifications',
      label: t('admin.verifications'),
      group: 'Navbat',
      icon: <IconShield size={17} />,
      badge: pending?.length,
      render: () => <VerificationList pending={pending} onDecide={decide} onReject={setRejecting} />,
    },
    {
      id: 'disputes',
      label: t('admin.disputes'),
      group: 'Navbat',
      icon: <IconAlert size={17} />,
      badge: disputes?.length,
      render: () => <DisputeList disputes={disputes} onOpen={openDispute} />,
    },
    { id: 'clinics', label: t('admin.tabClinics'), group: 'Boshqaruv', icon: <IconClinic size={17} />, render: () => <AdminClinics /> },
    { id: 'metrics', label: t('admin.metrics'), group: 'Boshqaruv', icon: <IconChart size={17} />, render: () => <MetricsPanel metrics={metrics} /> },
    { id: 'catalog', label: 'Katalog', group: 'Boshqaruv', icon: <IconStethoscope size={17} />, render: () => <CatalogSync /> },
    { id: 'commission', label: 'Komissiya to‘lovlari', group: 'Pul', icon: <IconWallet size={17} />, render: () => <CommissionPayments /> },
    { id: 'steps', label: 'So‘rov bosqichlari', group: 'Sozlash', icon: <IconSparkle size={17} />, render: () => <RequestStepsScreen /> },
    { id: 'settings', label: t('admin.tabSettings'), group: 'Sozlash', icon: <IconInfo size={17} />, render: () => <PlatformSettingsScreen /> },
    /*
     * Xavfsizlik oxirida, lekin ko'rinadigan joyda. Bu hisob butun
     * platformani boshqaradi va 2FA aynan shu yerdan yoqiladi.
     */
    { id: 'security', label: 'Xavfsizlik', group: 'Sozlash', icon: <IconShield size={17} />, render: () => <Security /> },
    /*
     * Foydalanuvchilar va huquqlar — faqat `admin` roli. Server ham
     * shu marshrutlarni `requireRole('admin')` bilan qo'riqlaydi;
     * bu yerdagi tekshiruv shunchaki ishlamaydigan bo'limni
     * ko'rsatmaslik uchun.
     */
    ...(user?.roles.includes('admin')
      ? [
          {
            id: 'users',
            label: 'Foydalanuvchilar',
            group: 'Sozlash',
            icon: <IconShield size={17} />,
            render: () => <AdminUsers />,
          },
        ]
      : []),
  ];

  return (
    <>
      <AdminShell sections={sections} active={tab} onChange={(id) => setTab(id as Tab)} who={who} />

      {/* Rad etish sababi majburiy */}
      <RejectSheet
        clinic={rejecting}
        onClose={() => setRejecting(null)}
        onSubmit={(note) => rejecting && decide(rejecting, 'rejected', note)}
      />

      <DisputeSheet data={reviewing} onClose={() => setReviewing(null)} onResolve={resolve} />
    </>
  );
}

/* ═════════════════  Bo'limlar  ═════════════════ */

/**
 * Verifikatsiya navbati — ro'yxat va tafsilot yonma-yon.
 *
 * Ilgari 58 ta klinika 11 600 piksel karta bo'lib cho'zilgandi va har
 * birining hujjatlari o'sha yerda ochilardi. Navbatning uzunligini
 * ko'rish uchun ham varaqlash kerak edi.
 *
 * Bu ekran uchun oddiy jadval ham yetarli emas: qaror HUJJATGA qarab
 * qabul qilinadi, ya'ni ular ko'z oldida turishi kerak. Shuning uchun
 * chapda qisqa ro'yxat, o'ngda tanlanganning to'liq tafsiloti.
 *
 * Ommaviy tasdiqlash ATAYLAB yo'q: litsenziyani ko'rmasdan o'nlab
 * klinikani bir bosishda tasdiqlash — verifikatsiyaning ma'nosini
 * yo'qotadi.
 */
function VerificationList({
  pending,
  onDecide,
  onReject,
}: {
  pending: Clinic[] | null;
  onDecide: (clinic: Clinic, status: 'approved' | 'rejected', note: string | null) => void;
  onReject: (clinic: Clinic) => void;
}) {
  const { t } = useApp();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pending ?? [];
    return (pending ?? []).filter(
      (c) => c.name.toLowerCase().includes(q) || (c.address ?? '').toLowerCase().includes(q),
    );
  }, [pending, query]);

  /* Tanlov yo'q bo'lsa birinchisi ochiladi — navbat darrov ish beradi */
  const selected = list.find((c) => c.id === selectedId) ?? list[0] ?? null;

  if (pending === null) return <SkeletonList count={2} />;

  return (
    <div className="stack">
      <PageHeader
        title={t('admin.verifications')}
        description="Klinika litsenziyasi va hujjatlarini tekshirib, qaror qabul qiling"
        count={pending.length}
      />

      {pending.length === 0 ? (
        <EmptyState icon={<IconShield size={32} />} title={t('admin.noPending')} />
      ) : (
        <div className="review">
          <div className="review__list">
            <Input
              value={query}
              placeholder={t('common.search')}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t('common.search')}
            />
            <div className="review__rows">
              {list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`review__row ${selected?.id === c.id ? 'is-active' : ''}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <span className="review__name">{c.name}</span>
                  <span className="review__meta">{c.address || '—'}</span>
                </button>
              ))}
              {list.length === 0 && <Empty title={t('ac.empty')} />}
            </div>
          </div>

          {selected && (
            <div className="review__detail">
              <div className="between">
                <strong>{selected.name}</strong>
                <Badge tone="warning">{t(`ver.status.${selected.verification}` as any)}</Badge>
              </div>
              <span className="tiny">{selected.address}</span>
              {selected.about && (
                <p className="tiny" style={{ color: 'var(--body)' }}>
                  {selected.about}
                </p>
              )}

              {/* Hujjatlarni ko'rmasdan tasdiqlash — verifikatsiyaning ma'nosini yo'qotadi */}
              <ClinicDocuments clinicId={selected.id} />

              <div className="row" style={{ gap: 'var(--s-2)' }}>
                <Button size="sm" icon={<IconCheck size={15} />} onClick={() => onDecide(selected, 'approved', null)}>
                  {t('admin.approve')}
                </Button>
                <Button size="sm" variant="danger" onClick={() => onReject(selected)}>
                  {t('admin.reject')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DisputeList({
  disputes,
  onOpen,
}: {
  disputes: Deal[] | null;
  onOpen: (id: number) => void;
}) {
  const { t, lang } = useApp();

  if (disputes === null) return <SkeletonList count={2} />;
  if (disputes.length === 0) return <EmptyState icon={<IconShield size={32} />} title={t('admin.noDisputes')} />;

  return (
    <AnimatedList>
      {disputes.map((deal) => (
        <AnimatedItem key={deal.id}>
          <button className="list-item" onClick={() => onOpen(deal.id)}>
            <div className="list-item__body">
              <div className="list-item__title">#{deal.id}</div>
              <div className="list-item__sub truncate">
                {money(deal.agreedPriceUzs, lang)} · {deal.disputeReason ?? '—'}
              </div>
            </div>
            <Badge tone="warning">{deal.status}</Badge>
          </button>
        </AnimatedItem>
      ))}
    </AnimatedList>
  );
}

function MetricsPanel({ metrics }: { metrics: AdminMetrics | null }) {
  const { lang } = useApp();
  if (metrics === null) return <SkeletonList count={2} />;

  /*
   * Bu ekran ilgari o'nta bir xil plitka edi va yorliqlari boshqa
   * ekranlardan qarzga olingandi — foydalanuvchilar soni "Salom" deb
   * turardi. Raqamlar bor edi, ma'no yo'q edi.
   *
   * Endi uch guruh, va tartib admin nimadan boshlashiga qarab:
   *   1. E'tibor talab qiladigan ish (kutayotgan odam bor)
   *   2. Voronka — so'rovdan bitimgacha qayerda yo'qotilyapti
   *   3. Pul
   */
  const funnel = [
    { label: 'So‘rov', value: metrics.requests },
    { label: 'Taklif', value: metrics.offers },
    { label: 'Bitim', value: metrics.deals },
    { label: 'Yopilgan', value: metrics.confirmedDeals },
  ];
  const peak = Math.max(...funnel.map((f) => f.value), 1);

  return (
    <div className="stack">
      <PageHeader title="Ko‘rsatkichlar" description="Platformaning umumiy holati" />

      {/* ── 1. E'tibor talab qiladi ── */}
      <Section title="E'tibor talab qiladi">
        <div className="kpi-grid">
          <Kpi
            label="Verifikatsiya kutmoqda"
            value={metrics.pendingVerifications}
            tone={metrics.pendingVerifications > 0 ? 'warn' : 'good'}
            hint={metrics.pendingVerifications > 0 ? 'Klinikalar javob kutmoqda' : 'Navbat bo‘sh'}
          />
          <Kpi
            label="Ochiq nizolar"
            value={metrics.disputes}
            tone={metrics.disputes > 0 ? 'bad' : 'good'}
            hint={metrics.disputes > 0 ? 'Moderator qarori kerak' : 'Nizo yo‘q'}
          />
        </div>
      </Section>

      {/* ── 2. Voronka ── */}
      <Section title="So‘rovdan bitimgacha">
        <div className="funnel">
          {funnel.map((f, i) => {
            const prev = i > 0 ? funnel[i - 1].value : null;
            /* Har bosqichda oldingisidan qancha qismi o'tgani — yo'qotish shu yerda ko'rinadi */
            const keep = prev && prev > 0 ? Math.round((f.value / prev) * 100) : null;
            return (
              <div className="funnel__row" key={f.label}>
                <span className="funnel__label">{f.label}</span>
                <div className="funnel__track">
                  <div className="funnel__bar" style={{ width: `${Math.max(2, (f.value / peak) * 100)}%` }} />
                </div>
                <span className="funnel__value num">{f.value}</span>
                <span className="funnel__keep">{keep != null ? `${keep}%` : ''}</span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── 3. Pul va hajm ── */}
      <Section title="Pul va hajm">
        <div className="kpi-grid">
          <Kpi label="Komissiya" value={money(metrics.commissionUzs, lang)} hint="Yopilgan bitimlardan" />
          <Kpi label="Obuna daromadi" value={money(metrics.subscriptionRevenueUzs, lang)} />
          <Kpi
            label="Bitimga aylanish"
            value={`${metrics.conversionPercent}%`}
            hint="So‘rovlardan bitim bo‘lgani"
          />
          <Kpi label="Klinikalar" value={metrics.clinics} />
          <Kpi label="Bemorlar" value={metrics.patients} />
          <Kpi label="Jami foydalanuvchi" value={metrics.users} />
        </div>
      </Section>
    </div>
  );
}

function RejectSheet({
  clinic,
  onClose,
  onSubmit,
}: {
  clinic: Clinic | null;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const { t } = useApp();
  const [note, setNote] = useState('');

  return (
    <Sheet open={Boolean(clinic)} onClose={onClose} title={t('admin.reject')}>
      <Field label={t('admin.rejectReason')} hint={t('common.required')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </Field>
      <Button block variant="danger" disabled={note.trim().length < 3} onClick={() => onSubmit(note.trim())}>
        {t('admin.reject')}
      </Button>
    </Sheet>
  );
}

function DisputeSheet({
  data,
  onClose,
  onResolve,
}: {
  data: { deal: DealDetail; messages: ChatMessage[] } | null;
  onClose: () => void;
  onResolve: (dealId: number, resolution: 'confirm' | 'cancel', amount: number | null, note: string) => void;
}) {
  const { t, lang } = useApp();
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (data) setAmount(data.deal.agreedPriceUzs);
  }, [data]);

  if (!data) return <Sheet open={false} onClose={onClose} children={null} />;

  const { deal, messages } = data;

  return (
    <Sheet open onClose={onClose} title={`${t('deal.title')} #${deal.id}`}>
      <Card variant="flat" className="stack">
        <div className="between">
          <span className="tiny">{t('deal.agreedPrice')}</span>
          <strong className="num">{money(deal.agreedPriceUzs, lang)}</strong>
        </div>
        <div className="between">
          <span className="tiny">{t('clinic.title')}</span>
          <span>{deal.clinic.name}</span>
        </div>
        {deal.scheduledAt && (
          <div className="between">
            <span className="tiny">{t('deal.scheduled')}</span>
            <span className="num">{formatDate(deal.scheduledAt, lang)}</span>
          </div>
        )}
        {deal.disputeReason && <Notice tone="warning">{deal.disputeReason}</Notice>}
      </Card>

      {/* Moderator chat asosida qaror qabul qiladi */}
      <div className="stack" style={{ maxHeight: 220, overflowY: 'auto', gap: 6 }}>
        {messages.map((m) => (
          <div
            key={m.id}
            className={`bubble ${m.kind === 'system' ? 'bubble--system' : m.senderRole === 'patient' ? 'bubble--theirs' : 'bubble--mine'}`}
            style={{ maxWidth: '100%' }}
          >
            {m.body}
          </div>
        ))}
      </div>

      <Field label={t('confirm.amount')}>
        <Input
          className="input--money"
          inputMode="numeric"
          value={amount ? groupDigits(amount) : ''}
          onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, '')) || 0)}
        />
      </Field>

      <Field label={t('admin.rejectReason')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>

      <Button block onClick={() => onResolve(deal.id, 'confirm', amount, note)}>
        {t('admin.resolveConfirm')}
      </Button>
      <Button block variant="danger" onClick={() => onResolve(deal.id, 'cancel', null, note)}>
        {t('admin.resolveCancel')}
      </Button>
    </Sheet>
  );
}


/* ═════════════════  Klinika hujjatlari (moderator ko'rinishi)  ═════════════════ */

/**
 * Har bir hujjat alohida tasdiqlanadi yoki rad etiladi.
 * Rad etishda sabab majburiy — klinika nimani tuzatishini bilishi kerak.
 */
function ClinicDocuments({ clinicId }: { clinicId: number }) {
  const { t, toast } = useApp();
  const [docs, setDocs] = useState<ClinicDocument[] | null>(null);
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState<ClinicDocument | null>(null);
  const [note, setNote] = useState('');

  const load = async () => {
    try {
      setDocs(await clinicApi.moderationDocuments(clinicId));
    } catch {
      setDocs([]);
    }
  };

  const decide = async (doc: ClinicDocument, status: 'approved' | 'rejected', reason: string | null) => {
    try {
      await clinicApi.setDocumentStatus(doc.id, status, reason);
      haptic.success();
      toast(status === 'approved' ? t('mod.docApproved') : t('mod.docRejected'), 'success');
      setRejecting(null);
      setNote('');
      await load();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  if (!open) {
    return (
      <Button
        size="sm"
        variant="secondary"
        block
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        {t('mod.reviewDocs')}
      </Button>
    );
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label-sm">{t('mod.docs')}</span>

      {docs === null && <Skeleton h={60} />}
      {docs?.length === 0 && <Notice tone="warning">{t('mod.noDocs')}</Notice>}

      {docs?.map((doc) => (
        <div key={doc.id} className="doc-row doc-row--wrap">
          <FileThumb
            file={{ id: doc.fileId, name: doc.fileName, mimeType: doc.fileMimeType, sizeBytes: 0, kind: 'other', label: null, createdAt: doc.createdAt }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="doc-row__name truncate">{doc.label || t(`ver.kind.${doc.kind}` as any)}</span>
            <span className="doc-row__meta">
              {doc.fileName} · {t(`ver.status.${doc.status}` as any)}
              {doc.note ? ` — ${doc.note}` : ''}
            </span>
          </span>

          {doc.status === 'pending' && (
            <span className="row" style={{ gap: 4 }}>
              <Button size="sm" variant="ghost" onClick={() => decide(doc, 'approved', null)}>
                {t('mod.approve')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(doc)}>
                {t('mod.reject')}
              </Button>
            </span>
          )}
        </div>
      ))}

      <Sheet open={rejecting !== null} onClose={() => setRejecting(null)} title={t('mod.rejectReason')}>
        <div className="stack">
          <Textarea
            rows={3}
            value={note}
            placeholder={t('mod.rejectHint')}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            block
            variant="danger"
            disabled={note.trim().length < 3}
            onClick={() => rejecting && decide(rejecting, 'rejected', note.trim())}
          >
            {t('mod.reject')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
