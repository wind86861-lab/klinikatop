/**
 * Bitim ekrani — bemor va klinika uchun bitta.
 * Bosqichli stepper + chat + kontekstga bog'liq amallar (sana, bajarildi, tasdiqlash, sharh).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { channelFor, onServerEvent, sendTyping, subscribe } from '@/lib/ws';
import { clockTime, formatDate, groupDigits, money } from '@/lib/format';
import { haptic } from '@/lib/telegram';
import { popVariants, spring } from '@/lib/motion';
import { opName } from '@/i18n';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  IconCheck,
  IconSend,
  IconShield,
  Input,
  Notice,
  Screen,
  Sheet,
  SkeletonList,
  Stars,
  Stepper,
  Textarea,
} from '@/ui';
import { DEAL_STEPS, REVIEW_ASPECTS, type ChatMessage, type DealDetail, type ReviewAspect } from '@shared/types';
import { PriceChangePanel } from '@/components/PriceChangePanel';

export function DealScreen() {
  const { id } = useParams();
  const dealId = Number(id);
  const navigate = useNavigate();
  const { t, lang, user, session, toast } = useApp();

  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);

  const [sheet, setSheet] = useState<null | 'schedule' | 'confirm' | 'review' | 'dispute'>(null);

  const chatRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number | null>(null);
  const isClinicSide = Boolean(session?.clinic && deal && session.clinic.id === deal.clinicId);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.deal(dealId);
      setDeal(data.deal);
      setMessages(data.messages);
      if (data.unread > 0) void api.readMessages(dealId);
    } catch (err: any) {
      setError(err?.message ?? t('common.error'));
    }
  }, [dealId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Jonli chat va bitim holati
  useEffect(() => {
    if (!Number.isFinite(dealId)) return;
    const unsubscribe = subscribe(channelFor.deal(dealId));

    const off = onServerEvent((event) => {
      if (event.type === 'chat:message' && event.dealId === dealId) {
        setMessages((prev) => (prev.some((m) => m.id === event.message.id) ? prev : [...prev, event.message]));
        setPeerTyping(false);
        if (event.message.senderId !== user?.id) {
          haptic.tap();
          void api.readMessages(dealId);
        }
      } else if (event.type === 'chat:typing' && event.dealId === dealId && event.userId !== user?.id) {
        setPeerTyping(true);
        if (typingTimer.current) window.clearTimeout(typingTimer.current);
        typingTimer.current = window.setTimeout(() => setPeerTyping(false), 2500);
      } else if (event.type === 'deal:status' && event.dealId === dealId) {
        void load();
      }
    });

    return () => {
      unsubscribe();
      off();
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
    };
  }, [dealId, user?.id, load]);

  // Yangi xabar kelganda pastga tushish
  useLayoutEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, peerTyping]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    try {
      const message = await api.sendMessage(dealId, text);
      // Optimistik emas — server tozalangan matnni qaytaradi (raqam yashirilishi mumkin)
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      haptic.tap();
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const act = async (fn: () => Promise<DealDetail>, successKey?: string) => {
    try {
      const updated = await fn();
      setDeal(updated);
      setSheet(null);
      haptic.success();
      if (successKey) toast(successKey, 'success');
      void load();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  if (error) {
    return (
      <Screen title={t('deal.title')} onBack={() => navigate(-1)}>
        <ErrorState message={error} retryLabel={t('common.retry')} onRetry={load} />
      </Screen>
    );
  }

  if (!deal) {
    return (
      <Screen title={t('deal.title')} onBack={() => navigate(-1)}>
        <SkeletonList count={3} />
      </Screen>
    );
  }

  // TASDIQLANGAN — yakuniy bosqich: oxirgi qadam ham "bajarildi" belgisini oladi
  const stepIndex =
    deal.status === 'CONFIRMED' ? DEAL_STEPS.length : DEAL_STEPS.indexOf(deal.status as any);
  const terminal = deal.status === 'CANCELLED' || deal.status === 'DISPUTED';
  const counterpartName = isClinicSide ? deal.patientName : deal.clinic.name;

  return (
    <div className="screen" style={{ height: '100dvh', overflow: 'hidden' }}>
      <header className="app-header">
        <div className="row">
          <button className="app-header__back" onClick={() => navigate(isClinicSide ? '/clinic' : '/')} aria-label={t('common.back')}>
            ‹
          </button>
          <Avatar name={counterpartName} url={isClinicSide ? null : deal.clinic.logoUrl} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 5 }}>
              <strong className="truncate">{counterpartName}</strong>
              {!isClinicSide && deal.clinic.verified && (
                <span style={{ color: 'var(--primary)' }} title={t('offers.verified')}>
                  <IconShield size={13} />
                </span>
              )}
            </div>
            <div className="app-header__sub truncate">{opName(deal.request.operation, lang)}</div>
          </div>
        </div>
      </header>

      {/* Bitim holati */}
      <div style={{ padding: 'var(--s-3) var(--s-4)', background: 'var(--bg)' }}>
        <Card variant="flat" className="stack">
          {terminal ? (
            <Badge tone={deal.status === 'DISPUTED' ? 'warning' : 'danger'}>
              {t(`deal.status.${deal.status}` as any)}
            </Badge>
          ) : (
            <Stepper steps={DEAL_STEPS.map((s) => t(`deal.step.${s}` as any))} current={Math.max(0, stepIndex)} />
          )}

          <div className="between">
            <span className="tiny">{t('deal.agreedPrice')}</span>
            <strong className="num">{money(deal.agreedPriceUzs, lang)}</strong>
          </div>

          {deal.scheduledAt && (
            <div className="between">
              <span className="tiny">{t('deal.scheduled')}</span>
              <strong className="num">{formatDate(deal.scheduledAt, lang)}</strong>
            </div>
          )}

          {deal.status === 'CONFIRMED' && deal.confirmedAmountUzs && (
            <div className="between">
              <span className="tiny">{t('deal.paidSum')}</span>
              <strong className="num" style={{ color: 'var(--success)' }}>
                {money(deal.confirmedAmountUzs, lang)}
              </strong>
            </div>
          )}

          {/*
            Komissiya faqat KLINIKAGA ko'rsatiladi va faqat yopilgach.
            Bu klinikaning pulidan chiqadi — "qancha oldingiz" degan
            savol albatta keladi va javob shu yerda turishi kerak.
            Bemorga bu raqamning ma'nosi yo'q: u to'liq summani to'laydi.
          */}
          {isClinicSide && deal.status === 'CONFIRMED' && deal.commissionUzs !== null && (
            <div className="between">
              <span className="tiny">
                Platforma komissiyasi
                {deal.commissionPercent !== null && ` · ${deal.commissionPercent}%`}
              </span>
              <strong className="num">{money(deal.commissionUzs, lang)}</strong>
            </div>
          )}

          {/*
            Navbat kimda ekani har doim ko'rinib tursin.

            Sana kelishilgach to'lov navbati BEMORda: unda tugma bor,
            klinika esa kutadi. To'lov bildirilgach navbat klinikaga
            o'tadi — endi u operatsiyani yakunlaydi.
          */}
          {deal.status === 'AGREED' && isClinicSide && <Notice>{t('deal.awaitingPaymentClinic')}</Notice>}
          {deal.status === 'AGREED' && !isClinicSide && <Notice>{t('deal.awaitingPayment')}</Notice>}
          {deal.status === 'PAID' && (
            <Notice>{t(isClinicSide ? 'deal.awaitingReceiptClinic' : 'deal.awaitingReceipt')}</Notice>
          )}

          <DealActions
            deal={deal}
            isClinicSide={isClinicSide}
            onSchedule={() => setSheet('schedule')}
            onConfirm={() => setSheet('confirm')}
            onReceipt={() => act(() => api.confirmReceipt(dealId))}
            onReview={() => setSheet('review')}
            onDispute={() => setSheet('dispute')}
          />
        </Card>

        {/*
          Narxni o'zgartirish — ish bajarilgunicha.
          Bajarilgandan keyin o'zgartirish qilingan ishning narxini
          keyin ko'tarish bo'lardi; u yerda nizo yo'li bor.
        */}
        <PriceChangePanel
          dealId={deal.id}
          agreedPriceUzs={deal.agreedPriceUzs}
          side={isClinicSide ? 'clinic' : 'patient'}
          editable={deal.status === 'SELECTED' || deal.status === 'AGREED'}
          onChanged={load}
        />
      </div>

      {/* Chat */}
      <div className="chat" ref={chatRef}>
        {messages.length === 0 && (
          <p className="tiny" style={{ textAlign: 'center', padding: 'var(--s-6)' }}>
            {t('chat.empty')}
          </p>
        )}

        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <Bubble key={message.id} message={message} mine={message.senderId === user?.id} />
          ))}
        </AnimatePresence>

        {peerTyping && (
          <m.div variants={popVariants} initial="initial" animate="animate" exit="exit" className="bubble bubble--theirs">
            <span className="typing" aria-label={t('chat.typing')}>
              <span />
              <span />
              <span />
            </span>
          </m.div>
        )}
      </div>

      {/* Yozish paneli */}
      {deal.status !== 'CANCELLED' ? (
        <div className="composer">
          <textarea
            className="composer__input"
            value={draft}
            rows={1}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            onChange={(e) => {
              setDraft(e.target.value);
              sendTyping(dealId);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="composer__send" onClick={send} disabled={!draft.trim() || sending} aria-label={t('common.send')}>
            <IconSend size={19} />
          </button>
        </div>
      ) : (
        <div className="composer">
          <Notice tone="warning">{t('deal.status.CANCELLED')}</Notice>
        </div>
      )}

      {/* ── Varaqlar ── */}

      <ScheduleSheet
        open={sheet === 'schedule'}
        onClose={() => setSheet(null)}
        onSubmit={(date) => act(() => api.schedule(dealId, date))}
      />

      <ConfirmSheet
        open={sheet === 'confirm'}
        deal={deal}
        onClose={() => setSheet(null)}
        onConfirm={(amount) => act(() => api.declarePayment(dealId, amount))}
        onReject={(reason) => act(() => api.disputeDeal(dealId, reason))}
      />

      <ReviewSheet
        open={sheet === 'review'}
        onClose={() => setSheet(null)}
        onSubmit={async (scores, body) => {
          try {
            await api.review(dealId, { ...scores, body });
            haptic.success();
            toast(t('review.thanks'), 'success');
            setSheet(null);
            void load();
          } catch (err: any) {
            haptic.error();
            toast(err?.message ?? t('common.error'), 'error');
          }
        }}
      />

      <ReasonSheet
        open={sheet === 'dispute'}
        title={t('deal.dispute')}
        label={t('deal.disputeReason')}
        onClose={() => setSheet(null)}
        onSubmit={(reason) => act(() => api.disputeDeal(dealId, reason))}
      />
    </div>
  );
}

