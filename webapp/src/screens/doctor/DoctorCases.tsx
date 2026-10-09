/**
 * Shifokor: bemor uchun so'rovlar.
 *
 *   Kabinet → statistika + "Bemor uchun so'rov" + ro'yxat
 *   /doctor/new       — raqam, xizmat, viloyat, izoh
 *   /doctor/case/:id  — holat; bemor botda bo'lmasa havola/QR;
 *                       tasdiqlangach — klinikalar takliflari
 *
 * So'rov bemor tasdiqlamaguncha QORALAMA: klinikalar uni ko'rmaydi.
 * Bu ekranlar shifokorga aynan shuni aytib turadi.
 */
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useNavigate, useParams } from '@/lib/router';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic, tg } from '@/lib/telegram';
import { formatDate, formatDateTime, money } from '@/lib/format';
import { cityName, opName } from '@/i18n';
import { CatalogBrowser, type CatalogBranch } from '@/components/CatalogBrowser';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Notice,
  Screen,
  Segment,
  Select,
  Sheet,
  Skeleton,
  SkeletonCard,
  Textarea,
} from '@/ui';
import type {
  DoctorCase,
  DoctorCaseStatus,
  DoctorStats,
  LabTest,
  Operation,
  OfferWithClinic,
  RequestKind,
} from '@shared/types';

const STATUS_TONE: Record<DoctorCaseStatus, string> = {
  waiting: 'warning',
  approved: 'success',
  declined: 'danger',
  expired: 'neutral',
  not_me: 'danger',
};

/* ─────────────────────────  Kabinetdagi bo'lim  ───────────────────────── */

/** Tasdiqlangan shifokor kabinetining ish qismi */
export function DoctorWorkspace() {
  const { t, lang } = useApp();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DoctorStats | null>(null);
  const [cases, setCases] = useState<DoctorCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    Promise.all([api.doctorStats(), api.doctorCases()])
      .then(([s, c]) => {
        setStats(s);
        setCases(c);
      })
      .catch((err) => setError(err?.message ?? t('common.error')));
  };
  useEffect(load, []);

  const service = (c: DoctorCase) => (lang === 'ru' ? c.serviceRu : c.serviceUz);

  return (
    <>
      <Button block onClick={() => navigate('/doctor/new')}>
        {t('rdoc.newCaseBtn')}
      </Button>

      {error && <ErrorState message={error} retryLabel={t('common.retry')} onRetry={load} />}

      {stats && (
        <div className="rdoc-stats">
          <Stat label={t('rdoc.statCases')} value={stats.cases} />
          <Stat label={t('rdoc.statApproved')} value={stats.approved} />
          <Stat label={t('rdoc.statOffers')} value={stats.offers} />
          <Stat label={t('rdoc.statDeals')} value={stats.deals} />
          <Stat label={t('rdoc.statRecs')} value={stats.recommendations} />
          <Stat label={t('rdoc.statAccepted')} value={stats.acceptedRecommendations} />
          <div className="rdoc-stat rdoc-stat--wide">
            <span className="tiny">{t('rdoc.statRecSum')}</span>
            <strong className="num">{money(stats.recommendedSumUzs, lang)}</strong>
          </div>
          <div className="rdoc-stat rdoc-stat--wide">
            <span className="tiny">{t('rdoc.statSum')}</span>
            <strong className="num">{money(stats.dealSumUzs, lang)}</strong>
          </div>
        </div>
      )}

      {/* Qaysi klinikaga nechta tavsiya va qancha summa — shifokorning o'zi ham ko'radi */}
      {stats && stats.byClinic.length > 0 && (
        <Card className="stack" style={{ gap: 8 }}>
          <strong>{t('rdoc.byClinic')}</strong>
          {stats.byClinic.map((r) => (
            <div className="rdoc-clinic" key={r.clinicId}>
              <strong className="truncate">{r.clinicName}</strong>
              <span className="tiny num">
                {t('rdoc.byClinicRow', { n: r.recommendations, sum: money(r.recommendedSumUzs, lang) })}
              </span>
              {r.accepted > 0 && (
                <span className="tiny num rdoc-clinic__ok">
                  {t('rdoc.byClinicAccepted', { n: r.accepted, sum: money(r.acceptedSumUzs, lang) })}
                </span>
              )}
            </div>
          ))}
        </Card>
      )}

      <Card className="stack" style={{ gap: 10 }}>
        <strong>{t('rdoc.casesTitle')}</strong>
        {cases === null && !error ? (
          <Skeleton h={120} />
        ) : cases && cases.length === 0 ? (
          <p className="tiny">{t('rdoc.casesEmptyText')}</p>
        ) : (
          cases?.map((c) => (
            <button type="button" key={c.id} className="rdoc-case" onClick={() => navigate(`/doctor/case/${c.id}`)}>
              <span className="rdoc-case__main">
                <strong className="truncate">{service(c)}</strong>
                <span className="tiny num">
                  {c.patientName ?? `+${c.patientPhone}`} · {formatDate(c.createdAt, lang)}
                </span>
              </span>
              <span className="rdoc-case__side">
                <Badge tone={STATUS_TONE[c.status]}>{t(`rdoc.st.${c.status}` as any)}</Badge>
                {c.status === 'approved' && <span className="tiny">{t('rdoc.offersN', { n: c.offersCount })}</span>}
              </span>
            </button>
          ))
        )}
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rdoc-stat">
      <strong className="num">{value}</strong>
      <span className="tiny">{label}</span>
    </div>
  );
}

