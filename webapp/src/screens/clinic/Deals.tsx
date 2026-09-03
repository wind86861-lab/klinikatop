/**
 * Bitim boshqaruvi — kabinetning 11, 12 va 13-ekranlari.
 *
 *   DealsBoard  — kanban: har bitim qaysi bosqichda
 *   ClinicDeal  — bitim tafsiloti va bosqich amallari
 *   ClinicChat  — bemor bilan yozishma
 *
 * Kanban ustunlari bitim holat mashinasiga to'g'ridan-to'g'ri mos keladi —
 * o'ylab topilgan bosqich yo'q. Shuning uchun taxta hech qachon haqiqatdan
 * ajralib qolmaydi.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { formatDate, money } from '@/lib/format';
import { opName } from '@/i18n';
import { AttachmentList } from '@/components/wizard/DocumentsStep';
import {
  Avatar,
  Button,
  Card,
  Field,
  IconChat,
  IconSend,
  Input,
  Notice,
  Screen,
  Skeleton,
  Stepper,
} from '@/ui';
import { Async, ClinicTabBar, useResource } from './shell';
import { DEAL_BOARD_COLUMNS, type ChatMessage, type DealDetail } from '@shared/types';

/* ═════════════════  11-ekran: bitimlar kanban  ═════════════════ */

