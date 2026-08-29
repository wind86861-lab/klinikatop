/**
 * Ish oqimi guruhi — kabinetning 6, 8, 9 va 10-ekranlari.
 *
 *   RequestsFeed  — kelayotgan so'rovlar, filtrlar bilan
 *   OfferBuilder  — taklif konstruktori (narx, tarkib, muddat)
 *   Templates     — taklif shablonlari
 *   MyOffers      — yuborilgan takliflar va ularning taqdiri
 *
 * Klinika kunining katta qismi shu to'rt ekranda o'tadi, shuning uchun
 * ular bir joyda turadi va bitta uslubga bo'ysunadi.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api, clinicApi } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { formatDate, groupDigits, money, timeLeft } from '@/lib/format';
import { cityName, opName } from '@/i18n';
import { AttachmentList } from '@/components/wizard/DocumentsStep';
import {
  Button,
  Card,
  Chip,
  Field,
  IconAlert,
  IconCheck,
  IconClock,
  IconPlus,
  Input,
  Notice,
  Screen,
  Segment,
  Sheet,
  Skeleton,
  Textarea,
} from '@/ui';
import { Async, ClinicTabBar, Meter, useResource } from './shell';
import type { OfferTemplate, Operation, RequestWithMeta } from '@shared/types';

/* ═════════════════  6-ekran: so'rovlar oqimi  ═════════════════ */

type Sort = 'new' | 'budget' | 'expiry';

export function RequestsFeed() {
  const { t, lang } = useApp();
  const navigate = useNavigate();

  const [onlyUnanswered, setOnlyUnanswered] = useState(false);
  const [withBudget, setWithBudget] = useState(false);
  const [withDocs, setWithDocs] = useState(false);
  const [sort, setSort] = useState<Sort>('new');

  const res = useResource(() => api.clinicRequests(false));
  // Obuna holati — so'rovlar ko'rinadi, lekin taklif yuborish to'silgan bo'lishi mumkin
  const dash = useResource(() => api.dashboard());
  const canOffer = dash.data ? dash.data.subscription.status === 'active' : true;

  const visible = useMemo(() => {
    const list = [...(res.data ?? [])];
    const filtered = list.filter((r) => {
      if (onlyUnanswered && r.offersCount > 0) return false;
      if (withBudget && r.budgetUzs == null) return false;
      if (withDocs && (r.files?.length ?? 0) === 0) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (sort === 'budget') return (b.budgetUzs ?? 0) - (a.budgetUzs ?? 0);
      if (sort === 'expiry') return (a.expiresAt ?? '').localeCompare(b.expiresAt ?? '');
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });
    return filtered;
  }, [res.data, onlyUnanswered, withBudget, withDocs, sort]);

  return (
    <Screen title={t('feed.title')} subtitle={t('feed.sub')} tabBar={<ClinicTabBar />}>
      {/* Filtrlar so'rovlardan oldin — klinika kuniga o'nlab so'rov ko'radi */}
      <div className="scroll-x">
        <div className="row" style={{ gap: 6 }}>
          <Chip size="sm" active={onlyUnanswered} onClick={() => setOnlyUnanswered((v) => !v)}>
            {t('feed.onlyUnanswered')}
          </Chip>
          <Chip size="sm" active={withBudget} onClick={() => setWithBudget((v) => !v)}>
            {t('feed.withBudget')}
          </Chip>
          <Chip size="sm" active={withDocs} onClick={() => setWithDocs((v) => !v)}>
            {t('feed.withDocs')}
          </Chip>
        </div>
      </div>

      {!canOffer && (
        <Notice tone="warning">
          {t('feed.noSub')}
        </Notice>
      )}

      <Segment
        value={sort}
        onChange={(v) => setSort(v as Sort)}
        options={[
          { value: 'new', label: t('feed.sortNew') },
          { value: 'budget', label: t('feed.sortBudget') },
          { value: 'expiry', label: t('feed.sortExpiry') },
        ]}
      />

      <Async
        resource={res}
        isEmpty={() => visible.length === 0}
        empty={{ title: t('feed.empty'), text: t('feed.emptyText') }}
      >
        {() => (
          <AnimatePresence initial={false}>
            {visible.map((request, i) => (
              <m.div
                key={request.id}
                layout
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ ...spring, delay: Math.min(i * 0.03, 0.2) }}
              >
                <Card onClick={() => navigate(`/clinic/requests/${request.id}`)} className="stack">
                  <div className="between">
                    <strong>{opName(request.operation, lang)}</strong>
                    {request.offersCount > 0 ? (
                      <span className="badge badge--muted">{t('feed.answered')}</span>
                    ) : (
                      <span className="live-pill">
                        <i /> {t('feed.live')}
                      </span>
                    )}
                  </div>

                  {request.conditionText && <p className="clamp-2 tiny">{request.conditionText}</p>}

                  <div className="row tiny" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <span>{cityName(request.city, lang)}</span>
                    <span>
                      {request.budgetUzs ? money(request.budgetUzs, lang) : t('budget.skip')}
                    </span>
                    {(request.files?.length ?? 0) > 0 && <span>{request.files!.length} 📎</span>}
                    {request.expiresAt && (
                      <span className="row" style={{ gap: 4 }}>
                        <IconClock size={12} /> {t('feed.expiresIn', { v: timeLeft(request.expiresAt, lang).text })}
                      </span>
                    )}
                  </div>
                </Card>
              </m.div>
            ))}
          </AnimatePresence>
        )}
      </Async>
    </Screen>
  );
}

