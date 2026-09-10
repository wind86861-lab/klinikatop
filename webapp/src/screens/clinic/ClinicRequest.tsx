/**
 * So'rov tafsiloti + taklif yuborish formasi.
 * Klinika bu yerda bemor byudjetini va bozor narxini yonma-yon ko'radi.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useNavigate, useParams } from '@/lib/router';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { formatDate, groupDigits, money, timeLeft } from '@/lib/format';
import { haptic } from '@/lib/telegram';
import { popVariants, spring } from '@/lib/motion';
import { cityName, opAlias } from '@/i18n';
import { PriceChart } from '@/components/Visuals';
import { ExtraAnswers } from '@/components/ExtraAnswers';
import { AttachmentList } from '@/components/wizard/DocumentsStep';
import {
  Badge,
  Button,
  Card,
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
import { requestTitle } from '@shared/types';
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
  /*
   * Narx bemor budjetidan ±20% dan chetga chiqmaydi.
   *
   * Chegara EKRANDA ko'rsatiladi, server javobida emas: klinika
   * narxni yozib, tugmani bosib, keyin xato olishi kerak emas —
   * u chegarani yozayotganda bilishi kerak.
   */
  const budget = request.budgetUzs;
  const maxPrice = budget ? Math.round(budget * 1.2) : null;
  const minPrice = budget ? Math.round(budget * 0.8) : null;

  const tooHighForBudget = Boolean(maxPrice && price > maxPrice);
  const tooLowForBudget = Boolean(minPrice && price > 0 && price < minPrice);
  const aboveBudget = Boolean(budget && price > budget && !tooHighForBudget);
  const overBy = aboveBudget && budget ? price - budget : 0;

  // Shaffoflik siyosati: "nima kiradi" bo'sh bo'lsa taklif yuborilmaydi
  const valid =
    price >= 100_000 &&
    includes.length > 0 &&
    !tooHighForBudget &&
    !tooLowForBudget &&
    (!aboveBudget || aboveReason.trim().length >= 10) &&
    !sent;

  return (
    <Screen
      title={requestTitle(request, lang)}
      subtitle={`${cityName(request.city, lang)}${request.operation ? ` · ${opAlias(request.operation, lang)}` : ''}`}
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

        {/*
          Tahlil so'rovida VAZN ko'rsatiladi.
          Ko'p tekshiruvda doza va uskuna sozlamasi shunga bog'liq —
          klinika buni taklif berishdan oldin bilishi kerak.
        */}
        {request.kind === 'lab' && request.weightKg && (
          <div className="between">
            <span className="tiny">{t('wz.review.weight')}</span>
            <strong className="num">{request.weightKg} kg</strong>
          </div>
        )}

        {/* Bemor holati — klinika narxni shundan aniqlaydi */}
        {request.conditionText && (
          <div className="stack" style={{ gap: 4 }}>
            <span className="tiny">{t('wz.review.condition')}</span>
            <p style={{ fontSize: 'var(--t-sm)', lineHeight: 1.5 }}>{request.conditionText}</p>
          </div>
        )}

        {/* Admin qo'shgan savollarga javoblar */}
        <ExtraAnswers answers={request.extraAnswers} />

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

      {/*
        Yuklangan hujjatlar.

        Yo'llanma so'rovida bu QO'SHIMCHA emas, so'rovning O'ZI:
        katalogdan hech narsa tanlanmagan va nima kerakligi faqat
        shu rasmda yozilgan. Shuning uchun sarlavha ham boshqacha —
        klinika buni "yana bir hujjat" deb o'tkazib yubormasin.
      */}
      {request.files && request.files.length > 0 && (
        <Card className="stack">
          <h2 className="section-title">
            {request.kind === 'referral' ? t('wz.ref.fileLabel') : t('wz.review.docs')}
          </h2>
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
      <Field
        label={t('clinic.price')}
        hint={
          budget
            ? `Bemor budjeti ${money(budget, lang)} · ruxsat etilgan oraliq ${money(
                minPrice!,
                lang,
              )} – ${money(maxPrice!, lang)}`
            : undefined
        }
      >
        <Input
          className="input--money"
          inputMode="numeric"
          value={price ? groupDigits(price) : ''}
          onChange={(e) => setPrice(Number(e.target.value.replace(/\D/g, '')) || 0)}
          aria-label={t('clinic.price')}
        />
      </Field>

      {/* Chegaradan chiqsa — darhol, tugmani bosishdan oldin */}
      <AnimatePresence>
        {(tooHighForBudget || tooLowForBudget) && (
          <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Notice tone="danger">
              {tooHighForBudget
                ? `Narx bemor budjetidan 20% dan ortiq yuqori. Eng ko‘pi ${money(maxPrice!, lang)}.`
                : `Narx bemor budjetidan 20% dan ortiq past. Eng kami ${money(minPrice!, lang)}.`}
            </Notice>
          </m.div>
        )}
      </AnimatePresence>

      {/*
        Budjetdan yuqori narx — to'siq emas, tushuntirish talab qiladi.
        Klinika yaxshiroq shart bilan qimmatroq taklif bera olishi kerak.
      */}
      <AnimatePresence>
        {aboveBudget && (
          <m.div
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
          </m.div>
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
        label="Operatsiya uchun qulay kunlar · ixtiyoriy"
        hint={
          request.dateFrom
            ? `Bemor ${formatDate(request.dateFrom, lang)}${
                request.dateTo ? ` – ${formatDate(request.dateTo, lang)}` : ''
              } oralig‘ini so‘ragan`
            : 'Bemor sana ko‘rsatmagan'
        }
      >
        <DatePicker
          value={dates}
          onChange={setDates}
          windowFrom={request.dateFrom}
          windowTo={request.dateTo}
          lang={lang}
        />
      </Field>

      <Field label={`${t('clinic.offerNote')} · ${t('common.optional')}`}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </Field>

      <Notice tone="info">{t('clinic.includesHint')}</Notice>

      {sent && (
        <m.div variants={popVariants} initial="initial" animate="animate" style={{ textAlign: 'center' }}>
          <m.div
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
          </m.div>
          <p style={{ marginTop: 'var(--s-2)' }}>{t('clinic.offerSent')}</p>
        </m.div>
      )}
    </Screen>
  );
}
