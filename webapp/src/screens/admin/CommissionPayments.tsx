/**
 * Admin: klinikalar topshirgan komissiya to'lovlari.
 *
 * Nima uchun kerak: ilgari klinika to'lovni o'zi yozar va u shu zahoti
 * "to'langan" bo'lib hisoblanardi — qarz kamayardi, hech kim
 * tekshirmasdi. Ya'ni klinika istalgan summani yozib qarzini nolga
 * tushira olardi.
 *
 * Endi qarz FAQAT shu ekrandagi tasdiqdan keyin kamayadi. Shuning
 * uchun bu navbat bo'sh turishi kerak: har bir yozuv — kimningdir
 * kutayotgan puli.
 */
import { useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { money, formatDate } from '@/lib/format';
import { Button, Card, Notice, Section, Sheet, Skeleton, Textarea } from '@/ui';
import { Async, useResource } from '@/screens/clinic/shell';
import type { PendingCommissionPayment } from '@shared/types';

const METHOD_LABEL: Record<string, string> = {
  bank: 'Bank o‘tkazmasi',
  cash: 'Naqd',
  payme: 'Payme',
  click: 'Click',
  manual: 'Qo‘lda',
};

export function CommissionPayments() {
  const { t, lang, toast } = useApp();
  const res = useResource(() => api.pendingCommissionPayments());
  const [rejecting, setRejecting] = useState<PendingCommissionPayment | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const review = async (
    payment: PendingCommissionPayment,
    decision: 'confirmed' | 'rejected',
    reason: string | null,
  ) => {
    setBusy(true);
    try {
      const next = await api.reviewCommissionPayment(payment.id, decision, reason);
      res.set(next);
      haptic.success();
      toast(decision === 'confirmed' ? 'To‘lov tasdiqlandi' : 'To‘lov qaytarildi', 'success');
      setRejecting(null);
      setNote('');
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Async resource={res} skeleton={<Skeleton h={320} />}>
      {(list) => (
        <div className="stack">
          <Notice>
            Klinika komissiyani topshirgach yozuv shu yerga tushadi. Qarz <b>faqat siz
            tasdiqlaganingizdan keyin</b> kamayadi — pul bankka tushganini tekshirib tasdiqlang.
          </Notice>

          {list.length === 0 ? (
            <Card>
              <p className="muted">Tekshiruv kutayotgan to‘lov yo‘q.</p>
            </Card>
          ) : (
            <Section title="Tekshiruv kutmoqda" action={<span className="muted">{list.length} ta</span>}>
              <div className="stack stack--tight">
                <AnimatePresence initial={false}>
                  {list.map((p) => (
                    <m.div
                      key={p.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={spring}
                    >
                      <Card className="payRow">
                        <div className="payRow__body">
                          <div className="payRow__head">
                            <b>{p.clinicName}</b>
                            <span className="num">{money(p.amountUzs, lang)}</span>
                          </div>
                          <p className="muted payRow__meta">
                            {METHOD_LABEL[p.method] ?? p.method}
                            {p.reference ? ` · ${p.reference}` : ''} · {formatDate(p.createdAt, lang)}
                          </p>
                        </div>
                        <div className="payRow__actions">
                          <Button size="sm" disabled={busy} onClick={() => review(p, 'confirmed', null)}>
                            Tasdiqlash
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              setRejecting(p);
                              setNote('');
                            }}
                          >
                            Qaytarish
                          </Button>
                        </div>
                      </Card>
                    </m.div>
                  ))}
                </AnimatePresence>
              </div>
            </Section>
          )}

          <Sheet open={rejecting !== null} onClose={() => setRejecting(null)} title="To‘lovni qaytarish">
            {rejecting && (
              <div className="stack">
                <Notice>
                  {rejecting.clinicName} — {money(rejecting.amountUzs, lang)}
                </Notice>
                {/*
                  Sabab MAJBURIY: klinika nima uchun qaytarilganini bilmasa
                  bir xil to'lovni qayta yuboraveradi.
                */}
                <Textarea
                  rows={3}
                  value={note}
                  placeholder="Masalan: bank hisobiga tushmadi"
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={300}
                />
                <Button
                  block
                  disabled={note.trim().length < 3 || busy}
                  onClick={() => review(rejecting, 'rejected', note.trim())}
                >
                  Qaytarish
                </Button>
              </div>
            )}
          </Sheet>
        </div>
      )}
    </Async>
  );
}
