/** Klinika arizasi — litsenziya moderator tekshiruviga yuboriladi. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { cityName, opName } from '@/i18n';
import { Button, Chip, Field, Input, Notice, Screen, Skeleton, Textarea } from '@/ui';
import type { Operation, OperationCategory } from '@shared/types';

export function ClinicRegister() {
  const { t, lang, cities, categories, refreshSession, toast } = useApp();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [cityId, setCityId] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [about, setAbout] = useState('');
  const [license, setLicense] = useState('');
  const [operationIds, setOperationIds] = useState<number[]>([]);
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void api.operations().then(setOperations);
  }, []);

  useEffect(() => {
    if (cityId === null && cities.length) setCityId(cities[0].id);
  }, [cities, cityId]);

  const toggleOperation = (id: number) => {
    haptic.select();
    setOperationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const valid = name.trim().length >= 2 && cityId !== null && operationIds.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await api.registerClinic({
        name: name.trim(),
        cityId: cityId!,
        address: address.trim(),
        about: about.trim(),
        licenseFileId: license.trim() || null,
        operationIds,
      });
      haptic.success();
      await refreshSession();
      navigate('/clinic', { replace: true });
    } catch (err: any) {
      haptic.error();
      toast(err?.message ?? t('common.error'), 'error');
      setSubmitting(false);
    }
  };

  const byCategory = (category: OperationCategory) =>
    (operations ?? []).filter((op) => op.categoryId === category.id);

  return (
    <Screen
      title={t('clinic.register')}
      onBack={() => navigate('/')}
      footer={
        <Button block loading={submitting} disabled={!valid} onClick={submit}>
          {t('common.send')}
        </Button>
      }
    >
      <Notice tone="info">{t('clinic.pendingText')}</Notice>

      <Field label={t('clinic.name')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field label={t('need.city')}>
        <div className="scroll-x">
          <div className="row" style={{ gap: 'var(--s-2)', paddingBottom: 4 }}>
            {cities.map((c) => (
              <Chip key={c.id} active={cityId === c.id} onClick={() => setCityId(c.id)}>
                {cityName(c, lang)}
              </Chip>
            ))}
          </div>
        </div>
      </Field>

      <Field label={t('clinic.address')}>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>

      <Field label={t('clinic.license')} hint={t('common.required')}>
        <Input value={license} onChange={(e) => setLicense(e.target.value)} />
      </Field>

      <Field label={`${t('clinic.about')} · ${t('common.optional')}`}>
        <Textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} />
      </Field>

      <Field
        label={t('clinic.operations')}
        hint={`${operationIds.length} ${t('common.done').toLowerCase()}`}
        error={operationIds.length === 0 ? t('common.required') : undefined}
      >
        {operations === null ? (
          <div className="stack">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} h={44} />
            ))}
          </div>
        ) : (
          <div className="stack">
            {categories.map((category) => {
              const items = byCategory(category);
              if (!items.length) return null;
              return (
                <div key={category.id} className="stack" style={{ gap: 6 }}>
                  <span className="tiny">{lang === 'ru' ? category.nameRu : category.nameUz}</span>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {items.map((op) => (
                      <Chip
                        key={op.id}
                        size="sm"
                        active={operationIds.includes(op.id)}
                        onClick={() => toggleOperation(op.id)}
                      >
                        {opName(op, lang)}
                      </Chip>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Field>
    </Screen>
  );
}
