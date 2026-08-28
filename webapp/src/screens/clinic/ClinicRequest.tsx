/**
 * So'rov tafsiloti + taklif yuborish formasi.
 * Klinika bu yerda bemor byudjetini va bozor narxini yonma-yon ko'radi.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
import type { PatientCase, PriceStats, RequestWithMeta } from '@shared/types';
import { PatientCaseCard } from '@/components/PatientCaseCard';
import { ChipPicker } from '@/components/ChipPicker';
import { DatePicker } from '@/components/DatePicker';

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
  const [patientCase, setPatientCase] = useState<PatientCase | null>(null);
  const [stats, setStats] = useState<PriceStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [price, setPrice] = useState(0);
  const [includes, setIncludes] = useState<string[]>(['Operatsiya', 'Narkoz (anesteziya)']);
  const [advantages, setAdvantages] = useState<string[]>([]);
  const [leadTimeDays, setLeadTimeDays] = useState(7);
  /** Klinika taklif qilgan aniq sanalar */
  const [dates, setDates] = useState<string[]>([]);
  /** Budjetdan yuqori narx uchun izoh */
  const [aboveReason, setAboveReason] = useState('');
  const [note, setNote] = useState('');
  /** Ro'yxatga o'z bandini qo'shish */
  const [customInclude, setCustomInclude] = useState('');
  const [customAdvantage, setCustomAdvantage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .clinicRequest(requestId)
      .then((data) => {
        if (cancelled) return;
        setRequest(data.request);
        setPatientCase(data.patientCase ?? null);
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
        proposedDates: dates,
        aboveBudgetReason: aboveReason.trim() || null,
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

  /*
   * Budjetdan YUQORI narx ruxsat etiladi: klinika yaxshiroq shart bilan
   * qimmatroq taklif bera olishi kerak, aks holda platforma faqat eng
   * arzon variantni ko'rsatadigan joyga aylanadi.
   *
   * Lekin sababsiz emas — bemor nima uchun qimmatroq ekanini bilmasa,
   * u shunchaki eng arzonini tanlaydi.
   */
  const aboveBudget = Boolean(request.budgetUzs && price > request.budgetUzs);
  const overBy = aboveBudget && request.budgetUzs ? price - request.budgetUzs : 0;

  // Shaffoflik siyosati: "nima kiradi" bo'sh bo'lsa taklif yuborilmaydi
  const valid =
    price >= 100_000 &&
    includes.length > 0 &&
    (!aboveBudget || aboveReason.trim().length >= 10) &&
    !sent;

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

      {/* Holat taklif berishdan OLDIN: narx shunga bog'liq */}
      {patientCase && <PatientCaseCard data={patientCase} />}

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

      {/*
        Budjetdan yuqori narx — to'siq emas, tushuntirish talab qiladi.
        Klinika yaxshiroq shart bilan qimmatroq taklif bera olishi kerak.
      */}
      <AnimatePresence>
        {aboveBudget && (
          <motion.div
            className="stack"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Notice tone="warning">
              Narx bemor budjetidan {money(overBy, lang)} yuqori. Nima uchun qimmatroq ekanini
              yozing — bemor buni taklifingiz bilan birga ko‘radi.
            </Notice>
            <Textarea
              rows={2}
              value={aboveReason}
              maxLength={300}
              placeholder="Masalan: robot yordamida operatsiya va bir kecha yotoq narxga kiradi"
              onChange={(e) => setAboveReason(e.target.value)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Field label={t('clinic.includes')} hint={t('clinic.includesHint')} error={includes.length === 0 ? t('common.required') : undefined}>
        <ChipPicker
          presets={INCLUDE_PRESETS}
          selected={includes}
          onToggle={(v) => toggle(includes, setIncludes, v)}
          draft={customInclude}
          onDraft={setCustomInclude}
          onAdd={(v) => {
            if (!includes.includes(v)) setIncludes([...includes, v]);
            setCustomInclude('');
          }}
          addPlaceholder="O‘z bandingizni yozing"
        />
      </Field>

      <Field label={`${t('clinic.advantages')} · ${t('common.optional')}`}>
        <ChipPicker
          presets={ADVANTAGE_PRESETS}
          selected={advantages}
          onToggle={(v) => toggle(advantages, setAdvantages, v)}
          draft={customAdvantage}
          onDraft={setCustomAdvantage}
          onAdd={(v) => {
            if (!advantages.includes(v)) setAdvantages([...advantages, v]);
            setCustomAdvantage('');
          }}
          addPlaceholder="O‘z afzalligingizni yozing"
        />
      </Field>

      {/*
        Aniq sanalar.
        "7 kun ichida" mo'ljal beradi, sana esa qaror qildiradi: bemor
        ishdan ta'til olishi va yaqinini chaqirishi kerak. Bemor
        ko'rsatgan oraliq bo'lsa, u birinchi ko'rinadi.
      */}
      <Field
        label="Qulay kunlar · ixtiyoriy"
        hint={
          request.dateFrom
            ? `Bemor ${formatDate(request.dateFrom, lang)}${
                request.dateTo ? ` – ${formatDate(request.dateTo, lang)}` : ''
              } oralig‘ini ko‘rsatgan`
            : 'Bemor sana ko‘rsatmagan — o‘zingiz taklif qiling'
        }
      >
        <DatePicker
          value={dates}
          onChange={setDates}
          preferFrom={request.dateFrom}
          preferTo={request.dateTo}
          lang={lang}
        />
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
