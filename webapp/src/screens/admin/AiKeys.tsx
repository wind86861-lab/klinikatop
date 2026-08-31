/**
 * Admin: AI kalitlari.
 *
 * Nima uchun kerak: prodda Gemini `503 "high demand"` qaytardi va
 * butun AI lokal heuristikaga tushdi. O'sha paytdagi so'rovlar
 * operatsiyasiz va sohasiz ketdi — bitta provayderning vaqtinchalik
 * yuklamasi mahsulotning asosiy qismini o'chirardi.
 *
 * Endi kalitlar ro'yxati bor va biri ishlamasa keyingisiga o'tiladi.
 * Kalit qo'shish uchun deploy kerak emas: kalit tugagan payt aynan
 * shoshilinch payt bo'ladi.
 *
 * To'liq kalit bu ekranga HECH QACHON kelmaydi — server faqat
 * niqoblangan ko'rinishni qaytaradi.
 */
import { useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { formatDate } from '@/lib/format';
import { Button, Card, Field, Input, Notice, Section, Sheet, Skeleton } from '@/ui';
import { Async, useResource } from '@/screens/clinic/shell';
import { PageHeader, RowMenu, Tag } from './ui';
import type { AiKeyRow } from '@shared/types';

const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
};

export function AiKeys() {
  const { t, lang, toast } = useApp();
  const res = useResource(() => api.aiKeys());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<AiKeyRow[]>, ok: string) => {
    setBusy(true);
    try {
      res.set(await fn());
      haptic.success();
      toast(ok, 'success');
      setAdding(false);
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Async resource={res} skeleton={<Skeleton h={300} />}>
      {(list) => (
        <div className="stack">
          <PageHeader
            title="AI kalitlari"
            description="Biri ishlamasa keyingisiga o‘tiladi. Tartib muhim — yuqoridagisi birinchi sinaladi."
            count={list.filter((k) => k.active).length}
            actions={<Button onClick={() => setAdding(true)}>Kalit qo‘shish</Button>}
          />

          {list.length === 0 ? (
            <Notice tone="warning">
              Kalit qo‘shilmagan. Hozir faqat <code>.env</code> dagi kalit ishlatiladi — u tushib
              qolsa AI butunlay o‘chadi va so‘rovlar operatsiyasiz ketadi.
            </Notice>
          ) : (
            <Section title="Ro‘yxat">
              <div className="stack stack--tight">
                <AnimatePresence initial={false}>
                  {list.map((k) => (
                    <m.div
                      key={k.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={spring}
                    >
                      <Card className="payRow">
                        <div className="payRow__body">
                          <div className="payRow__head">
                            <b>{PROVIDER_LABEL[k.provider] ?? k.provider}</b>
                            <code className="tiny">{k.masked}</code>
                            {k.active ? <Tag tone="good">Faol</Tag> : <Tag tone="neutral">O‘chiq</Tag>}
                            {/*
                              Oxirgi xato ko'rsatiladi: "qaysi kalit tushib
                              qolgan" degan savol aks holda faqat jurnalda
                              qolardi.
                            */}
                            {k.lastError && <Tag tone="bad">Xato</Tag>}
                          </div>
                          <p className="muted payRow__meta">
                            {k.label ? `${k.label} · ` : ''}
                            {k.lastError
                              ? `${k.lastError.slice(0, 90)} (${formatDate(k.lastErrorAt!, lang)})`
                              : k.lastOkAt
                                ? `Oxirgi muvaffaqiyatli: ${formatDate(k.lastOkAt, lang)}`
                                : 'Hali ishlatilmagan'}
                          </p>
                        </div>
                        <div className="payRow__actions">
                          <RowMenu
                            items={[
                              {
                                label: k.active ? 'O‘chirish (vaqtincha)' : 'Yoqish',
                                onClick: () =>
                                  act(() => api.setAiKeyActive(k.id, !k.active), 'Saqlandi'),
                              },
                              {
                                label: 'Butunlay o‘chirish',
                                danger: true,
                                onClick: () => act(() => api.deleteAiKey(k.id), 'Kalit o‘chirildi'),
                              },
                            ]}
                          />
                        </div>
                      </Card>
                    </m.div>
                  ))}
                </AnimatePresence>
              </div>
            </Section>
          )}

          <AddKeySheet
            open={adding}
            busy={busy}
            onClose={() => setAdding(false)}
            onAdd={(body) => act(() => api.addAiKey(body), 'Kalit qo‘shildi')}
          />
        </div>
      )}
    </Async>
  );
}

function AddKeySheet({
  open,
  busy,
  onClose,
  onAdd,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onAdd: (body: { provider: 'gemini' | 'anthropic'; apiKey: string; label: string | null }) => void;
}) {
  const [provider, setProvider] = useState<'gemini' | 'anthropic'>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');

  return (
    <Sheet open={open} onClose={onClose} title="Yangi AI kaliti">
      <div className="stack">
        <Field label="Provayder">
          <div className="chips">
            {(['gemini', 'anthropic'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`chip ${provider === p ? 'is-active' : ''}`}
                onClick={() => setProvider(p)}
              >
                {PROVIDER_LABEL[p]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Kalit" hint="Saqlangandan keyin u boshqa ko‘rsatilmaydi">
          {/*
            `type="password"` — kalit yelka ortidan o'qilmasin va
            brauzer uni oddiy matn deb saqlab qo'ymasin.
          */}
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            maxLength={400}
          />
        </Field>

        <Field label="Nomi" hint="O‘zingiz uchun belgi — masalan “Asosiy” yoki “Zaxira”">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </Field>

        <Button
          block
          loading={busy}
          disabled={apiKey.trim().length < 12}
          onClick={() => {
            onAdd({ provider, apiKey: apiKey.trim(), label: label.trim() || null });
            setApiKey('');
            setLabel('');
          }}
        >
          Qo‘shish
        </Button>
      </div>
    </Sheet>
  );
}
