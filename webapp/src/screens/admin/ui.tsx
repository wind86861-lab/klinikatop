/**
 * Admin panelning dizayn qatlami.
 *
 * Nima uchun alohida: bemor ilovasi telefon uchun — bitta ustun, katta
 * tugmalar, bitta ish. Admin esa kompyuterda o'nlab qatorni taqqoslaydi,
 * saralaydi, qidiradi. Bularga bir xil komponent xizmat qila olmaydi.
 *
 * Ilgari admin ham bemor kartalarini ishlatardi: 68 ta klinika 16 000
 * piksel bo'lib cho'zilar, ekranning o'ng yarmi bo'sh turardi va
 * qidiruv ham, saralash ham yo'q edi. Bu ro'yxat emas — varaqlash edi.
 *
 * Jadval TanStack Table ustiga qurilgan: saralash, qidiruv va sahifalash
 * uning ichida, bu yerda faqat ko'rinish. Uni o'zim yozmaganimning
 * sababi oddiy — bu hal qilingan masala, va u faqat admin bo'lagiga
 * tushadi (bemor ilovasi alohida yuklanadi).
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { m } from 'framer-motion';
import { Button, Input } from '@/ui';

/* ═════════════════  Sahifa sarlavhasi  ═════════════════ */

/**
 * Har bir bo'limning boshi: nima ekani, nechta ekani va asosiy amal.
 * Ilgari faqat nom turardi — sahifa nima uchun kerakligi tushunarsiz edi.
 */
export function PageHeader({
  title,
  description,
  count,
  actions,
}: {
  title: string;
  description?: string;
  count?: number;
  actions?: ReactNode;
}) {
  return (
    <div className="ah">
      <div className="ah__text">
        <div className="ah__titleRow">
          <h2 className="ah__title">{title}</h2>
          {count !== undefined && <span className="ah__count">{count}</span>}
        </div>
        {description && <p className="ah__desc">{description}</p>}
      </div>
      {actions && <div className="ah__actions">{actions}</div>}
    </div>
  );
}

/** Jadval ustidagi qator: qidiruv, filtrlar, o'ng tomonda amallar. */
export function Toolbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="atoolbar">
      <div className="atoolbar__main">{children}</div>
      {right && <div className="atoolbar__right">{right}</div>}
    </div>
  );
}

/* ═════════════════  Ko'rsatkich  ═════════════════ */

/**
 * Raqam yolg'iz o'zi hech narsa aytmaydi.
 *
 * "434 so'rov" — bu ko'pmi yoki kammi? Shuning uchun bu yerda izoh va
 * o'zgarish ham bor: admin raqamga emas, YO'NALISHGA qaraydi.
 */
export function Kpi({
  label,
  value,
  hint,
  delta,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  /** Oldingi davrga nisbatan foiz; musbat — o'sish */
  delta?: number | null;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  return (
    <div className={`kpi kpi--${tone}`}>
      <span className="kpi__label">{label}</span>
      <div className="kpi__valueRow">
        <span className="kpi__value">{value}</span>
        {delta != null && delta !== 0 && (
          <span className={`kpi__delta ${delta > 0 ? 'is-up' : 'is-down'}`}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}%
          </span>
        )}
      </div>
      {hint && <span className="kpi__hint">{hint}</span>}
    </div>
  );
}

/* ═════════════════  Bo'sh holat  ═════════════════ */

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="aempty">
      <p className="aempty__title">{title}</p>
      {hint && <p className="aempty__hint">{hint}</p>}
    </div>
  );
}

/* ═════════════════  Jadval  ═════════════════ */

export function DataTable<T>({
  data,
  columns,
  searchPlaceholder = 'Qidirish…',
  pageSize = 25,
  empty,
  toolbar,
  onRowClick,
}: {
  data: T[];
  columns: ColumnDef<T, any>[];
  searchPlaceholder?: string;
  pageSize?: number;
  empty?: ReactNode;
  /** Qidiruv qatoriga qo'shimcha boshqaruv (filtr tugmalari) */
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState('');

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();

  /* Sahifa raqamlari: ko'pi bilan 7 ta, o'rtasi joriy sahifa atrofida */
  const pages = useMemo(() => {
    const cur = table.getState().pagination.pageIndex;
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i);
    const out = new Set<number>([0, pageCount - 1, cur, cur - 1, cur + 1]);
    return [...out].filter((i) => i >= 0 && i < pageCount).sort((a, b) => a - b);
  }, [pageCount, table.getState().pagination.pageIndex]);

  return (
    <div className="stack">
      <Toolbar right={<span className="atoolbar__count">{total} ta</span>}>
        <Input
          className="atoolbar__search"
          value={search}
          placeholder={searchPlaceholder}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={searchPlaceholder}
        />
        {toolbar}
      </Toolbar>

      <div className="atable__wrap">
        <table className="atable">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      style={{ width: h.column.columnDef.size }}
                      className={sortable ? 'is-sortable' : undefined}
                      onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                    >
                      <span className="atable__th">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sortable && <i className="atable__sort">{dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕'}</i>}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((r) => (
              <m.tr
                key={r.id}
                className={onRowClick ? 'is-clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(r.original) : undefined}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
              >
                {r.getVisibleCells().map((c) => (
                  <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
                ))}
              </m.tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (empty ?? <Empty title="Hech narsa topilmadi" />)}
      </div>

      {pageCount > 1 && (
        <div className="apager">
          <Button
            size="sm"
            variant="ghost"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            ←
          </Button>
          {pages.map((p, i) => (
            <span key={p} className="apager__slot">
              {i > 0 && p - pages[i - 1] > 1 && <span className="apager__gap">…</span>}
              <button
                type="button"
                className={`apager__page ${p === table.getState().pagination.pageIndex ? 'is-active' : ''}`}
                onClick={() => table.setPageIndex(p)}
              >
                {p + 1}
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
            →
          </Button>
        </div>
      )}
    </div>
  );
}

/* ═════════════════  Kichik ko'rsatkichlar  ═════════════════ */

/** Jadval ichidagi holat belgisi — matn emas, rang bilan ham o'qiladi. */
export function Tag({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`atag atag--${tone}`}>{children}</span>;
}

/* ═════════════════  Qator menyusi  ═════════════════ */

/**
 * Qatordagi ikkilamchi amallar.
 *
 * Ularni yonma-yon qo'yish jadvalni buzadi: uzun yorliqlar ikki qatorga
 * sinadi, qator balandligi o'sadi va ko'z ustundan ustunga sakraydi.
 * Asosiy amal ko'rinib turadi, qolgani shu yerda.
 */
export function RowMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <span className="rowmenu">
      <button
        type="button"
        className="rowmenu__btn"
        aria-label="Amallar"
        aria-expanded={open}
        onClick={(e) => {
          // Qator bosilishi bilan chalkashmasin
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋯
      </button>
      {open && (
        <>
          {/* Tashqariga bosilsa yopiladi — menyuning o'zidan oldin turadi */}
          <button type="button" className="rowmenu__scrim" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} />
          <span className="rowmenu__list" role="menu">
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={`rowmenu__item ${it.danger ? 'is-danger' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.label}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}
