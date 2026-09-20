/**
 * Tahlil katalogidan tanlash — guruhlar yig'iladigan daraxt.
 *
 * `CatalogBrowser` ning tahlil uchun juftligi. Ilgari bu ko'rinish
 * klinika profilining ichida (`ClinicLabServices`) yozilgan edi;
 * ro'yxatdan o'tishda ham kerak bo'lgach alohida chiqarildi — ikki
 * nusxa vaqt o'tib boshqa-boshqa ko'rinishga ega bo'lardi, klinika
 * esa "profilda boshqacha edi-ku" derdi.
 *
 * Holat TASHQARIDA: komponent nima tanlanganini bilmaydi, faqat
 * ko'rsatadi va bosilganini aytadi. Shunda profil saqlashni o'zi
 * qiladi, ro'yxatdan o'tish esa arizaga qo'shadi.
 */
import { useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { haptic } from '@/lib/telegram';
import { EASE } from '@/lib/motion';
import { Chip, IconCheck } from '@/ui';
import type { Lang, LabTest } from '@shared/types';

export function LabTestPicker({
  tests,
  lang,
  selected,
  onToggle,
  onToggleMany,
  labels,
}: {
  tests: LabTest[];
  lang: Lang;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleMany: (ids: number[]) => void;
  /** Matnlar tashqaridan: ro'yxatdan o'tish sahifasida `t()` yo'q */
  labels: { tests: string; selectAll: string; clearAll: string };
}) {
  const [open, setOpen] = useState<number | null>(null);
  const name = (x: LabTest) => (lang === 'ru' ? x.nameRu : x.nameUz);

  const tap = (fn: () => void) => {
    fn();
    haptic.tap();
  };

  return (
    <div className="cat__tree">
      {tests
        .filter((x) => x.parentId === null)
        .map((g) => {
          const kids = tests.filter((x) => x.parentId === g.id);

          /* Bolasi yo'q guruh — o'zi bitta tekshiruv */
          if (kids.length === 0) {
            return (
              <div key={g.id} className="cat__branch">
                <button type="button" className="cat__head" onClick={() => tap(() => onToggle(g.id))}>
                  <span className="labtest__icon">{g.icon}</span>
                  <span className="cat__name truncate">{name(g)}</span>
                  {selected.has(g.id) && (
                    <span style={{ color: 'var(--primary)' }}>
                      <IconCheck size={16} />
                    </span>
                  )}
                </button>
              </div>
            );
          }

          const isOpen = open === g.id;
          const on = kids.filter((x) => selected.has(x.id)).length;
          const allOn = on === kids.length;

          return (
            <div key={g.id} className="cat__branch">
              <button
                type="button"
                className={`cat__head ${isOpen ? 'is-open' : ''}`}
                onClick={() => setOpen(isOpen ? null : g.id)}
              >
                <span className={`cat__caret ${isOpen ? 'is-open' : ''}`}>›</span>
                <span className="labtest__icon">{g.icon}</span>
                <span className="cat__name truncate">{name(g)}</span>
                <span className={`cat__count ${on > 0 ? 'is-on' : ''} num`}>
                  {on}/{kids.length}
                </span>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <m.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="cat__body">
                      <div className="cat__section">
                        <div className="cat__sectionHead">
                          <span className="cat__sectionName">{labels.tests}</span>
                          <button
                            type="button"
                            className="cat__all"
                            onClick={() => tap(() => onToggleMany(kids.map((x) => x.id)))}
                          >
                            {allOn ? labels.clearAll : labels.selectAll}
                          </button>
                        </div>

                        <div className="cat__ops">
                          {kids.map((x) => (
                            <Chip
                              key={x.id}
                              size="sm"
                              active={selected.has(x.id)}
                              onClick={() => tap(() => onToggle(x.id))}
                            >
                              {selected.has(x.id) && <IconCheck size={11} />}
                              {name(x)}
                            </Chip>
                          ))}
                        </div>
                      </div>
                    </div>
                  </m.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
    </div>
  );
}