/* ─────────────────────────  Kontekst tugmalari  ───────────────────────── */

function DealActions({
  deal,
  isClinicSide,
  onSchedule,
  onConfirm,
  onReceipt,
  onReview,
  onDispute,
}: {
  deal: DealDetail;
  isClinicSide: boolean;
  onSchedule: () => void;
  onConfirm: () => void;
  onReceipt: () => void;
  onReview: () => void;
  onDispute: () => void;
}) {
  const { t } = useApp();

  const buttons: React.ReactNode[] = [];

  if (deal.status === 'SELECTED') {
    buttons.push(
      <Button key="schedule" size="sm" block onClick={onSchedule}>
        {t('deal.setDate')}
      </Button>,
    );
  }

  /*
   * Sana kelishilgach to'lov navbati bemorda. Ilgari bu tugma
   * klinika "bajarildi" deb belgilaganidan KEYIN chiqardi; endi
   * to'lov birinchi bosqich.
   */
  if (deal.status === 'AGREED' && !isClinicSide) {
    buttons.push(
      <Button key="confirm" size="sm" block onClick={onConfirm}>
        {t('deal.declarePayment')}
      </Button>,
    );
  }

  /*
   * To'lov bildirilgach navbat KLINIKAda: u pulni olganini va
   * operatsiya bajarilganini tasdiqlab bitimni yopadi. Bemor
   * tomonida bu bosqichda tugma yo'q — u faqat kutadi (holat
   * matni buni aytadi).
   */
  if (deal.status === 'PAID' && isClinicSide) {
    buttons.push(
      <Button key="receipt" size="sm" block onClick={onReceipt}>
        {t('deal.confirmReceipt')}
      </Button>,
    );
  }

  if (deal.status === 'CONFIRMED' && !isClinicSide && !deal.hasReview) {
    buttons.push(
      <Button key="review" size="sm" block onClick={onReview}>
        {t('review.submit')}
      </Button>,
    );
  }

  if (deal.status !== 'CONFIRMED' && deal.status !== 'CANCELLED' && deal.status !== 'DISPUTED') {
    buttons.push(
      <Button key="dispute" size="sm" variant="ghost" onClick={onDispute}>
        {t('deal.dispute')}
      </Button>,
    );
  }

  if (!buttons.length) return null;
  return (
    <div className="row" style={{ gap: 'var(--s-2)' }}>
      {buttons}
    </div>
  );
}

