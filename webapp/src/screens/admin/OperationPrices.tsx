/**
 * Admin: operatsiyalarning narx oralig'i.
 *
 * Nima uchun kerak: bemor byudjetni ixtiyoriy qo'yardi va klinikalar
 * bajarib bo'lmaydigan so'rovlarni ko'rardi — 100 ming so'mga yurak
 * operatsiyasi. Har bunday taklif qo'lda rad etilardi.
 *
 * Nega klinikada emas, adminda: klinika o'z narxini ko'tarish uchun
 * pastki chegarani surib qo'yardi. Oraliq — katalog ma'lumoti.
 *
 * Katalogning O'ZI bu yerdan tahrirlanmaydi: operatsiyalar banisa
 * importidan keladi. Faqat narx — u bizning ma'lumotimiz.
 */
import { useMemo, useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { Async, useResource } from '@/screens/clinic/shell';
import { Button, Input } from '@/ui';
import type { AdminOperation } from '@shared/types';
import { PageHeader, Toolbar, Empty, Tag } from './ui';

/** `12 000 000` → `12000000`; bo'sh satr — chegarani olib tashlash */
const toNumber = (v: string): number | null => {
  const digits = v.replace(/\D/g, '');
  return digits === '' ? null : Number(digits);
};

const groupDigits = (n: number) => n.toLocaleString('ru-RU').replace(/ /g, ' ');

export function OperationPrices() {
  const { toast } = useApp();
  const res = useResource(() => api.adminOperations());
  const [query, setQuery] = useState('');

  return (
    <>
      <PageHeader
        title="Operatsiya narxlari"
        description="Bemorning byudjeti shu oraliqda bo'lishi kerak. Bo'sh qoldirilsa chegara yo'q."
      />
      <Toolbar>
        <Input
          placeholder="Operatsiya yoki soha nomi"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Toolbar>

      <Async resource={res}>
        {(data) => <List operations={data.operations} query={query} toast={toast} onSaved={res.reload} />}
      </Async>
    </>
  );
}

function List({
  operations,
  query,
  toast,
  onSaved,
}: {
  operations: AdminOperation[];
  query: string;
  toast: (m: string, tone?: 'success' | 'error') => void;
  onSaved: () => void;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return operations;
    return operations.filter(
      (o) =>
        o.nameUz.toLowerCase().includes(q) ||
        o.nameRu.toLowerCase().includes(q) ||
        (o.category?.nameUz ?? '').toLowerCase().includes(q),
    );
  }, [operations, query]);

  /*
   * Soha bo'yicha guruhlash. Narx yozadigan odam operatsiyani nomi
   * bo'yicha emas, sohasi bo'yicha qidiradi.
   */
  const groups = useMemo(() => {
    const map = new Map<string, AdminOperation[]>();
    for (const op of filtered) {
      const key = op.category?.nameUz ?? 'Sohasiz';
      const list = map.get(key);
      if (list) list.push(op);
      else map.set(key, [op]);
    }
    return [...map.entries()];
  }, [filtered]);

  if (filtered.length === 0) {
    return <Empty title="Topilmadi" hint="Boshqa nom bilan qidirib ko'ring" />;
  }

  return (
    <div className="stack">
      {groups.map(([category, ops]) => (
        <section key={category} className="stack">
          <h2 className="section-title">
            {category} <span className="tiny">({ops.length})</span>
          </h2>
          {ops.map((op) => (
            <Row key={op.id} op={op} toast={toast} onSaved={onSaved} />
          ))}
        </section>
      ))}
    </div>
  );
}

function Row({
  op,
  toast,
  onSaved,
}: {
  op: AdminOperation;
  toast: (m: string, tone?: 'success' | 'error') => void;
  onSaved: () => void;
}) {
  const [min, setMin] = useState(op.minPriceUzs == null ? '' : groupDigits(op.minPriceUzs));
  const [max, setMax] = useState(op.maxPriceUzs == null ? '' : groupDigits(op.maxPriceUzs));
  const [saving, setSaving] = useState(false);

  const minNum = toNumber(min);
  const maxNum = toNumber(max);

  /* Xato SAQLASHDAN OLDIN ko'rinadi — server ham tekshiradi */
  const invalid = minNum != null && maxNum != null && minNum > maxNum;

  const changed =
    minNum !== (op.minPriceUzs ?? null) || maxNum !== (op.maxPriceUzs ?? null);

  const save = async () => {
    setSaving(true);
    try {
      await api.setOperationPriceRange(op.id, minNum, maxNum);
      toast('Saqlandi', 'success');
      onSaved();
    } catch (err: any) {
      toast(err?.message ?? 'Saqlanmadi', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="opprice">
      <div className="opprice__name">
        <span>{op.nameUz}</span>
        {!op.active && <Tag tone="neutral">o'chirilgan</Tag>}
        {op.subcategory && <span className="tiny">{op.subcategory.nameUz}</span>}
      </div>

      <div className="opprice__fields">
        <Input
          inputMode="numeric"
          placeholder="eng kam"
          aria-label={`${op.nameUz} — eng kam narx`}
          value={min}
          onChange={(e) => {
            const n = toNumber(e.target.value);
            setMin(n == null ? '' : groupDigits(n));
          }}
        />
        <span className="tiny">—</span>
        <Input
          inputMode="numeric"
          placeholder="eng ko'p"
          aria-label={`${op.nameUz} — eng ko'p narx`}
          value={max}
          onChange={(e) => {
            const n = toNumber(e.target.value);
            setMax(n == null ? '' : groupDigits(n));
          }}
        />
        <Button
          size="sm"
          loading={saving}
          disabled={!changed || invalid}
          onClick={save}
        >
          Saqlash
        </Button>
      </div>

      {invalid && <span className="opprice__error">Eng kam narx eng ko'pidan katta</span>}
    </div>
  );
}
