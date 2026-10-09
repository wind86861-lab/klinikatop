/**
 * Admin: klinika haqida to'liq ma'lumot — varaq.
 *
 * Ikki joydan ochiladi: "Klinikalar" jadvalida qator bosilganda va
 * "So'rovlar" varag'ida klinika nomi bosilganda. Bir komponent — ikki
 * joyda bir xil ko'rinish.
 *
 * Eng muhim qism — FAOLLIK zanjiri: keldi → ochdi → taklif → tanlandi.
 * So'rovlar nega javobsiz qolayotganini aynan shu ko'rsatadi (masalan,
 * 300 ta so'rov kelgan, 2 tasi ochilgan — klinika kabinetga kirmaydi).
 */
import { useApp } from '@/store/app';
import { api, type AdminClinicDetail } from '@/lib/api';
import { formatDate, formatDateTime, money } from '@/lib/format';
import { Notice, Sheet, Skeleton } from '@/ui';
import { Async, useResource } from '@/screens/clinic/shell';
import { Tag } from './ui';

const VERIFICATION: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  approved: { label: 'Tasdiqlangan', tone: 'good' },
  pending: { label: 'Tekshiruvda', tone: 'warn' },
  rejected: { label: 'Rad etilgan', tone: 'bad' },
};

const SUBSCRIPTION: Record<string, string> = {
  active: 'faol',
  suspended: 'to‘xtatilgan',
  expired: 'muddati o‘tgan',
  none: 'yo‘q',
};