/* ═════════════════  8-ekran: taklif konstruktori  ═════════════════ */

export function OfferBuilder() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const requestId = Number(id);

  const res = useResource(async () => {
    const [detail, templates] = await Promise.all([
      api.clinicRequest(requestId),
      clinicApi.templates(),
    ]);
    return { ...detail, templates };
  }, [requestId]);

  const [price, setPrice] = useState('');
  const [includes, setIncludes] = useState<string[]>(['']);
  const [advantages, setAdvantages] = useState<string[]>(['']);
  const [leadTimeDays, setLeadTimeDays] = useState(7);
  const [note, setNote] = useState('');
  const [pickTemplate, setPickTemplate] = useState(false);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [sending, setSending] = useState(false);

  const priceNumber = Number(price.replace(/\D/g, '')) || 0;
  const clean = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);
  const canSend = priceNumber > 0 && clean(includes).length > 0;

  const applyTemplate = (tpl: OfferTemplate) => {
    if (tpl.priceUzs) setPrice(groupDigits(tpl.priceUzs));
    setIncludes(tpl.includes.length ? tpl.includes : ['']);
    setAdvantages(tpl.advantages.length ? tpl.advantages : ['']);
    setLeadTimeDays(tpl.leadTimeDays);
    setNote(tpl.note ?? '');
    setPickTemplate(false);
    haptic.success();
    void clinicApi.useTemplate(tpl.id);
  };

  /** Obuna to'sig'i — server 402 qaytarganda ko'rsatiladi */
  const [paywall, setPaywall] = useState<'subscription_required' | 'offer_limit_reached' | null>(null);

  const submit = async () => {
    setSending(true);
    try {
      await api.createOffer({
        requestId,
        priceUzs: priceNumber,
        includes: clean(includes),
        advantages: clean(advantages),
        leadTimeDays,
        note: note.trim() || null,
      });

      // Shablon sifatida saqlash ixtiyoriy — keyingi safar bir tegishda qo'llaniladi
      if (saveAsTemplate && res.data) {
        await clinicApi.createTemplate({
          title: opName(res.data.request.operation, lang).slice(0, 60),
          operationId: res.data.request.operationId,
          priceUzs: priceNumber,
          includes: clean(includes),
          advantages: clean(advantages),
          leadTimeDays,
          note: note.trim() || null,
        });
      }

      haptic.success();
      toast(t('ob.sent'), 'success');
      navigate('/clinic/offers', { replace: true });
    } catch (err: any) {
      haptic.error();
      // 402 — bu xato emas, tijorat to'sig'i: alohida ekran ko'rsatiladi
      if (err?.code === 'subscription_required' || err?.code === 'offer_limit_reached') {
        setPaywall(err.code);
      } else {
        toast(err?.message ?? t('common.error'), 'error');
      }
      setSending(false);
    }
  };

  return (
    <Screen
      onBack={() => navigate(-1)}
      title={t('ob.title')}
      subtitle={t('ob.sub')}
      footer={
        <Button block loading={sending} disabled={!canSend} onClick={submit}>
          {t('ob.submit')}
        </Button>
      }
    >
      <Async resource={res} skeleton={<Skeleton h={360} />}>
        {(data) => {
          const median = data.stats?.median ?? null;
          const tooHigh = median != null && priceNumber > median * 1.5;

          return (
            <>
              <Card className="stack" style={{ gap: 6 }}>
                <strong>{opName(data.request.operation, lang)}</strong>
                <p className="tiny">{data.request.conditionText}</p>
                {data.request.files && data.request.files.length > 0 && (
                  <AttachmentList files={data.request.files} />
                )}
              </Card>

              {data.templates.length > 0 && (
                <Button variant="secondary" block onClick={() => setPickTemplate(true)}>
                  {t('ob.fromTemplate')}
                </Button>
              )}

              <Field label={t('ob.price')} hint={median ? t('ob.marketHint', { v: money(median, lang) }) : t('ob.priceHint')}>
                <Input
                  inputMode="numeric"
                  value={price}
                  placeholder="0"
                  onChange={(e) => setPrice(groupDigits(Number(e.target.value.replace(/\D/g, '')) || 0))}
                />
              </Field>

              <AnimatePresence>
                {tooHigh && (
                  <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Notice tone="warning">{t('ob.tooHigh')}</Notice>
                  </m.div>
                )}
              </AnimatePresence>

              <LineEditor
                label={t('ob.includes')}
                hint={t('ob.includesHint')}
                lines={includes}
                onChange={setIncludes}
                addLabel={t('ob.addLine')}
              />

              <LineEditor
                label={t('ob.advantages')}
                lines={advantages}
                onChange={setAdvantages}
                addLabel={t('ob.addLine')}
              />

              <Field label={t('ob.leadTime')}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {[3, 7, 14, 30].map((d) => (
                    <Chip key={d} size="sm" active={leadTimeDays === d} onClick={() => setLeadTimeDays(d)}>
                      {d} {t('common.days')}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label={t('ob.note')}>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>

              <label className="toggle-row">
                <span className="toggle-row__text">
                  <span className="toggle-row__title">{t('ob.saveTemplate')}</span>
                </span>
                <input
                  type="checkbox"
                  checked={saveAsTemplate}
                  onChange={(e) => setSaveAsTemplate(e.target.checked)}
                />
              </label>

              {/* Tijorat to'sig'i — nima uchun to'silgani va nima qilish kerakligi */}
              <Sheet open={paywall !== null} onClose={() => setPaywall(null)} title={t('sub.title')}>
                <div className="stack">
                  <strong>{paywall === 'offer_limit_reached' ? t('paywall.limit') : t('paywall.title')}</strong>
                  <p className="tiny">
                    {paywall === 'offer_limit_reached' ? t('paywall.limitText') : t('paywall.text')}
                  </p>
                  <Button block onClick={() => navigate('/clinic/subscription')}>
                    {t('paywall.cta')}
                  </Button>
                </div>
              </Sheet>

              <Sheet open={pickTemplate} onClose={() => setPickTemplate(false)} title={t('tpl.title')}>
                <div className="stack">
                  {data.templates.map((tpl) => (
                    <Card key={tpl.id} onClick={() => applyTemplate(tpl)} className="stack" style={{ gap: 4 }}>
                      <div className="between">
                        <strong>{tpl.title}</strong>
                        {tpl.priceUzs && <span className="num">{money(tpl.priceUzs, lang)}</span>}
                      </div>
                      <span className="tiny">{tpl.includes.slice(0, 3).join(' · ')}</span>
                    </Card>
                  ))}
                </div>
              </Sheet>
            </>
          );
        }}
      </Async>
    </Screen>
  );
}

/** Ko'p qatorli ro'yxat muharriri — "narxga nima kiradi" va afzalliklar uchun. */
function LineEditor({
  label,
  hint,
  lines,
  onChange,
  addLabel,
}: {
  label: string;
  hint?: string;
  lines: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
}) {
  const set = (i: number, value: string) => onChange(lines.map((l, j) => (j === i ? value : l)));
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i));

  return (
    <Field label={label} hint={hint}>
      <div className="stack" style={{ gap: 6 }}>
        <AnimatePresence initial={false}>
          {lines.map((line, i) => (
            <m.div
              key={i}
              layout
              className="row"
              style={{ gap: 6 }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
            >
              <Input value={line} onChange={(e) => set(i, e.target.value)} />
              {lines.length > 1 && (
                <button className="doc-row__remove" onClick={() => remove(i)} aria-label="×">
                  ×
                </button>
              )}
            </m.div>
          ))}
        </AnimatePresence>
        <Button variant="ghost" size="sm" icon={<IconPlus size={14} />} onClick={() => onChange([...lines, ''])}>
          {addLabel}
        </Button>
      </div>
    </Field>
  );
}

/* ═════════════════  9-ekran: shablonlar  ═════════════════ */

export function Templates() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => clinicApi.templates());
  const opsRes = useResource(() => api.operations({}));

  const [editing, setEditing] = useState<OfferTemplate | 'new' | null>(null);

  const remove = async (id: number) => {
    if (!confirm(t('tpl.deleteConfirm'))) return;
    try {
      await clinicApi.deleteTemplate(id);
      haptic.tap();
      toast(t('tpl.deleted'), 'success');
      res.reload();
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  return (
    <Screen
      onBack={() => navigate('/clinic/more')}
      title={t('tpl.title')}
      subtitle={t('tpl.sub')}
      footer={
        <Button block icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
          {t('tpl.new')}
        </Button>
      }
    >
      <Async
        resource={res}
        isEmpty={(d) => d.length === 0}
        empty={{ title: t('tpl.empty'), text: t('tpl.emptyText') }}
      >
        {(list) => (
          <AnimatePresence initial={false}>
            {list.map((tpl) => {
              const op = opsRes.data?.find((o: Operation) => o.id === tpl.operationId);
              return (
                <m.div key={tpl.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={spring}>
                  <Card className="stack" style={{ gap: 6 }}>
                    <div className="between">
                      <strong>{tpl.title}</strong>
                      {tpl.priceUzs && <span className="num">{money(tpl.priceUzs, lang)}</span>}
                    </div>
                    <span className="tiny">{op ? opName(op, lang) : t('tpl.anyOperation')}</span>
                    {tpl.includes.length > 0 && <p className="tiny clamp-2">{tpl.includes.join(' · ')}</p>}
                    <div className="between">
                      <span className="tiny">{t('tpl.used', { n: tpl.usedCount })}</span>
                      <div className="row" style={{ gap: 6 }}>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(tpl)}>
                          {t('common.edit')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(tpl.id)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  </Card>
                </m.div>
              );
            })}
          </AnimatePresence>
        )}
      </Async>

      <TemplateSheet
        editing={editing}
        operations={opsRes.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          toast(t('tpl.saved'), 'success');
          res.reload();
        }}
      />
    </Screen>
  );
}

function TemplateSheet({
  editing,
  operations,
  onClose,
  onSaved,
}: {
  editing: OfferTemplate | 'new' | null;
  operations: Operation[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang, toast } = useApp();
  const tpl = editing === 'new' || editing === null ? null : editing;

  const [title, setTitle] = useState('');
  const [operationId, setOperationId] = useState<number | null>(null);
  const [price, setPrice] = useState('');
  const [includes, setIncludes] = useState<string[]>(['']);
  const [leadTimeDays, setLeadTimeDays] = useState(7);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState<number | 'new' | null>(null);

  // Tahrirlash boshlanganda formani bir marta to'ldiramiz
  const key = editing === 'new' ? 'new' : (tpl?.id ?? null);
  if (editing !== null && seeded !== key) {
    setSeeded(key);
    setTitle(tpl?.title ?? '');
    setOperationId(tpl?.operationId ?? null);
    setPrice(tpl?.priceUzs ? groupDigits(tpl.priceUzs) : '');
    setIncludes(tpl?.includes.length ? tpl.includes : ['']);
    setLeadTimeDays(tpl?.leadTimeDays ?? 7);
  }

  const save = async () => {
    setSaving(true);
    const body = {
      title: title.trim(),
      operationId,
      priceUzs: Number(price.replace(/\D/g, '')) || null,
      includes: includes.map((s) => s.trim()).filter(Boolean),
      advantages: [],
      leadTimeDays,
      note: null,
    };
    try {
      if (tpl) await clinicApi.updateTemplate(tpl.id, body);
      else await clinicApi.createTemplate(body);
      haptic.success();
      onSaved();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={editing !== null} onClose={onClose} title={tpl ? t('common.edit') : t('tpl.new')}>
      <div className="stack">
        <Field label={t('tpl.name')}>
          <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <Field label={t('need.tabCatalog')}>
          <div className="scroll-x">
            <div className="row" style={{ gap: 6 }}>
              <Chip size="sm" active={operationId === null} onClick={() => setOperationId(null)}>
                {t('tpl.anyOperation')}
              </Chip>
              {operations
                .filter((o) => o.slug !== 'unknown')
                .slice(0, 30)
                .map((op) => (
                  <Chip key={op.id} size="sm" active={operationId === op.id} onClick={() => setOperationId(op.id)}>
                    {opName(op, lang)}
                  </Chip>
                ))}
            </div>
          </div>
        </Field>

        <Field label={t('ob.price')}>
          <Input
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(groupDigits(Number(e.target.value.replace(/\D/g, '')) || 0))}
          />
        </Field>

        <LineEditor label={t('ob.includes')} lines={includes} onChange={setIncludes} addLabel={t('ob.addLine')} />

        <Field label={t('ob.leadTime')}>
          <div className="row" style={{ gap: 6 }}>
            {[3, 7, 14, 30].map((d) => (
              <Chip key={d} size="sm" active={leadTimeDays === d} onClick={() => setLeadTimeDays(d)}>
                {d}
              </Chip>
            ))}
          </div>
        </Field>

        <Button block loading={saving} disabled={title.trim().length < 2} onClick={save}>
          {t('common.save')}
        </Button>
      </div>
    </Sheet>
  );
}

/* ═════════════════  10-ekran: mening takliflarim  ═════════════════ */

export function MyOffers() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();
  const res = useResource(() => api.clinicOffers());
  const [filter, setFilter] = useState<'all' | 'SENT' | 'CHOSEN' | 'REJECTED'>('all');

  const withdraw = async (id: number) => {
    try {
      await api.withdrawOffer(id);
      haptic.tap();
      res.reload();
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
    }
  };

  const visible = (res.data ?? []).filter((o) => filter === 'all' || o.status === filter);

  return (
    <Screen onBack={() => navigate('/clinic/more')} title={t('mo.title')} subtitle={t('mo.sub')}>
      <Segment
        value={filter}
        onChange={(v) => setFilter(v as any)}
        options={[
          { value: 'all', label: t('common.all') },
          { value: 'SENT', label: t('mo.status.SENT') },
          { value: 'CHOSEN', label: t('mo.status.CHOSEN') },
          { value: 'REJECTED', label: t('mo.status.REJECTED') },
        ]}
      />

      <Async
        resource={res}
        isEmpty={() => visible.length === 0}
        empty={{ title: t('mo.empty'), text: t('tpl.emptyText') }}
      >
        {() => (
          <AnimatePresence initial={false}>
            {visible.map((offer) => (
              <m.div key={offer.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={spring}>
                <Card className="stack" style={{ gap: 6 }}>
                  <div className="between">
                    <strong>{offer.operationName}</strong>
                    <span className={`badge badge--${offer.status === 'CHOSEN' ? 'success' : offer.status === 'REJECTED' ? 'muted' : 'accent'}`}>
                      {t(`mo.status.${offer.status}` as any)}
                    </span>
                  </div>

                  <div className="between">
                    <span className="num" style={{ fontSize: 'var(--t-lg)' }}>{money(offer.priceUzs, lang)}</span>
                    <span className="tiny">{t('offers.leadTime', { n: offer.leadTimeDays })}</span>
                  </div>

                  {offer.includes.length > 0 && <p className="tiny clamp-2">{offer.includes.join(' · ')}</p>}

                  <div className="between">
                    <span className="tiny">{formatDate(offer.createdAt, lang)}</span>
                    {offer.status === 'SENT' && (
                      <Button size="sm" variant="ghost" onClick={() => withdraw(offer.id)}>
                        {t('mo.withdraw')}
                      </Button>
                    )}
                  </div>
                </Card>
              </m.div>
            ))}
          </AnimatePresence>
        )}
      </Async>
    </Screen>
  );
}

export { IconAlert, IconCheck, Meter, type RequestWithMeta };
