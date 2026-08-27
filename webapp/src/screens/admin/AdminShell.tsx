/**
 * Super-admin ish joyi.
 *
 * Bemor ilovasi telefon uchun — bitta ustun, katta tugmalar, orqaga
 * qaytish. Admin esa kompyuterda ishlaydi va butunlay boshqa narsa
 * qiladi: ro'yxatlarni ko'zdan kechiradi, taqqoslaydi, bo'limlar
 * orasida tez-tez sakraydi. Shuning uchun bu yerda yon panel va keng
 * maydon — telefon uchun yasalgan ekranni kompyuterga cho'zish emas.
 *
 * Panel FAQAT YORUG' rejimda. Bu qaror: admin uzoq vaqt jadval va
 * raqamlarga qaraydi, qorong'i fonda esa ular bir-biriga qo'shilib
 * ketadi. Rejim tanlovi bemor ilovasida qoladi.
 */
import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EASE, spring } from '@/lib/motion';
import { setWebToken } from '@/lib/session';

export interface AdminSection {
  id: string;
  label: string;
  /** Yon paneldagi raqam — e'tibor talab qiladigan ishlar soni */
  badge?: number;
  render: () => ReactNode;
}

export function AdminShell({
  sections,
  active,
  onChange,
  who,
}: {
  sections: AdminSection[];
  active: string;
  onChange: (id: string) => void;
  who: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const current = sections.find((s) => s.id === active) ?? sections[0];

  const pick = (id: string) => {
    onChange(id);
    setMenuOpen(false);
  };

  return (
    <div className="admin">
      {/* ── Yon panel ── */}
      <aside className={`admin__side ${menuOpen ? 'is-open' : ''}`}>
        <div className="admin__brand">
          <span className="admin__mark">KlinikaTop</span>
          <span className="admin__role">Administrator</span>
        </div>

        <nav className="admin__nav">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`admin__navItem ${s.id === active ? 'is-active' : ''}`}
              onClick={() => pick(s.id)}
            >
              {s.id === active && (
                <motion.span layoutId="admin-nav-marker" className="admin__navMark" transition={spring} />
              )}
              <span className="admin__navLabel">{s.label}</span>
              {s.badge ? <span className="admin__navBadge num">{s.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="admin__foot">
          <span className="admin__who num">{who}</span>
          <button
            type="button"
            className="admin__logout"
            onClick={() => {
              setWebToken(null);
              window.location.href = '/kabinet';
            }}
          >
            Chiqish
          </button>
        </div>
      </aside>

      {/* Tor ekranda yon panel ustiga chiqadi — orqa fonni bosib yopamiz */}
      {menuOpen && <button className="admin__scrim" aria-label="Yopish" onClick={() => setMenuOpen(false)} />}

      {/* ── Asosiy maydon ── */}
      <main className="admin__main">
        <header className="admin__top">
          <button
            type="button"
            className="admin__burger"
            aria-label="Menyu"
            onClick={() => setMenuOpen(true)}
          >
            <span />
            <span />
            <span />
          </button>
          <h1 className="admin__title">{current?.label}</h1>
        </header>

        <div className="admin__body">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="admin__panel"
            >
              {current?.render()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

/** Bir qatorli ko'rsatkich — panelning yuqorisidagi qator uchun. */
export function AdminStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className={`admin__stat ${tone ? `is-${tone}` : ''}`}>
      <span className="admin__statLabel">{label}</span>
      <strong className="admin__statValue num">{value}</strong>
      {hint && <span className="admin__statHint">{hint}</span>}
    </div>
  );
}
