/**
 * Sana maydoni — o'qiladigan ko'rinish, tizim tanlagichi.
 *
 * Muammo: `<input type="date">` sanani BRAUZER tilida ko'rsatadi.
 * Telegram ichida bu ko'pincha amerikacha `09/17/2026` bo'lib
 * chiqadi va bemor uni 9-sentabr deb o'qiydi — ya'ni noto'g'ri
 * kunni tanlab, buni sezmaydi ham.
 *
 * Shuning uchun maydon o'zimizning matnimizni ko'rsatadi
 * ("17 sen 2026"), haqiqiy `input` esa ustida shaffof turadi:
 * bosilganda tizimning o'z tanlagichi ochiladi — telefonda u
 * eng qulay va tanish narsa. Ya'ni ko'rinish bizniki, tanlash
 * tizimniki.
 *
 * Alohida fayl: sana bosqichi ham, admin qo'shgan "sana" savoli
 * ham shuni ishlatadi. Nusxa ko'chirilsa, ikkitasi vaqt o'tib
 * boshqa-boshqa ko'rinishga ega bo'lardi.
 */
import { useRef } from 'react';
import { useApp } from '@/store/app';
import { formatDate } from '@/lib/format';
import { IconClock } from '@/ui';

export function DateField({
  label,
  value,
  min,
  onChange,
}: {
  /** Bo'sh qoldirilsa yozuv chiqmaydi — sarlavha yuqorida turgan bo'ladi */
  label?: string;
  value: string | null;
  /** Undan oldingi kunlar tanlanmaydi; berilmasa cheklov yo'q */
  min?: string;
  onChange: (v: string | null) => void;
}) {
  const { t, lang } = useApp();
  const ref = useRef<HTMLInputElement>(null);

  return (
    <label className="datefield">
      {label && <span className="datefield__label">{label}</span>}

      <span className={`datefield__box ${value ? 'is-set' : ''}`}>
        <IconClock size={15} />
        <span className="datefield__value">
          {value ? formatDate(value, lang) : t('wz.date.pick')}
        </span>

        <input
          ref={ref}
          className="datefield__input"
          type="date"
          min={min}
          value={value ?? ''}
          aria-label={label ?? undefined}
          onClick={() => {
            /*
             * `showPicker()` — kompyuterda bosish tanlagichni ochsin.
             * Telefonda maydonga fokus tushishining o'zi yetarli;
             * eski brauzerlarda usul yo'q va xato beradi.
             */
            try {
              ref.current?.showPicker?.();
            } catch {
              /* tanlagich baribir fokus orqali ochiladi */
            }
          }}
          onChange={(e) => onChange(e.target.value || null)}
        />
      </span>
    </label>
  );
}
