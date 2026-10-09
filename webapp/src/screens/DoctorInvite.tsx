/**
 * Bemor: shifokor siz uchun so'rov yaratdi — ko'rish va qaror.
 *
 * Botdagi xabar tugmasi shu yerga olib keladi (`/invite/:token`).
 * Taklifnoma faqat raqami mos bemorga ochiladi; boshqa odam "topilmadi"
 * ni ko'radi.
 *
 * Tasdiqlash — oddiy so'rov bilan bir xil qoidalar: profil to'liq
 * (ilova buni oldinroq yo'naltirib qo'yadi) va oferta qabul qilingan.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from '@/lib/router';
import { useApp } from '@/store/app';
import { api, ApiError } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { formatDateTime } from '@/lib/format';
import { cityName } from '@/i18n';
import { TermsCheckbox, TermsSheet } from '@/components/Terms';
import { Button, Card, EmptyState, Field, Input, Notice, Screen, SkeletonCard } from '@/ui';
import type { DoctorInvite as Invite } from '@shared/types';

export function DoctorInvite() {
  const { t, lang, cities, toast } = useApp();
  const navigate = useNavigate();
  const { token = '' } = useParams<{ token: string }>();

  const [invite, setInvite] = useState<Invite | null>(null);
  const [missing, setMissing] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [weight, setWeight] = useState('');
  /** Qarshi ko'rsatmalar bor tekshiruvda — "menda yo'q" tasdig'i */
  const [contraAck, setContraAck] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'decline' | 'not_me' | null>(null);
  const [done, setDone] = useState<'declined' | null>(null);

  useEffect(() => {
    api
      .invite(token)
      .then((inv) => {
        setInvite(inv);
        if (inv.weightKg) setWeight(String(inv.weightKg));
      })
      .catch(() => setMissing(true));
  }, [token]);

  const home = () => navigate('/', { replace: true });

  if (missing) {
    return (
      <Screen title={t('inv.title')} onBack={home}>
        <EmptyState icon="🔍" title={t('inv.title')} text={t('inv.notFound')} />
      </Screen>
    );
  }
  if (!invite) {
    return (
      <Screen title={t('inv.title')} onBack={home}>
        <SkeletonCard lines={5} />
      </Screen>
    );
  }

  const w = Number(weight.replace(',', '.'));
  const needsWeight = invite.kind === 'lab' && invite.needsWeight;
  const weightOk = !needsWeight || (Number.isFinite(w) && w >= 2 && w <= 400);
  const contraText = (lang === 'ru' ? invite.contraRu : invite.contraUz) || invite.contraUz;
  const contraOk = !contraText || contraAck;
  const city = cities.find((c) => c.id === invite.cityId);

  const approve = async () => {
    setBusy('approve');
    try {
      const res = await api.approveInvite(token, {
        acceptTerms: accepted,
        weightKg: needsWeight ? Math.round(w) : null,
        contraindicationsAck: contraText ? contraAck : undefined,
      });
      haptic.success();
      toast(t('inv.done'), 'success');
      navigate(`/request/${res.requestId}`, { replace: true });
    } catch (err: any) {
      haptic.error();
      // Profil to'liq emas — anketaga, keyin shu yerga qaytadi
      if (err instanceof ApiError && err.code === 'profile_incomplete') {
        navigate('/register', { state: { next: `/invite/${token}` } });
        return;
      }
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const decline = async (notMe: boolean) => {
    setBusy(notMe ? 'not_me' : 'decline');
    try {
      await api.declineInvite(token, notMe);
      haptic.success();
      setDone('declined');
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const service = lang === 'ru' ? invite.serviceRu : invite.serviceUz;

  const details = (
    <Card className="stack" style={{ gap: 8 }}>
      <span className="tiny">{t('inv.lead')}</span>
      <strong>{invite.doctor.name}</strong>
      <span className="tiny">
        {invite.doctor.specialty} · {invite.doctor.workplace}
      </span>
      <div className="app-rows">
        <div className="app-row">
          <span className="tiny">{t('inv.service')}</span>
          <strong>{service}</strong>
        </div>
        {city && (
          <div className="app-row">
            <span className="tiny">{t('inv.city')}</span>
            <span>{cityName(city, lang)}</span>
          </div>
        )}
      </div>
      {invite.referralItems.length > 0 && (
        <>
          <span className="tiny">{t('inv.items')}</span>
          <ul className="rdoc-items">
            {invite.referralItems.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      )}
      {invite.note && (
        <>
          <span className="tiny">{t('inv.note')}</span>
          <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{invite.note}</p>
        </>
      )}
    </Card>
  );

  // Qaror allaqachon qabul qilingan yoki muddat o'tgan
  if (done || invite.status !== 'waiting') {
    const text =
      done === 'declined'
        ? t('inv.declined')
        : invite.status === 'approved'
          ? t('inv.approved')
          : invite.status === 'expired'
            ? t('inv.expired')
            : t('inv.closed');
    return (
      <Screen title={t('inv.title')} onBack={home}>
        <div className="stack">
          {details}
          <Notice tone={invite.status === 'approved' ? 'info' : 'warning'}>{text}</Notice>
          {invite.status === 'approved' && invite.requestId && (
            <Button block onClick={() => navigate(`/request/${invite.requestId}`)}>
              {t('inv.openRequest')}
            </Button>
          )}
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      title={t('inv.title')}
      subtitle={formatDateTime(invite.expiresAt, lang)}
      onBack={home}
      footer={
        <Button block loading={busy === 'approve'} disabled={!accepted || !weightOk || !contraOk || busy !== null} onClick={approve}>
          {t('inv.approve')}
        </Button>
      }
    >
      <div className="stack">
        {details}

        <Notice>{t('inv.privacy')}</Notice>

        {contraText && (
          <Card variant="flat" className="contra stack" style={{ gap: 10 }}>
            <strong>{t('wz.contra.title')}</strong>
            <p className="contra__text">{contraText}</p>
            <label className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={contraAck} onChange={(e) => setContraAck(e.target.checked)} style={{ marginTop: 3 }} />
              <span>{t('inv.contraAck')}</span>
            </label>
          </Card>
        )}

        {needsWeight && (
          <Field label={t('inv.weight')} hint={t('inv.weightHint')}>
            <Input inputMode="decimal" value={weight} maxLength={5} onChange={(e) => setWeight(e.target.value)} />
          </Field>
        )}

        <TermsCheckbox accepted={accepted} onChange={setAccepted} onOpen={() => setTermsOpen(true)} />

        <div className="row" style={{ gap: 'var(--s-2)' }}>
          <Button block variant="secondary" loading={busy === 'decline'} disabled={busy !== null} onClick={() => decline(false)}>
            {t('inv.decline')}
          </Button>
          <Button block variant="ghost" loading={busy === 'not_me'} disabled={busy !== null} onClick={() => decline(true)}>
            {t('inv.notMe')}
          </Button>
        </div>
      </div>

      <TermsSheet
        open={termsOpen}
        onClose={() => setTermsOpen(false)}
        onAccept={() => {
          setAccepted(true);
          setTermsOpen(false);
        }}
      />
    </Screen>
  );
}
