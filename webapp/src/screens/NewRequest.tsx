/**
 * So'rov vizardi — har qadamda bitta savol.
 *
 * 1 Operatsiya (katalog / AI / bilmayman) → 2 Holat → 3 Hujjatlar →
 * 4 Viloyat → 5 Byudjet → 6 Sana → 7 Izoh → 8 Ko'rib chiqish va oferta.
 *
 * Holat bitta joyda (`draft`) turadi; har qadam faqat o'z bo'lagini o'zgartiradi.
 * Orqaga qaytish hech narsani yo'qotmaydi.
 */
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { formatDate, groupDigits, money } from '@/lib/format';
import { haptic } from '@/lib/telegram';
import { EASE, spring } from '@/lib/motion';
import { cityName } from '@/i18n';
import { TermsCheckbox, TermsSheet } from '@/components/Terms';
import { OperationStep } from '@/components/wizard/OperationStep';
import { DocumentsStep } from '@/components/wizard/DocumentsStep';
import { PriceChart } from '@/components/Visuals';
import {
  Button,
  Card,
  Chip,
  CountUp,
  Field,
  Input,
  Notice,
  Screen,
  Select,
  Skeleton,
  Textarea,
} from '@/ui';
import { GENDERS, ageFromBirthYear, type ChatTurn, type Gender, type Operation, type PriceStats, type StoredFile, type Urgency } from '@shared/types';

/** Vizard qoralamasi — bitta manba. */
export interface Draft {
  operation: Operation | null;
  aiSuggested: boolean;
  conditionText: string;
  files: StoredFile[];
  cityId: number | null;
  otherRegionsOk: boolean;
  budgetUzs: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  dateFlexible: boolean;
  note: string;
  urgency: Urgency;
  /** AI suhbati — klinika bemor nima yozganini to'liq ko'radi */
  aiConversation: ChatTurn[] | null;
  /** So'rov kimga: o'ziga yoki tanishiga */
  forSelf: boolean;
  subjectName: string;
  subjectBirthYear: number | null;
  subjectGender: Gender | null;
}

/*
 * "Kimga" eng boshida turadi: javob keyingi qadamlarga ta'sir qiladi
 * (o'ziga bo'lsa profil ma'lumotlari ishlatiladi), shuning uchun uni
 * oxirida so'rash kech bo'lardi.
 */
const STEPS = ['who', 'operation', 'condition', 'documents', 'region', 'budget', 'date', 'note', 'review'] as const;
type Step = (typeof STEPS)[number];

