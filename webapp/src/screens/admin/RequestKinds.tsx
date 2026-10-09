/**
 * So'rov turlari — bemor "Sizga nima kerak?" qadamida nimani ko'radi.
 *
 * Faol/nofaol va tartib. Nofaol tur bemorga KO'RINADI ("Hozircha faol
 * emas" belgisi bilan), lekin tanlanmaydi; server ham uni qabul qilmaydi.
 *
 * Saqlash darhol: deploy kerak emas. Telegram ilovasi ochiq turgan
 * bemor yangi tartibni ilovani qayta ochganda ko'radi.
 */
import { useEffect, useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { Button, Card, Chip, Notice, Section, Skeleton } from '@/ui';
import type { RequestKind, RequestKindSetting } from '@shared/types';

const INFO: Record<RequestKind, { icon: string; title: string; what: string }> = {
  referral: { icon: '📄', title: 'Laboratoriya so‘rovi (yo‘llanma)', what: 'Shifokor yo‘llanmasini rasmga oladi yoki ro‘yxat yozadi' },
  operation: { icon: '🩺', title: 'Operatsiya', what: 'Katalogdan operatsiya + holat tavsifi' },
  lab: { icon: '🔬', title: 'Tahlil / MRT, MSKT', what: 'Tahlil katalogidan aniq tekshiruv + vazn' },
};

export function RequestKindsCard() {
  const { toast } = useApp();
  const [saved, setSaved] = useState<RequestKindSetting[] | null>(null);
  const [list, setList] = useState<RequestKindSetting[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .requestKinds()
      .then((k) => {
        setSaved(k);
        setList(k);
      })
      .catch((err) => toast(err?.message ?? 'Yuklab bo‘lmadi', 'error'));
  }, [toast]);

  if (!list || !saved) return <Skeleton h={180} />;

  const dirty = JSON.stringify(list) !== JSON.stringify(saved);
  const enabledCount = list.filter((k) => k.enabled).length;

  const move = (i: number, d: number) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setList(next);
    haptic.select();
  };
  const toggle = (i: number) => {
    // Oxirgi yoqilganini o'chirib bo'lmaydi — aks holda so'rov qoldirib bo'lmasdi
    if (list[i].enabled && enabledCount === 1) {
      toast('Kamida bitta tur faol bo‘lishi kerak', 'error');
      return;
    }
    setList(list.map((k, j) => (j === i ? { ...k, enabled: !k.enabled } : k)));
  };

  const save = async () => {
    setBusy(true);
    try {
      const after = await api.saveRequestKinds(list);
      setSaved(after);
      setList(after);
      haptic.success();
      toast('Saqlandi', 'success');
    } catch (err: any) {
      toast(err?.message ?? 'Saqlab bo‘lmadi', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="So‘rov turlari" action={<span className="muted">{enabledCount} ta faol / {list.length}</span>}>
      <div className="stack stack--tight">
        <Notice>
          Bemor «Sizga nima kerak?» qadamida turlarni shu tartibda ko‘radi. <b>Nofaol</b> tur kulrang,
          «Hozircha faol emas» belgisi bilan ko‘rinadi va uni tanlab bo‘lmaydi; bu tur bo‘yicha so‘rov
          qabul qilinmaydi (shifokor so‘rovlari ham).
        </Notice>

        {list.map((k, i) => (
          <Card key={k.kind} className={`stepRow ${k.enabled ? '' : 'is-off'}`}>
            <div className="stepRow__order">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Yuqoriga">
                ↑
              </button>
              <span className="stepRow__num">{i + 1}</span>
              <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Pastga">
                ↓
              </button>
            </div>
            <div className="stepRow__body">
              <div className="stepRow__head">
                <b>
                  {INFO[k.kind].icon} {INFO[k.kind].title}
                </b>
              </div>
              <p className="muted stepRow__what">{INFO[k.kind].what}</p>
            </div>
            <div className="stepRow__actions">
              <Chip size="sm" active={k.enabled} onClick={() => toggle(i)}>
                {k.enabled ? 'Faol' : 'Nofaol'}
              </Chip>
            </div>
          </Card>
        ))}

        {dirty && (
          <div className="row" style={{ gap: 'var(--s-2)' }}>
            <Button loading={busy} onClick={save}>
              Saqlash
            </Button>
            <Button variant="ghost" onClick={() => setList(saved)}>
              Bekor qilish
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
