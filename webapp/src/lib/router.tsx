/**
 * Kichik marshrutlagich — `react-router-dom` o'rnida.
 *
 * ── Nega o'zimizniki ──
 *
 * Ilova `react-router-dom` dan atigi shu narsalarni ishlatadi:
 * `useNavigate`, `useLocation`, `useParams`, `useSearchParams`,
 * `Routes`/`Route`, `Navigate`, `NavLink`. Ichma-ich marshrut ham,
 * `Outlet` ham, ma'lumot yuklovchilari ham yo'q.
 *
 * YUTUQ QANCHA — o'lchangan, taxmin emas: 119,7 KB dan 112,3 KB ga
 * (siqilgan holda), ya'ni ~7 KB va bitta so'rov kam.
 *
 * Bu KUTILGANIDAN kam chiqdi va sababi bilib qo'yishga arziydi:
 * `vite.config.ts` da `manualChunks: { router: ['react-router-dom'] }`
 * turardi va o'sha 53 KB lik "router" bo'lagi aslida REACT NING
 * O'ZINI ham ichiga olgan edi (Vite bog'liqliklarni ham o'sha
 * bo'lakka tortadi). Ya'ni bo'lak nomiga qarab uning ichida nima
 * borligini hukm qilib bo'lmaydi.
 *
 * Shunga qaramay saqlanadi: 7 KB har sovuq ochilishda, bitta so'rov
 * kam, va tashqi bog'liqlik bittaga kamaydi. Buning evaziga ~330
 * qator o'z kodimiz — ilovaning marshrutlari tekis va sodda bo'lgani
 * uchun bu adolatli almashuv.
 *
 * ── Nega API AYNAN o'sha ──
 *
 * Nomlar va imzolar `react-router-dom` nikiga bir xil qoldirildi:
 * shunda 28 ta fayldagi o'zgarish faqat IMPORT QATORI bo'ladi.
 * Chaqiruv joylari tegilmagan bo'lsa, xatolik ham u yerdan
 * chiqmaydi — va kerak bo'lsa ortga qaytish ham xuddi shunday oson.
 *
 * ── Chegaralar (ataylab) ──
 *
 * Nisbiy manzil ("../x") QO'LLANMAYDI: ilovada bunday chaqiruv yo'q
 * (hammasi "/" bilan boshlanadi) va uni qo'llash marshrut daraxtini
 * talab qilardi. Nisbiy manzil berilsa — xato, jimgina noto'g'ri
 * joyga o'tishdan ko'ra shu yaxshiroq.
 */
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface Location {
  pathname: string;
  search: string;
  hash: string;
  /** `navigate(to, { state })` bergan qiymat */
  state: unknown;
}

interface RouterValue {
  location: Location;
  navigate: NavigateFn;
}

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

export type NavigateFn = {
  (to: string, options?: NavigateOptions): void;
  /** Orqaga: `navigate(-1)` */
  (delta: number): void;
};

const RouterContext = createContext<RouterValue | null>(null);
const ParamsContext = createContext<Record<string, string>>({});

/*
 * Holat `history.state.usr` ichida saqlanadi.
 *
 * To'g'ridan-to'g'ri `history.state` ga yozib bo'lmaydi: u yerda
 * brauzerning va boshqa kutubxonalarning o'z qiymatlari bo'lishi
 * mumkin. Kalit `react-router` dagi bilan bir xil — agar kimdir
 * ortga qaytmoqchi bo'lsa, saqlangan holat o'sha joyda turadi.
 */
