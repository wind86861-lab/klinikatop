/**
 * Admin: bemor so'rovi bosqichlari.
 *
 * Nima uchun kerak: bemor so'rov qoldirayotganda to'qqiz bosqichdan
 * o'tadi. Qaysi bosqich bor, qanday tartibda va nima deb yozilgani —
 * mahsulot qarori, kod emas. Ilgari uni o'zgartirish uchun deploy
 * kutish kerak edi; matnni tajriba qilish yoki mavsumiy savol qo'shish
 * shu sababli amalda qilinmasdi.
 *
 * Ikki xil bosqich bor va farqi ekranda ham ko'rinib turadi:
 *
 *   TAYYOR — kodda yozilgan maxsus ekranlar (katalog tanlash, byudjet
 *   slayderi, sana oynasi). Tartibi, matni va yoqilgani o'zgaradi,
 *   lekin yangisi yaratilmaydi va o'chirilmaydi.
 *
 *   SAVOL — admin o'zi yaratadigan oddiy savollar. Javoblari so'rov
 *   bilan birga saqlanadi va klinikaga ko'rinadi.
 *
 * Ba'zi bosqichlar qulflangan: ularsiz server so'rovni baribir rad
 * etadi, shuning uchun ularni o'chirish imkoniyati umuman berilmaydi —
 * "mumkin, lekin keyin buziladi" degan holat eng yomoni.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useApp } from '@/store/app';
import { api, type StepDraft } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { Button, Card, Chip, Field, Input, Notice, Section, Sheet, Skeleton, Textarea } from '@/ui';
import { Async, useResource } from '@/screens/clinic/shell';
import { BUILTIN_STEPS, type RequestStep, type StepKind, type StepOption } from '@shared/types';

/** Tayyor bosqichlarning admin panelidagi nomi va nima qilishi. */
const BUILTIN_INFO: Record<string, { name: string; what: string }> = {
  who: { name: 'Kimga', what: 'O‘ziga yoki tanishiga' },
  operation: { name: 'Operatsiya', what: 'Katalogdan tanlash yoki AI yordami' },
  condition: { name: 'Holat', what: 'Bemor o‘z so‘zi bilan yozadi' },
  documents: { name: 'Hujjatlar', what: 'Tahlil va xulosalarni yuklash' },
  region: { name: 'Viloyat', what: 'Qaysi shaharda qidiriladi' },
  budget: { name: 'Byudjet', what: 'Narx statistikasi bilan slayder' },
  date: { name: 'Sana', what: 'Qulay sana oralig‘i' },
  note: { name: 'Izoh', what: 'Qo‘shimcha erkin matn' },
  review: { name: 'Tekshirish', what: 'Yakuniy ko‘rinish va ommaviy oferta' },
};

const KIND_LABEL: Record<StepKind, string> = {
  builtin: 'Tayyor',
  text: 'Qisqa matn',
  longtext: 'Uzun matn',
  number: 'Raqam',
  boolean: 'Ha / Yo‘q',
  choice: 'Bitta tanlov',
  multichoice: 'Bir nechta tanlov',
};

/** Admin yarata oladigan savol turlari — `builtin` bu yerda yo'q, u kod. */
const CREATABLE: StepKind[] = ['text', 'longtext', 'number', 'boolean', 'choice', 'multichoice'];

const isBuiltin = (key: string) => (BUILTIN_STEPS as readonly string[]).includes(key);