export function NewRequest() {
  const { t, user, session, toast } = useApp();
  const navigate = useNavigate();

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [draft, setDraft] = useState<Draft>({
    operation: null,
    aiSuggested: false,
    conditionText: '',
    files: [],
    cityId: null,
    otherRegionsOk: false,
    budgetUzs: null,
    dateFrom: null,
    dateTo: null,
    dateFlexible: true,
    note: '',
    urgency: 'normal',
    aiConversation: null,
    forSelf: true,
    subjectName: '',
    subjectBirthYear: null,
    subjectGender: null,
  });

  const patch = (part: Partial<Draft>) => setDraft((d) => ({ ...d, ...part }));

  // Profil to'ldirilmagan bo'lsa avval ro'yxatdan o'tkazamiz
  useEffect(() => {
    if (session && !session.profileComplete) {
      navigate('/register', { replace: true, state: { next: '/new' } });
    }
  }, [session, navigate]);

  // Viloyat profildan olinadi, keyin o'zgartirilishi mumkin
  useEffect(() => {
    if (user?.cityId) setDraft((d) => (d.cityId === null ? { ...d, cityId: user.cityId } : d));
  }, [user?.cityId]);

  const step = STEPS[index];

  /** Har qadamning "davom etish" sharti. Ixtiyoriy qadamlar doim o'tadi. */
  const canAdvance = useMemo(() => {
    switch (step) {
      case 'who':
        // Tanishiga bo'lsa uning ma'lumotlari to'liq bo'lishi kerak
        return (
          draft.forSelf ||
          (draft.subjectName.trim().length >= 2 && draft.subjectBirthYear !== null && draft.subjectGender !== null)
        );
      case 'operation':
        return draft.operation !== null;
      case 'condition':
        return draft.conditionText.trim().length >= 10;
      case 'region':
        return draft.cityId !== null;
      case 'review':
        return termsAccepted;
      default:
        return true;
    }
  }, [step, draft, termsAccepted]);

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0) {
      navigate(-1);
      return;
    }
    if (next >= STEPS.length) return;
    setDirection(delta);
    setIndex(next);
    haptic.select();
    window.scrollTo({ top: 0 });
  };

  const jumpTo = (target: Step) => {
    setDirection(-1);
    setIndex(STEPS.indexOf(target));
    window.scrollTo({ top: 0 });
  };

  const submit = async () => {
    if (!draft.operation || !draft.cityId || !termsAccepted) return;
    setSubmitting(true);
    try {
      const request = await api.createRequest({
        operationId: draft.operation.id,
        cityId: draft.cityId,
        conditionText: draft.conditionText.trim(),
        budgetUzs: draft.budgetUzs,
        note: draft.note.trim() || null,
        urgency: draft.urgency,
        attachments: draft.files.map((f) => f.id),
        otherRegionsOk: draft.otherRegionsOk,
        dateFrom: draft.dateFrom,
        dateTo: draft.dateTo,
        dateFlexible: draft.dateFlexible,
        aiConversation: draft.aiConversation,
        forSelf: draft.forSelf,
        subjectName: draft.forSelf ? null : draft.subjectName.trim(),
        subjectBirthYear: draft.forSelf ? null : draft.subjectBirthYear,
        subjectGender: draft.forSelf ? null : draft.subjectGender,
        aiSuggested: draft.aiSuggested,
        acceptTerms: true,
      });
      haptic.success();
      navigate(`/request/${request.id}`, { replace: true });
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
      setSubmitting(false);
    }
  };

  return (
    <Screen
      onBack={() => go(-1)}
      title={t('wz.step', { n: index + 1, total: STEPS.length })}
      footer={
        step === 'review' ? (
          <Button block loading={submitting} disabled={!canAdvance} onClick={submit}>
            {t('wz.review.submit')}
          </Button>
        ) : (
          <Button block disabled={!canAdvance} onClick={() => go(1)}>
            {t('wz.next')}
          </Button>
        )
      }
    >
      <div className="wz-progress" aria-hidden>
        {STEPS.map((s, i) => (
          <m.span
            key={s}
            className="wz-progress__seg"
            animate={{
              background: i <= index ? 'var(--primary)' : 'var(--line)',
              flex: i === index ? 1.6 : 1,
            }}
            transition={spring}
          />
        ))}
      </div>

      <AnimatePresence mode="wait" custom={direction}>
        <m.div
          key={step}
          className="stack"
          initial={{ opacity: 0, x: direction * 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -28 }}
          transition={{ duration: 0.26, ease: EASE }}
        >
          {step === 'who' && <WhoStep draft={draft} patch={patch} />}

          {step === 'operation' && (
            <OperationStep
              draft={draft}
              onPick={(operation, aiSuggested) => {
                patch({ operation, aiSuggested });
                // Tanlangach avtomatik keyingi qadamga — bitta tegish kamayadi
                setDirection(1);
                setIndex(2);
                haptic.press();
                window.scrollTo({ top: 0 });
              }}
              onChatDone={({ operation, conditionText, turns }) => {
                // Bitta matn ikki joyga: AI aniqlagan operatsiya + bemorning o'z so'zlari
                patch({
                  operation,
                  aiSuggested: operation !== null,
                  conditionText,
                  aiConversation: turns,
                });
                setDirection(1);
                setIndex(2);
                haptic.press();
                window.scrollTo({ top: 0 });
              }}
            />
          )}

          {step === 'condition' && <ConditionStep draft={draft} patch={patch} />}
          {step === 'documents' && <DocumentsStep draft={draft} patch={patch} />}
          {step === 'region' && <RegionStep draft={draft} patch={patch} />}
          {step === 'budget' && <BudgetStep draft={draft} patch={patch} />}
          {step === 'date' && <DateStep draft={draft} patch={patch} />}
          {step === 'note' && <NoteStep draft={draft} patch={patch} />}
          {step === 'review' && (
            <ReviewStep
              draft={draft}
              termsAccepted={termsAccepted}
              onTermsChange={setTermsAccepted}
              onEdit={jumpTo}
            />
          )}
        </m.div>
      </AnimatePresence>
    </Screen>
  );
}