const readLocation = (): Location => ({
  pathname: window.location.pathname,
  search: window.location.search,
  hash: window.location.hash,
  state: (window.history.state as { usr?: unknown } | null)?.usr ?? null,
});

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(readLocation);

  useEffect(() => {
    // Brauzerning "orqaga"/"oldinga" tugmalari va `navigate(-1)`
    const onPop = () => setLocation(readLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /*
   * `navigate` BARQAROR bo'lishi shart: u o'nlab `useEffect` va
   * `useCallback` ning bog'liqlik ro'yxatida turibdi. Har render'da
   * yangisi yasalsa, o'sha effektlar cheksiz qayta ishga tushardi.
   */
  const navigate = useCallback(((to: string | number, options?: NavigateOptions) => {
    if (typeof to === 'number') {
      window.history.go(to);
      return;
    }
    if (!to.startsWith('/')) {
      throw new Error(`Marshrut mutlaq bo‘lishi kerak: ${to}`);
    }
    window.history[options?.replace ? 'replaceState' : 'pushState'](
      { usr: options?.state ?? null },
      '',
      to,
    );
    setLocation(readLocation());
  }) as NavigateFn, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('Marshrutlagich <BrowserRouter> ichida bo‘lishi kerak');
  return ctx;
}

export const useLocation = (): Location => useRouter().location;
export const useNavigate = (): NavigateFn => useRouter().navigate;
/**
 * Marshrut o'zgaruvchilari.
 *
 * Qiymat `undefined` bo'lishi MUMKIN va turlar shuni aytib turadi:
 * komponent boshqa marshrutda ham render bo'lib qolsa, o'zgaruvchi
 * o'sha yerda bo'lmaydi. `react-router` da ham xuddi shunday.
 */
export function useParams<
  T extends Record<string, string | undefined> = Record<string, string>,
>(): Readonly<Partial<T>> {
  return useContext(ParamsContext) as Readonly<Partial<T>>;
}

export function useSearchParams(): [URLSearchParams, (next: Record<string, string>) => void] {
  const { location, navigate } = useRouter();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const set = useCallback(
    (next: Record<string, string>) => {
      const query = new URLSearchParams(next).toString();
      navigate(query ? `${location.pathname}?${query}` : location.pathname, { replace: true });
    },
    [location.pathname, navigate],
  );

  return [params, set];
}

/* ─────────────────────────────  Moslash  ───────────────────────────── */

/** Yakuniy "/" ahamiyatsiz: "/clinic" va "/clinic/" bir xil sahifa. */
const segmentsOf = (path: string) => path.replace(/\/+$/, '').split('/').filter(Boolean);

/**
 * Manzil naqshga mos keladimi; mos kelsa — o'zgaruvchilar.
 *
 * Bo'laklar soni TENG bo'lishi shart (oxirida `*` bo'lmasa). Shu
 * sababli "/clinic" naqshi "/clinic/requests" ni yutib yubormaydi —
 * `react-router` da ham shunday.
 */
function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === '*') return { '*': pathname.replace(/^\//, '') };

  const pat = segmentsOf(pattern);
  const url = segmentsOf(pathname);
  const splat = pat[pat.length - 1] === '*';

  if (splat ? url.length < pat.length - 1 : url.length !== pat.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < pat.length; i++) {
    const p = pat[i];
    if (p === '*') {
      params['*'] = url.slice(i).join('/');
      return params;
    }
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(url[i]);
      continue;
    }
    if (p !== url[i]) return null;
  }

  return params;
}

/**
 * Naqshning aniqlik bahosi — `react-router` dagi tartiblash qoidasi.
 *
 * Yozilish tartibiga tayanib bo'lmaydi: "/request/new" va
 * "/request/:id" ikkalasi ham mos keladi va ANIQROG'I yutishi kerak,
 * fayldagi o'rni qanday bo'lishidan qat'i nazar.
 */
function scoreOf(pattern: string): number {
  if (pattern === '*') return -1;
  return segmentsOf(pattern).reduce(
    (sum, seg) => sum + (seg === '*' ? -2 : seg.startsWith(':') ? 3 : 10),
    0,
  );
}

/* ─────────────────────────────  Komponentlar  ───────────────────────────── */

export interface RouteProps {
  path: string;
  element: ReactElement | null;
}

/** Belgi komponenti: hech qachon o'zi render bo'lmaydi, `Routes` uni o'qiydi. */
export function Route(_props: RouteProps): ReactElement | null {
  return null;
}

/** `<Routes>` ichidagi `<Route>` larni yig'adi, fragmentlarni ochib. */
function collect(children: ReactNode, out: ReactElement<RouteProps>[]) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Route) {
      out.push(child as ReactElement<RouteProps>);
      return;
    }
    // <>...</> ichiga o'ralgan marshrutlar ham topilsin
    const props = child.props as { children?: ReactNode };
    if (props?.children) collect(props.children, out);
  });
}

export function Routes({
  children,
  location: locationProp,
}: {
  children: ReactNode;
  /**
   * Chiqish animatsiyasi uchun: `AnimatePresence` eski ekranni
   * ko'rsatib turgan paytda manzil allaqachon yangi bo'ladi.
   */
  location?: Location;
}) {
  const ctx = useRouter();
  const location = locationProp ?? ctx.location;

  const routes: ReactElement<RouteProps>[] = [];
  collect(children, routes);

  let best: ReactElement<RouteProps> | null = null;
  let bestScore = -Infinity;
  let bestParams: Record<string, string> = {};

  for (const route of routes) {
    const params = matchPath(route.props.path, location.pathname);
    if (!params) continue;
    const score = scoreOf(route.props.path);
    if (score > bestScore) {
      best = route;
      bestScore = score;
      bestParams = params;
    }
  }

  if (!best) return null;

  return <ParamsContext.Provider value={bestParams}>{best.props.element}</ParamsContext.Provider>;
}

/**
 * Manzil havolasi — faol holatini o'zi biladi.
 *
 * Haqiqiy `<a href>`: sichqonchaning o'rta tugmasi va "yangi
 * oynada ochish" ishlashi kerak, shuning uchun bosish faqat ODDIY
 * chap bosishda to'xtatiladi.
 */
export function NavLink({
  to,
  end,
  className,
  onClick,
  children,
}: {
  to: string;
  /** `true` — faqat AYNAN shu manzilda faol; aks holda ichki sahifalarda ham */
  end?: boolean;
  className?: string | ((state: { isActive: boolean }) => string);
  onClick?: () => void;
  children: ReactNode;
}) {
  const { location, navigate } = useRouter();

  const here = location.pathname.replace(/\/+$/, '') || '/';
  const there = to.replace(/\/+$/, '') || '/';
  const isActive = end ? here === there : here === there || here.startsWith(`${there}/`);

  return (
    <a
      href={to}
      className={typeof className === 'function' ? className({ isActive }) : className}
      aria-current={isActive ? 'page' : undefined}
      onClick={(e) => {
        // Ctrl/Cmd/Shift bilan bosilgan havola brauzerga qoldiriladi
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** Render paytida yo'naltirish. */
export function Navigate({
  to,
  replace,
  state,
}: {
  to: string;
  replace?: boolean;
  state?: unknown;
}) {
  const navigate = useNavigate();

  /*
   * Yo'naltirish EFFEKTDA: render paytida holatni o'zgartirish
   * React'da taqiqlangan va "Cannot update during render" xatosini
   * beradi.
   */
  useEffect(() => {
    navigate(to, { replace, state });
  }, [to, replace, state, navigate]);

  return null;
}
