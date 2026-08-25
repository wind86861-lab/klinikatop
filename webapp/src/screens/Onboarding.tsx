import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { EASE, spring } from '@/lib/motion';
import { Button, Chip, IconChat, IconSparkle, IconWallet } from '@/ui';
import type { TranslationKey } from '@/i18n';
import type { Lang } from '@shared/types';

const SLIDES = [
  { key: '1', Icon: IconWallet },
  { key: '2', Icon: IconSparkle },
  { key: '3', Icon: IconChat },
] as const;

export function Onboarding() {
  const { t, lang, setLang, refreshSession } = useApp();
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [finishing, setFinishing] = useState(false);

  const isLast = index === SLIDES.length - 1;

  const goTo = (next: number) => {
    if (next < 0 || next >= SLIDES.length) return;
    setDirection(next > index ? 1 : -1);
    setIndex(next);
    haptic.select();
  };

  const finish = async () => {
    setFinishing(true);
    haptic.success();
    try {
      await api.markOnboarded();
      await refreshSession();
    } catch {
      // Onboarding belgisi saqlanmasa ham ilovaga kirishga to'sqinlik qilmaymiz
    }
    navigate('/', { replace: true });
  };

  const { Icon } = SLIDES[index];

  return (
    <div className="onb">
      {/* Sekin harakatlanadigan aurora — GPU'da, faqat transform.
          Ikkalasi ham sovuq gammada: iliq rang teal fon bilan qo'shilib zaytun tus beradi. */}
      <div className="onb__aurora" style={{ background: '#2fbf87', top: '-20%', left: '-25%' }} />
      <div
        className="onb__aurora"
        style={{ background: '#0a5a72', bottom: '-30%', right: '-30%', animationDelay: '-8s' }}
      />

      <div className="onb__slide">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={index}
            custom={direction}
            className="stack"
            style={{ alignItems: 'center', gap: 'var(--s-6)' }}
            initial={{ opacity: 0, x: direction * 70 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -70 }}
            transition={{ duration: 0.36, ease: EASE }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={(_, info) => {
              if (info.offset.x < -60) goTo(index + 1);
              else if (info.offset.x > 60) goTo(index - 1);
            }}
          >
            {/* Parallaks: rasm matndan tezroq suriladi */}
            <motion.div
              className="onb__art"
              initial={{ opacity: 0, scale: 0.7, x: direction * 110 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              transition={spring}
            >
              <Icon size={54} />
            </motion.div>

            <motion.h1
              className="onb__title"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.06 }}
            >
              {t(`onb.${SLIDES[index].key}.title` as TranslationKey)}
            </motion.h1>

            <motion.p
              className="onb__text"
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 0.88, y: 0 }}
              transition={{ ...spring, delay: 0.1 }}
            >
              {t(`onb.${SLIDES[index].key}.text` as TranslationKey)}
            </motion.p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="onb__footer">
        <div className="onb__dots" role="tablist" aria-label="Slaydlar">
          {SLIDES.map((s, i) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={i === index}
              aria-label={`${i + 1}`}
              className={`onb__dot ${i === index ? 'onb__dot--active' : ''}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>

        <div className="row" style={{ justifyContent: 'center', gap: 'var(--s-2)' }}>
          <span className="tiny" style={{ color: 'rgba(255,255,255,.7)' }}>
            {t('onb.lang')}
          </span>
          {(['uz', 'ru'] as Lang[]).map((l) => (
            <Chip key={l} size="sm" active={lang === l} onClick={() => setLang(l)}>
              {l === 'uz' ? "O'zbekcha" : 'Русский'}
            </Chip>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.16 }}
        >
          <Button
            block
            variant="secondary"
            loading={finishing}
            onClick={() => (isLast ? finish() : goTo(index + 1))}
          >
            {isLast ? t('onb.start') : t('common.next')}
          </Button>
        </motion.div>

        {!isLast && (
          <button className="btn btn--ghost" style={{ color: 'rgba(255,255,255,.75)' }} onClick={finish}>
            {t('common.skip')}
          </button>
        )}
      </div>
    </div>
  );
}