/* ─────────────────────────  Xabar pufakchasi  ───────────────────────── */

function Bubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const { t } = useApp();

  if (message.kind === 'system') {
    return (
      <m.div className="bubble bubble--system" variants={popVariants} initial="initial" animate="animate">
        {message.body}
      </m.div>
    );
  }

  return (
    <m.div
      className={`bubble ${mine ? 'bubble--mine' : 'bubble--theirs'}`}
      initial={{ opacity: 0, y: 12, scale: 0.97, x: mine ? 12 : -12 }}
      animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
      transition={spring}
      layout
    >
      <div>{message.body}</div>
      {message.redacted && <div className="bubble__redacted">{t('chat.redacted')}</div>}
      <div className="bubble__meta">
        {clockTime(message.createdAt)}
        {mine && message.readAt && <IconCheck size={11} />}
      </div>
    </m.div>
  );
}

/* ─────────────────────────  Varaqlar  ───────────────────────── */

function ScheduleSheet({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (iso: string) => void;
}) {
  const { t } = useApp();
  const [date, setDate] = useState('');

  const min = new Date().toISOString().slice(0, 10);

  return (
    <Sheet open={open} onClose={onClose} title={t('deal.setDate')}>
      <Field label={t('deal.scheduled')}>
        <Input type="date" min={min} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Button block disabled={!date} onClick={() => onSubmit(new Date(date).toISOString())}>
        {t('common.confirm')}
      </Button>
    </Sheet>
  );
}

