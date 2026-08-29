/**
 * Klinika arizalari — ochiq veb-formadan keladi.
 *
 * Moderatorning birinchi filtri: ariza haqiqiymi. Litsenziya raqami
 * tekshiriladi, mas'ul shaxsga qo'ng'iroq qilinadi. Tasdiqlangach klinika
 * yaratiladi va ULANISH KODI beriladi — moderator uni telefonda aytadi
 * yoki yozib yuboradi.
 *
 * Tasdiqlangach klinika, uning veb hisobi va PAROL O'RNATISH HAVOLASI
 * yaratiladi. Havola bir martalik va bir marta ko'rsatiladi: qayta ochib
 * ko'rish yo'li yo'q, chunki uni ko'rgan har kim klinika kabinetini
 * egallab olardi. Moderator uni darhol klinikaning pochtasiga yuboradi.
 */
import { useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useApp } from '@/store/app';
import { api, type ClinicApplication } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { popVariants, spring } from '@/lib/motion';
import { formatDate } from '@/lib/format';
import { cityName } from '@/i18n';
import { Button, Card, Notice, Segment, Sheet, Skeleton, Textarea } from '@/ui';
import { Async, useResource } from '../clinic/shell';

type Filter = 'pending' | 'approved' | 'rejected';

export function Applications() {
  const { t, lang, cities, toast } = useApp();
  const [filter, setFilter] = useState<Filter>('pending');
  const res = useResource(() => api.applications(filter), [filter]);

  const [rejecting, setRejecting] = useState<ClinicApplication | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  /** Yangi berilgan kod — bir marta ko'rsatiladi */
  const [issued, setIssued] = useState<ClinicApplication | null>(null);

  const approve = async (app: ClinicApplication) => {
    setBusy(true);
    try {
      const updated = await api.approveApplication(app.id);
      haptic.success();
      setIssued(updated);
      res.reload();
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
      await api.rejectApplication(rejecting.id, note.trim());
      haptic.success();
      setRejecting(null);
      setNote('');
      res.reload();
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  /* Havola shu yerda yig'iladi: server faqat tokenni qaytaradi. */
  const setupUrl = issued?.connectCode
    ? `${window.location.origin}/kabinet/parol?token=${issued.connectCode}`
    : '';

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast(t('team.copied'), 'success');
    } catch {
      /* clipboard yopiq bo'lsa kod ekranda ko'rinib turadi */
    }
  };

  return (
    <>
      <Segment
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        options={[
          { value: 'pending', label: t('app.pending') },
          { value: 'approved', label: t('app.approved') },
          { value: 'rejected', label: t('app.rejected') },
        ]}
      />

      <Async
        resource={res}
        skeleton={<Skeleton h={200} />}
        isEmpty={(d) => d.length === 0}
        empty={{ title: t('app.empty'), text: t('app.emptyText') }}
      >
        {(list) => (
          <AnimatePresence initial={false}>
            {list.map((app) => (
              <m.div key={app.id} layout variants={popVariants} initial="initial" animate="animate">
                <Card className="stack" style={{ gap: 8 }}>
                  <div className="between">
                    <strong>{app.name}</strong>
                    <span className="tiny num">#{app.id}</span>
                  </div>

                  <span className="tiny">
                    {cities.find((c) => c.id === app.cityId)
                      ? cityName(cities.find((c) => c.id === app.cityId)!, lang)
                      : ''}{' '}
                    · {app.address}
                  </span>

                  <div className="app-rows">
                    <div className="app-row">
                      <span className="tiny">{t('app.license')}</span>
                      <strong className="num">{app.licenseNo}</strong>
                    </div>
                    <div className="app-row">
                      <span className="tiny">{t('app.contact')}</span>
                      <span>{app.contactName}</span>
                    </div>
                    <div className="app-row">
                      <span className="tiny">{t('app.phone')}</span>
                      {/* Moderator shu raqamga qo'ng'iroq qiladi */}
                      <a className="num" href={`tel:${app.contactPhone}`}>
                        {app.contactPhone}
                      </a>
                    </div>
                    {app.contactEmail && (
                      <div className="app-row">
                        <span className="tiny">Email</span>
                        <a href={`mailto:${app.contactEmail}`}>{app.contactEmail}</a>
                      </div>
                    )}
                    <div className="app-row">
                      <span className="tiny">{t('app.operations')}</span>
                      <span className="num">{app.operationIds.length}</span>
                    </div>
                  </div>

                  {app.about && <p className="tiny clamp-2">{app.about}</p>}

                  <span className="tiny">{formatDate(app.createdAt, lang)}</span>

                  {app.status === 'pending' && (
                    <div className="row" style={{ gap: 'var(--s-2)' }}>
                      <Button size="sm" block loading={busy} onClick={() => approve(app)}>
                        {t('app.approve')}
                      </Button>
                      <Button size="sm" block variant="danger" onClick={() => setRejecting(app)}>
                        {t('app.reject')}
                      </Button>
                    </div>
                  )}

                  {app.status === 'rejected' && app.note && <Notice tone="danger">{app.note}</Notice>}

                  {app.status === 'approved' && (
                    <Notice tone={app.connectCode ? 'warning' : 'info'}>
                      {app.connectCode ? t('app.codeWaiting') : t('app.codeUsed')}
                    </Notice>
                  )}
                </Card>
              </m.div>
            ))}
          </AnimatePresence>
        )}
      </Async>

      {/* Kod bir marta ko'rsatiladi — moderator uni darhol yetkazishi kerak */}
      <Sheet open={issued !== null} onClose={() => setIssued(null)} title={t('app.codeTitle')}>
        <div className="stack">
          <Notice tone="warning">{t('app.codeHint')}</Notice>
          <Card>
            <code className="setup-link">{setupUrl}</code>
          </Card>
          <p className="tiny">{t('app.codeSteps', { phone: issued?.contactPhone ?? '' })}</p>
          <Button block onClick={() => setupUrl && copy(setupUrl)}>
            {t('team.copy')}
          </Button>
        </div>
      </Sheet>

      <Sheet open={rejecting !== null} onClose={() => setRejecting(null)} title={t('app.rejectReason')}>
        <div className="stack">
          <Textarea
            rows={3}
            value={note}
            maxLength={500}
            placeholder={t('app.rejectHint')}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button block variant="danger" loading={busy} disabled={note.trim().length < 3} onClick={reject}>
            {t('app.reject')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

export { spring };
