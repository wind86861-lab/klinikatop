/**
 * Bemor profili — so'rov yuborishdan oldin majburiy.
 *
 * Nima majburiy va nega:
 *   ism, familiya  — klinika kimga taklif berayotganini bilishi kerak
 *   tug'ilgan yil  — bir xil operatsiya 30 va 70 yoshda boshqacha narxlanadi
 *   jins           — ba'zi operatsiyalar jinsga bog'liq
 *   viloyat        — so'rov shu hududdagi klinikalarga boradi
 *
 * Telefon Telegram tomonidan tasdiqlangan va O'ZGARTIRILMAYDI: agar bemor
 * uni qo'lda almashtira olsa, "tasdiqlangan" bo'lishining ma'nosi qolmasdi.
 * Qo'shimcha aloqa uchun alohida, ixtiyoriy maydon bor.
 */
import { useEffect, useState, type ChangeEvent } from 'react';
import { m } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { spring } from '@/lib/motion';
import { cityName } from '@/i18n';
import { Button, Chip, Field, Input, Notice, Screen, Select } from '@/ui';
import { GENDERS, ageFromBirthYear, type Gender } from '@shared/types';
import { safePath } from '@/lib/safePath';

/** Tanlash uchun yillar: bugundan 120 yil orqaga. */
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 120 }, (_, i) => CURRENT_YEAR - 1 - i);

export function Register() {
  const { t, lang, user, cities, refreshSession, toast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  // Telegram ismini boshlang'ich qiymat sifatida olamiz — bemor faqat tasdiqlaydi
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [cityId, setCityId] = useState<number | null>(user?.cityId ?? null);
  const [birthYear, setBirthYear] = useState<number | null>(user?.birthYear ?? null);
  const [gender, setGender] = useState<Gender | null>(user?.gender ?? null);
  const [extraPhone, setExtraPhone] = useState(user?.extraPhone ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName((v) => v || user.firstName);
    setLastName((v) => v || (user.lastName ?? ''));
    setCityId((v) => v ?? user.cityId);
    setBirthYear((v) => v ?? user.birthYear);
    setGender((v) => v ?? user.gender);
  }, [user]);

  const valid =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    cityId !== null &&
    birthYear !== null &&
    gender !== null;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await api.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        cityId: cityId!,
        birthYear,
        gender,
        extraPhone: extraPhone.trim() || null,
      });
      await refreshSession();
      haptic.success();
      const next = (location.state as { next?: string } | null)?.next ?? '/';
      navigate(safePath(next), { replace: true });
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
      setSaving(false);
    }
  };

  const age = ageFromBirthYear(birthYear);

  return (
    <Screen
      title={t('reg.title')}
      subtitle={t('reg.subtitle')}
      footer={
        <Button block loading={saving} disabled={!valid} onClick={submit}>
          {t('common.next')}
        </Button>
      }
    >
      <m.div
        className="stack"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <Field label={t('reg.firstName')}>
          <Input value={firstName} maxLength={80} onChange={(e) => setFirstName(e.target.value)} />
        </Field>

        <Field label={t('reg.lastName')}>
          <Input value={lastName} maxLength={80} onChange={(e) => setLastName(e.target.value)} />
        </Field>

        {/* Yosh va jins — tibbiy jihatdan muhim, shuning uchun majburiy */}
        <div className="row" style={{ gap: 'var(--s-2)', alignItems: 'flex-end' }}>
          <Field label={t('reg.birthYear')} hint={age != null ? t('reg.age', { n: age }) : undefined}>
            <Select
              value={birthYear ?? ''}
              aria-label={t('reg.birthYear')}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                setBirthYear(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">{t('reg.choose')}</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label={t('reg.gender')}>
          <div className="row" style={{ gap: 6 }}>
            {GENDERS.map((g) => (
              <Chip key={g} active={gender === g} onClick={() => setGender(g)}>
                {t(`reg.gender.${g}` as any)}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label={t('reg.region')} hint={t('reg.regionHint')}>
          <Select
            value={cityId ?? ''}
            aria-label={t('reg.region')}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              setCityId(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">{t('reg.choose')}</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {cityName(c, lang)}
              </option>
            ))}
          </Select>
        </Field>

        {/* Telegram tasdiqlagan raqam — ko'rsatiladi, lekin tahrirlanmaydi */}
        {user?.phone && (
          <Field label={t('reg.phone')} hint={t('reg.phoneVerified')}>
            <Input value={user.phone} readOnly disabled />
          </Field>
        )}

        <Field label={t('reg.extraPhone')} hint={t('reg.extraPhoneHint')}>
          <Input
            type="tel"
            value={extraPhone}
            maxLength={30}
            placeholder="+998 __ ___ __ __"
            onChange={(e) => setExtraPhone(e.target.value)}
          />
        </Field>

        <Notice tone="info">{t('reg.privacy')}</Notice>
      </m.div>
    </Screen>
  );
}
