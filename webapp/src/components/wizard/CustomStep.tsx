/**
 * Admin qo'shgan savol.
 *
 * Tayyor bosqichlar (katalog, byudjet, sana) — kodda yozilgan maxsus
 * ekranlar. Bu esa ularning aksi: admin panelidan yaratiladigan oddiy
 * savol. Shu sababli bu yerda hech qanday maxsus mantiq yo'q, faqat
 * turga qarab to'g'ri boshqaruv elementi tanlanadi.
 */
import { Chip, Input, Textarea } from '@/ui';
import { useApp } from '@/store/app';
import { haptic } from '@/lib/telegram';
import { DateField } from './DateField';
import type { WizardStep } from '@shared/types';

export function CustomStep({
  step,
  value,
  onChange,
}: {
  step: WizardStep;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useApp();
  const options = step.options ?? [];

  return (
    <>
      <div className="wz-head">
        <h1 className="wz-head__title">{step.title ?? step.key}</h1>
        {step.sub && <p className="wz-head__sub">{step.sub}</p>}
        {!step.required && <p className="wz-head__sub">{t('wz.optional')}</p>}
      </div>

      {step.kind === 'text' && (
        <Input
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={200}
          aria-label={step.title ?? step.key}
        />
      )}

      {step.kind === 'longtext' && (
        <Textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          maxLength={500}
          aria-label={step.title ?? step.key}
        />
      )}

      {step.kind === 'number' && (
        <Input
          type="number"
          inputMode="numeric"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          aria-label={step.title ?? step.key}
        />
      )}

      {step.kind === 'date' && (
        <DateField
          value={typeof value === 'string' && value ? value : null}
          onChange={(v) => {
            onChange(v ?? undefined);
            haptic.select();
          }}
        />
      )}

      {step.kind === 'boolean' && (
        <div className="chips">
          {[
            { v: true, label: t('common.yes') },
            { v: false, label: t('common.no') },
          ].map((o) => (
            <Chip
              key={String(o.v)}
              active={value === o.v}
              onClick={() => {
                onChange(o.v);
                haptic.select();
              }}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      )}

      {step.kind === 'choice' && (
        <div className="chips">
          {options.map((o) => (
            <Chip
              key={o.value}
              active={value === o.value}
              onClick={() => {
                onChange(o.value);
                haptic.select();
              }}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      )}

      {step.kind === 'multichoice' && (
        <div className="chips">
          {options.map((o) => {
            const list = Array.isArray(value) ? (value as string[]) : [];
            const on = list.includes(o.value);
            return (
              <Chip
                key={o.value}
                active={on}
                onClick={() => {
                  onChange(on ? list.filter((v) => v !== o.value) : [...list, o.value]);
                  haptic.select();
                }}
              >
                {o.label}
              </Chip>
            );
          })}
        </div>
      )}
    </>
  );
}
