/**
 * Admin: botning Telegram'dagi "yuzi".
 *
 * Nima uchun kerak: bot suhbati bo'sh bo'lganda Telegram "What can
 * this bot do?" ostida bir matn ko'rsatadi — odam /start bosishidan
 * OLDIN o'qiydigan yagona narsa shu. U kodda qattiq yozilgan edi,
 * ya'ni bir so'zni o'zgartirish uchun ham deploy kerak bo'lardi.
 * Bu marketing matni, mahsulot qarori.
 *
 * Uchta matn uchtа boshqa joyda chiqadi, shuning uchun ular alohida:
 * to'liq tavsif (start oldidan), qisqasi (bot profilida) va ilovani
 * ochadigan tugma nomi.
 */
import { useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { Button, Field, Input, Notice, Section, Skeleton, Textarea } from '@/ui';
import { Async, useResource } from '@/screens/clinic/shell';
import { PageHeader } from './ui';
import type { BotFace as Face } from '@shared/types';

/** Telegram chegaralari — serverda ham shu qiymatlar bilan kesiladi */
const LIMITS = { description: 512, shortDescription: 120, menuButton: 30 };

export function BotFaceScreen() {
  const { t, toast } = useApp();
  const res = useResource(() => api.botFace());
  const [draft, setDraft] = useState<Partial<Face>>({});
  const [saving, setSaving] = useState(false);

  const dirty = Object.keys(draft).length > 0;
  const set = (key: keyof Face, v: string) => setDraft((d) => ({ ...d, [key]: v }));

  const save = async (current: Face) => {
    setSaving(true);
    try {
      const next = await api.saveBotFace({ ...current, ...draft });
      res.set({ ...next, defaults: res.data!.defaults });
      setDraft({});
      haptic.success();
      /*
       * Telegram matnlarni o'zi keshlaydi. Buni aytmasak, admin
       * o'zgarishni darrov ko'rmay "saqlanmadi" deb o'ylaydi.
       */
      toast(
        next.applied ? 'Saqlandi va Telegram’ga yuborildi' : 'Saqlandi, lekin Telegram’ga yuborilmadi',
        next.applied ? 'success' : 'error',
      );
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Async resource={res} skeleton={<Skeleton h={340} />}>
      {(data) => {
        const value = (key: keyof Face) => draft[key] ?? data[key];

        return (
          <div className="stack">
            <PageHeader
              title="Bot matnlari"
              description="Odam botni birinchi marta ochganda, /start bosishidan oldin ko‘radigan matnlar"
            />

            {/* ── Jonli ko'rinish ── */}
            <Section title="Telegramda qanday ko‘rinadi">
              <div className="botPreview">
                <div className="botPreview__head">
                  <span className="botPreview__avatar">K</span>
                  <span>
                    <b className="botPreview__name">klinikatop</b>
                    <span className="botPreview__meta">bot</span>
                  </span>
                </div>
                <div className="botPreview__bubble">
                  <b>What can this bot do?</b>
                  <p>{value('description') || <span className="muted">— matn yo‘q —</span>}</p>
                </div>
                <div className="botPreview__bar">
                  <span className="botPreview__input">Xabar…</span>
                  <span className="botPreview__menu">{value('menuButton') || 'Menu'}</span>
                </div>
              </div>
            </Section>

            <Field
              label="Tavsif — /start bosilishidan oldin"
              hint={`${value('description').length} / ${LIMITS.description}`}
            >
              <Textarea
                rows={3}
                maxLength={LIMITS.description}
                value={value('description')}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>

            <Field
              label="Qisqa tavsif — bot profilida"
              hint={`${value('shortDescription').length} / ${LIMITS.shortDescription}`}
            >
              <Textarea
                rows={2}
                maxLength={LIMITS.shortDescription}
                value={value('shortDescription')}
                onChange={(e) => set('shortDescription', e.target.value)}
              />
            </Field>

            <Field label="Ilovani ochadigan tugma nomi" hint="Yozuv maydoni yonida turadi">
              <Input
                maxLength={LIMITS.menuButton}
                value={value('menuButton')}
                onChange={(e) => set('menuButton', e.target.value)}
              />
            </Field>

            <Notice>
              Telegram bu matnlarni keshlaydi: yangi (bo‘sh) suhbatda o‘zgarish darhol ko‘rinadi,
              allaqachon ochilgan suhbatlarda esa biroz kechikishi mumkin.
            </Notice>

            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <Button
                loading={saving}
                disabled={!dirty || value('menuButton').trim().length === 0}
                onClick={() => save(data)}
              >
                Saqlash
              </Button>
              {dirty && (
                <Button variant="ghost" disabled={saving} onClick={() => setDraft({})}>
                  Bekor qilish
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => setDraft({ ...data.defaults })}
              >
                Standart matnga qaytarish
              </Button>
            </div>
          </div>
        );
      }}
    </Async>
  );
}
