/**
 * Admin: tahlil katalogi — tekshiruvlar va ularga mos organlar.
 *
 * Nima uchun kerak: bemor tahlil so'rovida ikkita savolga javob
 * beradi — QANDAY tekshiruv (MRT, UZI, qon tahlili) va QAYSI organ
 * uchun. Qaysi organ qaysi tekshiruvga mos kelishi tibbiy qaror va u
 * o'zgarib turadi: yangi uskuna kelsa ro'yxat kengayadi.
 *
 * Bu kodda turgan bo'lsa, har o'zgarish deploy kutardi. Shuning uchun
 * u shu yerda: admin tekshiruv qo'shadi, organlarini belgilaydi va
 * bemor darhol shu ro'yxatni ko'radi.
 *
 * Juftlik MUHIM: bemorga "qon tahlili + umurtqa" degan variant
 * ko'rsatilmasligi kerak — u hech qaysi klinikaga tushmaydi.
 */
import { useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { Async, useResource } from '@/screens/clinic/shell';
import { Button, Chip, Field, Input, Notice, Sheet } from '@/ui';
import type { LabOrgan, LabTest } from '@shared/types';
import { PageHeader, Toolbar, Empty } from './ui';

interface Draft {
  id: number | null;
  nameUz: string;
  nameRu: string;
  icon: string;
  organIds: number[];
  active: boolean;
}

const EMPTY: Draft = { id: null, nameUz: '', nameRu: '', icon: '', organIds: [], active: true };

export function LabTests() {
  const { toast } = useApp();
  const res = useResource(() => api.adminLabTests());

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [openTest, setOpenTest] = useState<number | null>(null);

  /*
   * Tana a'zolarini ham SHU YERDA boshqaramiz.
   *
   * Ular alohida bo'lim bo'lishi mumkin edi, lekin ikkovi bir
   * ishning ikki yarmi: tekshiruv qo'shayotgan odam unga mos
   * a'zoni ham o'sha zahoti kiritishi kerak bo'ladi. Bo'limlar
   * orasida sakrash faqat xalaqit berardi.
   */
  const [organDraft, setOrganDraft] = useState<{ id: number | null; nameUz: string; nameRu: string; icon: string } | null>(
    null,
  );

  const saveOrgan = async () => {
    if (!organDraft) return;
    if (organDraft.nameUz.trim().length < 2) {
      toast('Nomini yozing', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        nameUz: organDraft.nameUz.trim(),
        nameRu: organDraft.nameRu.trim() || organDraft.nameUz.trim(),
        icon: organDraft.icon.trim(),
      };
      if (organDraft.id) await api.updateLabOrgan(organDraft.id, body);
      else await api.createLabOrgan(body);
      toast('Saqlandi', 'success');
      setOrganDraft(null);
      res.reload();
    } catch (err: any) {
      toast(err?.message ?? 'Xatolik', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeOrgan = async (o: LabOrgan) => {
    try {
      await api.deleteLabOrgan(o.id);
      toast('O‘chirildi', 'success');
      res.reload();
    } catch (err: any) {
      // Ishlatilgan a'zo o'chirilmaydi — server sababini aytadi
      toast(err?.message ?? 'Xatolik', 'error');
    }
  };

  const organName = (organs: LabOrgan[], id: number) => organs.find((o) => o.id === id)?.nameUz ?? String(id);

  const open = (t: LabTest | null) =>
    setDraft(
      t
        ? { id: t.id, nameUz: t.nameUz, nameRu: t.nameRu, icon: t.icon, organIds: [...t.organIds], active: true }
        : { ...EMPTY },
    );

  const save = async () => {
    if (!draft) return;
    if (draft.nameUz.trim().length < 2) {
      toast('Tekshiruv nomini yozing', 'error');
      return;
    }
    if (!draft.organIds.length) {
      toast('Kamida bitta organ tanlang', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        nameUz: draft.nameUz.trim(),
        nameRu: draft.nameRu.trim() || draft.nameUz.trim(),
        icon: draft.icon.trim(),
        organIds: draft.organIds,
        active: draft.active,
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
      // Ishlatilgan tekshiruv o'chirilmaydi — server sababini aytadi
      toast(err?.message ?? 'Xatolik', 'error');
    }
  };

  return (
    <>
      <PageHeader
        title="Tahlil katalogi"
        description="Tekshiruvlar va ularga mos organlar. Bemor shu ro‘yxatdan tanlaydi."
      />

      <Toolbar>
        <Button size="sm" onClick={() => open(null)}>
          Yangi tekshiruv
        </Button>
      </Toolbar>

      <Async resource={res}>
        {(data: { tests: LabTest[]; organs: LabOrgan[] }) =>
          data.tests.length === 0 ? (
            <Empty title="Tekshiruv yo‘q" hint="Birinchisini qo‘shing — bemor shundan tanlaydi." />
          ) : (
            /*
              Yig'iladigan ro'yxat — operatsiyalar katalogidagidek.
              Tekshiruvlar soni o'sgani sari hammasining organlarini
              bir vaqtda ochiq ko'rsatish ekranni uzun devorga
              aylantiradi va keraklisini topish qiyinlashadi.
            */
            <div className="cat__tree">
              {data.tests.map((t) => {
                const isOpen = openTest === t.id;
                return (
                  <div key={t.id} className="cat__branch">
                    <div className="labrow">
                      <button
                        type="button"
                        className={`cat__head ${isOpen ? 'is-open' : ''}`}
                        style={{ flex: 1 }}
                        onClick={() => setOpenTest(isOpen ? null : t.id)}
                      >
                        <span className={`cat__caret ${isOpen ? 'is-open' : ''}`}>›</span>
                        <span className="labtest__icon">{t.icon}</span>
                        <span className="cat__name truncate">{t.nameUz}</span>
                        <span className="cat__count num">{t.organIds.length}</span>
                      </button>

                      <div className="row" style={{ gap: 4, paddingRight: 'var(--s-3)' }}>
                        <Button size="sm" variant="ghost" onClick={() => open(t)}>
                          Tahrirlash
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(t)}>
                          O‘chirish
                        </Button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="cat__body">
                        <div className="cat__ops">
                          {t.organIds.map((id) => (
                            <span className="badge badge--neutral" key={id}>
                              {organName(data.organs, id)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        }
      </Async>

      {/* ── Tana a'zolari ── */}
      <Async resource={res}>
        {(data: { tests: LabTest[]; organs: LabOrgan[] }) => (
          <>
            <PageHeader
              title="Tana a‘zolari"
              description="Bemor tekshiruvni tanlagach shu ro‘yxatdan qidiradi."
            />
            <Toolbar>
              <Button size="sm" onClick={() => setOrganDraft({ id: null, nameUz: '', nameRu: '', icon: '' })}>
                Yangi a‘zo
              </Button>
            </Toolbar>

            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {data.organs.map((o) => (
                <span key={o.id} className="organchip">
                  <span>{o.icon}</span>
                  <button
                    type="button"
                    className="organchip__name"
                    onClick={() => setOrganDraft({ id: o.id, nameUz: o.nameUz, nameRu: o.nameRu, icon: o.icon })}
                  >
                    {o.nameUz}
                  </button>
                  <button type="button" className="organchip__x" aria-label="O‘chirish" onClick={() => removeOrgan(o)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </>
        )}
      </Async>

      <Sheet
        open={organDraft !== null}
        onClose={() => setOrganDraft(null)}
        title={organDraft?.id ? 'A‘zoni tahrirlash' : 'Yangi tana a‘zosi'}
      >
        {organDraft && (
          <div className="stack">
            <Field label="Nomi (uz)">
              <Input
                value={organDraft.nameUz}
                placeholder="Bosh miya"
                onChange={(e) => setOrganDraft({ ...organDraft, nameUz: e.target.value })}
              />
            </Field>
            <Field label="Nomi (ru)" hint="Bo‘sh qoldirilsa o‘zbekchasi ishlatiladi">
              <Input
                value={organDraft.nameRu}
                onChange={(e) => setOrganDraft({ ...organDraft, nameRu: e.target.value })}
              />
            </Field>
            <Field label="Belgi" hint="Bitta emoji">
              <Input
                value={organDraft.icon}
                onChange={(e) => setOrganDraft({ ...organDraft, icon: e.target.value })}
              />
            </Field>
            <Button block loading={saving} onClick={saveOrgan}>
              Saqlash
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Tekshiruvni tahrirlash' : 'Yangi tekshiruv'}
      >
        {draft && (
          <div className="stack">
            <Field label="Nomi (uz)">
              <Input value={draft.nameUz} onChange={(e) => setDraft({ ...draft, nameUz: e.target.value })} />
            </Field>
            <Field label="Nomi (ru)" hint="Bo‘sh qoldirilsa o‘zbekchasi ishlatiladi">
              <Input value={draft.nameRu} onChange={(e) => setDraft({ ...draft, nameRu: e.target.value })} />
            </Field>
            <Field label="Belgi" hint="Bitta emoji — ro‘yxatda ko‘rinadi">
              <Input value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
            </Field>

            <Field label="Qaysi organlar uchun">
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {(res.data?.organs ?? []).map((o) => (
                  <Chip
                    key={o.id}
                    size="sm"
                    active={draft.organIds.includes(o.id)}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        organIds: draft.organIds.includes(o.id)
                          ? draft.organIds.filter((x) => x !== o.id)
                          : [...draft.organIds, o.id],
                      })
                    }
                  >
                    {o.nameUz}
                  </Chip>
                ))}
              </div>
            </Field>

            {draft.organIds.length === 0 && (
              <Notice tone="warning">Kamida bitta organ tanlang — bemor shundan tanlaydi.</Notice>
            )}

            <Button block loading={saving} onClick={save}>
              Saqlash
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
