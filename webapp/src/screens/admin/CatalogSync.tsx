/**
 * Katalog manbasi — banisa.uz.
 *
 * Operatsiyalar ro'yxati platformaning o'zagi: unga tegish barcha
 * klinikalarning ko'radigan so'rovlarini o'zgartiradi. Shuning uchun bu
 * ekran ikki qadamli — avval NIMA o'zgarishini ko'rsatadi, keyin
 * qo'llaydi. Bir bosishda 105 ta yozuvni almashtirish yo'li yo'q.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from '@/store/app';
import { api, type SyncChange, type SyncPlan } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { popVariants, spring } from '@/lib/motion';
import { formatDate } from '@/lib/format';
import { Button, Card, Notice, Section, Skeleton } from '@/ui';
import { Async, useResource } from '../clinic/shell';

const KIND_LABEL: Record<SyncChange['kind'], string> = {
  add: 'yangi',
  update: 'yangilanadi',
  deactivate: 'yashiriladi',
  reactivate: 'qaytariladi',
};

const KIND_TONE: Record<SyncChange['kind'], string> = {
  add: 'is-add',
  update: 'is-update',
  deactivate: 'is-off',
  reactivate: 'is-add',
};

export function CatalogSync() {
  const { lang, toast } = useApp();
  const res = useResource(() => api.catalogStatus());

  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const preview = async () => {
    setLoading(true);
    try {
      setPlan(await api.catalogPreview());
      haptic.tap();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? 'Manbaga ulanib bo‘lmadi', 'error');
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      const r = await api.catalogSync();
      haptic.success();
      toast(`${r.added} yangi, ${r.updated} yangilandi, ${r.deactivated} yashirildi`, 'success');
      setPlan(null);
      res.reload();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? 'Sinxronizatsiya bajarilmadi', 'error');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Async resource={res} skeleton={<Skeleton h={200} />}>
      {(status) => (
        <>
          {!status.configured && (
            <Notice tone="danger">
              Manba ulanishi sozlanmagan. Serverda <code>deploy/setup-catalog-source.sh</code> ni
              yurgizing.
            </Notice>
          )}

          <Card className="stack" style={{ gap: 'var(--s-3)' }}>
            <div className="stack" style={{ gap: 2 }}>
              <strong>banisa.uz katalogi</strong>
              <span className="tiny">
                Operatsiyalar banisa'dan o‘qiladi va bu yerga ko‘chiriladi. banisa'ga hech narsa
                yozilmaydi — ulanish faqat o‘qish huquqiga ega.
              </span>
            </div>

            <Button block variant="secondary" loading={loading} disabled={!status.configured} onClick={preview}>
              O‘zgarishlarni ko‘rish
            </Button>
          </Card>

          {/* ── Reja ── */}
          <AnimatePresence>
            {plan && (
              <motion.div variants={popVariants} initial="initial" animate="animate" exit="exit">
                <Section title="Nima o‘zgaradi">
                  <div className="sync-sum">
                    <SumCell n={plan.operations.filter((c) => c.kind === 'add').length} label="yangi" tone="is-add" />
                    <SumCell n={plan.operations.filter((c) => c.kind === 'update').length} label="yangilanadi" tone="is-update" />
                    <SumCell n={plan.operations.filter((c) => c.kind === 'deactivate').length} label="yashiriladi" tone="is-off" />
                  </div>

                  <Card className="stack" style={{ gap: 6 }}>
                    <Row k="Manbada operatsiyalar" v={plan.sourceTotal} />
                    <Row k="Yangi kategoriya" v={plan.categories.add} />
                    <Row k="Qo‘lda kiritilgan (ro‘yxatdan chiqadi)" v={plan.manualHidden} />
                    {plan.skippedDuplicates > 0 && (
                      <Row k="Manbada takrorlangan (olinmaydi)" v={plan.skippedDuplicates} />
                    )}
                  </Card>

                  {plan.operations.length === 0 ? (
                    <Notice tone="info">Katalog manba bilan bir xil — o‘zgarish yo‘q.</Notice>
                  ) : (
                    <>
                      {(plan.operations.some((c) => c.kind === 'deactivate') ||
                        plan.manualHidden > 0) && (
                        <Notice tone="warning">
                          Katalog to‘liq banisa.uz dan bo‘ladi: qo‘lda kiritilganlar ro‘yxatdan
                          chiqariladi. Ular o‘chirilmaydi — klinikalarning sozlamasi va o‘tgan
                          bitimlar saqlanadi, faqat yangi so‘rovlarda ko‘rinmaydi.
                        </Notice>
                      )}

                      <div className="sync-list">
                        {plan.operations.slice(0, 60).map((c) => (
                          <div key={c.externalId} className="sync-row">
                            <span className={`sync-tag ${KIND_TONE[c.kind]}`}>{KIND_LABEL[c.kind]}</span>
                            <span className="truncate">{c.nameUz}</span>
                            {c.fields && <span className="tiny">{c.fields.join(', ')}</span>}
                          </div>
                        ))}
                        {plan.operations.length > 60 && (
                          <span className="tiny">
                            …va yana {plan.operations.length - 60} ta
                          </span>
                        )}
                      </div>

                      <Button block loading={applying} onClick={apply}>
                        Qo‘llash
                      </Button>
                    </>
                  )}
                </Section>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Tarix ── */}
          {status.log.length > 0 && (
            <Section title="Tarix">
              {status.log.map((row) => (
                <Card key={row.id} className="stack" style={{ gap: 4 }}>
                  <div className="between">
                    <strong className={row.status === 'ok' ? '' : 'danger'}>
                      {row.status === 'ok'
                        ? `+${row.added} · ~${row.updated} · −${row.deactivated}`
                        : 'Xato'}
                    </strong>
                    <span className="tiny num">{row.durationMs} ms</span>
                  </div>
                  <span className="tiny">{formatDate(row.createdAt, lang)}</span>
                  {row.error && <span className="tiny danger">{row.error}</span>}
                </Card>
              ))}
            </Section>
          )}
        </>
      )}
    </Async>
  );
}

function SumCell({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <motion.div className={`sync-cell ${tone}`} layout transition={spring}>
      <strong className="num">{n}</strong>
      <span className="tiny">{label}</span>
    </motion.div>
  );
}

function Row({ k, v }: { k: string; v: number }) {
  return (
    <div className="between">
      <span className="tiny">{k}</span>
      <strong className="num">{v}</strong>
    </div>
  );
}