/* ─────────────────────────  Qadam sarlavhasi  ───────────────────────── */

function StepHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="wz-head">
      <h1 className="wz-head__title">{title}</h1>
      {sub && <p className="wz-head__sub">{sub}</p>}
    </div>
  );
}

/* ─────────────────────────  2. Holat  ───────────────────────── */

function ConditionStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const { t } = useApp();
  const length = draft.conditionText.trim().length;

  return (
    <>
      <StepHead title={t('wz.cond.title')} sub={t('wz.cond.sub')} />

      {/* Suhbatdan kelgan bo'lsa matn tayyor turadi — bemor qayta yozmaydi */}
      {draft.aiConversation && <Notice tone="info">{t('ai.fromChat')}</Notice>}

      <Textarea
        value={draft.conditionText}
        onChange={(e) => patch({ conditionText: e.target.value })}
        placeholder={t('wz.cond.ph')}
        rows={6}
        aria-label={t('wz.cond.title')}
      />
      <div className="between">
        <span className="tiny">{length < 10 ? t('wz.cond.min') : ''}</span>
        <span className="tiny num">{length}</span>
      </div>
      <Notice tone="info">{t('wz.cond.why')}</Notice>
    </>
  );
}

/* ─────────────────────────  4. Viloyat  ───────────────────────── */

function RegionStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const { t, lang, cities } = useApp();
  const [matching, setMatching] = useState<number | null>(null);

  // Mos klinika sonini jonli ko'rsatamiz
  useEffect(() => {
    if (!draft.operation || !draft.cityId) return;
    let cancelled = false;
    setMatching(null);
    void api
      .priceStats(draft.operation.id, draft.cityId)
      .then((res) => !cancelled && setMatching(res.matchingClinics))
      .catch(() => !cancelled && setMatching(null));
    return () => {
      cancelled = true;
    };
  }, [draft.operation, draft.cityId]);

  return (
    <>
      <StepHead title={t('wz.region.title')} sub={t('wz.region.sub')} />

      {/* 14 ta viloyat — chiplar o'rniga ro'yxat: telefonda tanish va tez */}
      <Field label={t('wz.region.label')}>
        <Select
          value={draft.cityId ?? ''}
          aria-label={t('wz.region.label')}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            patch({ cityId: e.target.value ? Number(e.target.value) : null })
          }
        >
          <option value="">{t('wz.region.placeholder')}</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {cityName(c, lang)}
            </option>
          ))}
        </Select>
      </Field>

      {/* Matchingni kengaytiruvchi tanlov */}
      <ToggleRow
        on={draft.otherRegionsOk}
        title={t('wz.region.other')}
        hint={t('wz.region.otherHint')}
        onToggle={() => patch({ otherRegionsOk: !draft.otherRegionsOk })}
      />

      {matching !== null &&
        (matching === 0 && !draft.otherRegionsOk ? (
          <Notice tone="warning">{t('wz.region.none')}</Notice>
        ) : (
          <Notice tone="info">{t('wz.region.count', { n: matching })}</Notice>
        ))}
    </>
  );
}

/* ─────────────────────────  5. Byudjet  ───────────────────────── */

function BudgetStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const { t, lang } = useApp();
  const [stats, setStats] = useState<PriceStats | null>(null);

  useEffect(() => {
    if (!draft.operation || !draft.cityId) return;
    let cancelled = false;
    void api.priceStats(draft.operation.id, draft.cityId).then((res) => {
      if (!cancelled) setStats(res.stats);
    });
    return () => {
      cancelled = true;
    };
  }, [draft.operation, draft.cityId]);

  const range = useMemo(() => {
    if (!stats?.min || !stats.max) return { min: 1_000_000, max: 100_000_000, step: 500_000 };
    const min = Math.max(500_000, Math.floor(stats.min * 0.5));
    const max = Math.ceil(stats.max * 1.4);
    return { min, max, step: Math.max(100_000, Math.round((max - min) / 100 / 100_000) * 100_000) };
  }, [stats]);

  const belowRange = draft.budgetUzs != null && stats?.p25 != null && draft.budgetUzs < stats.p25;

  return (
    <>
      <StepHead title={t('wz.budget.title')} sub={t('wz.budget.sub')} />

      {/*
        Faqat REAL bitimlardan chiqqan narx ko'rsatiladi. Bozor tadqiqotidan
        olingan "taxminiy oraliq" bu yerda chiqmaydi: bemor uni haqiqiy narx
        deb o'qib, byudjetini noto'g'ri qo'yib qo'yadi.
      */}
      {!stats ? (
        <Skeleton h={110} />
      ) : stats.source === 'deals' && stats.median != null ? (
        <Card className="stack">
          <div className="between">
            <h2 className="section-title">{t('budget.statsTitle')}</h2>
            <span className="tiny">
              {t('budget.sourceDeals', { n: stats.sampleSize, days: stats.windowDays })}
            </span>
          </div>
          <PriceChart stats={stats} budget={draft.budgetUzs} lang={lang} yourLabel={t('budget.yours')} />
          <span className="tiny">
            {t('budget.median')}: <strong className="num">{money(stats.median, lang)}</strong>
          </span>
        </Card>
      ) : (
        <Notice tone="info">{t('budget.noStats')}</Notice>
      )}

      {draft.budgetUzs == null ? (
        <Button variant="secondary" block onClick={() => patch({ budgetUzs: stats?.median ?? range.min })}>
          {t('wz.budget.set')}
        </Button>
      ) : (
        <Card className="stack">
          <div style={{ textAlign: 'center' }}>
            <div className="num" style={{ fontSize: 'var(--t-3xl)' }}>
              <CountUp value={draft.budgetUzs} format={(n) => groupDigits(n)} />
              <span style={{ fontSize: 'var(--t-md)', color: 'var(--body)' }}>
                {' '}
                {lang === 'ru' ? 'сум' : 'so‘m'}
              </span>
            </div>
          </div>
          <input
            className="slider"
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={draft.budgetUzs}
            onChange={(e) => patch({ budgetUzs: Number(e.target.value) })}
            aria-label={t('wz.budget.title')}
          />
          <div className="between">
            <span className="tiny">{money(range.min, lang)}</span>
            <span className="tiny">{money(range.max, lang)}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => patch({ budgetUzs: null })}>
            {t('wz.budget.skip')}
          </Button>
        </Card>
      )}

      <AnimatePresence>
        {belowRange && (
          <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Notice tone="warning">{t('budget.belowRange')}</Notice>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ─────────────────────────  6. Sana  ───────────────────────── */

function DateStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const { t } = useApp();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <StepHead title={t('wz.date.title')} sub={t('wz.date.sub')} />

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {(
          [
            ['urgent', t('wz.date.asap')],
            ['soon', t('budget.urgency.soon')],
            ['normal', t('budget.urgency.normal')],
          ] as [Urgency, string][]
        ).map(([value, label]) => (
          <Chip key={value} active={draft.urgency === value} onClick={() => patch({ urgency: value })}>
            {label}
          </Chip>
        ))}
      </div>

      {/*
        Moslashuvchanlik va aniq oraliq — BIR narsaning ikki holati,
        ikki mustaqil sozlama emas.

        Ilgari ikkalasi alohida turardi va bemor 28–31 avgustni
        belgilab, ustiga "moslashuvchan" ni ham yoqib qo'yardi.
        Klinika buni qanday tushunishi kerak edi — sanaga qat'iymi
        yoki yo'qmi? Javob yo'q edi.

        Endi sana tanlansa moslashuvchanlik o'chadi, moslashuvchanlik
        yoqilsa sanalar tozalanadi. Zid holat yuzaga kelmaydi.
      */}
      <ToggleRow
        on={draft.dateFlexible}
        title={t('wz.date.flexible')}
        hint={t('wz.date.flexibleHint')}
        onToggle={() =>
          patch(
            draft.dateFlexible
              ? { dateFlexible: false }
              : { dateFlexible: true, dateFrom: null, dateTo: null },
          )
        }
      />

      <AnimatePresence initial={false}>
        {!draft.dateFlexible && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            style={{ overflow: 'hidden' }}
          >
            <div className="row" style={{ gap: 'var(--s-2)', alignItems: 'flex-end' }}>
              <Field label={t('wz.date.from')}>
                <Input
                  type="date"
                  min={today}
                  value={draft.dateFrom ?? ''}
                  onChange={(e) => {
                    // O'tgan sana kiritilsa e'tiborga olinmaydi: kelgusi
                    // operatsiyani o'tgan kunga belgilab bo'lmaydi
                    const v = e.target.value;
                    patch({ dateFrom: v && v >= today ? v : null });
                  }}
                />
              </Field>
              <Field label={t('wz.date.to')}>
                <Input
                  type="date"
                  min={draft.dateFrom ?? today}
                  value={draft.dateTo ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    const floor = draft.dateFrom ?? today;
                    patch({ dateTo: v && v >= floor ? v : null });
                  }}
                />
              </Field>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ─────────────────────────  7. Izoh  ───────────────────────── */

function NoteStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const { t } = useApp();
  return (
    <>
      <StepHead title={t('wz.note.title')} sub={t('wz.note.sub')} />
      <Textarea
        value={draft.note}
        onChange={(e) => patch({ note: e.target.value })}
        placeholder={t('wz.note.ph')}
        rows={4}
        aria-label={t('wz.note.title')}
      />
    </>
  );
}

/* ─────────────────────────  8. Ko'rib chiqish  ───────────────────────── */

function ReviewStep({
  draft,
  termsAccepted,
  onTermsChange,
  onEdit,
}: {
  draft: Draft;
  termsAccepted: boolean;
  onTermsChange: (v: boolean) => void;
  onEdit: (step: Step) => void;
}) {
  const { t, lang, cities } = useApp();
  const [termsOpen, setTermsOpen] = useState(false);
  const [matching, setMatching] = useState<number | null>(null);

  useEffect(() => {
    if (!draft.operation || !draft.cityId) return;
    void api
      .priceStats(draft.operation.id, draft.cityId)
      .then((res) => setMatching(res.matchingClinics))
      .catch(() => setMatching(null));
  }, [draft.operation, draft.cityId]);

  const city = cities.find((c) => c.id === draft.cityId);
  const empty = t('wz.review.empty');

  const dateText = draft.dateFrom
    ? `${formatDate(draft.dateFrom, lang)}${draft.dateTo ? ` – ${formatDate(draft.dateTo, lang)}` : ''}`
    : draft.dateFlexible
      ? t('wz.date.flexible')
      : empty;

  return (
    <>
      <StepHead title={t('wz.review.title')} sub={t('wz.review.sub')} />

      <Card className="stack" style={{ gap: 0 }}>
        <ReviewRow
          label={t('wz.review.operation')}
          value={draft.operation ? (lang === 'ru' ? draft.operation.nameRu : draft.operation.nameUz) : empty}
          onEdit={() => onEdit('operation')}
        />
        <ReviewRow
          label={t('wz.review.condition')}
          value={draft.conditionText}
          multiline
          onEdit={() => onEdit('condition')}
        />
        <ReviewRow
          label={t('wz.review.docs')}
          value={draft.files.length ? draft.files.map((f) => f.name).join(', ') : empty}
          onEdit={() => onEdit('documents')}
        />
        <ReviewRow
          label={t('wz.review.region')}
          value={`${city ? cityName(city, lang) : empty}${
            draft.otherRegionsOk ? ` + ${t('wz.region.other').toLowerCase()}` : ''
          }`}
          onEdit={() => onEdit('region')}
        />
        <ReviewRow
          label={t('wz.review.budget')}
          value={draft.budgetUzs ? money(draft.budgetUzs, lang) : empty}
          onEdit={() => onEdit('budget')}
        />
        <ReviewRow label={t('wz.review.date')} value={dateText} onEdit={() => onEdit('date')} />
        <ReviewRow
          label={t('wz.review.note')}
          value={draft.note.trim() || empty}
          multiline
          onEdit={() => onEdit('note')}
        />
      </Card>

      {matching !== null && (
        <Notice tone={matching === 0 ? 'warning' : 'info'}>
          {matching === 0 ? t('wz.region.none') : t('wz.review.goesTo', { n: matching })}
        </Notice>
      )}

      <TermsCheckbox accepted={termsAccepted} onChange={onTermsChange} onOpen={() => setTermsOpen(true)} />
      <TermsSheet open={termsOpen} onClose={() => setTermsOpen(false)} onAccept={() => onTermsChange(true)} />
    </>
  );
}

function ReviewRow({
  label,
  value,
  multiline,
  onEdit,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onEdit: () => void;
}) {
  const { t } = useApp();
  return (
    <div className="wz-review-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="wz-review-row__label">{label}</div>
        <div className={`wz-review-row__value ${multiline ? '' : 'truncate'}`}>{value}</div>
      </div>
      <button className="wz-review-row__edit" onClick={onEdit}>
        {t('common.edit')}
      </button>
    </div>
  );
}

/* ─────────────────────────  Umumiy toggle qatori  ───────────────────────── */

export function ToggleRow({
  on,
  title,
  hint,
  onToggle,
}: {
  on: boolean;
  title: string;
  hint?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`toggle-row ${on ? 'toggle-row--on' : ''}`}
      onClick={() => {
        haptic.select();
        onToggle();
      }}
      aria-pressed={on}
    >
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span className="toggle-row__title">{title}</span>
        {hint && <span className="toggle-row__hint">{hint}</span>}
      </span>
      <span className="toggle-row__switch" aria-hidden>
        <m.span className="toggle-row__knob" animate={{ x: on ? 18 : 0 }} transition={spring} />
      </span>
    </button>
  );
}


