/**
 * Bemorning brauzerdan kirishi — telefon raqami bilan.
 *
 * Ikki qadam: raqam → kod. Kirish ham, NOLDAN ro'yxatdan o'tish ham
 * shu yerda: raqam bazada bo'lmasa hisob kod tasdiqlangach
 * yaratiladi.
 *
 * Kod qayerga borgani EKRANDA aytiladi. Server ikki kanaldan
 * birini tanlaydi — Telegram hisobi borga bot yozadi (tekin),
 * qolganiga SMS. Odam qayerga qarashni bilishi kerak, aks holda
 * SMS kutib o'tirardi yoki aksincha.
 */
import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { api } from '@/lib/api';
import { setPatientToken } from '@/lib/session';
import { useApp } from '@/store/app';
import { EASE } from '@/lib/motion';
import { Button, Field, Input, Notice } from '@/ui';

const BASE = import.meta.env.VITE_API_URL ?? '';

export function PhoneLogin() {
  const { t, toast } = useApp();

  /*
   * Bot havolasi — kanal topilmagan holat uchun zaxira yo'l.
   * Ochiq statistikadan olinadi; kelmasa havola ko'rsatilmaydi,
   * xolos.
   */
  const [botUrl, setBotUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${BASE}/api/public/stats`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((s: { botUrl: string | null }) => alive && setBotUrl(s.botUrl))
      .catch(() => {
        /* havolasiz ham ekran ishlayveradi */
      });
    return () => {
      alive = false;
    };
  }, []);

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  /** Kod qaysi kanaldan ketdi — ikkinchi qadamdagi matn shunga bog'liq */
  const [channel, setChannel] = useState<'telegram' | 'sms' | null>(null);
  /** Yangi raqam — bu kirish emas, ro'yxatdan o'tish */
  const [isNew, setIsNew] = useState(false);
  /** Hech qanday kanal yo'q: SMS sozlanmagan va Telegram hisobi ham yo'q */
  const [noChannel, setNoChannel] = useState(false);

  const digits = phone.replace(/\D/g, '');
  const phoneOk = digits.length === 9 || /^998\d{9}$/.test(digits);

  const ask = async () => {
    setBusy(true);
    setNoChannel(false);
    try {
      const res = await api.requestPhoneCode(phone);

      /*
       * Kanal umuman yo'q — bu sozlash muammosi, odamning aybi
       * emas. Uni "kod yuborildi" deb kutib qoldirmaymiz.
       */
      if (!res.channel) {
        setNoChannel(true);
        return;
      }

      /*
       * Kanal bor, lekin yetkazib bo'lmadi: botni bloklagan yoki
       * SMS o'tmagan. Bu ham jim qolmasligi kerak.
       */
      if (!res.sent) {
        toast(t('plogin.notSent'), 'error');
        return;
      }

      setChannel(res.channel);
      setIsNew(!res.found);
      setStep('code');
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const { token } = await api.verifyPhoneCode(phone, code);
      setPatientToken(token);
      /*
       * To'liq qayta yuklash: ilova ildizi boshlanishida sessiyani
       * bir marta o'qiydi, shuning uchun holatni yangilash yetarli
       * emas edi — kabinet kirishida aynan shu xato bo'lgan.
       */
      // Bemor ilovasi /app da; "/" — ochiq sayt
      window.location.replace('/app');
    } catch (err: any) {
      toast(err?.message ?? t('common.error'), 'error');
      setBusy(false);
    }
  };

  return (
    <div className="plogin">
      <m.div
        className="plogin__box"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
      >
        <h1 className="plogin__title">{t('plogin.title')}</h1>
        <p className="plogin__sub">
          {step === 'phone'
            ? t('plogin.sub')
            : t(channel === 'sms' ? 'plogin.codeSubSms' : 'plogin.codeSubTg', { phone })}
        </p>

        {step === 'phone' ? (
          <>
            <Field label={t('plogin.phone')} hint={t('plogin.phoneHint')}>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+998 90 123 45 67"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && phoneOk && !busy && void ask()}
              />
            </Field>

            {noChannel && (
              <Notice tone="warning">
                {t('plogin.noChannel')}
                {botUrl && (
                  <>
                    {' '}
                    <a href={botUrl} target="_blank" rel="noreferrer">
                      {t('plogin.openBot')}
                    </a>
                  </>
                )}
              </Notice>
            )}

            <Button block loading={busy} disabled={!phoneOk} onClick={ask}>
              {t('plogin.send')}
            </Button>
          </>
        ) : (
          <>
            <Field label={t('plogin.code')}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && !busy && void verify()}
              />
            </Field>

            {isNew && <Notice tone="info">{t('plogin.willRegister')}</Notice>}

            <Button block loading={busy} disabled={code.length !== 6} onClick={verify}>
              {t(isNew ? 'plogin.register' : 'plogin.enter')}
            </Button>

            <button
              type="button"
              className="plogin__back"
              onClick={() => {
                setStep('phone');
                setCode('');
              }}
            >
              {t('plogin.changePhone')}
            </button>
          </>
        )}

        {/* "/" — ochiq sayt (statik HTML), SPA emas: to'liq o'tish kerak */}
        <button type="button" className="plogin__back" onClick={() => window.location.assign('/')}>
          {t('common.back')}
        </button>
      </m.div>
    </div>
  );
}
