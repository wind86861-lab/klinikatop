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
import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { EASE, spring } from '@/lib/motion';
import { setWebToken } from '@/lib/session';

export interface AdminSection {
  id: string;
  label: string;
  /** Yon paneldagi raqam — e'tibor talab qiladigan ishlar soni */
  badge?: number;
  /** Yon paneldagi belgi — bo'limni o'qimasdan tanib olish uchun */
  icon?: ReactNode;
  /**
   * Qaysi guruhga tegishli. Guruhsiz o'nta bo'lim bir xil ko'rinardi
   * va admin har safar hammasini o'qib chiqishga majbur edi.
   */
  group?: string;
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

  /*
   * Bo'limlar guruhlanadi, lekin TARTIB o'zgarmaydi: guruh birinchi
   * marta qaysi joyda uchrasa, o'sha joyda turadi. Aks holda menyu
   * elementlari admin o'rganib qolgan joydan sakrab ketardi.
   */
  const groups = useMemo(() => {
    const map = new Map<string, AdminSection[]>();
    for (const s of sections) {
      const key = s.group ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()];
  }, [sections]);

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
          {groups.map(([group, items]) => (
            <div className="admin__navGroup" key={group}>
              {group && <span className="admin__navGroupLabel">{group}</span>}
              {items.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`admin__navItem ${s.id === active ? 'is-active' : ''}`}
              onClick={() => pick(s.id)}
            >
              {s.id === active && (
                <m.span layoutId="admin-nav-marker" className="admin__navMark" transition={spring} />
              )}
              {s.icon && <span className="admin__navIcon">{s.icon}</span>}
              <span className="admin__navLabel">{s.label}</span>
              {s.badge ? <span className="admin__navBadge num">{s.badge}</span> : null}
            </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin__foot">
          <span className="admin__who num">{who}</span>
          <button
            type="button"
            className="admin__logout"
            onClick={() => {
              setWebToken(null);
              // Admin o'z eshigiga qaytadi, klinika kirishiga emas
              window.location.href = '/admin/login';
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
          {/*
            Bo'lim nomi ustki panelda FAQAT telefonda ko'rinadi: u yerda
            yon panel yopiq va boshqa belgi yo'q. Kompyuterda esa yon
            panelda ham, sahifa sarlavhasida ham turgani — bir xil so'z
            ikki marta, 60 piksel oralig'ida.
          */}
          <h1 className="admin__title">{current?.label}</h1>
        </header>

        <div className="admin__body">
          <AnimatePresence mode="wait">
            <m.div
              key={active}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="admin__panel"
            >
              {current?.render()}
            </m.div>
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
