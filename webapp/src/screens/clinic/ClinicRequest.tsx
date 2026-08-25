/**
 * So'rov tafsiloti + taklif yuborish formasi.
 * Klinika bu yerda bemor byudjetini va bozor narxini yonma-yon ko'radi.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { formatDate, groupDigits, money, timeLeft } from '@/lib/format';
import { haptic } from '@/lib/telegram';
import { popVariants, spring } from '@/lib/motion';
import { cityName, opAlias, opName } from '@/i18n';
import { PriceChart } from '@/components/Visuals';
import { AttachmentList } from '@/components/wizard/DocumentsStep';
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  IconCheck,
  IconClock,
  Input,
  Notice,
  Screen,
  SkeletonList,
  Textarea,
} from '@/ui';
import type { PriceStats, RequestWithMeta } from '@shared/types';

/** Tez javob uchun tayyor variantlar — klinika bir tegishda qo'shadi. */
const INCLUDE_PRESETS = [
  'Operatsiya',
  'Narkoz (anesteziya)',
  'Palata (2 kun)',
  'Dori-darmon',
  'Operatsiyadan oldingi tekshiruv',
  'Jarroh nazorati (1 oy)',
  'Sarflanuvchi materiallar',
];

const ADVANTAGE_PRESETS = [
  'Oliy toifali jarroh',
  'Yangi avlod jihozlari',
  'Xalqaro sertifikat',
  '24/7 nazorat',
  'Bepul konsultatsiya',
  'Bo‘lib to‘lash imkoni',
];

