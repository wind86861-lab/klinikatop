/**
 * AI suhbati — "shikoyatimni yozaman" va "bilmayman, klinika aytsin" birlashgan.
 *
 * Nima uchun birlashtirildi:
 *   Bitta jumladan operatsiyani aniqlash xato tashxis xavfini tug'diradi.
 *   Suhbatda AI aniqlashtiruvchi savol beradi va xato ehtimoli kamayadi.
 *   Aniqlab bo'lmasa — o'sha suhbatning o'zi "klinika aytsin" bo'lib davom
 *   etadi: tupik yo'q, bemor qayta boshlamaydi.
 *
 * Bitta matn ikki joyga boradi: AI ga tahlil uchun, klinikaga esa bemorning
 * O'Z SO'ZLARI sifatida. Klinika AI xulosasiga emas, bemor yozganiga qaraydi.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { popVariants, spring } from '@/lib/motion';
import { opDesc, opName } from '@/i18n';
import { Button, Card, IconCheck, IconSend, IconSparkle, Notice } from '@/ui';
import type { AiChatResult, ChatTurn, Operation } from '@shared/types';

export interface AiChatOutcome {
  /** Aniqlangan operatsiya, yoki null → "klinika aytsin" */
  operation: Operation | null;
  /** Bemor yozgan matn — klinikaga shu boradi */
  conditionText: string;
  turns: ChatTurn[];
}