export function RequestStepsScreen() {
  const { t, toast } = useApp();
  const res = useResource(() => api.adminRequestSteps());

  const [draft, setDraft] = useState<RequestStep[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<RequestStep | null>(null);
  const [adding, setAdding] = useState(false);

  /** Amaldagi ro'yxat: tahrir boshlangan bo'lsa u, aks holda serverdagi. */
  const listOf = (server: RequestStep[]) => draft ?? server;
  const dirty = draft !== null;

  const mutate = (server: RequestStep[], fn: (list: RequestStep[]) => RequestStep[]) => {
    setDraft(fn([...listOf(server)]));
    haptic.select();
  };

  const move = (server: RequestStep[], index: number, delta: number) =>
    mutate(server, (list) => {
      const to = index + delta;
      if (to < 0 || to >= list.length) return list;
      const [row] = list.splice(index, 1);
      list.splice(to, 0, row);
      return list;
    });

  const toggle = (server: RequestStep[], key: string, field: 'enabled' | 'required') =>
    mutate(server, (list) =>
      list.map((s) => (s.key === key ? { ...s, [field]: !s[field] } : s)),
    );

  const remove = (server: RequestStep[], key: string) =>
    mutate(server, (list) => list.filter((s) => s.key !== key));

  const upsert = (server: RequestStep[], row: RequestStep) =>
    mutate(server, (list) => {
      const i = list.findIndex((s) => s.key === row.key);
      if (i === -1) return [...list, row];
      list[i] = row;
      return list;
    });

  const save = async (server: RequestStep[]) => {
    setSaving(true);
    try {
      const body: StepDraft[] = listOf(server).map((s) => ({
        key: s.key,
        kind: s.kind,
        enabled: s.enabled,
        required: s.required,
        titleUz: s.titleUz,
        titleRu: s.titleRu,
        subUz: s.subUz,
        subRu: s.subRu,
        options: s.options,
      }));
      const next = await api.saveRequestSteps(body);
      res.set(next);
      setDraft(null);
      haptic.success();
      toast('Bosqichlar saqlandi', 'success');
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Async resource={res} skeleton={<Skeleton h={420} />}>
      {(server) => {
        const list = listOf(server);
        const enabled = list.filter((s) => s.enabled).length;

        return (
          <div className="stack">
            <Notice>
              Bemor so‘rov qoldirayotganda shu bosqichlardan o‘tadi. <b>Tayyor</b> bosqichlar kodda
              yozilgan — ularning tartibi va matnini o‘zgartirish mumkin, lekin yangisini yaratib
              bo‘lmaydi. O‘zingizning <b>savolingiz</b>ni esa xohlagancha qo‘shasiz.
            </Notice>

            <Section
              title="Bosqichlar"
              action={
                <span className="muted">
                  {enabled} ta yoqilgan / {list.length}
                </span>
              }
            >
              <div className="stack stack--tight">
                {list.map((step, i) => (
                  <StepRow
                    key={step.key}
                    step={step}
                    position={i}
                    total={list.length}
                    onUp={() => move(server, i, -1)}
                    onDown={() => move(server, i, 1)}
                    onToggle={(f) => toggle(server, step.key, f)}
                    onEdit={() => setEditing(step)}
                    onRemove={() => remove(server, step.key)}
                  />
                ))}
              </div>
            </Section>

            <Button variant="ghost" block onClick={() => setAdding(true)}>
              + Savol qo‘shish
            </Button>

            <AnimatePresence>
              {dirty && (
                <m.div
                  className="admin__saveBar"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  transition={spring}
                >
                  <span className="muted">Saqlanmagan o‘zgarish bor</span>
                  <div className="row">
                    <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                      Bekor qilish
                    </Button>
                    <Button loading={saving} onClick={() => save(server)}>
                      Saqlash
                    </Button>
                  </div>
                </m.div>
              )}
            </AnimatePresence>

            <Sheet
              open={editing !== null}
              onClose={() => setEditing(null)}
              title={editing && !isBuiltin(editing.key) ? 'Savolni tahrirlash' : 'Bosqichni tahrirlash'}
            >
              {editing && (
                <StepEditor
                  /*
                   * `key` shart: varaq yopilib boshqa bosqich uchun ochilganda
                   * React bir xil komponentni qayta ishlatadi va ichidagi
                   * `useState(step)` eski qiymatda qolib ketardi.
                   */
                  key={editing.key}
                  step={editing}
                  onDone={(row) => {
                    upsert(server, row);
                    setEditing(null);
                  }}
                />
              )}
            </Sheet>

            <Sheet open={adding} onClose={() => setAdding(false)} title="Yangi savol">
              <NewQuestion
                taken={list.map((s) => s.key)}
                onDone={(row) => {
                  upsert(server, row);
                  setAdding(false);
                }}
              />
            </Sheet>
          </div>
        );
      }}
    </Async>
  );
}

/* ─────────────────────────  Bitta qator  ───────────────────────── */

function StepRow({
  step,
  position,
  total,
  onUp,
  onDown,
  onToggle,
  onEdit,
  onRemove,
}: {
  step: RequestStep;
  position: number;
  total: number;
  onUp: () => void;
  onDown: () => void;
  onToggle: (field: 'enabled' | 'required') => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const builtin = isBuiltin(step.key);
  const info = BUILTIN_INFO[step.key];
  const title = step.titleUz || info?.name || step.key;

  return (
    <Card className={`stepRow ${step.enabled ? '' : 'is-off'}`}>
      <div className="stepRow__order">
        <button type="button" onClick={onUp} disabled={position === 0} aria-label="Yuqoriga">
          ↑
        </button>
        <span className="stepRow__num">{position + 1}</span>
        <button type="button" onClick={onDown} disabled={position === total - 1} aria-label="Pastga">
          ↓
        </button>
      </div>

      <div className="stepRow__body">
        <div className="stepRow__head">
          <b>{title}</b>
          <Chip size="sm">{KIND_LABEL[step.kind]}</Chip>
          {step.locked && <Chip size="sm">Qulflangan</Chip>}
        </div>
        <p className="muted stepRow__what">
          {builtin ? info?.what ?? step.key : step.subUz || `Kalit: ${step.key}`}
        </p>
      </div>

      <div className="stepRow__actions">
        {/*
          Qulflangan bosqichda tugmalar umuman ko'rsatilmaydi. Ko'rsatib
          keyin xato berish — foydalanuvchini aldash bo'lardi.
        */}
        {!step.locked && (
          <>
            <Chip size="sm" active={step.enabled} onClick={() => onToggle('enabled')}>
              {step.enabled ? 'Yoqilgan' : 'O‘chiq'}
            </Chip>
            <Chip size="sm" active={step.required} onClick={() => onToggle('required')}>
              {step.required ? 'Majburiy' : 'Ixtiyoriy'}
            </Chip>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Tahrirlash
        </Button>
        {!builtin && (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            O‘chirish
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ─────────────────────────  Matn tahriri  ───────────────────────── */

function StepEditor({ step, onDone }: { step: RequestStep; onDone: (row: RequestStep) => void }) {
  const [row, setRow] = useState<RequestStep>(step);
  const set = (part: Partial<RequestStep>) => setRow((r) => ({ ...r, ...part }));
  const builtin = isBuiltin(row.key);

  return (
    <div className="stack">
      {builtin ? (
        <Notice>
          <b>{BUILTIN_INFO[row.key]?.name ?? row.key}</b> — tayyor bosqich: {BUILTIN_INFO[row.key]?.what}.
          Bo‘sh qoldirilsa ilovadagi tayyor matn ishlatiladi; bu yerga yozsangiz sizniki ustun keladi.
        </Notice>
      ) : (
        <Notice>
          Savol turi: <b>{KIND_LABEL[row.kind]}</b>. Turini keyin o‘zgartirib bo‘lmaydi — allaqachon
          berilgan javoblar ma’nosini yo‘qotardi. Boshqa tur kerak bo‘lsa yangi savol qo‘shing.
          Majburiyligini ro‘yxatdagi tugmadan o‘zgartirasiz.
        </Notice>
      )}

      <Field label="Sarlavha (o‘zbekcha)">
        <Input value={row.titleUz ?? ''} onChange={(e) => set({ titleUz: e.target.value || null })} maxLength={120} />
      </Field>
      <Field label="Sarlavha (ruscha)">
        <Input value={row.titleRu ?? ''} onChange={(e) => set({ titleRu: e.target.value || null })} maxLength={120} />
      </Field>
      <Field label="Tushuntirish (o‘zbekcha)">
        <Textarea rows={2} value={row.subUz ?? ''} onChange={(e) => set({ subUz: e.target.value || null })} maxLength={240} />
      </Field>
      <Field label="Tushuntirish (ruscha)">
        <Textarea rows={2} value={row.subRu ?? ''} onChange={(e) => set({ subRu: e.target.value || null })} maxLength={240} />
      </Field>

      {(row.kind === 'choice' || row.kind === 'multichoice') && (
        <OptionsEditor options={row.options ?? []} onChange={(options) => set({ options })} />
      )}

      <Button block onClick={() => onDone(row)}>
        Qo‘llash
      </Button>
    </div>
  );
}

/* ─────────────────────────  Variantlar  ───────────────────────── */

function OptionsEditor({
  options,
  onChange,
}: {
  options: StepOption[];
  onChange: (options: StepOption[]) => void;
}) {
  const set = (i: number, part: Partial<StepOption>) =>
    onChange(options.map((o, k) => (k === i ? { ...o, ...part } : o)));

  return (
    <Section title="Variantlar">
      <div className="stack stack--tight">
        {options.map((o, i) => (
          <div className="row row--gap" key={i}>
            <Input
              value={o.uz}
              placeholder="O‘zbekcha"
              onChange={(e) => set(i, { uz: e.target.value })}
              maxLength={80}
            />
            <Input
              value={o.ru}
              placeholder="Ruscha"
              onChange={(e) => set(i, { ru: e.target.value })}
              maxLength={80}
            />
            <Button size="sm" variant="ghost" onClick={() => onChange(options.filter((_, k) => k !== i))}>
              ✕
            </Button>
          </div>
        ))}
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          onChange([...options, { value: `v${options.length + 1}`, uz: '', ru: '' }])
        }
      >
        + Variant
      </Button>
      {options.length < 2 && <p className="muted">Kamida ikkita variant kerak.</p>}
    </Section>
  );
}

/* ─────────────────────────  Yangi savol  ───────────────────────── */

function NewQuestion({ taken, onDone }: { taken: string[]; onDone: (row: RequestStep) => void }) {
  const [kind, setKind] = useState<StepKind>('choice');
  const [titleUz, setTitleUz] = useState('');
  const [titleRu, setTitleRu] = useState('');
  const [options, setOptions] = useState<StepOption[]>([
    { value: 'v1', uz: '', ru: '' },
    { value: 'v2', uz: '', ru: '' },
  ]);

  /*
   * Kalit sarlavhadan yasaladi: admin texnik kalit o'ylab topishi shart
   * emas. Lotin bo'lmagan belgilar tushib qoladi, bo'sh qolsa vaqt
   * bo'yicha yasaladi — natija har doim serverdagi qoidaga mos bo'ladi.
   */
  const key = useMemo(() => {
    const base = titleUz
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30);
    const seed = base && /^[a-z]/.test(base) ? base : `q${Date.now().toString(36).slice(-6)}`;
    let candidate = seed;
    let n = 2;
    while (taken.includes(candidate)) candidate = `${seed}_${n++}`;
    return candidate;
  }, [titleUz, taken]);

  const needsOptions = kind === 'choice' || kind === 'multichoice';
  const optionsOk = !needsOptions || (options.length >= 2 && options.every((o) => o.uz.trim()));
  const ready = titleUz.trim().length >= 2 && optionsOk;

  return (
    <div className="stack">
      <Field label="Savol turi">
        <div className="chips">
          {CREATABLE.map((k) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label="Savol (o‘zbekcha)">
        <Input value={titleUz} onChange={(e) => setTitleUz(e.target.value)} maxLength={120} />
      </Field>
      <Field label="Savol (ruscha)">
        <Input value={titleRu} onChange={(e) => setTitleRu(e.target.value)} maxLength={120} />
      </Field>

      {needsOptions && <OptionsEditor options={options} onChange={setOptions} />}

      <p className="muted">Kalit: <code>{key}</code></p>

      <Button
        block
        disabled={!ready}
        onClick={() =>
          onDone({
            id: 0,
            key,
            kind,
            position: 0,
            enabled: true,
            required: false,
            locked: false,
            titleUz: titleUz.trim(),
            titleRu: titleRu.trim() || null,
            subUz: null,
            subRu: null,
            options: needsOptions
              ? options.map((o, i) => ({ value: o.value || `v${i + 1}`, uz: o.uz.trim(), ru: o.ru.trim() || o.uz.trim() }))
              : null,
          })
        }
      >
        Qo‘shish
      </Button>
    </div>
  );
}
