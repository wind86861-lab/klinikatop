/**
 * So'rov vizardi — har qadamda bitta savol.
 *
 * 1 Operatsiya (katalog / AI / bilmayman) → 2 Holat → 3 Hujjatlar →
 * 4 Viloyat → 5 Byudjet → 6 Sana → 7 Izoh → 8 Ko'rib chiqish va oferta.
 *
 * Holat bitta joyda (`draft`) turadi; har qadam faqat o'z bo'lagini o'zgartiradi.
 * Orqaga qaytish hech narsani yo'qotmaydi.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
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
import { CustomStep } from '@/components/wizard/CustomStep';
import { PriceChart } from '@/components/Visuals';
import {
  Button,
  Card,
  Chip,
  CountUp,
  Field,
  IconClock,
  Input,
  Notice,
  Screen,
  Select,
  Skeleton,
  Textarea,
} from '@/ui';
import {
  GENDERS,
  REQUEST_KINDS,
  STEP_FLOWS,
  ageFromBirthYear,
  type BuiltinStep,
  type ChatTurn,
  type Gender,
  type LabOrgan,
  type Operation,
  type PriceStats,
  type RequestKind,
  type StoredFile,
  type Urgency,
  type WizardStep,
} from '@shared/types';

/** Vizard qoralamasi — bitta manba. */
export interface Draft {
  /** Operatsiya aniqlanmaganda — AI aniqlagan soha */
  fallbackCategoryId: number | null;
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
  /** Operatsiya so'rovimi yoki tahlil — oqim shunga qarab ajraladi */
  kind: RequestKind;
  /** Tahlil so'rovida: qaysi organ tekshiriladi */
  labOrgan: LabOrgan | null;
  /** Tahlil so'rovida: bemor vazni (kg) */
  weightKg: number | null;
}

/*
 * "Kimga" eng boshida turadi: javob keyingi qadamlarga ta'sir qiladi
 * (o'ziga bo'lsa profil ma'lumotlari ishlatiladi), shuning uchun uni
 * oxirida so'rash kech bo'lardi.
 */
/*
 * Zaxira ro'yxat. Bosqichlar admin panelidan keladi, lekin so'rov
 * javob bermasa bemor ilovasiz qolmasligi kerak — shunda shu ishlatiladi.
 */
const FALLBACK_STEPS: WizardStep[] = [
  'who', 'type', 'operation', 'condition', 'documents', 'weight', 'organ',
  'region', 'budget', 'date', 'note', 'review',
].map((key) => ({
  key,
  kind: 'builtin' as const,
  required: false,
  title: null,
  sub: null,
  options: null,
  flows: STEP_FLOWS[key as BuiltinStep] ?? REQUEST_KINDS,
}));

type Step = string;