/* ─────────────────────────  Yangi so'rov  ───────────────────────── */

export function DoctorNewCase() {
  const { t, lang, cities, toast, session } = useApp();
  const navigate = useNavigate();

  // Bemor sehrgaridagi bilan bir xil: admin yoqqan turlar, o'sha tartibda
  const kinds: RequestKind[] = session?.features.requestKinds?.length
    ? session.features.requestKinds
    : ['operation', 'lab', 'referral'];

  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<RequestKind>(kinds[0]);
  const [op, setOp] = useState<Operation | null>(null);
  const [picking, setPicking] = useState(false);
  const [tree, setTree] = useState<CatalogBranch[] | null>(null);
  const [tests, setTests] = useState<LabTest[] | null>(null);
  const [group, setGroup] = useState<number | null>(null);
  const [testId, setTestId] = useState<number | null>(null);
  const [items, setItems] = useState('');
  const [cityId, setCityId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (kind === 'operation' && tree === null) void api.catalogTree().then(setTree).catch(() => setTree([]));
    if (kind === 'lab' && tests === null) void api.labTests().then(setTests).catch(() => setTests([]));
  }, [kind, tree, tests]);

  const name = (x: LabTest) => (lang === 'ru' ? x.nameRu : x.nameUz);
  const groups = useMemo(() => (tests ?? []).filter((x) => x.parentId === null), [tests]);
  const kids = useMemo(() => (tests ?? []).filter((x) => x.parentId === group), [tests, group]);

  // Bolasi yo'q guruh — o'zi tekshiruv
  const pickGroup = (id: number | null) => {
    setGroup(id);
    const hasKids = (tests ?? []).some((x) => x.parentId === id);
    setTestId(id && !hasKids ? id : null);
  };

  const digits = phone.replace(/\D/g, '');
  const itemList = items.split('\n').map((s) => s.trim()).filter(Boolean);
  const valid =
    (digits.length === 9 || (digits.length === 12 && digits.startsWith('998'))) &&
    cityId !== null &&
    (kind === 'operation' ? op !== null && note.trim().length >= 10 : kind === 'lab' ? testId !== null : itemList.length > 0);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const created = await api.createDoctorCase({
        patientPhone: digits,
        kind,
        operationId: kind === 'operation' ? op!.id : null,
        labTestId: kind === 'lab' ? testId : null,
        referralItems: kind === 'referral' ? itemList : null,
        cityId: cityId!,
        note: note.trim() || null,
      });
      haptic.success();
      toast(t('rdoc.new.sent'), 'success');
      navigate(`/doctor/case/${created.id}`, { replace: true });
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={t('rdoc.new.title')}
      subtitle={t('rdoc.new.sub')}
      onBack={() => navigate('/doctor')}
      footer={
        <Button block loading={busy} disabled={!valid} onClick={submit}>
          {t('rdoc.new.submit')}
        </Button>
      }
    >
      <div className="stack">
        <Field label={t('rdoc.new.phone')} hint={t('rdoc.new.phoneHint')}>
          <div className="rdoc-phone">
            <span className="rdoc-phone__cc">+998</span>
            <Input
              inputMode="tel"
              placeholder="90 123 45 67"
              value={phone}
              maxLength={16}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d\s+-]/g, ''))}
            />
          </div>
        </Field>

        {kinds.length > 1 && (
          <Field label={t('rdoc.new.kind')}>
            <Segment
              value={kind}
              onChange={(v) => setKind(v as RequestKind)}
              options={kinds.map((k) => ({ value: k, label: t(`rdoc.kind.${k}` as const) }))}
            />
          </Field>
        )}

        {kind === 'operation' && (
          <Field label={t('rdoc.kind.operation')}>
            {op ? (
              <div className="cs__file is-picked">
                <span className="cs__fileMeta">
                  <strong>{opName(op, lang)}</strong>
                </span>
                <button type="button" className="cs__clear" onClick={() => setPicking(true)}>
                  {t('rdoc.new.change')}
                </button>
              </div>
            ) : (
              <Button variant="secondary" block onClick={() => setPicking(true)}>
                {t('rdoc.new.pickOp')}
              </Button>
            )}
          </Field>
        )}

        {kind === 'lab' && (
          <>
            <Field label={t('rdoc.new.labGroup')}>
              <Select value={group ?? ''} onChange={(e) => pickGroup(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{t('rdoc.new.choose')}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.icon} {name(g)}
                  </option>
                ))}
              </Select>
            </Field>
            {group !== null && kids.length > 0 && (
              <Field label={t('rdoc.new.labTest')}>
                <Select value={testId ?? ''} onChange={(e) => setTestId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{t('rdoc.new.choose')}</option>
                  {kids.map((x) => (
                    <option key={x.id} value={x.id}>
                      {name(x)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}

        {kind === 'referral' && (
          <Field label={t('rdoc.new.items')} hint={t('rdoc.new.itemsHint')}>
            <Textarea rows={4} value={items} maxLength={3000} onChange={(e) => setItems(e.target.value)} />
          </Field>
        )}

        <Field label={t('rdoc.new.city')}>
          <Select value={cityId ?? ''} onChange={(e) => setCityId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('rdoc.new.choose')}</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {cityName(c, lang)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('rdoc.new.note')} hint={kind === 'operation' ? t('rdoc.new.noteHintOp') : t('rdoc.new.noteHint')}>
          <Textarea rows={3} value={note} maxLength={1500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <Sheet open={picking} onClose={() => setPicking(false)} title={t('rdoc.new.pickOp')}>
        {tree === null ? (
          <Skeleton h={240} />
        ) : (
          <CatalogBrowser
            tree={tree}
            lang={lang}
            mode="single"
            selected={op ? [op.id] : []}
            onSelect={(o) => {
              setOp(o);
              setPicking(false);
            }}
          />
        )}
      </Sheet>
    </Screen>
  );
}

/* ─────────────────────────  So'rov tafsiloti  ───────────────────────── */

export function DoctorCaseDetail() {
  const { t, lang, cities, toast } = useApp();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<(DoctorCase & { offers: OfferWithClinic[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [recommending, setRecommending] = useState<OfferWithClinic | null>(null);
  const [recComment, setRecComment] = useState('');
  const [recBusy, setRecBusy] = useState(false);

  const load = () => {
    setError(null);
    api
      .doctorCase(Number(id))
      .then(setData)
      .catch((err) => setError(err?.message ?? t('common.error')));
  };
  useEffect(load, [id]);

  const needsLink = data?.status === 'waiting' && !data.patientLinked;
  useEffect(() => {
    if (!needsLink || !data) return;
    QRCode.toDataURL(data.inviteLink, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [needsLink, data]);

  const back = () => navigate('/doctor');

  if (error) {
    return (
      <Screen title={t('rdoc.title')} onBack={back}>
        <ErrorState message={error} retryLabel={t('common.retry')} onRetry={load} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen title={t('rdoc.title')} onBack={back}>
        <SkeletonCard lines={5} />
      </Screen>
    );
  }

  const city = cities.find((c) => c.id === data.cityId);
  // Tavsiya faqat bemor hali tanlamagan paytda
  const canRecommend =
    data.status === 'approved' && (data.requestStatus === 'NEW' || data.requestStatus === 'COLLECTING');

  const recommend = async () => {
    if (!recommending) return;
    setRecBusy(true);
    try {
      setData(await api.recommendOffer(data.id, recommending.id, recComment.trim() || null));
      haptic.success();
      toast(t('rdoc.rec.sent'), 'success');
      setRecommending(null);
      setRecComment('');
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setRecBusy(false);
    }
  };

  const share = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(data.inviteLink)}&text=${encodeURIComponent(t('rdoc.case.shareText'))}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, '_blank');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.inviteLink);
      toast(t('rdoc.case.copied'), 'success');
    } catch {
      /* havola ekranda ko'rinib turadi */
    }
  };

  return (
    <Screen title={t('rdoc.case.title', { id: data.id })} subtitle={formatDateTime(data.createdAt, lang)} onBack={back}>
      <div className="stack">
        <Card className="stack" style={{ gap: 8 }}>
          <div className="between">
            <strong>{lang === 'ru' ? data.serviceRu : data.serviceUz}</strong>
            <Badge tone={STATUS_TONE[data.status]}>{t(`rdoc.st.${data.status}` as any)}</Badge>
          </div>
          <div className="app-rows">
            <div className="app-row">
              <span className="tiny">{t('rdoc.case.patient')}</span>
              <span className="num">{data.patientName ?? `+${data.patientPhone}`}</span>
            </div>
            {city && (
              <div className="app-row">
                <span className="tiny">{t('rdoc.new.city')}</span>
                <span>{cityName(city, lang)}</span>
              </div>
            )}
          </div>
          {data.referralItems.length > 0 && (
            <ul className="rdoc-items">
              {data.referralItems.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          {data.note && <p className="tiny" style={{ whiteSpace: 'pre-line' }}>{data.note}</p>}
        </Card>

        {data.status === 'waiting' && data.patientLinked && (
          <Notice>
            {t('rdoc.case.linkedWait')} {t('rdoc.case.expires', { date: formatDateTime(data.expiresAt, lang) })}
          </Notice>
        )}

        {needsLink && (
          <Card className="stack rdoc-invite" style={{ gap: 10 }}>
            <Notice tone="warning">{t('rdoc.case.notLinked')}</Notice>
            {qr && <img className="rdoc-qr" src={qr} alt="QR" />}
            <code className="setup-link">{data.inviteLink}</code>
            <Button block onClick={share}>
              {t('rdoc.case.share')}
            </Button>
            <Button block variant="secondary" onClick={copy}>
              {t('rdoc.case.copy')}
            </Button>
            <span className="tiny">{t('rdoc.case.expires', { date: formatDateTime(data.expiresAt, lang) })}</span>
          </Card>
        )}

        {data.status === 'declined' && <Notice tone="danger">{t('rdoc.case.declined')}</Notice>}
        {data.status === 'not_me' && <Notice tone="danger">{t('rdoc.case.notMe')}</Notice>}
        {data.status === 'expired' && <Notice tone="warning">{t('rdoc.case.expired')}</Notice>}

        {data.status === 'approved' && (
          <Card className="stack" style={{ gap: 10 }}>
            <div className="between">
              <strong>{t('rdoc.case.offers')}</strong>
              <Badge tone="neutral">{data.offers.length}</Badge>
            </div>
            {data.dealPriceUzs != null && (
              <Notice>{t('rdoc.case.deal', { price: money(data.dealPriceUzs, lang) })}</Notice>
            )}
            {data.offers.length === 0 ? (
              <p className="tiny">{t('rdoc.case.noOffers')}</p>
            ) : (
              data.offers.map((o) => {
                const isRec = data.recommendation?.offerId === o.id;
                const isChosen = data.chosenOfferId === o.id;
                return (
                  <div className={`rdoc-offer ${isRec ? 'is-rec' : ''} ${isChosen ? 'is-chosen' : ''}`} key={o.id}>
                    <div className="rdoc-offer__top">
                      <span className="rdoc-offer__main">
                        <strong className="truncate">{o.clinic.name}</strong>
                        <span className="tiny">
                          {o.clinic.ratingCount > 0 ? `★ ${o.clinic.ratingAvg.toFixed(1)} · ` : ''}
                          {t('rdoc.case.dates', { n: o.proposedDates.length })}
                        </span>
                      </span>
                      <strong className="num">{money(o.priceUzs, lang)}</strong>
                    </div>
                    {(isRec || isChosen || (canRecommend && o.status === 'SENT')) && (
                      <div className="rdoc-offer__foot">
                        {isRec && <Badge tone="accent">{t('rdoc.rec.mine')}</Badge>}
                        {isChosen && <Badge tone="success">{t('rdoc.rec.chosen')}</Badge>}
                        {canRecommend && o.status === 'SENT' && !isRec && (
                          <Button size="sm" variant="secondary" onClick={() => setRecommending(o)}>
                            {t('rdoc.rec.btn')}
                          </Button>
                        )}
                      </div>
                    )}
                    {isRec && data.recommendation?.comment && (
                      <p className="rdoc-offer__comment">«{data.recommendation.comment}»</p>
                    )}
                  </div>
                );
              })
            )}
            <span className="tiny">{canRecommend ? t('rdoc.case.recHint') : data.chosenOfferId ? t('rdoc.rec.locked') : ''}</span>
          </Card>
        )}
      </div>

      <Sheet open={recommending !== null} onClose={() => setRecommending(null)} title={t('rdoc.rec.title')}>
        {recommending && (
          <div className="stack">
            <Card variant="flat" className="between">
              <strong className="truncate">{recommending.clinic.name}</strong>
              <strong className="num">{money(recommending.priceUzs, lang)}</strong>
            </Card>
            <Field label={t('rdoc.rec.comment')} hint={t('rdoc.rec.commentHint')}>
              <Textarea rows={3} maxLength={500} value={recComment} onChange={(e) => setRecComment(e.target.value)} />
            </Field>
            <Notice>{t('rdoc.rec.note')}</Notice>
            <Button block loading={recBusy} onClick={recommend}>
              {t('rdoc.rec.btn')}
            </Button>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}