const OFFER: Record<string, string> = {
  SENT: 'taklif berdi',
  CHOSEN: 'tanlandi',
  REJECTED: 'rad etildi',
  EXPIRED: 'eskirdi',
  WITHDRAWN: 'qaytarib oldi',
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export function ClinicInfoSheet({ clinicId, onClose }: { clinicId: number | null; onClose: () => void }) {
  return (
    <Sheet open={clinicId !== null} onClose={onClose} title="Klinika">
      {clinicId !== null && <ClinicInfo key={clinicId} id={clinicId} />}
    </Sheet>
  );
}

function ClinicInfo({ id }: { id: number }) {
  const { lang } = useApp();
  const res = useResource(() => api.adminClinicDetail(id), [id]);

  return (
    <Async resource={res} skeleton={<Skeleton h={320} />}>
      {(c: AdminClinicDetail) => {
        const v = VERIFICATION[c.verification] ?? { label: c.verification, tone: 'warn' as const };
        const a = c.activity;
        return (
          <div className="stack ci">
            <div className="ci__head">
              {c.logoUrl ? <img className="ci__logo" src={c.logoUrl} alt="" /> : <span className="ci__logo">{c.name.slice(0, 2).toUpperCase()}</span>}
              <div className="rq-who">
                <strong className="ci__name">{c.name}</strong>
                <span className="tiny">
                  {c.city}
                  {c.address && ` · ${c.address}`}
                </span>
              </div>
            </div>

            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Tag tone={v.tone}>{v.label}</Tag>
              <Tag tone={c.subscriptionStatus === 'active' ? 'good' : 'neutral'}>
                Obuna: {SUBSCRIPTION[c.subscriptionStatus] ?? c.subscriptionStatus}
                {c.plan ? ` (${c.plan})` : ''}
              </Tag>
              <Tag tone={c.acceptsReferral ? 'good' : 'neutral'}>Yo‘llanma: {c.acceptsReferral ? 'qabul qiladi' : 'yo‘q'}</Tag>
              {c.linkedToBanisa && <Tag tone="neutral">banisa.uz</Tag>}
            </div>

            {c.verificationNote && <Notice tone="warning">{c.verificationNote}</Notice>}

            {/* Faollik zanjiri */}
            <div className="ci__funnel">
              <div>
                <b className="num">{a.received}</b>
                <span className="tiny">so‘rov keldi</span>
              </div>
              <div>
                <b className="num">{a.viewed}</b>
                <span className="tiny">ochdi · {pct(a.viewed, a.received)}</span>
              </div>
              <div>
                <b className="num">{a.offers}</b>
                <span className="tiny">taklif · {pct(a.offers, a.viewed)}</span>
              </div>
              <div>
                <b className="num">{a.chosen}</b>
                <span className="tiny">tanlandi</span>
              </div>
              <div>
                <b className="num">{a.dealsConfirmed}</b>
                <span className="tiny">bitim</span>
              </div>
            </div>
            {a.received >= 10 && a.viewed / a.received < 0.2 && (
              <Notice tone="warning">
                Klinika kelgan so‘rovlarning atigi {pct(a.viewed, a.received)} ini ochgan — kabinetga kirmayotgan bo‘lishi mumkin.
              </Notice>
            )}

            <div className="app-rows">
              <div className="app-row">
                <span className="tiny">Telefon</span>
                {c.phone ? <a className="num" href={`tel:${c.phone}`}>{c.phone}</a> : <span className="tiny">—</span>}
              </div>
              {c.website && (
                <div className="app-row">
                  <span className="tiny">Sayt</span>
                  <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noopener">
                    {c.website}
                  </a>
                </div>
              )}
              {c.licenseNo && (
                <div className="app-row">
                  <span className="tiny">Litsenziya</span>
                  <span className="num">{c.licenseNo}</span>
                </div>
              )}
              <div className="app-row">
                <span className="tiny">Reyting</span>
                <span>
                  ★ {c.rating.avg.toFixed(1)} <span className="tiny">({c.rating.count} ta sharh)</span>
                </span>
              </div>
              <div className="app-row">
                <span className="tiny">O‘rtacha javob</span>
                <span>{c.avgResponseMinutes != null ? `${c.avgResponseMinutes} daqiqa` : '—'}</span>
              </div>
              <div className="app-row">
                <span className="tiny">Komissiya</span>
                <span>{c.effectiveCommissionPercent}%</span>
              </div>
              {c.subscriptionUntil && (
                <div className="app-row">
                  <span className="tiny">Obuna muddati</span>
                  <span>{formatDate(c.subscriptionUntil, lang)}</span>
                </div>
              )}
              {c.trialUntil && (
                <div className="app-row">
                  <span className="tiny">Sinov muddati</span>
                  <span>{formatDate(c.trialUntil, lang)}</span>
                </div>
              )}
              <div className="app-row">
                <span className="tiny">Hujjatlar</span>
                <span>
                  {c.documents.approved} tasdiqlangan
                  {c.documents.pending > 0 && ` · ${c.documents.pending} kutilmoqda`}
                  {c.documents.rejected > 0 && ` · ${c.documents.rejected} rad`}
                </span>
              </div>
              <div className="app-row">
                <span className="tiny">Platformada</span>
                <span>{formatDate(c.createdAt, lang)} dan</span>
              </div>
            </div>

            {c.about && <p className="tiny">{c.about}</p>}

            <h3 className="section-title">
              Xizmatlar <span className="tiny">({c.services.operationsTotal} operatsiya · {c.services.labTests} tahlil)</span>
            </h3>
            {c.services.operations.length ? (
              <div className="ci__tags">
                {c.services.operations.map((o) => (
                  <span key={o}>{o}</span>
                ))}
                {c.services.operationsTotal > c.services.operations.length && (
                  <span>+{c.services.operationsTotal - c.services.operations.length}</span>
                )}
              </div>
            ) : (
              <span className="tiny">Operatsiya belgilanmagan</span>
            )}

            <h3 className="section-title">
              Kabinet xodimlari <span className="tiny">({c.staff.length})</span>
            </h3>
            {c.staff.length ? (
              <ul className="rq-clinics" role="list">
                {c.staff.map((s) => (
                  <li key={s.phone}>
                    <div className="rq-who">
                      <strong>{s.fullName}</strong>
                      <span className="tiny">
                        {s.role} · <a href={`tel:+${s.phone}`}>+{s.phone}</a>
                      </span>
                    </div>
                    <div className="rq-state">
                      {s.disabled ? (
                        <Tag tone="bad">o‘chirilgan</Tag>
                      ) : (
                        <span className="tiny">{s.lastLoginAt ? `kirgan: ${formatDateTime(s.lastLoginAt, lang)}` : 'hali kirmagan'}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="tiny">Kabinet hisobi yo‘q</span>
            )}

            <h3 className="section-title">Oxirgi so‘rovlar</h3>
            {c.recentRequests.length ? (
              <ul className="rq-clinics" role="list">
                {c.recentRequests.map((r) => (
                  <li key={r.id} className={r.offerStatus ? 'has-offer' : r.viewedAt ? 'is-viewed' : ''}>
                    <div className="rq-who">
                      <strong>
                        #{r.id} · {r.service}
                      </strong>
                      <span className="tiny">
                        {r.patientName} · {formatDateTime(r.sentAt, lang)}
                      </span>
                    </div>
                    <div className="rq-state">
                      {r.offerStatus ? (
                        <>
                          <strong className="num">{r.offerPriceUzs != null ? money(r.offerPriceUzs, lang) : '—'}</strong>
                          <span className="tiny">{OFFER[r.offerStatus] ?? r.offerStatus}</span>
                        </>
                      ) : (
                        <span className="tiny">{r.viewedAt ? 'ochdi, taklif yo‘q' : 'ochmagan'}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="tiny">Hali so‘rov kelmagan</span>
            )}
          </div>
        );
      }}
    </Async>
  );
}
