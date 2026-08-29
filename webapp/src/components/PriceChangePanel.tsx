/**
 * Bitim narxini o'zgartirish — ikki tomon roziligi bilan.
 *
 * Hayotda narx o'zgaradi: tekshiruvda qo'shimcha muammo chiqadi yoki
 * aksincha, rejalashtirilgan bosqich kerak bo'lmay qoladi. Ilgari bunga
 * yagona yo'l bor edi — tasdiqlash paytida boshqa summa kiritish. Kim
 * rozi bo'lgani hech qayerda qolmasdi va nizoda dalil bo'lmasdi.
 *
 * Endi: taklif → ikkinchi tomon javobi → yozib qo'yiladi.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { popVariants } from '@/lib/motion';
import { formatDate, groupDigits, money } from '@/lib/format';
import { Button, Card, Field, Input, Notice, Textarea } from '@/ui';
import type { DealPriceChange } from '@shared/types';

export function PriceChangePanel({
  dealId,
  agreedPriceUzs,
  /** Bu ekran kim tomonidan ochilgan */
  side,
  /** Narx faqat ish bajarilgunicha o'zgaradi */
  editable,
  onChanged,
}: {
  dealId: number;
  agreedPriceUzs: number;
  side: 'patient' | 'clinic';
  editable: boolean;
  onChanged: () => void;
}) {
  const { lang, toast } = useApp();

  const [history, setHistory] = useState<DealPriceChange[]>([]);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setHistory(await api.priceChanges(dealId));
    } catch {
      /* tarix ko'rinmasa ham asosiy ekran ishlayveradi */
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const pending = history.find((h) => h.status === 'pending') ?? null;
  const priceNumber = Number(price.replace(/\D/g, '')) || 0;
  const canPropose = priceNumber >= 100_000 && priceNumber !== agreedPriceUzs && reason.trim().length >= 10;

  const propose = async () => {
    setBusy(true);
    try {
      await api.proposePriceChange(dealId, priceNumber, reason.trim());
      haptic.success();
      toast('Taklif yuborildi — javob kutilmoqda', 'success');
      setOpen(false);
      setPrice('');
      setReason('');
      await load();
      onChanged();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? 'Xatolik', 'error');
    } finally {
      setBusy(false);
    }
  };

  const respond = async (accept: boolean) => {
    if (!pending) return;
    setBusy(true);
    try {
      await api.respondToPriceChange(pending.id, accept);
      haptic.success();
      toast(accept ? 'Yangi narx qabul qilindi' : 'Taklif rad etildi', 'success');
      await load();
      onChanged();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? 'Xatolik', 'error');
    } finally {
      setBusy(false);
    }
  };

  /* Javobni ikkinchi tomon beradi — taklif qilgan tomon kutadi */
  const iProposed = pending?.proposedBy === side;

  return (
    <Card className="stack">
      <div className="between">
        <h2 className="section-title">Narx</h2>
        <strong className="num">{money(agreedPriceUzs, lang)}</strong>
      </div>

      <AnimatePresence mode="wait">
        {pending ? (
          <m.div key="pending" className="stack" variants={popVariants} initial="initial" animate="animate">
            <div className="pchange">
              <div className="pchange__row">
                <span className="num pchange__old">{money(pending.fromUzs, lang)}</span>
                <span className="pchange__arrow">→</span>
                <strong className="num pchange__new">{money(pending.toUzs, lang)}</strong>
              </div>
              <p className="tiny">{pending.reason}</p>
            </div>

            {iProposed ? (
              <Notice tone="info">Taklifingiz yuborildi — ikkinchi tomon javobini kutmoqdamiz.</Notice>
            ) : (
              <>
                <Notice tone="warning">
                  Rozi bo‘lsangiz bitim narxi o‘zgaradi. Rad etsangiz eski narx kuchda qoladi.
                </Notice>
                <div className="row" style={{ gap: 'var(--s-2)' }}>
                  <Button block loading={busy} onClick={() => respond(true)}>
                    Roziman
                  </Button>
                  <Button block variant="secondary" loading={busy} onClick={() => respond(false)}>
                    Rad etaman
                  </Button>
                </div>
              </>
            )}
          </m.div>
        ) : editable ? (
          <m.div key="idle" variants={popVariants} initial="initial" animate="animate">
            {open ? (
              <div className="stack">
                <Field label="Yangi narx">
                  <Input
                    className="input--money"
                    inputMode="numeric"
                    value={price}
                    onChange={(e) => setPrice(groupDigits(Number(e.target.value.replace(/\D/g, '')) || 0))}
                  />
                </Field>
                <Field label="Nima uchun" hint="Ikkinchi tomon shuni o‘qib qaror qiladi">
                  <Textarea
                    rows={2}
                    value={reason}
                    maxLength={400}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <div className="row" style={{ gap: 'var(--s-2)' }}>
                  <Button block loading={busy} disabled={!canPropose} onClick={propose}>
                    Taklif qilish
                  </Button>
                  <Button block variant="ghost" onClick={() => setOpen(false)}>
                    Bekor qilish
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Narxni o‘zgartirishni taklif qilish
              </Button>
            )}
          </m.div>
        ) : null}
      </AnimatePresence>

      {/* Tarix — nizoda dalil bo'ladi */}
      {history.filter((h) => h.status !== 'pending').length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="tiny">O‘zgarishlar tarixi</span>
          {history
            .filter((h) => h.status !== 'pending')
            .map((h) => (
              <div key={h.id} className="pchange__log">
                <span className="num">
                  {money(h.fromUzs, lang)} → {money(h.toUzs, lang)}
                </span>
                <span className={`pchange__badge ${h.status === 'accepted' ? 'is-ok' : 'is-no'}`}>
                  {h.status === 'accepted' ? 'qabul qilindi' : 'rad etildi'}
                </span>
                <span className="tiny">{formatDate(h.decidedAt ?? h.createdAt, lang)}</span>
              </div>
            ))}
        </div>
      )}
    </Card>
  );
}