function ConfirmSheet({
  open,
  deal,
  onClose,
  onConfirm,
  onReject,
}: {
  open: boolean;
  deal: DealDetail;
  onClose: () => void;
  onConfirm: (amount: number) => void;
  onReject: (reason: string) => void;
}) {
  const { t, lang } = useApp();
  const [amount, setAmount] = useState(deal.agreedPriceUzs);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <Sheet open={open} onClose={onClose} title={t('confirm.title')}>
      <p className="tiny">{t('confirm.subtitle')}</p>

      {!rejecting ? (
        <>
          <Field label={t('confirm.amount')} hint={t('confirm.amountHint')}>
            <Input
              className="input--money"
              inputMode="numeric"
              value={groupDigits(amount)}
              onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, '')) || 0)}
              aria-label={t('confirm.amount')}
            />
          </Field>

          <div className="between">
            <span className="tiny">{t('deal.agreedPrice')}</span>
            <span className="num">{money(deal.agreedPriceUzs, lang)}</span>
          </div>

          <Button block disabled={amount < 100_000} onClick={() => onConfirm(amount)}>
            {t('confirm.yes')}
          </Button>
          <Button block variant="ghost" onClick={() => setRejecting(true)}>
            {t('confirm.no')}
          </Button>
        </>
      ) : (
        <>
          <Field label={t('deal.disputeReason')}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </Field>
          <Button block variant="danger" disabled={reason.trim().length < 3} onClick={() => onReject(reason)}>
            {t('common.confirm')}
          </Button>
          <Button block variant="ghost" onClick={() => setRejecting(false)}>
            {t('common.back')}
          </Button>
        </>
      )}
    </Sheet>
  );
}

function ReviewSheet({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (scores: Record<ReviewAspect, number>, body: string | null) => void;
}) {
  const { t } = useApp();
  const [scores, setScores] = useState<Record<ReviewAspect, number>>({
    quality: 0,
    attitude: 0,
    cleanliness: 0,
    result: 0,
  });
  const [body, setBody] = useState('');

  const complete = REVIEW_ASPECTS.every((a) => scores[a] > 0);

  return (
    <Sheet open={open} onClose={onClose} title={t('review.title')}>
      <Notice tone="info">{t('review.motivation')}</Notice>

      {REVIEW_ASPECTS.map((aspect) => (
        <div className="between" key={aspect}>
          <span>{t(`review.${aspect}` as any)}</span>
          <Stars value={scores[aspect]} onChange={(v) => setScores((s) => ({ ...s, [aspect]: v }))} />
        </div>
      ))}

      <Field label={t('review.comment')}>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('review.commentPlaceholder')} rows={3} />
      </Field>

      <Button block disabled={!complete} onClick={() => onSubmit(scores, body.trim() || null)}>
        {t('review.submit')}
      </Button>
    </Sheet>
  );
}

function ReasonSheet({
  open,
  title,
  label,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const { t } = useApp();
  const [reason, setReason] = useState('');

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <Field label={label}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Field>
      <Button block variant="danger" disabled={reason.trim().length < 3} onClick={() => onSubmit(reason)}>
        {t('common.confirm')}
      </Button>
    </Sheet>
  );
}