export function ClinicRequest() {
  const { id } = useParams();
  const requestId = Number(id);
  const navigate = useNavigate();
  const { t, lang, toast } = useApp();

  const [request, setRequest] = useState<RequestWithMeta | null>(null);
  const [stats, setStats] = useState<PriceStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [price, setPrice] = useState(0);
  const [includes, setIncludes] = useState<string[]>(['Operatsiya', 'Narkoz (anesteziya)']);
  const [advantages, setAdvantages] = useState<string[]>([]);
  const [leadTimeDays, setLeadTimeDays] = useState(7);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .clinicRequest(requestId)
      .then((data) => {
        if (cancelled) return;
        setRequest(data.request);
        setStats(data.stats);
        // Boshlang'ich narx: bemor byudjeti yoki bozor medianasi
        setPrice(data.request.budgetUzs ?? data.stats.median ?? 0);
      })
      .catch((err) => !cancelled && setError(err?.message ?? t('common.error')));
    return () => {
      cancelled = true;
    };
  }, [requestId, t]);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => {
    haptic.select();
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  };

  const submit = async () => {
    setSending(true);
    try {
      await api.createOffer({
        requestId,
        priceUzs: price,
        includes,
        advantages,
        leadTimeDays,
        note: note.trim() || null,
      });
      haptic.success();
      setSent(true);
      toast(t('clinic.offerSent'), 'success');
      window.setTimeout(() => navigate('/clinic', { replace: true }), 1200);
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
      setSending(false);
    }
  };

  if (error) {
    return (
      <Screen title={t('clinic.requests')} onBack={() => navigate('/clinic')}>
        <ErrorState message={error} retryLabel={t('common.retry')} onRetry={() => navigate(0)} />
      </Screen>
    );
  }

  if (!request) {
    return (
      <Screen title={t('clinic.requests')} onBack={() => navigate('/clinic')}>
        <SkeletonList count={3} />
      </Screen>
    );
  }

  const left = timeLeft(request.expiresAt, lang);
  // Shaffoflik siyosati: "nima kiradi" bo'sh bo'lsa taklif yuborilmaydi
  const valid = price >= 100_000 && includes.length > 0 && !sent;

  return (
    <Screen
      title={opName(request.operation, lang)}
      subtitle={`${cityName(request.city, lang)} · ${opAlias(request.operation, lang)}`}
      onBack={() => navigate('/clinic')}
      footer={
        <Button block loading={sending} disabled={!valid} onClick={submit}>
          {sent ? t('common.done') : t('clinic.makeOffer')}
        </Button>
      }
    >
      {/* Bemor konteksti */}
      <Card className="stack">
        <div className="between">
          <span className="tiny">{t('clinic.patientBudget')}</span>
          <strong className="num">
            {request.budgetUzs ? money(request.budgetUzs, lang) : t('clinic.noBudget')}
          </strong>
        </div>

        <div className="between">
          <span className="tiny">{t('offers.title')}</span>
          <Badge tone="neutral">{request.offersCount}</Badge>
        </div>

        {!left.expired && (
          <div className="row tiny" style={{ gap: 5 }}>
            <IconClock size={13} /> {left.text}
          </div>
        )}

        {request.urgency !== 'normal' && (
          <Badge tone={request.urgency === 'urgent' ? 'danger' : 'warning'}>
            {t(`budget.urgency.${request.urgency}` as any)}
          </Badge>
        )}

        {/* Bemor holati — klinika narxni shundan aniqlaydi */}
        {request.conditionText && (
          <div className="stack" style={{ gap: 4 }}>
            <span className="tiny">{t('wz.review.condition')}</span>
            <p style={{ fontSize: 'var(--t-sm)', lineHeight: 1.5 }}>{request.conditionText}</p>
          </div>
        )}

        {request.dateFrom && (
          <div className="between">
            <span className="tiny">{t('wz.review.date')}</span>
            <span className="num">
              {formatDate(request.dateFrom, lang)}
              {request.dateTo ? ` – ${formatDate(request.dateTo, lang)}` : ''}
            </span>
          </div>
        )}

        {request.dateFlexible && <Badge tone="verified">{t('wz.date.flexible')}</Badge>}
        {request.otherRegionsOk && <Badge tone="neutral">{t('wz.region.other')}</Badge>}

        {request.note && (
          <p className="tiny" style={{ color: 'var(--body)' }}>
            {request.note}
          </p>
        )}
      </Card>

      {/* Tekshiruv natijalari */}
      {request.files && request.files.length > 0 && (
        <Card className="stack">
          <h2 className="section-title">{t('wz.review.docs')}</h2>
          <AttachmentList files={request.files} />
        </Card>
      )}

      {/* Bozor narxi — klinika o'zini joylashtirsin */}
      {stats?.median != null && (
        <Card className="stack">
          <div className="between">
            <h2 className="section-title">{t('clinic.marketPrice')}</h2>
            <span className="tiny">
              {stats.source === 'deals'
                ? t('budget.sourceDeals', { n: stats.sampleSize, days: stats.windowDays })
                : t('budget.sourceManual')}
            </span>
          </div>
          <PriceChart stats={stats} budget={price} lang={lang} yourLabel={t('clinic.price')} />
        </Card>
      )}

      {/* Taklif formasi */}
      <Field label={t('clinic.price')}>
        <Input
          className="input--money"
          inputMode="numeric"
          value={price ? groupDigits(price) : ''}
          onChange={(e) => setPrice(Number(e.target.value.replace(/\D/g, '')) || 0)}
          aria-label={t('clinic.price')}
        />
      </Field>

      <Field label={t('clinic.includes')} hint={t('clinic.includesHint')} error={includes.length === 0 ? t('common.required') : undefined}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {INCLUDE_PRESETS.map((item) => (
            <Chip key={item} size="sm" active={includes.includes(item)} onClick={() => toggle(includes, setIncludes, item)}>
              {includes.includes(item) && <IconCheck size={11} />} {item}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={`${t('clinic.advantages')} · ${t('common.optional')}`}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {ADVANTAGE_PRESETS.map((item) => (
            <Chip
              key={item}
              size="sm"
              active={advantages.includes(item)}
              onClick={() => toggle(advantages, setAdvantages, item)}
            >
              {item}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={t('clinic.leadTime')}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {[1, 3, 7, 14, 30].map((d) => (
            <Chip key={d} size="sm" active={leadTimeDays === d} onClick={() => setLeadTimeDays(d)}>
              {d} {t('common.days')}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={`${t('clinic.offerNote')} · ${t('common.optional')}`}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </Field>

      <Notice tone="info">{t('clinic.includesHint')}</Notice>

      {sent && (
        <motion.div variants={popVariants} initial="initial" animate="animate" style={{ textAlign: 'center' }}>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={spring}
            style={{
              width: 64,
              height: 64,
              margin: '0 auto',
              borderRadius: '50%',
              background: 'var(--success)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <IconCheck size={30} />
          </motion.div>
          <p style={{ marginTop: 'var(--s-2)' }}>{t('clinic.offerSent')}</p>
        </motion.div>
      )}
    </Screen>
  );
}