export function DealsBoard() {
  const { t, lang } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => api.clinicDeals());

  return (
    <Screen title={t('board.title')} subtitle={t('board.sub')} tabBar={<ClinicTabBar />}>
      <Async
        resource={res}
        isEmpty={(d) => d.length === 0}
        empty={{ title: t('board.empty'), text: t('board.emptyText') }}
      >
        {(deals) => (
          <div className="kanban">
            {DEAL_BOARD_COLUMNS.map((column) => {
              const items = deals.filter((d) => d.status === column);
              return (
                <section key={column} className="kanban__col">
                  <header className="kanban__head">
                    <span>{t(`board.col.${column}` as any)}</span>
                    <span className="kanban__count num">{items.length}</span>
                  </header>

                  <div className="kanban__body">
                    <AnimatePresence initial={false}>
                      {items.map((deal) => (
                        <m.button
                          key={deal.id}
                          layout
                          type="button"
                          className="kanban__card"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={spring}
                          onClick={() => {
                            haptic.press();
                            navigate(`/clinic/deals/${deal.id}`);
                          }}
                        >
                          <strong className="truncate">{opName(deal.request.operation, lang)}</strong>
                          <span className="num">{money(deal.agreedPriceUzs, lang)}</span>
                          <span className="tiny truncate">{deal.patientName}</span>
                          {deal.scheduledAt && (
                            <span className="tiny">{formatDate(deal.scheduledAt, lang)}</span>
                          )}
                        </m.button>
                      ))}
                    </AnimatePresence>

                    {items.length === 0 && <div className="kanban__empty">—</div>}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </Async>
    </Screen>
  );
}

/* ═════════════════  12-ekran: bitim tafsiloti  ═════════════════ */

/*
 * Bosqichlar bemor ilovasidagi bilan BIR XIL bo'lishi shart. Ilgari
 * bu yerda `PAID` yo'q edi va klinika bitim qaysi bosqichda ekanini
 * noto'g'ri ko'rardi.
 */
const DEAL_STEPS = ['SELECTED', 'AGREED', 'PAID', 'CONFIRMED'] as const;

export function ClinicDeal() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const dealId = Number(id);

  const res = useResource(() => api.deal(dealId), [dealId]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      haptic.success();
      res.reload();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen onBack={() => navigate('/clinic/deals')} title={t('cdeal.title')}>
      <Async resource={res} skeleton={<Skeleton h={300} />}>
        {({ deal }: { deal: DealDetail }) => {
          // Tasdiqlangan bitimda bosqich to'liq — indeks oxiridan oshadi
          const stepIndex =
            deal.status === 'CONFIRMED'
              ? DEAL_STEPS.length
              : DEAL_STEPS.indexOf(deal.status as (typeof DEAL_STEPS)[number]);

          return (
            <>
              <Stepper
                steps={DEAL_STEPS.map((s) => t(`deal.step.${s}` as any))}
                current={stepIndex}
              />

              {(deal.status === 'CANCELLED' || deal.status === 'DISPUTED') && (
                <Notice tone="danger">
                  {t(`deal.status.${deal.status}` as any)}
                  {deal.disputeReason ? ` — ${deal.disputeReason}` : ''}
                </Notice>
              )}

              <Card className="stack">
                <div className="between">
                  <span className="tiny">{t('deal.agreedPrice')}</span>
                  <strong className="num">{money(deal.agreedPriceUzs, lang)}</strong>
                </div>
                <div className="between">
                  <span className="tiny">{t('board.patient')}</span>
                  <span className="row" style={{ gap: 8 }}>
                    <Avatar name={deal.patientName} size="sm" />
                    {deal.patientName}
                  </span>
                </div>
                {deal.scheduledAt && (
                  <div className="between">
                    <span className="tiny">{t('deal.scheduled')}</span>
                    <span>{formatDate(deal.scheduledAt, lang)}</span>
                  </div>
                )}
                {deal.confirmedAmountUzs != null && (
                  <div className="between">
                    <span className="tiny">{t('deal.paidSum')}</span>
                    <strong className="num">{money(deal.confirmedAmountUzs, lang)}</strong>
                  </div>
                )}
              </Card>

              <Card className="stack" style={{ gap: 6 }}>
                <strong>{opName(deal.request.operation, lang)}</strong>
                <p className="tiny">{deal.request.conditionText}</p>
                {deal.request.files && deal.request.files.length > 0 && (
                  <AttachmentList files={deal.request.files} />
                )}
              </Card>

              {/* Bosqich amallari — faqat shu bosqichda mumkin bo'lganlari */}
              {deal.status === 'SELECTED' && (
                <Card className="stack">
                  <Field label={t('deal.setDate')}>
                    <Input
                      type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                    />
                  </Field>
                  <Button
                    block
                    loading={busy}
                    disabled={!scheduledAt}
                    onClick={() => act(() => api.schedule(dealId, scheduledAt))}
                  >
                    {t('deal.setDate')}
                  </Button>
                </Card>
              )}

              {/*
                Sana kelishildi — navbat BEMORda: u to'lovni bildiradi.
                Klinikada bu bosqichda amal yo'q, faqat kutish.
              */}
              {deal.status === 'AGREED' && <Notice tone="info">{t('deal.awaitingPaymentClinic')}</Notice>}

              {/*
                To'lov bildirilgach navbat KLINIKAda: u pulni olganini
                va operatsiya bajarilganini tasdiqlaydi. Faqat shundan
                keyin bitim yopilib, komissiya hisoblanadi.

                Bu tugma ilgari faqat bemor ilovasidagi ekranda bor
                edi — klinika `ClinicDeal` degan boshqa komponentni
                ishlatadi va u yerda tasdiqlash imkoni umuman yo'q
                edi. Bitimlar shu sababli `PAID` da qotib qolardi.
              */}
              {deal.status === 'PAID' && (
                <Card className="stack" style={{ gap: 8 }}>
                  <Notice tone="warning">{t('deal.awaitingReceiptClinic')}</Notice>
                  <div className="between">
                    <span className="tiny">{t('deal.paidAmount')}</span>
                    <strong className="num">
                      {deal.confirmedAmountUzs ? money(deal.confirmedAmountUzs, lang) : '—'}
                    </strong>
                  </div>
                  <Button block loading={busy} onClick={() => act(() => api.confirmReceipt(dealId))}>
                    {t('deal.confirmReceipt')}
                  </Button>
                  {/*
                    Summaga rozi bo'lmasa — nizo. Klinika summani
                    o'zgartira olmaydi: u komissiya bazasi va uni
                    pasaytirish klinikaga foydali bo'lardi.
                  */}
                  <Button
                    variant="ghost"
                    block
                    onClick={() => navigate(`/clinic/deals/${dealId}/chat`)}
                  >
                    {t('deal.disputeHint')}
                  </Button>
                </Card>
              )}

              <Button
                variant="secondary"
                block
                icon={<IconChat size={16} />}
                onClick={() => navigate(`/clinic/deals/${dealId}/chat`)}
              >
                {t('board.openChat')}
              </Button>
            </>
          );
        }}
      </Async>
    </Screen>
  );
}

/* ═════════════════  13-ekran: bemor bilan chat  ═════════════════ */

export function ClinicChat() {
  const { t, user } = useApp();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const dealId = Number(id);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const res = useResource(() => api.deal(dealId), [dealId]);

  useEffect(() => {
    if (res.data) setMessages(res.data.messages);
  }, [res.data]);

  // Yangi xabar kelganda pastga tushamiz
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  // Qisqa oraliqda so'rab turamiz — WebSocket uzilsa ham chat tirik qoladi
  useEffect(() => {
    const timer = setInterval(async () => {
      const last = messages[messages.length - 1]?.id ?? 0;
      try {
        const fresh = await api.messages(dealId, last);
        if (fresh.length) setMessages((prev) => [...prev, ...fresh]);
      } catch {
        /* tarmoq uzilishi — keyingi urinishda tiklanadi */
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [dealId, messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const message = await api.sendMessage(dealId, body);
      setMessages((prev) => [...prev, message]);
      setDraft('');
      haptic.tap();
    } catch {
      haptic.error();
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen
      onBack={() => navigate(`/clinic/deals/${dealId}`)}
      title={t('cchat.title')}
      subtitle={res.data?.deal.patientName}
      footer={
        <div className="ai-composer">
          <textarea
            className="composer__input"
            rows={1}
            value={draft}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
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
      }
    >
      <Notice tone="info">{t('chat.privacyNote')}</Notice>

      <div className="chat" ref={scrollRef}>
        {messages.length === 0 && <p className="tiny">{t('chat.empty')}</p>}

        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <m.div
              key={message.id}
              className={`ai-bubble ai-bubble--${message.senderId === user?.id ? 'mine' : 'ai'}`}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={spring}
            >
              {message.body}
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </Screen>
  );
}