export function AiChatStep({
  onDone,
  onSwitchToCatalog,
}: {
  onDone: (outcome: AiChatOutcome) => void;
  onSwitchToCatalog: () => void;
}) {
  const { t, lang } = useApp();

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<AiChatResult | null>(null);
  const [operations, setOperations] = useState<Map<number, Operation>>(new Map());
  const [unknownOp, setUnknownOp] = useState<Operation | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.operations().then((list) => setOperations(new Map(list.map((o) => [o.id, o]))));
    void api.unknownOperation().then(setUnknownOp).catch(() => setUnknownOp(null));
  }, []);

  // Yangi xabar kelganda pastga tushamiz
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length, thinking, result]);

  /** Bemor yozgan barcha matn — klinikaga shu boradi. */
  const patientText = (list: ChatTurn[]) =>
    list
      .filter((turn) => turn.role === 'user')
      .map((turn) => turn.content)
      .join('\n\n');

  const send = async () => {
    const text = draft.trim();
    if (text.length < 3 || thinking) return;

    const next: ChatTurn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setDraft('');
    setResult(null);
    setThinking(true);
    haptic.tap();

    try {
      const response = await api.aiChat(next);
      // AI javobini suhbatga qo'shamiz — keyingi savolda kontekst saqlanadi
      setTurns([...next, { role: 'assistant', content: response.reply }]);
      setResult(response);
      haptic.success();
    } catch {
      haptic.error();
      setResult({
        reply: t('ai.failed'),
        needsMoreInfo: false,
        suggestions: [],
        urgentWarning: null,
        fallbackToClinic: true,
        disclaimer: t('need.disclaimer'),
      });
    } finally {
      setThinking(false);
    }
  };

  const finish = (operation: Operation | null) => {
    haptic.press();
    onDone({ operation, conditionText: patientText(turns), turns });
  };

  const started = turns.length > 0;

  return (
    <>
      <div className="wz-head">
        <h1 className="wz-head__title">{t('ai.title')}</h1>
        <p className="wz-head__sub">{t('ai.sub')}</p>
      </div>

      {/* Suhbat oynasi */}
      {started && (
        <div className="ai-chat" ref={scrollRef}>
          {turns.map((turn, i) => (
            <motion.div
              key={i}
              className={`ai-bubble ai-bubble--${turn.role === 'user' ? 'mine' : 'ai'}`}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={spring}
            >
              {turn.role === 'assistant' && (
                <span className="ai-bubble__badge">
                  <IconSparkle size={11} /> AI
                </span>
              )}
              {turn.content}
            </motion.div>
          ))}

          {thinking && (
            <motion.div className="ai-bubble ai-bubble--ai" variants={popVariants} initial="initial" animate="animate">
              <span className="typing" aria-label={t('need.thinking')}>
                <span />
                <span />
                <span />
              </span>
            </motion.div>
          )}
        </div>
      )}

      {/* Shoshilinch xavf — hamma narsadan ustun turadi */}
      <AnimatePresence>
        {result?.urgentWarning && (
          <motion.div variants={popVariants} initial="initial" animate="animate" exit="exit">
            <Notice tone="danger">{result.urgentWarning}</Notice>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Aniqlangan yo'nalishlar */}
      <AnimatePresence>
        {result && !result.needsMoreInfo && result.suggestions.length > 0 && (
          <motion.div variants={popVariants} initial="initial" animate="animate" exit="exit" className="stack">
            <div className="between">
              <h2 className="section-title">{t('need.aiTitle')}</h2>
              <span className="tiny">{t('need.confirmQuestion')}</span>
            </div>

            {result.suggestions.map((s, i) => {
              const op = operations.get(s.operationId);
              if (!op) return null;
              return (
                <motion.div
                  key={s.operationId}
                  initial={{ opacity: 0, y: 14, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ ...spring, delay: i * 0.06 }}
                >
                  <Card className="stack">
                    <div className="between">
                      <strong>{opName(op, lang)}</strong>
                      <Confidence value={s.confidence} label={t('need.confidence')} />
                    </div>
                    <p className="tiny" style={{ color: 'var(--body)' }}>
                      {s.reason}
                    </p>
                    <p className="tiny">{opDesc(op, lang)}</p>
                    <Button size="sm" block icon={<IconCheck size={15} />} onClick={() => finish(op)}>
                      {t('ai.continueWith')}
                    </Button>
                  </Card>
                </motion.div>
              );
            })}

            {/* Aniqlangan bo'lsa ham bemor rozi bo'lmasligi mumkin */}
            {unknownOp && (
              <Button variant="ghost" block onClick={() => finish(unknownOp)}>
                {t('ai.notThis')}
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Aniqlab bo'lmadi — o'sha suhbat "klinika aytsin" bo'lib davom etadi */}
      <AnimatePresence>
        {result?.fallbackToClinic && unknownOp && (
          <motion.div variants={popVariants} initial="initial" animate="animate" exit="exit" className="stack">
            <Notice tone="info">{t('ai.clinicWillDecide')}</Notice>
            <Button block icon={<IconCheck size={16} />} onClick={() => finish(unknownOp)}>
              {t('ai.continueUnknown')}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Yozish paneli — AI savol bersa yana yoziladi */}
      {(!result || result.needsMoreInfo) && (
        <div className="ai-composer">
          <textarea
            className="composer__input"
            rows={started ? 2 : 4}
            value={draft}
            placeholder={started ? t('ai.answerPh') : t('ai.firstPh')}
            aria-label={t('ai.title')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && started) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="composer__send"
            onClick={send}
            disabled={draft.trim().length < 3 || thinking}
            aria-label={t('common.send')}
          >
            <IconSend size={19} />
          </button>
        </div>
      )}

      {/*
        Chiqish yo'li. Yordamchi savol berayotgan bo'lsa ham bemor javob
        bera olmasligi mumkin — u holda suhbat shu yerda "klinika aytsin"
        bo'lib yakunlanadi. Hech qachon tupikka tushmaydi.
      */}
      {started && result?.needsMoreInfo && unknownOp && (
        <Button variant="ghost" block onClick={() => finish(unknownOp)}>
          {t('ai.cantAnswer')}
        </Button>
      )}

      {!started && (
        <Button variant="ghost" block onClick={onSwitchToCatalog}>
          {t('ai.orCatalog')}
        </Button>
      )}

      {/* Xavfsizlik qoidasi: ogohlantirish doim ko'rinadi */}
      <Notice tone="warning">{result?.disclaimer ?? t('need.disclaimer')}</Notice>
    </>
  );
}

function Confidence({ value, label }: { value: number; label: string }) {
  const percent = Math.round(value * 100);
  const tone = percent >= 70 ? 'var(--success)' : percent >= 40 ? 'var(--accent)' : 'var(--muted)';

  return (
    <div className="row" style={{ gap: 6 }}>
      <div style={{ width: 46, height: 5, borderRadius: 100, background: 'var(--line)', overflow: 'hidden' }}>
        <motion.div
          style={{ height: '100%', background: tone, transformOrigin: 'left' }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: value }}
          transition={{ ...spring, delay: 0.15 }}
        />
      </div>
      <span className="tiny" style={{ color: tone }}>
        {percent}% {label}
      </span>
    </div>
  );
}
