/**
 * Bemor profili: ism, familiya, viloyat.
 * So'rov yuborishdan oldin majburiy — klinika kimga taklif berayotganini bilishi kerak.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { cityName } from '@/i18n';
import { Button, Chip, Field, IconCheck, Input, Notice, Screen } from '@/ui';

export function Register() {
  const { t, lang, user, cities, refreshSession, toast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  // Telegram ismini boshlang'ich qiymat sifatida olamiz — bemor faqat tasdiqlaydi
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [cityId, setCityId] = useState<number | null>(user?.cityId ?? null);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName((v) => v || user.firstName);
    setLastName((v) => v || (user.lastName ?? ''));
    setCityId((v) => v ?? user.cityId);
  }, [user]);

  const valid = firstName.trim().length >= 2 && lastName.trim().length >= 2 && cityId !== null;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await api.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        cityId: cityId!,
        phone: phone.trim() || null,
      });
      await refreshSession();
      haptic.success();

      // Qayerdan kelgan bo'lsa o'sha yerga qaytamiz (masalan so'rov yaratishga)
      const next = (location.state as { next?: string } | null)?.next;
      navigate(next ?? '/', { replace: true });
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
      setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <Button block loading={saving} disabled={!valid} onClick={submit}>
          {t('reg.submit')}
        </Button>
      }
    >
      <motion.div
        className="reg-hero"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <div className="reg-hero__art">
          <IconUser />
        </div>
        <h1 style={{ fontSize: 'var(--t-xl)' }}>{t('reg.title')}</h1>
        <p className="tiny" style={{ maxWidth: '30ch' }}>
          {t('reg.subtitle')}
        </p>
      </motion.div>

      <Field label={t('reg.firstName')}>
        <Input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder={t('reg.firstNamePh')}
          autoComplete="given-name"
        />
      </Field>

      <Field label={t('reg.lastName')}>
        <Input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder={t('reg.lastNamePh')}
          autoComplete="family-name"
        />
      </Field>

      <Field label={t('reg.region')} hint={t('reg.regionHint')}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {cities.map((c) => (
            <Chip key={c.id} active={cityId === c.id} onClick={() => setCityId(c.id)}>
              {cityId === c.id && <IconCheck size={12} />} {cityName(c, lang)}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={`${t('reg.phone')} · ${t('common.optional')}`} hint={t('reg.phoneHint')}>
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+998 __ ___ __ __"
          inputMode="tel"
          autoComplete="tel"
        />
      </Field>

      <Notice tone="info">{t('reg.privacy')}</Notice>
    </Screen>
  );
}

const IconUser = () => (
  <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
