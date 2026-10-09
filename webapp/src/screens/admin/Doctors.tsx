/**
 * Yo'naltiruvchi shifokorlar — arizalarni ko'rib chiqish.
 *
 * Shifokor botda `/shifokor` orqali ro'yxatdan o'tadi va diplomini
 * yuklaydi. Admin diplomni ochib ko'radi, telefon raqami orqali
 * bog'lanadi va qaror qiladi. Tasdiqlangan shifokor bemorlar uchun
 * so'rov yarata oladi — ya'ni bu platformaga kimni kiritish haqidagi
 * qaror, shuning uchun server uni faqat to'liq huquqli adminga beradi.
 *
 * "Qayta ko'rib chiqish" — rad etilgan shifokor yangi hujjat yuklagan.
 * Oldingi rad sababi saqlanadi: admin o'tgan safar nima noto'g'ri
 * bo'lganini ko'rib turadi.
 */
import { useState } from 'react';
import { useApp } from '@/store/app';
import { api, fetchDoctorDocument } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { formatDate } from '@/lib/format';
import { formatSize } from '@/lib/docFile';
import { Button, Card, Notice, Segment, Sheet, Skeleton, Textarea } from '@/ui';
import { Async, useResource } from '../clinic/shell';
import { PageHeader, Tag } from './ui';
import type { AdminDoctorStatRow, AdminReferringDoctor, ReferringDoctorStatus } from '@shared/types';
import { money } from '@/lib/format';

type Filter = ReferringDoctorStatus | 'all' | 'stats';

const STATUS_LABEL: Record<ReferringDoctorStatus, string> = {
  pending: 'Kutilmoqda',
  in_review: 'Qayta ko‘rib chiqish',
  approved: 'Tasdiqlangan',
  rejected: 'Rad etilgan',
};

const STATUS_TONE: Record<ReferringDoctorStatus, 'good' | 'warn' | 'bad' | 'neutral'> = {
  pending: 'warn',
  in_review: 'warn',
  approved: 'good',
  rejected: 'bad',
};

