/**
 * 1-qadam: operatsiya.
 *
 * Uch yo'l: katalogdan tanlash · shikoyatni yozib AI aniqlaydi ·
 * "bilmayman, klinika aytsin". Uchinchisi katalogdagi maxsus yozuvni
 * tanlaydi — keyingi qadamda holat tavsifi majburiy bo'ladi va klinika
 * shundan aniqlaydi.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { EASE, spring } from '@/lib/motion';
import { opAlias, opName } from '@/i18n';
import {
  AnimatedItem,
  AnimatedList,
  Card,
  Chip,
  EmptyState,
  IconCheck,
  IconSearch,
  IconSparkle,
  Input,
  Skeleton,
} from '@/ui';
import { UNKNOWN_OPERATION_SLUG, type Operation } from '@shared/types';
import { AiChatStep, type AiChatOutcome } from './AiChatStep';

type Mode = 'choose' | 'catalog' | 'describe';

interface Draftish {
  operation: Operation | null;
}

/**
 * 1-qadam. Ikki yo'l:
 *   • Katalogdan tanlash — bemor operatsiya nomini biladi
 *   • Shikoyatimni yozaman — AI suhbati; aniqlansa aniq operatsiya,
 *     aniqlanmasa "klinika aytsin" bo'lib o'sha yerda yakunlanadi
 *
 * "Bilmayman" alohida yo'l emas — u suhbatning tabiiy natijasi. Shunday
 * qilib bemor tanlov qilishdan oldin bilishi shart bo'lmaydi.
 */
export function OperationStep({
  draft,
  onPick,
  onChatDone,
}: {
  draft: Draftish;
  onPick: (operation: Operation, aiSuggested: boolean) => void;
  onChatDone: (outcome: AiChatOutcome) => void;
}) {
  const { t, lang } = useApp();
  const [mode, setMode] = useState<Mode>('choose');

  if (mode === 'choose') {
    return (
      <>
        <div className="wz-head">
          <h1 className="wz-head__title">{t('wz.op.title')}</h1>
          <p className="wz-head__sub">{t('wz.op.sub')}</p>
        </div>

        {/* Tanlangan operatsiya bo'lsa yuqorida ko'rinadi */}
        {draft.operation && (
          <Card variant="flat" className="between">
            <span style={{ minWidth: 0 }}>
              <span className="tiny" style={{ display: 'block' }}>
                {t('wz.op.chosen')}
              </span>
              <strong className="truncate" style={{ display: 'block' }}>
                {opName(draft.operation, lang)}
              </strong>
            </span>
            <IconCheck size={18} />
          </Card>
        )}

        <PathCard
          icon={<IconSearch size={22} />}
          title={t('wz.op.catalog')}
          onClick={() => setMode('catalog')}
        />
        <PathCard
          icon={<IconSparkle size={22} />}
          title={t('wz.op.ai')}
          hint={t('wz.op.aiHint')}
          onClick={() => setMode('describe')}
        />
      </>
    );
  }

  return (
    <>
      <div className="between">
        <button className="btn btn--ghost" onClick={() => setMode('choose')}>
          ‹ {t('wz.back')}
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          className="stack"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: EASE }}
        >
          {mode === 'catalog' ? (
            <CatalogPicker onPick={(op) => onPick(op, false)} />
          ) : (
            <AiChatStep onDone={onChatDone} onSwitchToCatalog={() => setMode('catalog')} />
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function PathCard({
  icon,
  title,
  hint,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      className="wz-path"
      whileTap={{ scale: disabled ? 1 : 0.99 }}
      transition={spring}
      disabled={disabled}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
    >
      <span className="wz-path__icon">{icon}</span>
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span className="wz-path__title">{title}</span>
        {hint && <span className="wz-path__hint">{hint}</span>}
      </span>
      <span className="wz-path__chevron">›</span>
    </motion.button>
  );
}

/* ─────────────────────────  Katalogdan tanlash  ───────────────────────── */

function CatalogPicker({ onPick }: { onPick: (op: Operation) => void }) {
  const { t, lang, categories } = useApp();
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [operations, setOperations] = useState<Operation[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      async () => {
        const list = await api.operations({
          q: query.trim() || undefined,
          categoryId: query.trim() ? undefined : (categoryId ?? undefined),
        });
        // "Bilmayman" yozuvi bu ro'yxatda chiqmasin — u alohida yo'l
        if (!cancelled) setOperations(list.filter((o) => o.slug !== UNKNOWN_OPERATION_SLUG));
      },
      query ? 180 : 0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, categoryId]);

  return (
    <>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 14, top: 14, color: 'var(--muted)' }}>
          <IconSearch size={18} />
        </span>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('need.searchPlaceholder')}
          style={{ paddingLeft: 42 }}
          aria-label={t('common.search')}
        />
      </div>

      {!query && (
        <div className="scroll-x">
          <div className="row" style={{ gap: 'var(--s-2)', paddingBottom: 4 }}>
            <Chip active={categoryId === null} onClick={() => setCategoryId(null)}>
              {t('common.all')}
            </Chip>
            {categories.map((c) => (
              <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                {lang === 'ru' ? c.nameRu : c.nameUz}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {operations === null ? (
        <div className="stack">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} h={64} />
          ))}
        </div>
      ) : operations.length === 0 ? (
        <EmptyState icon={<IconSearch size={30} />} title={t('need.noMatch')} text={t('need.noMatchText')} />
      ) : (
        <AnimatedList>
          {operations.map((op) => (
            <AnimatedItem key={op.id}>
              <button className="list-item" onClick={() => onPick(op)}>
                <span className="list-item__body">
                  <span className="list-item__title" style={{ display: 'block' }}>
                    {opName(op, lang)}
                  </span>
                  <span className="list-item__sub" style={{ display: 'block' }}>
                    {opAlias(op, lang)}
                  </span>
                </span>
              </button>
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}
    </>
  );
}
