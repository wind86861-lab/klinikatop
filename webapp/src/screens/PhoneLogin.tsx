/**
 * Bemorning brauzerdan kirishi — telefon raqami bilan.
 *
 * Ikki qadam: raqam → Telegramga kelgan kod. Kod SMS emas, chunki
 * raqamning o'zi Telegram tasdiqlagan (`users.phone` boshqa yo'l
 * bilan to'lmaydi) va bot allaqachon bor.
 *
 * Shuning uchun bu yerda ochiq aytiladi: kod TELEGRAMGA keladi.
 * "Kod yuborildi" deb qo'yilsa, odam SMS kutib o'tirardi.
 *
 * Telegramda hech qachon bo'lmagan odam bu yerdan ro'yxatdan o'ta
 * olmaydi — unga kod yuboradigan kanal yo'q. Shuning uchun raqam
 * topilmaganda xato emas, BOTGA yo'l ko'rsatiladi.
 */
import { useState } from 'react';
import { m } from 'framer-motion';
import { useNavigate } from '@/lib/router';
import { api } from '@/lib/api';
import { setPatientToken } from '@/lib/session';
import { useApp } from '@/store/app';
import { EASE } from '@/lib/motion';
import { Button, Field, Input, Notice } from '@/ui';

export function PhoneLogin({ botUrl }: { botUrl?: string | null }) {
  const { t, toast } = useApp();
  const navigate = useNavigate();

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  /** Raqam topilmadi — ro'yxatdan o'tish kerak */
  const [unknown, setUnknown] = useState(false);

  const digits = phone.replace(/\D/g, '');
  const phoneOk = digits.length === 9 || /^998\d{9}$/.test(digits);

  const ask = async () => {
    setBusy(true);
    setUnknown(false);
    try {
      const res = await api.requestPhoneCode(phone);
      if (!res.found) {
        setUnknown(true);
        return;
      }
      /*
       * `sent: false` — hisob bor, lekin botga yozib bo'lmadi
       * (odam botni bloklagan yoki chat yo'q). Buni jimgina
       * "kod yuborildi" deb ko'rsatish odamni kutib qoldirardi.
       */
      if (!res.sent) {
        toast(t('plogin.notSent'), 'error');
        return;
      }
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
      window.location.replace('/');
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
          {step === 'phone' ? t('plogin.sub') : t('plogin.codeSub', { phone })}
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

            {unknown && (
              <Notice tone="warning">
                {t('plogin.unknown')}
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

            <Button block loading={busy} disabled={code.length !== 6} onClick={verify}>
              {t('plogin.enter')}
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

        <button type="button" className="plogin__back" onClick={() => navigate('/')}>
          {t('common.back')}
        </button>
      </m.div>
    </div>
  );
}