/* ─────────────────────────  1. So'rov kimga  ───────────────────────── */

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 120 }, (_, i) => CURRENT_YEAR - i);

/**
 * Bemor o'zi uchun ham, yaqini uchun ham so'rov qoldirishi mumkin.
 *
 * O'ziga bo'lsa profil ma'lumotlari ishlatiladi va hech narsa so'ralmaydi.
 * Tanishiga bo'lsa profil ma'lumotlari ISHLATILMAYDI — aks holda klinika
 * noto'g'ri odamning yoshi va jinsini ko'rib, noto'g'ri taklif berardi.
 */
function WhoStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const { t, user } = useApp();

  const profileSummary = [
    `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim(),
    ageFromBirthYear(user?.birthYear) != null ? t('reg.age', { n: ageFromBirthYear(user?.birthYear)! }) : null,
    user?.gender ? t(`reg.gender.${user.gender}` as any) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <StepHead title={t('wz.who.title')} sub={t('wz.who.sub')} />

      <div className="stack" style={{ gap: 8 }}>
        <Card
          className={`who-card ${draft.forSelf ? 'is-active' : ''}`}
          onClick={() => patch({ forSelf: true })}
        >
          <strong>{t('wz.who.self')}</strong>
          <span className="tiny">{t('wz.who.selfHint')}</span>
        </Card>

        <Card
          className={`who-card ${!draft.forSelf ? 'is-active' : ''}`}
          onClick={() => patch({ forSelf: false })}
        >
          <strong>{t('wz.who.other')}</strong>
          <span className="tiny">{t('wz.who.otherHint')}</span>
        </Card>
      </div>

      <AnimatePresence mode="wait">
        {draft.forSelf ? (
          <m.div key="self" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Notice tone="info">{t('wz.who.usingProfile', { v: profileSummary })}</Notice>
          </m.div>
        ) : (
          <m.div
            key="other"
            className="stack"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring}
          >
            <Field label={t('wz.who.name')}>
              <Input
                value={draft.subjectName}
                maxLength={120}
                placeholder={t('wz.who.namePh')}
                onChange={(e) => patch({ subjectName: e.target.value })}
              />
            </Field>

            <Field label={t('wz.who.birthYear')}>
              <Select
                value={draft.subjectBirthYear ?? ''}
                aria-label={t('wz.who.birthYear')}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  patch({ subjectBirthYear: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">{t('reg.choose')}</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('wz.who.gender')}>
              <div className="row" style={{ gap: 6 }}>
                {GENDERS.map((g) => (
                  <Chip key={g} active={draft.subjectGender === g} onClick={() => patch({ subjectGender: g })}>
                    {t(`reg.gender.${g}` as any)}
                  </Chip>
                ))}
              </div>
            </Field>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}