export function NewRequest() {
  const { t, user, session, toast } = useApp();
  const navigate = useNavigate();

  const [allSteps, setSteps] = useState<WizardStep[]>(FALLBACK_STEPS);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [draft, setDraft] = useState<Draft>({
    kind: 'operation',
    labOrgan: null,
    weightKg: null,
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
    /* Operatsiya aniqlanmaganda — AI aniqlagan soha; so'rov shu yo'nalishga boradi */
    fallbackCategoryId: null,
    forSelf: true,
    subjectName: '',
    subjectBirthYear: null,
    subjectGender: null,
  });

  const patch = (part: Partial<Draft>) => setDraft((d) => ({ ...d, ...part }));
  const answer = (key: string, value: unknown) => setAnswers((a) => ({ ...a, [key]: value }));

  /*
   * Bosqichlarni admin belgilaydi. Xato bo'lsa zaxira ro'yxat qoladi —
   * so'rov qoldirish imkoniyati sozlama tufayli yo'qolmasligi kerak.
   */
  useEffect(() => {
    let alive = true;
    api
      .requestSteps()
      .then((list) => {
        if (alive && list.length) setSteps(list);
      })
      .catch(() => {
        /* zaxira ro'yxat bilan davom etamiz */
      });
    return () => {
      alive = false;
    };
  }, []);

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

  /*
   * Ko'rinadigan bosqichlar TURGA bog'liq.
   *
   * Operatsiya yo'lida operatsiya, holat va hujjatlar bor; tahlil
   * yo'lida esa vazn va organ. Ularni bitta ro'yxatda qoldirib,
   * ekranda yashirish yetarli emas edi: "3 / 9" hisoblagichi
   * bemorga hech qachon ko'rmaydigan bosqichlarni ham sanardi.
   */
  const steps = useMemo(
    () => allSteps.filter((s) => (s.flows ?? REQUEST_KINDS).includes(draft.kind)),
    [allSteps, draft.kind],
  );

  const current = steps[Math.min(index, steps.length - 1)];
  const step = current?.key ?? 'review';
  /** Bosqich kaliti bo'yicha o'rni — tartib o'zgargani uchun qidiriladi */
  const indexOf = (key: string) => steps.findIndex((s) => s.key === key);
  /** Shu bosqichdan keyingisi; oxirgisi bo'lsa o'sha joyda qoladi */
  const nextAfter = (key: string) => Math.min(indexOf(key) + 1, steps.length - 1);

  /** Har qadamning "davom etish" sharti. Ixtiyoriy qadamlar doim o'tadi. */
  const canAdvance = useMemo(() => {
    // Admin qo'shgan savol: majburiy bo'lsa javob bo'lishi shart
    if (current && current.kind !== 'builtin') {
      if (!current.required) return true;
      const v = answers[current.key];
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'string') return v.trim().length > 0;
      return v !== undefined && v !== null && v !== '';
    }
    switch (step) {
      case 'who':
        // Tanishiga bo'lsa uning ma'lumotlari to'liq bo'lishi kerak
        return (
          draft.forSelf ||
          (draft.subjectName.trim().length >= 2 && draft.subjectBirthYear !== null && draft.subjectGender !== null)
        );
      case 'type':
        // Doim tanlangan qiymat bor, shuning uchun to'siq yo'q
        return true;
      case 'operation':
        return draft.operation !== null;
      case 'weight':
        return draft.weightKg !== null && draft.weightKg >= 2 && draft.weightKg <= 400;
      case 'organ':
        return draft.labOrgan !== null;
      case 'condition':
        return draft.conditionText.trim().length >= 10;
      case 'region':
        return draft.cityId !== null;
      case 'review':
        return termsAccepted;
      default:
        return true;
    }
  }, [step, current, answers, draft, termsAccepted]);

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0) {
      navigate(-1);
      return;
    }
    if (next >= steps.length) return;
    setDirection(delta);
    setIndex(next);
    haptic.select();
    window.scrollTo({ top: 0 });
  };

  const jumpTo = (target: Step) => {
    setDirection(-1);
    setIndex(Math.max(0, indexOf(target)));
    window.scrollTo({ top: 0 });
  };

  const submit = async () => {
    /*
     * Yuborish sharti TURGA bog'liq: operatsiya so'rovida operatsiya,
     * tahlilda esa organ va vazn bo'lishi kerak.
     */
    const ready =
      draft.kind === 'lab' ? Boolean(draft.labOrgan && draft.weightKg) : Boolean(draft.operation);
    if (!ready || !draft.cityId || !termsAccepted) return;

    setSubmitting(true);
    try {
      const request = await api.createRequest({
        kind: draft.kind,
        operationId: draft.kind === 'lab' ? null : (draft.operation?.id ?? null),
        labOrganId: draft.kind === 'lab' ? (draft.labOrgan?.id ?? null) : null,
        weightKg: draft.kind === 'lab' ? draft.weightKg : null,
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
        fallbackCategoryId: draft.fallbackCategoryId,
        acceptTerms: true,
        extraAnswers: Object.keys(answers).length ? answers : null,
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
      title={t('wz.step', { n: index + 1, total: steps.length })}
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
        {steps.map((s, i) => (
          <m.span
            key={s.key}
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

          {step === 'type' && (
            <TypeStep
              draft={draft}
              onPick={(kind) => {
                /*
                 * Turni almashtirsa BOSHQA oqimning javoblari tozalanadi.
                 *
                 * Aks holda odam operatsiyani tanlab, keyin tahlilga
                 * o'tsa, so'rov ikkalasini ham olib ketardi va server
                 * qaysi biri to'g'ri ekanini bilmasdi.
                 */
                patch(
                  kind === 'lab'
                    ? { kind, operation: null, conditionText: '', files: [], aiConversation: null, fallbackCategoryId: null }
                    : { kind, labOrgan: null, weightKg: null },
                );
                setDirection(1);
                setIndex(nextAfter('type'));
                haptic.press();
                window.scrollTo({ top: 0 });
              }}
            />
          )}

          {step === 'weight' && <WeightStep draft={draft} patch={patch} />}
          {step === 'organ' && (
            <OrganStep
              draft={draft}
              onPick={(labOrgan) => {
                patch({ labOrgan });
                setDirection(1);
                setIndex(nextAfter('organ'));
                haptic.press();
                window.scrollTo({ top: 0 });
              }}
            />
          )}

          {step === 'operation' && (
            <OperationStep
              draft={draft}
              onPick={(operation, aiSuggested) => {
                patch({ operation, aiSuggested });
                // Tanlangach avtomatik keyingi qadamga — bitta tegish kamayadi.
                // Qattiq raqam emas: admin tartibni o'zgartirgan bo'lishi mumkin.
                setDirection(1);
                setIndex(nextAfter('operation'));
                haptic.press();
                window.scrollTo({ top: 0 });
              }}
              onChatDone={({ operation, conditionText, turns, fallbackCategoryId }) => {
                // Bitta matn ikki joyga: AI aniqlagan operatsiya + bemorning o'z so'zlari
                patch({
                  operation,
                  aiSuggested: operation !== null,
                  conditionText,
                  aiConversation: turns,
                  fallbackCategoryId,
                });
                setDirection(1);
                setIndex(nextAfter('operation'));
                haptic.press();
                window.scrollTo({ top: 0 });
              }}
            />
          )}

          {current && current.kind !== 'builtin' && (
            <CustomStep step={current} value={answers[current.key]} onChange={(v: unknown) => answer(current.key, v)} />
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

/* ─────────────────────────  Tur, vazn va organ  ───────────────────────── */

/**
 * So'rov turi — oqim shu yerda ikkiga ajraladi.
 *
 * Ikkita katta karta, uchinchisi yo'q: bemor "operatsiya kerak"
 * yoki "tekshiruvdan o'tishim kerak" deb keladi va oralig'i yo'q.
 */
function TypeStep({ draft, onPick }: { draft: Draft; onPick: (kind: RequestKind) => void }) {
  const { t } = useApp();

  const cards: { kind: RequestKind; icon: string; title: string; sub: string }[] = [
    { kind: 'operation', icon: '🩺', title: t('wz.type.operation'), sub: t('wz.type.operationSub') },
    { kind: 'lab', icon: '🔬', title: t('wz.type.lab'), sub: t('wz.type.labSub') },
  ];

  return (
    <>
      <StepHead title={t('wz.type.title')} sub={t('wz.type.sub')} />
      <div className="stack" style={{ gap: 'var(--s-3)' }}>
        {cards.map((c) => (
          <Card
            key={c.kind}
            variant={draft.kind === c.kind ? 'default' : 'flat'}
            className={`kindcard ${draft.kind === c.kind ? 'is-active' : ''}`}
            onClick={() => onPick(c.kind)}
          >
            <span className="kindcard__icon">{c.icon}</span>
            <span className="stack" style={{ gap: 2 }}>
              <strong>{c.title}</strong>
              <span className="tiny">{c.sub}</span>
            </span>
          </Card>
        ))}
      </div>
    </>
  );
}

/**
 * Vazn — tahlil so'rovida.
 *
 * Ko'p tekshiruvda doza va uskuna sozlamasi vaznga bog'liq. O'ziga
 * so'rov qoldirsa profildagi qiymat AVTOMATIK to'ladi, lekin qulflab
 * qo'yilmaydi: odamning vazni o'zgaradi va u shu yerda tuzatishi
 * mumkin bo'lishi kerak. Tuzatgani profilga ham yoziladi.
 */
function WeightStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const { t, user } = useApp();

  useEffect(() => {
    if (draft.weightKg == null && draft.forSelf && user?.weightKg) {
      patch({ weightKg: user.weightKg });
    }
    // Faqat birinchi ochilishda — keyin odam o'zi boshqaradi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <StepHead title={t('wz.weight.title')} sub={t('wz.weight.sub')} />
      <Field label={t('wz.weight.label')} hint={t('wz.weight.hint')}>
        <Input
          className="input--money num"
          inputMode="numeric"
          value={draft.weightKg == null ? '' : String(draft.weightKg)}
          placeholder="70"
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
            patch({ weightKg: digits ? Number(digits) : null });
          }}
        />
      </Field>
      {draft.weightKg != null && (draft.weightKg < 2 || draft.weightKg > 400) && (
        <Notice tone="warning">{t('wz.weight.range')}</Notice>
      )}
    </>
  );
}

/**
 * Qaysi organ uchun tahlil.
 *
 * Ro'yxat serverdan keladi va tekis: organlar o'nga yaqin, ularni
 * daraxtga solish faqat ortiqcha bosish qo'shardi.
 */
function OrganStep({ draft, onPick }: { draft: Draft; onPick: (organ: LabOrgan) => void }) {
  const { t, lang } = useApp();
  const [organs, setOrgans] = useState<LabOrgan[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .labOrgans()
      .then((list) => alive && setOrgans(list))
      .catch(() => alive && setOrgans([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <StepHead title={t('wz.organ.title')} sub={t('wz.organ.sub')} />
      {organs === null ? (
        <div className="stack">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={52} />)}</div>
      ) : (
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          {organs.map((o) => (
            <Card
              key={o.id}
              variant="flat"
              className={`organrow ${draft.labOrgan?.id === o.id ? 'is-active' : ''}`}
              onClick={() => onPick(o)}
            >
              <span className="organrow__icon">{o.icon}</span>
              <strong>{lang === 'ru' ? o.nameRu : o.nameUz}</strong>
            </Card>
          ))}
        </div>
      )}
    </>
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
  /*
   * Statistika operatsiya va shaharga bog'liq. Admin bosqichlarni
   * qayta tartiblagan bo'lsa byudjet ulardan OLDIN kelishi mumkin —
   * o'shanda so'rov umuman yuborilmaydi va skelet abadiy aylanib
   * turardi. Shuning uchun kutish holati alohida belgilanadi.
   */
  const canLoadStats = Boolean(draft.operation && draft.cityId);

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
  /* Tegilmagan slayder shu yerda turadi — bu taklif, tanlov emas */
  const suggested = stats?.median ?? Math.round((range.min + range.max) / 2);

  return (
    <>
      <StepHead title={t('wz.budget.title')} sub={t('wz.budget.sub')} />

      {/*
        Faqat REAL bitimlardan chiqqan narx ko'rsatiladi. Bozor tadqiqotidan
        olingan "taxminiy oraliq" bu yerda chiqmaydi: bemor uni haqiqiy narx
        deb o'qib, byudjetini noto'g'ri qo'yib qo'yadi.
      */}
      {!canLoadStats ? null : !stats ? (
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

      {/*
        Slayder DARHOL ko'rinadi.

        Ilgari avval "Byudjetni ko'rsatish" tugmasini bosish kerak
        edi va bosmagan odam byudjet bo'limida umuman hech narsa
        ko'rmasdi — nima qilish kerakligi tushunarsiz edi.

        Endi slayder bor, lekin SURILMAGUNCHA byudjet
        "ko'rsatilmagan" bo'lib qoladi: tegmasdan o'tib ketsa
        `budgetUzs` null bo'lib boradi. Ya'ni ko'rsatish ixtiyoriy
        bo'lib qolaveradi, faqat endi u ko'rinib turadi.
      */}
      <Card className="stack">
        <div style={{ textAlign: 'center' }}>
          {draft.budgetUzs == null ? (
            <div className="budget-empty">
              <span className="budget-empty__value">{t('wz.budget.notSet')}</span>
              <span className="budget-empty__hint">{t('wz.budget.dragHint')}</span>
            </div>
          ) : (
            <div className="num" style={{ fontSize: 'var(--t-3xl)' }}>
              <CountUp value={draft.budgetUzs} format={(n) => groupDigits(n)} />
              <span style={{ fontSize: 'var(--t-md)', color: 'var(--body)' }}>
                {' '}
                {lang === 'ru' ? 'сум' : 'so‘m'}
              </span>
            </div>
          )}
        </div>

        <input
          className={`slider ${draft.budgetUzs == null ? 'is-untouched' : ''}`}
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          /* Tegilmagan holatda taklif qilingan joyda turadi, lekin qiymat null */
          value={draft.budgetUzs ?? suggested}
          onChange={(e) => patch({ budgetUzs: Number(e.target.value) })}
          aria-label={t('wz.budget.title')}
        />
        <div className="between">
          <span className="tiny">{money(range.min, lang)}</span>
          <span className="tiny">{money(range.max, lang)}</span>
        </div>

        {draft.budgetUzs != null && (
          <Button variant="ghost" size="sm" onClick={() => patch({ budgetUzs: null })}>
            {t('wz.budget.skip')}
          </Button>
        )}
      </Card>

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

/** `2026-09-17` → shu kunga N kun qo'shilgan sana, o'sha shaklda. */
function isoPlus(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // yozgi vaqt siljishi kunni o'zgartirmasin
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Ikki sana orasidagi kunlar soni, ikkalasi ham hisobga olinadi. */
function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T12:00:00Z').getTime();
  const b = new Date(to + 'T12:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Sana maydoni — o'qiladigan ko'rinish, tizim tanlagichi.
 *
 * Muammo: `<input type="date">` sanani BRAUZER tilida ko'rsatadi.
 * Telegram ichida bu ko'pincha amerikacha `09/17/2026` bo'lib
 * chiqadi va bemor uni 9-sentabr deb o'qiydi — ya'ni noto'g'ri
 * kunni tanlab, buni sezmaydi ham.
 *
 * Shuning uchun maydon o'zimizning matnimizni ko'rsatadi
 * ("17 sen 2026"), haqiqiy `input` esa ustida shaffof turadi:
 * bosilganda tizimning o'z tanlagichi ochiladi — telefonda u
 * eng qulay va tanish narsa. Ya'ni ko'rinish bizniki, tanlash
 * tizimniki.
 */
function DateField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: string | null;
  min: string;
  onChange: (v: string | null) => void;
}) {
  const { t, lang } = useApp();
  const ref = useRef<HTMLInputElement>(null);

  return (
    <label className="datefield">
      <span className="datefield__label">{label}</span>

      <span className={`datefield__box ${value ? 'is-set' : ''}`}>
        <IconClock size={15} />
        <span className="datefield__value">
          {value ? formatDate(value, lang) : t('wz.date.pick')}
        </span>

        <input
          ref={ref}
          className="datefield__input"
          type="date"
          min={min}
          value={value ?? ''}
          aria-label={label}
          onClick={() => {
            /*
             * `showPicker()` — kompyuterda bosish tanlagichni ochsin.
             * Telefonda maydonga fokus tushishining o'zi yetarli;
             * eski brauzerlarda usul yo'q va xato beradi.
             */
            try {
              ref.current?.showPicker?.();
            } catch {
              /* tanlagich baribir fokus orqali ochiladi */
            }
          }}
          onChange={(e) => onChange(e.target.value || null)}
        />
      </span>
    </label>
  );
}

function DateStep({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const { t, lang } = useApp();
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
            <div className="stack" style={{ gap: 'var(--s-3)' }}>
              {/*
                Tayyor oraliqlar — bemor odatda "ikki hafta ichida"
                deb o'ylaydi, "17-sentabrdan 24-sentabrgacha" deb
                emas. Bir bosishda ikkala sana ham to'ladi; aniq kun
                kerak bo'lsa quyida o'zgartiriladi.
              */}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {(
                  [
                    [7, t('wz.date.inWeek')],
                    [14, t('wz.date.inTwoWeeks')],
                    [30, t('wz.date.inMonth')],
                  ] as [number, string][]
                ).map(([days, label]) => {
                  const to = isoPlus(days);
                  return (
                    <Chip
                      key={days}
                      size="sm"
                      active={draft.dateFrom === today && draft.dateTo === to}
                      onClick={() => patch({ dateFrom: today, dateTo: to })}
                    >
                      {label}
                    </Chip>
                  );
                })}
              </div>

              <div className="row" style={{ gap: 'var(--s-2)', alignItems: 'flex-end' }}>
                <DateField
                  label={t('wz.date.from')}
                  value={draft.dateFrom}
                  min={today}
                  onChange={(v) => {
                    /*
                     * Boshlanish oxiridan keyinga surilsa, oxiri
                     * TOZALANADI. Aks holda ekranda "24-sentabrdan
                     * 20-sentabrgacha" degan mumkin bo'lmagan oraliq
                     * qolib ketardi.
                     */
                    if (v && draft.dateTo && draft.dateTo < v) patch({ dateFrom: v, dateTo: null });
                    else patch({ dateFrom: v });
                  }}
                />
                <DateField
                  label={t('wz.date.to')}
                  value={draft.dateTo}
                  min={draft.dateFrom ?? today}
                  onChange={(v) => patch({ dateTo: v })}
                />
              </div>

              {/*
                Tanlangan oraliq SO'Z bilan takrorlanadi. Maydonlardagi
                sana to'g'ri o'qilganini shu yerda ko'rish mumkin va
                oraliq necha kun ekani darrov ma'lum bo'ladi.
              */}
              {draft.dateFrom && draft.dateTo && (
                <div className="between">
                  <span className="tiny">
                    {formatDate(draft.dateFrom, lang)} — {formatDate(draft.dateTo, lang)} ·{' '}
                    {t('wz.date.days', { n: daysBetween(draft.dateFrom, draft.dateTo) })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => patch({ dateFrom: null, dateTo: null })}
                  >
                    {t('wz.date.clear')}
                  </Button>
                </div>
              )}
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
        {/*
          Ko'rib chiqishda ham ikki oqim: tahlil so'rovida operatsiya,
          holat va hujjatlar qatorlari umuman bo'lmaydi — ular bo'sh
          turgan bo'lardi va "tahrirlash" tugmasi mavjud bo'lmagan
          bosqichga olib borardi.
        */}
        {draft.kind === 'lab' ? (
          <>
            <ReviewRow
              label={t('wz.review.organ')}
              value={
                draft.labOrgan ? (lang === 'ru' ? draft.labOrgan.nameRu : draft.labOrgan.nameUz) : empty
              }
              onEdit={() => onEdit('organ')}
            />
            <ReviewRow
              label={t('wz.review.weight')}
              value={draft.weightKg ? `${draft.weightKg} kg` : empty}
              onEdit={() => onEdit('weight')}
            />
          </>
        ) : (
          <>
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
          </>
        )}
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
        {draft.kind === 'operation' && (
          <>
            <ReviewRow label={t('wz.review.date')} value={dateText} onEdit={() => onEdit('date')} />
            <ReviewRow
              label={t('wz.review.note')}
              value={draft.note.trim() || empty}
              multiline
              onEdit={() => onEdit('note')}
            />
          </>
        )}
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
