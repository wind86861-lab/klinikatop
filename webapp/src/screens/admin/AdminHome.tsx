/**
 * Super-admin paneli.
 *
 * Ilgari ikki daraja bor edi — moderator va admin. Amalda bu faqat
 * chalkashlik keltirardi: ikkovi bir xil ekranlarni ko'rardi va farqni
 * eslab qolish uchun sabab yo'q edi. Endi bitta daraja.
 */
import { useCallback, useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { useApp } from '@/store/app';
import { api, clinicApi } from '@/lib/api';
import { formatDate, groupDigits, money } from '@/lib/format';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import {
  AnimatedItem,
  AnimatedList,
  Badge,
  Button,
  Card,
  CountUp,
  EmptyState,
  ErrorState,
  Field,
  IconCheck,
  IconShield,
  Input,
  Notice,
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
    { id: 'applications', label: t('admin.tabApplications'), render: () => <Applications /> },
    {
      id: 'verifications',
      label: t('admin.verifications'),
      badge: pending?.length,
      render: () => <VerificationList pending={pending} onDecide={decide} onReject={setRejecting} />,
    },
    {
      id: 'disputes',
      label: t('admin.disputes'),
      badge: disputes?.length,
      render: () => <DisputeList disputes={disputes} onOpen={openDispute} />,
    },
    { id: 'clinics', label: t('admin.tabClinics'), render: () => <AdminClinics /> },
    { id: 'metrics', label: t('admin.metrics'), render: () => <MetricsPanel metrics={metrics} /> },
    { id: 'catalog', label: 'Katalog', render: () => <CatalogSync /> },
    { id: 'steps', label: 'So‘rov bosqichlari', render: () => <RequestStepsScreen /> },
    { id: 'settings', label: t('admin.tabSettings'), render: () => <PlatformSettingsScreen /> },
    /*
     * Xavfsizlik oxirida, lekin ko'rinadigan joyda. Bu hisob butun
     * platformani boshqaradi va 2FA aynan shu yerdan yoqiladi.
     */
    { id: 'security', label: 'Xavfsizlik', render: () => <Security /> },
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

  if (pending === null) return <SkeletonList count={2} />;
  if (pending.length === 0) return <EmptyState icon={<IconShield size={32} />} title={t('admin.noPending')} />;

  return (
    <AnimatedList>
      {pending.map((clinic) => (
        <AnimatedItem key={clinic.id}>
          <Card className="stack">
            <div className="between">
              <strong>{clinic.name}</strong>
              <Badge tone="warning">{t(`ver.status.${clinic.verification}` as any)}</Badge>
            </div>
            <span className="tiny">{clinic.address}</span>
            {clinic.about && <p className="tiny" style={{ color: 'var(--body)' }}>{clinic.about}</p>}
            {/* Hujjatlarni ko'rmasdan tasdiqlash — verifikatsiyaning ma'nosini yo'qotadi */}
            <ClinicDocuments clinicId={clinic.id} />

            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <Button size="sm" icon={<IconCheck size={15} />} onClick={() => onDecide(clinic, 'approved', null)}>
                {t('admin.approve')}
              </Button>
              <Button size="sm" variant="danger" onClick={() => onReject(clinic)}>
                {t('admin.reject')}
              </Button>
            </div>
          </Card>
        </AnimatedItem>
      ))}
    </AnimatedList>
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
  const { t } = useApp();
  if (metrics === null) return <SkeletonList count={2} />;

  return (
    <div className="kpi-grid">
      <MetricCard label={t('home.greeting')} value={metrics.users} />
      <MetricCard label={t('clinic.title')} value={metrics.clinics} />
      <MetricCard label={t('home.active')} value={metrics.requests} />
      <MetricCard label={t('offers.title')} value={metrics.offers} />
      <MetricCard label={t('home.deals')} value={metrics.deals} />
      <MetricCard label={t('deal.step.CONFIRMED')} value={metrics.confirmedDeals} />
      <MetricCard label={t('clinic.kpi.winRate')} value={metrics.conversionPercent} suffix="%" />
      <MetricCard label={t('clinic.kpi.commission')} value={metrics.commissionUzs} isMoney />
      <MetricCard label={t('clinic.subscription')} value={metrics.subscriptionRevenueUzs} isMoney />
      <MetricCard label={t('admin.disputes')} value={metrics.disputes} />
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
  isMoney,
}: {
  label: string;
  value: number;
  suffix?: string;
  isMoney?: boolean;
}) {
  const { lang } = useApp();
  return (
    <m.div className="kpi" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">
        {isMoney ? (
          money(value, lang)
        ) : (
          <>
            <CountUp value={value} format={(n) => String(Math.round(n))} />
            {suffix}
          </>
        )}
      </div>
    </m.div>
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
