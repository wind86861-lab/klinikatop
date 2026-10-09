/**
 * Admin: bemor so'rovlari — kim so'radi va so'rov QAYSI KLINIKALARGA ketdi.
 *
 * Platformaning asosiy muammosini ko'rinadigan qiladi: so'rovlarning
 * ko'pi hech bir klinikaga yetmaydi yoki yetsa ham ochilmaydi. Jadvalda
 * har so'rov uchun "yuborildi → ko'rdi → taklif" zanjiri, varaqda esa
 * klinikalar birma-bir: kim ochdi, kim qancha narx taklif qildi.
 *
 * Hech kimga yetmagan so'rovda "nega" ham ko'rinadi: hozir shu
 * viloyatda va butun mamlakatda nechta mos klinika bor. Hisob yuborish
 * qoidasining o'zi bilan qilinadi (server: `adminRequests.ts`).
 */
import { useMemo, useState } from 'react';
import { useApp } from '@/store/app';
import { api, type AdminRequestDetail, type AdminRequestFilter, type AdminRequestRow } from '@/lib/api';
import { formatDateTime, money } from '@/lib/format';
import { Button, Notice, Segment, Sheet, Skeleton } from '@/ui';
import { Async, useResource } from '@/screens/clinic/shell';
import { DataTable, Empty, PageHeader, Tag } from './ui';
import { ClinicInfoSheet } from './ClinicInfo';
import type { ColumnDef } from '@tanstack/react-table';

const KIND: Record<AdminRequestRow['kind'], string> = {
  operation: 'Operatsiya',
  lab: 'Tahlil',
  referral: 'Yo‘llanma',
};

const STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  NEW: { label: 'Yangi', tone: 'warn' },
  COLLECTING: { label: 'Taklif yig‘ilmoqda', tone: 'warn' },
  CHOSEN: { label: 'Tanlangan', tone: 'good' },
  COMPLETED: { label: 'Yakunlangan', tone: 'good' },
  CANCELLED: { label: 'Bekor / muddati o‘tgan', tone: 'neutral' },
};

const OFFER_STATUS: Record<string, string> = {
  SENT: 'yuborilgan',
  CHOSEN: 'tanlangan',
  REJECTED: 'rad etilgan',
  EXPIRED: 'eskirgan',
  WITHDRAWN: 'qaytarib olingan',
};

/** "5 → 2 → 1": yuborildi → ochib ko'rdi → taklif */
function Funnel({ r }: { r: AdminRequestRow }) {
  if (r.sent === 0) return <Tag tone="bad">hech kimga yetmadi</Tag>;
  return (
    <span className="rq-funnel" title="Yuborildi → ko‘rdi → taklif">
      <b>{r.sent}</b> klinika <span>→</span> <b>{r.viewed}</b> ko‘rdi <span>→</span>{' '}
      <b className={r.offers ? 'is-good' : ''}>{r.offers}</b> taklif
    </span>
  );
}

export function AdminRequests() {
  const { lang } = useApp();
  const [filter, setFilter] = useState<AdminRequestFilter>('all');
  const res = useResource(() => api.adminRequests(filter), [filter]);
  const [openId, setOpenId] = useState<number | null>(null);

  const columns = useMemo<ColumnDef<AdminRequestRow, any>[]>(
    () => [
      {
        header: '#',
        accessorKey: 'id',
        cell: (c) => <span className="num tiny">#{c.getValue()}</span>,
      },
      {
        header: 'Sana',
        accessorKey: 'createdAt',
        cell: (c) => <span className="tiny">{formatDateTime(c.getValue(), lang)}</span>,
      },
      {
        header: 'Bemor',
        id: 'patient',
        accessorFn: (r) => `${r.patient.name} ${r.patient.phone ?? ''}`,
        cell: ({ row: { original: r } }) => (
          <div className="rq-who">
            <strong>{r.patient.name}</strong>
            <span className="tiny">{r.patient.phone ? `+${r.patient.phone}` : r.patient.viaTelegram ? 'Telegram' : '—'}</span>
          </div>
        ),
      },
      {
        header: 'Nima so‘radi',
        id: 'service',
        accessorFn: (r) => `${r.service} ${KIND[r.kind]} ${r.city}`,
        cell: ({ row: { original: r } }) => (
          <div className="rq-who">
            <strong>{r.service}</strong>
            <span className="tiny">
              {KIND[r.kind]} · {r.city}
              {r.budgetUzs ? ` · ${money(r.budgetUzs, lang)}` : ''}
            </span>
          </div>
        ),
      },
      {
        header: 'Qaysi klinikalarga',
        id: 'funnel',
        accessorFn: (r) => r.sent,
        cell: ({ row: { original: r } }) => <Funnel r={r} />,
      },
      {
        header: 'Holat',
        accessorKey: 'status',
        cell: (c) => {
          const s = STATUS[c.getValue()] ?? { label: c.getValue(), tone: 'neutral' as const };
          return <Tag tone={s.tone}>{s.label}</Tag>;
        },
      },
    ],
    [lang],
  );

  return (
    <div className="stack">
      <PageHeader
        title="So‘rovlar"
        description="Qaysi bemor nima so‘radi va so‘rov qaysi klinikalarga ketdi. Qatorni bosing — klinikalar ro‘yxati ochiladi."
      />

      <Segment
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'Hammasi' },
          { value: 'active', label: 'Faol' },
          { value: 'unreached', label: 'Klinikaga yetmagan' },
          { value: 'no_offers', label: 'Taklifsiz' },
        ]}
      />

      <Async resource={res} skeleton={<Skeleton h={320} />}>
        {(list) => (
          <DataTable
            data={list}
            columns={columns}
            searchPlaceholder="Bemor, telefon, xizmat yoki viloyat…"
            onRowClick={(r) => setOpenId(r.id)}
            empty={<Empty title="So‘rov topilmadi" hint="Boshqa filtrni tanlab ko‘ring" />}
          />
        )}
      </Async>

      <RequestSheet id={openId} onClose={() => setOpenId(null)} onChanged={res.reload} />
    </div>
  );
}

