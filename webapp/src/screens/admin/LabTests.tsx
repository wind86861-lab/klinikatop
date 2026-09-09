/**
 * Admin: tahlil katalogi.
 *
 * Bemor tahlil so'rovida bitta savolga javob beradi — QANDAY
 * tekshiruv kerak. Ro'yxatni admin qo'lda to'ldiradi va u o'zgarib
 * turadi: yangi uskuna kelsa kengayadi, eskisi yashiriladi. Kodda
 * tursa har o'zgarish deploy kutardi.
 *
 * Tana a'zosi ALOHIDA daraja emas — u nomning o'ziga kiradi ("Bosh
 * miya MRT"). Ikki daraja nazariy jihatdan toza edi, lekin amalda
 * ortiqcha: katalogni to'ldiradigan odam uchun ham, bemor uchun ham.
 *
 * Tekshiruvga MOS SAVOL "So'rov bosqichlari" ekranidan qo'shiladi:
 * savol yaratilayotganda qaysi tekshiruvda chiqishi tanlanadi.
 */
import { useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { Async, useResource } from '@/screens/clinic/shell';
import { Button, Chip, Field, Input, Sheet } from '@/ui';
import type { LabTest } from '@shared/types';
import { PageHeader, Toolbar, Empty } from './ui';

interface Draft {
  id: number | null;
  nameUz: string;
  nameRu: string;
  icon: string;
  /** Qaysi guruhga kiradi (MRT, MSKT); null — o'zi guruh */
  parentId: number | null;
  durationMin: string;
}

const EMPTY: Draft = {
  id: null,
  nameUz: '',
  nameRu: '',
  icon: '',
  parentId: null,
  durationMin: '',
};

export function LabTests() {
  const { toast } = useApp();
  const res = useResource(() => api.adminLabTests());

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const [openGroup, setOpenGroup] = useState<number | null>(null);

  const open = (t: LabTest | null, parentId: number | null = null) =>
    setDraft(
      t
        ? {
            id: t.id,
            nameUz: t.nameUz,
            nameRu: t.nameRu,
            icon: t.icon,
            parentId: t.parentId,
            durationMin: t.durationMin == null ? '' : String(t.durationMin),
          }
        : { ...EMPTY, parentId },
    );

  const save = async () => {
    if (!draft) return;
    if (draft.nameUz.trim().length < 2) {
      toast('Tekshiruv nomini yozing', 'error');
      return;
    }
    setSaving(true);
    try {
      const num = (v: string) => (v.trim() ? Number(v.replace(/\D/g, '')) : null);
      const body = {
        nameUz: draft.nameUz.trim(),
        nameRu: draft.nameRu.trim() || draft.nameUz.trim(),
        icon: draft.icon.trim(),
        parentId: draft.parentId,
        durationMin: num(draft.durationMin),
      };
      if (draft.id) await api.updateLabTest(draft.id, body);
      else await api.createLabTest(body);
      toast('Saqlandi', 'success');
      setDraft(null);
      res.reload();
    } catch (err: any) {
      toast(err?.message ?? 'Xatolik', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: LabTest) => {
    try {
      await api.deleteLabTest(t.id);
      toast('O‘chirildi', 'success');
      res.reload();
    } catch (err: any) {
      // So'rovda ishlatilgan tekshiruv o'chirilmaydi — server sababini aytadi
      toast(err?.message ?? 'Xatolik', 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Tahlil katalogi"
        description="Avval guruh (MRT, MSKT), ichida esa aniq tekshiruv. Bemor guruhni ochib, kerakli tekshiruvni tanlaydi."
      />

      <Toolbar>
        <Button size="sm" onClick={() => open(null)}>
          Yangi tekshiruv
        </Button>
      </Toolbar>

      <Async resource={res}>
        {(data: { tests: LabTest[] }) => {
          const groups = data.tests.filter((x) => x.parentId === null);
          const kidsOf = (id: number) => data.tests.filter((x) => x.parentId === id);

          return groups.length === 0 ? (
            <Empty title="Tekshiruv yo‘q" hint="Birinchisini qo‘shing — bemor shundan tanlaydi." />
          ) : (
            /*
              Katalog ikki darajali: guruh (MRT, MSKT) va uning
              ichidagi aniq tekshiruvlar. Ellikdan ortiq yozuvni
              tekis ro'yxatda ko'rsatish keraklisini topib bo'lmaydigan
              devor bo'lardi.
            */
            <div className="cat__tree">
              {groups.map((g) => {
                const kids = kidsOf(g.id);
                const isOpen = openGroup === g.id;

                return (
                  <div key={g.id} className="cat__branch">
                    <div className="labrow">
                      <button
                        type="button"
                        className={`cat__head ${isOpen ? 'is-open' : ''}`}
                        style={{ flex: 1 }}
                        onClick={() => setOpenGroup(isOpen ? null : g.id)}
                      >
                        {kids.length > 0 && (
                          <span className={`cat__caret ${isOpen ? 'is-open' : ''}`}>›</span>
                        )}
                        <span className="labtest__icon">{g.icon}</span>
                        <span className="cat__name truncate">{g.nameUz}</span>
                        <span className="cat__count num">{kids.length}</span>
                      </button>

                      <div className="row" style={{ gap: 4, paddingRight: 'var(--s-3)' }}>
                        <Button size="sm" variant="ghost" onClick={() => open(null, g.id)}>
                          Ichiga qo‘shish
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => open(g)}>
                          Tahrirlash
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(g)}>
                          O‘chirish
                        </Button>
                      </div>
                    </div>

                    {isOpen && kids.length > 0 && (
                      <div className="cat__body">
                        <div className="stack" style={{ gap: 'var(--s-2)' }}>
                          {kids.map((x) => (
                            <div key={x.id} className="labrow labrow--card">
                              <span style={{ flex: 1 }}>{x.nameUz}</span>
                              {x.durationMin != null && <span className="tiny">{x.durationMin} daq</span>}
                              <Button size="sm" variant="ghost" onClick={() => open(x)}>
                                Tahrirlash
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => remove(x)}>
                                O‘chirish
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        }}
      </Async>

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Tekshiruvni tahrirlash' : 'Yangi tekshiruv'}
      >
        {draft && (
          <div className="stack">
            <Field label="Nomi (uz)" hint="Tana a‘zosi bilan birga: “Bosh miya MRT”">
              <Input
                value={draft.nameUz}
                placeholder="Bosh miya MRT"
                onChange={(e) => setDraft({ ...draft, nameUz: e.target.value })}
              />
            </Field>
            <Field label="Nomi (ru)" hint="Bo‘sh qoldirilsa o‘zbekchasi ishlatiladi">
              <Input value={draft.nameRu} onChange={(e) => setDraft({ ...draft, nameRu: e.target.value })} />
            </Field>
            <Field label="Belgi" hint="Bitta emoji — guruh ro‘yxatida ko‘rinadi">
              <Input value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
            </Field>

            <Field label="Guruh" hint="Bo‘sh qoldirilsa yozuvning o‘zi guruh bo‘ladi">
              <div className="chips">
                <Chip active={draft.parentId === null} onClick={() => setDraft({ ...draft, parentId: null })}>
                  Guruhsiz
                </Chip>
                {(res.data?.tests ?? [])
                  .filter((x) => x.parentId === null && x.id !== draft.id)
                  .map((g) => (
                    <Chip
                      key={g.id}
                      active={draft.parentId === g.id}
                      onClick={() => setDraft({ ...draft, parentId: g.id })}
                    >
                      {g.icon} {g.nameUz}
                    </Chip>
                  ))}
              </div>
            </Field>

            <Field label="Davomiyligi (daqiqa)">
              <Input
                inputMode="numeric"
                value={draft.durationMin}
                placeholder="15"
                onChange={(e) => setDraft({ ...draft, durationMin: e.target.value })}
              />
            </Field>

            <Button block loading={saving} onClick={save}>
              Saqlash
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
