/**
 * Saytga kirish paroli — bemor uni Telegram ichida qo'yadi va o'zgartiradi.
 *
 * Login — botda kontakt bilan tasdiqlangan telefon raqami. Parol bilan
 * u klinikatop.uz/kirish/ sahifasida Telegramsiz ham kiradi.
 *
 * Telegram imzosi shaxsni tasdiqlaydi, shuning uchun SMS kod ham, eski
 * parol ham so'ralmaydi (eski parolni unutgan odam aynan shu yerda
 * yangisini qo'yadi). Parol o'zgarganda saytdagi eski kirishlar yopiladi.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic, tg } from '@/lib/telegram';
import { formatDate } from '@/lib/format';
import { Button, Card, EmptyState, Field, Input, Notice, Screen, SkeletonCard } from '@/ui';

type Status = { phone: string | null; hasPassword: boolean; passwordSetAt: string | null };

const SITE_LOGIN = 'https://klinikatop.uz/kirish/';

const prettyPhone = (p: string) => `+${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10, 12)}`;

export function WebPassword() {
  const { t, lang, toast } = useApp();
  const navigate = useNavigate();
  const insideTelegram = Boolean(tg?.initData);

  const [status, setStatus] = useState<Status | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!insideTelegram) return;
    api
      .webLogin()
      .then(setStatus)
      .catch((err) => toast(err?.message ?? t('common.error'), 'error'));
  }, [insideTelegram, t, toast]);

  const back = () => navigate('/profile');

  if (!insideTelegram) {
    return (
      <Screen title={t('pw.title')} onBack={back}>
        <EmptyState icon="🔑" title={t('pw.title')} text={t('pw.onlyTelegram')} />
      </Screen>
    );
  }
  if (!status) {
    return (
      <Screen title={t('pw.title')} onBack={back}>
        <SkeletonCard lines={4} />
      </Screen>
    );
  }
  if (!status.phone) {
    return (
      <Screen title={t('pw.title')} onBack={back}>
        <EmptyState icon="📱" title={t('pw.title')} text={t('pw.noPhone')} />
      </Screen>
    );
  }

  // Mijoz tomonda ham xuddi server qoidasi — xato yuborishdan OLDIN ko'rinsin
  const weak = password.length > 0 && (password.length < 8 || /^\d+$/.test(password));
  const mismatch = repeat.length > 0 && repeat !== password;
  const valid = password.length >= 8 && !/^\d+$/.test(password) && repeat === password;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      setStatus(await api.setWebPassword(password));
      setPassword('');
      setRepeat('');
      haptic.success();
      toast(t('pw.saved'), 'success');
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openSite = () => {
    // Telegram ichida tashqi brauzerda ochiladi — u yerda kiriladi
    const w = tg as unknown as { openLink?: (url: string) => void } | undefined;
    if (w?.openLink) w.openLink(SITE_LOGIN);
    else window.open(SITE_LOGIN, '_blank', 'noopener');
  };

  return (
    <Screen
      title={t('pw.title')}
      onBack={back}
      footer={
        <Button block loading={busy} disabled={!valid} onClick={save}>
          {status.hasPassword ? t('pw.change') : t('pw.save')}
        </Button>
      }
    >
      <div className="stack">
        <p className="tiny">{t('pw.lead')}</p>

        <Card className="stack" style={{ gap: 8 }}>
          <div className="app-rows">
            <div className="app-row">
              <span className="tiny">{t('pw.login')}</span>
              <strong className="num">{prettyPhone(status.phone)}</strong>
            </div>
          </div>
          <span className={`pw-status ${status.hasPassword ? 'is-set' : ''}`}>
            {status.hasPassword
              ? t('pw.statusSet', { date: status.passwordSetAt ? formatDate(status.passwordSetAt, lang) : '' })
              : t('pw.statusNone')}
          </span>
        </Card>

        <Field label={t('pw.new')} hint={weak ? undefined : t('pw.hint')} error={weak ? t('pw.hint') : undefined}>
          <div className="pw-field">
            <Input
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              maxLength={200}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="pw-field__toggle" onClick={() => setShow((v) => !v)}>
              {show ? t('pw.hide') : t('pw.show')}
            </button>
          </div>
        </Field>
        <Field label={t('pw.repeat')} error={mismatch ? t('pw.mismatch') : undefined}>
          <Input
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={repeat}
            maxLength={200}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </Field>

        {status.hasPassword && (
          <Notice>
            <button type="button" className="link-btn" onClick={openSite}>
              {t('pw.openSite')} →
            </button>
          </Notice>
        )}
      </div>
    </Screen>
  );
}
