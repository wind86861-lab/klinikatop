/**
 * Katalog: soha → bo'lim → operatsiya.
 *
 * Bitta komponent bemor uchun ham, klinika uchun ham. Ular bir xil
 * tuzilmani ko'rishi SHART: bemor "Katarakta" bo'limidan tanlaydi,
 * klinika esa o'sha bo'limni yoqadi. Ikki joyda ikki xil ko'rinish
 * bo'lsa, ular bir-biriga mos kelmay qoladi va nima uchun so'rov
 * kelmayotgani tushunarsiz bo'ladi.
 *
 * Ikki rejim bir kod bilan:
 *   `mode="single"` — bemor bitta operatsiya tanlaydi
 *   `mode="multi"`  — klinika o'z yo'nalishlarini yoqadi
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EASE } from '@/lib/motion';
import { categoryName, opAlias, opName } from '@/i18n';
import { Chip, IconCheck, IconSearch, Input } from '@/ui';
import type { Lang, Operation, OperationCategory } from '@shared/types';

export interface CatalogSection {
  category: OperationCategory;
  operations: Operation[];
}

export interface CatalogBranch {
  category: OperationCategory;
  loose: Operation[];
  sections: CatalogSection[];
  total: number;
}

export function CatalogBrowser({
  tree,
  lang,
  mode,
  selected,
  onSelect,
  /** `multi` rejimda: butun bo'limni bir tegishda yoqish */
  onToggleMany,
  emptyText,
}: {
  tree: CatalogBranch[];
  lang: Lang;
  mode: 'single' | 'multi';
  selected: number[];
  onSelect: (operation: Operation) => void;
  onToggleMany?: (operations: Operation[]) => void;
  emptyText?: string;
}) {
  const [query, setQuery] = useState('');
  const [openBranch, setOpenBranch] = useState<number | null>(null);

  const q = query.trim().toLowerCase();
  const chosen = useMemo(() => new Set(selected), [selected]);

  /*
   * Qidiruvda daraxt YOYILADI.
   *
   * Odam qidirayotganda tuzilma emas, natija kerak. Bo'limlarni
   * yopiq holda ko'rsatish uni yana bosishga majburlaydi — va u
   * qidirgan narsasi qaysi bo'limda ekanini bilmaydi.
   */
  const matches = useMemo(() => {
    if (!q) return null;
    const out: { op: Operation; path: string }[] = [];

    for (const branch of tree) {
      const push = (op: Operation, section?: OperationCategory) => {
        const haystack = `${opName(op, lang)} ${opAlias(op, lang)}`.toLowerCase();
        if (!haystack.includes(q)) return;
        out.push({
          op,
          path: section
            ? `${categoryName(branch.category, lang)} · ${categoryName(section, lang)}`
            : categoryName(branch.category, lang),
        });
      };

      for (const op of branch.loose) push(op);
      for (const s of branch.sections) for (const op of s.operations) push(op, s.category);
    }
    return out;
  }, [q, tree, lang]);

  return (
    <div className="cat">
      <div className="cat__search">
        <IconSearch size={16} />
        <Input
          value={query}
          placeholder="Operatsiya nomi bo‘yicha qidirish"
          aria-label="Qidirish"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* ── Qidiruv natijasi ── */}
      {matches !== null ? (
        matches.length === 0 ? (
          <p className="tiny">{emptyText ?? 'Hech narsa topilmadi'}</p>
        ) : (
          <div className="cat__results">
            {matches.slice(0, 40).map(({ op, path }) => (
              <OperationRow
                key={op.id}
                op={op}
                lang={lang}
                path={path}
                active={chosen.has(op.id)}
                onClick={() => onSelect(op)}
              />
            ))}
            {matches.length > 40 && (
              <span className="tiny">…va yana {matches.length - 40} ta — qidiruvni aniqlashtiring</span>
            )}
          </div>
        )
      ) : (
        /* ── Daraxt ── */
        <div className="cat__tree">
          {tree.map((branch) => {
            const open = openBranch === branch.category.id;
            const picked = countPicked(branch, chosen);

            return (
              <div key={branch.category.id} className="cat__branch">
                <button
                  type="button"
                  className={`cat__head ${open ? 'is-open' : ''}`}
                  onClick={() => setOpenBranch(open ? null : branch.category.id)}
                >
                  <span className={`cat__caret ${open ? 'is-open' : ''}`}>›</span>
                  <span className="cat__name truncate">{categoryName(branch.category, lang)}</span>
                  <span className={`cat__count ${picked > 0 ? 'is-on' : ''} num`}>
                    {mode === 'multi' ? `${picked}/${branch.total}` : branch.total}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: EASE }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div className="cat__body">
                        {branch.sections.map((section) => (
                          <Section
                            key={section.category.id}
                            section={section}
                            lang={lang}
                            mode={mode}
                            chosen={chosen}
                            onSelect={onSelect}
                            onToggleMany={onToggleMany}
                          />
                        ))}

                        {/* Bo'limga kirmagan operatsiyalar */}
                        {branch.loose.length > 0 && (
                          <div className="cat__section">
                            {branch.sections.length > 0 && (
                              <span className="cat__sectionName">Boshqa</span>
                            )}
                            <div className="cat__ops">
                              {branch.loose.map((op) => (
                                <OperationRow
                                  key={op.id}
                                  op={op}
                                  lang={lang}
                                  active={chosen.has(op.id)}
                                  onClick={() => onSelect(op)}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Section({
  section,
  lang,
  mode,
  chosen,
  onSelect,
  onToggleMany,
}: {
  section: CatalogSection;
  lang: Lang;
  mode: 'single' | 'multi';
  chosen: Set<number>;
  onSelect: (op: Operation) => void;
  onToggleMany?: (ops: Operation[]) => void;
}) {
  const allOn = section.operations.every((op) => chosen.has(op.id));

  return (
    <div className="cat__section">
      <div className="cat__sectionHead">
        <span className="cat__sectionName">{categoryName(section.category, lang)}</span>
        {/*
          Butun bo'limni bir tegishda yoqish — faqat klinika uchun.
          "Katarakta" ni to'liq qiladigan klinika 5 ta yozuvni
          bittalab bosishi kerak emas.
        */}
        {mode === 'multi' && onToggleMany && (
          <button type="button" className="cat__all" onClick={() => onToggleMany(section.operations)}>
            {allOn ? 'Bo‘shatish' : 'Barchasi'}
          </button>
        )}
      </div>

      <div className="cat__ops">
        {section.operations.map((op) => (
          <OperationRow
            key={op.id}
            op={op}
            lang={lang}
            active={chosen.has(op.id)}
            onClick={() => onSelect(op)}
          />
        ))}
      </div>
    </div>
  );
}

function OperationRow({
  op,
  lang,
  path,
  active,
  onClick,
}: {
  op: Operation;
  lang: Lang;
  /** Qidiruv natijasida: qaysi soha va bo'limda ekani */
  path?: string;
  active: boolean;
  onClick: () => void;
}) {
  const alias = opAlias(op, lang);

  return (
    <Chip size="sm" active={active} onClick={onClick}>
      {active && <IconCheck size={11} />}
      <span className="cat__opName">
        {opName(op, lang)}
        {/* Xalq tilidagi nom — bemor tibbiy atamani bilmaydi */}
        {alias && <span className="cat__alias">{alias}</span>}
        {path && <span className="cat__path">{path}</span>}
      </span>
    </Chip>
  );
}

function countPicked(branch: CatalogBranch, chosen: Set<number>): number {
  let n = 0;
  for (const op of branch.loose) if (chosen.has(op.id)) n++;
  for (const s of branch.sections) for (const op of s.operations) if (chosen.has(op.id)) n++;
  return n;
}