/* ─────────────────────────  Bitta so'rov  ───────────────────────── */

function RequestSheet({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Sheet open={id !== null} onClose={onClose} title={id ? `So‘rov #${id}` : undefined}>
      {id !== null && <RequestDetail key={id} id={id} onChanged={onChanged} />}
    </Sheet>
  );
}

function RequestDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const { lang, toast } = useApp();
  const res = useResource(() => api.adminRequest(id), [id]);
  const [busy, setBusy] = useState(false);
  const [clinicId, setClinicId] = useState<number | null>(null);

  const resend = async () => {
    setBusy(true);
    try {
      const { added } = await api.rebroadcastRequest(id);
      toast(added ? `${added} ta yangi klinikaga yuborildi` : 'Yangi mos klinika yo‘q', added ? 'success' : 'error');
      res.reload();
      onChanged();
    } catch (err: any) {
      toast(err?.message ?? 'Yuborilmadi', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Async resource={res} skeleton={<Skeleton h={260} />}>
      {(r: AdminRequestDetail) => {
        const active = r.status === 'NEW' || r.status === 'COLLECTING';
        return (
          <div className="stack rq-detail">
            <div className="app-rows">
              <div className="app-row">
                <span className="tiny">Bemor</span>
                <span>
                  <strong>{r.patient.name}</strong>
                  {r.patient.phone && (
                    <>
                      {' · '}
                      <a className="num" href={`tel:+${r.patient.phone}`}>+{r.patient.phone}</a>
                    </>
                  )}
                </span>
              </div>
              <div className="app-row">
                <span className="tiny">So‘rov</span>
                <span>
                  {r.service} <span className="tiny">({KIND[r.kind]})</span>
                </span>
              </div>
              <div className="app-row">
                <span className="tiny">Viloyat</span>
                <span>
                  {r.city}
                  {r.otherRegionsOk && <span className="tiny"> · boshqa viloyatlar ham</span>}
                </span>
              </div>
              {r.budgetUzs != null && (
                <div className="app-row">
                  <span className="tiny">Byudjet</span>
                  <span className="num">{money(r.budgetUzs, lang, false)}</span>
                </div>
              )}
              <div className="app-row">
                <span className="tiny">Yuborilgan</span>
                <span>{formatDateTime(r.createdAt, lang)}</span>
              </div>
              <div className="app-row">
                <span className="tiny">Holat</span>
                <Tag tone={(STATUS[r.status] ?? STATUS.CANCELLED).tone}>{(STATUS[r.status] ?? { label: r.status }).label}</Tag>
              </div>
            </div>

            {r.note && <p className="tiny">“{r.note}”</p>}

            {r.deal && (
              <Notice tone="info">
                Bitim: <strong>{r.deal.clinicName}</strong> · {money(r.deal.agreedPriceUzs, lang, false)} · {r.deal.status}
              </Notice>
            )}

            <h3 className="section-title">
              Klinikalar <span className="tiny">({r.clinics.length})</span>
            </h3>

            {r.clinics.length === 0 ? (
              <>
                <Notice tone="danger">
                  Bu so‘rov hech bir klinikaga yetmagan.{' '}
                  {r.diagnosis &&
                    (r.diagnosis.inCity > 0
                      ? `Hozir ${r.city}da ${r.diagnosis.inCity} ta mos klinika bor — ular so‘rovdan keyin qo‘shilgan.`
                      : r.diagnosis.anywhere > 0
                        ? `${r.city}da bu xizmatni qiladigan klinika yo‘q, boshqa viloyatlarda ${r.diagnosis.anywhere} ta bor.`
                        : 'Bu xizmatni qiladigan tasdiqlangan klinika platformada umuman yo‘q.')}
                </Notice>
                {active && r.diagnosis && r.diagnosis.inCity > 0 && (
                  <Button block loading={busy} onClick={resend}>
                    Yangi klinikalarga yuborish
                  </Button>
                )}
              </>
            ) : (
              <ul className="rq-clinics" role="list">
                {r.clinics.map((c) => (
                  <li
                    key={c.clinicId}
                    className={`is-clickable ${c.offer ? 'has-offer' : c.viewedAt ? 'is-viewed' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setClinicId(c.clinicId)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setClinicId(c.clinicId)}
                  >
                    <div className="rq-who">
                      <strong>{c.name}</strong>
                      <span className="tiny">
                        {c.city} · yuborildi {formatDateTime(c.sentAt, lang)}
                      </span>
                    </div>
                    <div className="rq-state">
                      {c.offer ? (
                        <>
                          <strong className="num">{money(c.offer.priceUzs, lang)}</strong>
                          <span className="tiny">taklif {OFFER_STATUS[c.offer.status] ?? c.offer.status}</span>
                        </>
                      ) : c.viewedAt ? (
                        <>
                          <span>ko‘rdi</span>
                          <span className="tiny">{formatDateTime(c.viewedAt, lang)} · taklif yo‘q</span>
                        </>
                      ) : (
                        <span className="tiny">ochmagan</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <ClinicInfoSheet clinicId={clinicId} onClose={() => setClinicId(null)} />

            {r.clinics.length > 0 && active && (
              <Button variant="secondary" block loading={busy} onClick={resend}>
                Keyin qo‘shilgan klinikalarga ham yuborish
              </Button>
            )}
          </div>
        );
      }}
    </Async>
  );
}