export function AdminDoctors({ onChanged }: { onChanged?: () => void }) {
  const { t, lang, toast } = useApp();
  const [filter, setFilter] = useState<Filter>('pending');
  const res = useResource(() => api.adminDoctors(filter === 'stats' ? 'all' : filter), [filter]);

  const [rejecting, setRejecting] = useState<AdminReferringDoctor | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * Fayl sessiya sarlavhasi bilan olinadi — oddiy havola ishlamaydi.
   * Oyna BOSISH paytida ochiladi (aks holda brauzer uni popup deb
   * to'sadi), manzil esa fayl kelgach qo'yiladi.
   */
  const openDoc = async (doctorId: number, docId: number) => {
    const win = window.open('', '_blank');
    try {
      const url = await fetchDoctorDocument(docId, doctorId);
      if (win) win.location.href = url;
      else window.location.assign(url);
    } catch (err: any) {
      win?.close();
      toast(err?.message ?? 'Hujjatni ochib bo‘lmadi', 'error');
    }
  };

  const done = () => {
    res.reload();
    onChanged?.();
  };

  const approve = async (d: AdminReferringDoctor) => {
    setBusy(true);
    try {
      await api.approveDoctor(d.id);
      haptic.success();
      toast(`${d.firstName} ${d.lastName} tasdiqlandi`, 'success');
      done();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      await api.rejectDoctor(rejecting.id, reason.trim());
      haptic.success();
      setRejecting(null);
      setReason('');
      done();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const counts = res.data?.counts;
  const label = (f: Exclude<Filter, 'stats'>, text: string) => (counts && counts[f] ? `${text} · ${counts[f]}` : text);

  return (
    <>
      <PageHeader
        title="Shifokorlar"
        description="Botda /shifokor orqali ro‘yxatdan o‘tgan yo‘naltiruvchi shifokorlar. Diplomni tekshirib, tasdiqlang yoki sababini yozib rad eting."
      />

      <Segment
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        options={[
          { value: 'all', label: label('all', 'Hammasi') },
          { value: 'pending', label: label('pending', 'Kutilmoqda') },
          { value: 'in_review', label: label('in_review', 'Qayta ko‘rib chiqish') },
          { value: 'approved', label: label('approved', 'Tasdiqlangan') },
          { value: 'rejected', label: label('rejected', 'Rad etilgan') },
          { value: 'stats', label: 'Statistika' },
        ]}
      />

      {filter === 'stats' ? (
        <DoctorStatsTable />
      ) : (

      <Async
        resource={res}
        skeleton={<Skeleton h={200} />}
        isEmpty={(d) => d.doctors.length === 0}
        empty={{ title: 'Ariza yo‘q', text: 'Bu bo‘limda hozircha shifokor yo‘q.' }}
      >
        {(data) => (
          <div className="stack">
            {data.doctors.map((d) => (
              <Card key={d.id} className="stack" style={{ gap: 8 }}>
                <div className="between">
                  <strong>
                    {d.firstName} {d.lastName}
                  </strong>
                  <Tag tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Tag>
                </div>

                <div className="app-rows">
                  <div className="app-row">
                    <span className="tiny">Mutaxassislik</span>
                    <span>{d.specialty}</span>
                  </div>
                  <div className="app-row">
                    <span className="tiny">Ish joyi</span>
                    <span>{d.workplace}</span>
                  </div>
                  <div className="app-row">
                    <span className="tiny">Telefon</span>
                    {d.phone ? (
                      <a className="num" href={`tel:+${d.phone.replace(/^\+/, '')}`}>
                        +{d.phone.replace(/^\+/, '')}
                      </a>
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                  {d.username && (
                    <div className="app-row">
                      <span className="tiny">Telegram</span>
                      <a href={`https://t.me/${d.username}`} target="_blank" rel="noreferrer">
                        @{d.username}
                      </a>
                    </div>
                  )}
                  {d.documents.map((doc) => (
                    <div className="app-row" key={doc.id}>
                      <span className="tiny">{doc.kind === 'master' ? 'Magistr diplomi' : 'Bakalavr diplomi'}</span>
                      <button type="button" className="link-btn" onClick={() => openDoc(d.id, doc.id)}>
                        Ochish ({doc.mime === 'application/pdf' ? 'PDF' : 'rasm'}, {formatSize(doc.size)})
                      </button>
                    </div>
                  ))}
                </div>

                {d.bio && (
                  <p className="tiny" style={{ whiteSpace: 'pre-line' }}>
                    {d.bio}
                  </p>
                )}

                {d.rejectReason && d.status !== 'approved' && (
                  <Notice tone={d.status === 'rejected' ? 'danger' : 'warning'}>
                    {d.status === 'rejected' ? 'Rad sababi' : 'Oldingi rad sababi'}: {d.rejectReason}
                  </Notice>
                )}

                <span className="tiny">
                  Ariza: {formatDate(d.createdAt, lang)}
                  {d.reviewedAt ? ` · Ko‘rib chiqilgan: ${formatDate(d.reviewedAt, lang)}` : ''}
                </span>

                {(d.status === 'pending' || d.status === 'in_review') && (
                  <div className="row" style={{ gap: 'var(--s-2)' }}>
                    <Button size="sm" block loading={busy} onClick={() => approve(d)}>
                      Tasdiqlash
                    </Button>
                    <Button size="sm" block variant="danger" onClick={() => setRejecting(d)}>
                      Rad etish
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </Async>
      )}

      <Sheet open={rejecting !== null} onClose={() => setRejecting(null)} title="Rad etish sababi">
        <div className="stack">
          <p className="tiny">Sabab shifokorga Telegram orqali yuboriladi. U yangi hujjat yuklasa, ariza qayta ko‘rib chiqishga keladi.</p>
          <Textarea
            rows={3}
            value={reason}
            maxLength={500}
            placeholder="Masalan: diplom surati o‘qilmaydi"
            onChange={(e) => setReason(e.target.value)}
          />
          <Button block variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={reject}>
            Rad etish
          </Button>
        </div>
      </Sheet>
    </>
  );
}

/**
 * Shifokorlar statistikasi: kim qancha so'rov yuborgan, qaysi klinikaga
 * nechta tavsiya bergan, tavsiyalar va bitimlar summasi.
 *
 * Summalar: "tavsiya" — tavsiya paytidagi taklif narxi; "qabul" —
 * bemor aynan tavsiya qilingan taklifni tanlagan bitim summasi.
 * Qatorni bosganda klinikalar kesimi ochiladi.
 */
function DoctorStatsTable() {
  const { lang } = useApp();
  const res = useResource(() => api.adminDoctorStats(), []);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <Async
      resource={res}
      skeleton={<Skeleton h={240} />}
      isEmpty={(d) => d.length === 0}
      empty={{ title: 'Ma’lumot yo‘q', text: 'Hali shifokor yo‘q.' }}
    >
      {(rows: AdminDoctorStatRow[]) => {
        const total = rows.reduce(
          (a, r) => ({
            recs: a.recs + r.recommendations,
            recSum: a.recSum + r.recommendedSumUzs,
            acc: a.acc + r.acceptedRecommendations,
            accSum: a.accSum + r.acceptedSumUzs,
          }),
          { recs: 0, recSum: 0, acc: 0, accSum: 0 },
        );
        return (
          <div className="stack">
            <div className="dstat__kpis">
              <div className="dstat__kpi">
                <span className="tiny">Tavsiyalar</span>
                <strong className="num">{total.recs}</strong>
              </div>
              <div className="dstat__kpi">
                <span className="tiny">Tavsiyalar summasi</span>
                <strong className="num">{money(total.recSum, lang)}</strong>
              </div>
              <div className="dstat__kpi">
                <span className="tiny">Qabul qilingan</span>
                <strong className="num">{total.acc}</strong>
              </div>
              <div className="dstat__kpi">
                <span className="tiny">Qabul summasi</span>
                <strong className="num">{money(total.accSum, lang)}</strong>
              </div>
            </div>

            <div className="dstat">
              <div className="dstat__row dstat__row--head">
                <span>Shifokor</span>
                <span>So‘rovlar</span>
                <span>Tasdiqlangan</span>
                <span>Tavsiyalar</span>
                <span>Tavsiya summasi</span>
                <span>Qabul</span>
                <span>Bitimlar summasi</span>
              </div>
              {rows.map((r) => (
                <div key={r.doctorId}>
                  <button
                    type="button"
                    className={`dstat__row ${open === r.doctorId ? 'is-open' : ''}`}
                    onClick={() => setOpen(open === r.doctorId ? null : r.doctorId)}
                  >
                    <span className="dstat__who">
                      <strong>{r.name}</strong>
                      <span className="tiny">
                        {r.specialty} · {r.workplace}
                        {r.status !== 'approved' ? ` · ${STATUS_LABEL[r.status]}` : ''}
                      </span>
                    </span>
                    <span className="num">{r.cases}</span>
                    <span className="num">{r.approved}</span>
                    <span className="num">{r.recommendations}</span>
                    <span className="num">{money(r.recommendedSumUzs, lang)}</span>
                    <span className="num">
                      {r.acceptedRecommendations} · {money(r.acceptedSumUzs, lang)}
                    </span>
                    <span className="num">{money(r.dealSumUzs, lang)}</span>
                  </button>
                  {open === r.doctorId && (
                    <div className="dstat__clinics">
                      {r.byClinic.length === 0 ? (
                        <span className="tiny">Hali tavsiya yo‘q.</span>
                      ) : (
                        r.byClinic.map((c) => (
                          <div className="dstat__clinic" key={c.clinicId}>
                            <strong>{c.clinicName}</strong>
                            <span className="num">{c.recommendations} ta tavsiya</span>
                            <span className="num">{money(c.recommendedSumUzs, lang)}</span>
                            <span className="num">
                              qabul: {c.accepted} · {money(c.acceptedSumUzs, lang)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      }}
    </Async>
  );
}
