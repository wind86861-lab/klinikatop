/**
 * Admin qo'shgan savollarga bemor bergan javoblar.
 *
 * Server javoblarni XOM holida beradi (kalit → qiymat), yorliqlar esa
 * bosqichlar ro'yxatidan olinadi. Nima uchun shunday: aks holda har bir
 * so'rov qatorida bosqichlar jadvali o'qilardi — ro'yxatlarda bu N+1
 * bo'lardi. Ro'yxat esa kichkina va hamma uchun bir xil, shuning uchun
 * bir marta olinadi va modul darajasida saqlanadi.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { WizardStep } from '@shared/types';

let cache: WizardStep[] | null = null;
let inflight: Promise<WizardStep[]> | null = null;

function loadSteps(): Promise<WizardStep[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .requestSteps()
      .then((list) => {
        cache = list;
        return list;
      })
      .catch(() => [])
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function ExtraAnswers({ answers }: { answers: Record<string, unknown> | null }) {
  const [steps, setSteps] = useState<WizardStep[]>(cache ?? []);

  useEffect(() => {
    if (!answers || Object.keys(answers).length === 0) return;
    let alive = true;
    loadSteps().then((list) => {
      if (alive) setSteps(list);
    });
    return () => {
      alive = false;
    };
  }, [answers]);

  if (!answers) return null;

  const rows = Object.entries(answers).flatMap(([key, value]) => {
    const step = steps.find((s) => s.key === key);
    // Savol o'chirilgan bo'lsa yorliq yo'q — javobni ko'rsatmaymiz,
    // chunki nima so'ralganini bilmasdan raqam yoki "ha" ma'nosiz.
    if (!step?.title) return [];

    const label = (v: string) => step.options?.find((o) => o.value === v)?.label ?? v;
    let text: string;
    if (Array.isArray(value)) text = value.map((v) => label(String(v))).join(', ');
    else if (typeof value === 'boolean') text = value ? 'Ha' : 'Yo‘q';
    else text = label(String(value));

    return text ? [{ key, title: step.title, text }] : [];
  });

  if (rows.length === 0) return null;

  return (
    <div className="stack" style={{ gap: 4 }}>
      {rows.map((r) => (
        <div className="between" key={r.key}>
          <span className="tiny">{r.title}</span>
          <span style={{ fontSize: 'var(--t-sm)', textAlign: 'right' }}>{r.text}</span>
        </div>
      ))}
    </div>
  );
}
