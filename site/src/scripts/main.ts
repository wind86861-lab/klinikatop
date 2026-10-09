/**
 * Sahifa jonlantirishi.
 *
 * Har funksiya MUSTAQIL va xato yutadi: bittasi yiqilsa, qolganlari
 * ishlayveradi, kontent esa JS'siz ham to'liq ko'rinadi (site.css
 * boshidagi qoida). Og'ir qism — zarrachalar — sahifa chizilgandan
 * KEYIN, alohida bo'lak sifatida yuklanadi.
 */

import { intro, loopVideo, youtubeBackground } from './intro';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const lang = document.documentElement.lang === 'ru' ? 'ru' : 'uz';

function safe(name: string, fn: () => void) {
  try {
    fn();
  } catch (err) {
    console.warn(`[site] ${name}:`, err);
  }
}

/* ── Header: aylantirilganda shisha fon, pastga ketganda yashirinadi ── */
function header() {
  const el = document.querySelector<HTMLElement>('.header');
  if (!el) return;
  let lastY = window.scrollY;
  const update = () => {
    const y = window.scrollY;
    el.classList.toggle('is-scrolled', y > 12);
    const menuOpen = document.documentElement.classList.contains('menu-open');
    el.classList.toggle('is-hidden', !menuOpen && y > 600 && y > lastY + 4);
    if (y < lastY - 4 || y < 600) el.classList.remove('is-hidden');
    lastY = y;
  };
  update();
  window.addEventListener('scroll', update, { passive: true });

  const burger = document.querySelector<HTMLButtonElement>('.burger');
  const root = document.documentElement;
  burger?.addEventListener('click', () => {
    const open = root.classList.toggle('menu-open');
    burger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  });
  document.querySelectorAll('.mobile-menu a').forEach((a) =>
    a.addEventListener('click', () => {
      root.classList.remove('menu-open');
      burger?.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }),
  );
}

/* ── Sarlavhalarni so'zlarga bo'lish (birma-bir paydo bo'lishi uchun) ── */
function splitWords() {
  document.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
    let w = 0;
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const parts = (node.textContent ?? '').split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const part of parts) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            frag.append(part);
          } else {
            const span = document.createElement('span');
            span.className = 'split-word';
            span.style.setProperty('--w', String(w++));
            span.textContent = part;
            frag.append(span);
          }
        }
        node.parentNode?.replaceChild(frag, node);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const e = node as HTMLElement;
        // Belgilangan bo'lak butun turadi
        if (e.hasAttribute('data-nosplit')) {
          e.classList.add('split-word');
          e.style.setProperty('--w', String(w++));
          return;
        }
        [...e.childNodes].forEach(walk);
      }
    };
    [...el.childNodes].forEach(walk);
  });
}

/* ── Ko'rinishga kelganda paydo bo'lish ── */
function reveal() {
  const items = document.querySelectorAll<HTMLElement>('[data-reveal], [data-split]');
  if (reduced || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  items.forEach((el) => io.observe(el));
}

/* ── Jonli raqamlar va bot manzili ── */
function formatNum(n: number) {
  return n.toLocaleString('ru-RU').replace(/ |,/g, ' ');
}

function countUp(el: HTMLElement, to: number) {
  if (reduced || to < 4) {
    el.textContent = formatNum(to);
    return;
  }
  const dur = 1600;
  const t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 4);
    el.textContent = formatNum(Math.round(to * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function liveData() {
  let stats: Record<string, unknown> | null = null;
  try {
    const cached = sessionStorage.getItem('kt.stats');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.at < 60_000) stats = parsed.value;
    }
  } catch {
    /* saqlash yopiq — to'g'ridan-to'g'ri so'raymiz */
  }
  if (!stats) {
    try {
      const res = await fetch('/api/public/stats', { headers: { accept: 'application/json' } });
      if (res.ok) {
        stats = await res.json();
        try {
          sessionStorage.setItem('kt.stats', JSON.stringify({ at: Date.now(), value: stats }));
        } catch {
          /* ahamiyatsiz */
        }
      }
    } catch {
      /* tarmoq yo'q — statik qiymatlar qoladi */
    }
  }
  if (!stats) return;

  // Bot manzili: Telegram'dagi asosiy yo'l
  const bot = typeof stats.botUrl === 'string' ? stats.botUrl : null;
  if (bot) {
    document.querySelectorAll<HTMLAnchorElement>('a[data-bot]').forEach((a) => {
      a.href = bot;
      a.target = '_blank';
      a.rel = 'noopener';
    });
  }

  const nums = document.querySelectorAll<HTMLElement>('[data-stat]');
  const apply = (el: HTMLElement) => {
    const v = stats![el.dataset.stat!];
    if (typeof v === 'number' && v > 0) countUp(el, v);
  };
  if (!('IntersectionObserver' in window)) return nums.forEach(apply);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        apply(e.target as HTMLElement);
        io.unobserve(e.target);
      }
    }
  });
  nums.forEach((el) => io.observe(el));
}

/* ── Admin yuklagan media (rasm va YouTube) ── */
interface MediaItem {
  kind: 'image' | 'video' | 'youtube';
  url?: string;
  youtubeId?: string;
  altUz?: string;
  altRu?: string;
}

async function media() {
  const preview = /[?&]preview=slots\b/.test(location.search) || location.hash === '#slots';
  if (preview) document.documentElement.classList.add('slot-preview');

  /*
   * Media ro'yxati sahifaning O'ZIDA keladi (server `window.__KT_MEDIA__`
   * qo'yadi) — alohida so'rov va kechikish yo'q. Sahifa statik holda
   * berilgan bo'lsa (server ishlamay qolgan) — so'rab olinadi.
   */
  let items: Record<string, MediaItem> = (window as any).__KT_MEDIA__ ?? {};
  if (!(window as any).__KT_MEDIA__) {
    try {
      const res = await fetch('/api/public/site-media', { headers: { accept: 'application/json' } });
      if (res.ok) items = (await res.json()).items ?? {};
    } catch {
      return;
    }
  }

  document.querySelectorAll<HTMLElement>('[data-slot]').forEach((slot) => {
    const item = items[slot.dataset.slot!];
    if (!item || item.kind !== 'image' || !item.url) return;
    const img = new Image();
    img.className = 'slot__img';
    img.decoding = 'async';
    /*
     * Yashirin bo'limdagi rasm `lazy` bo'lsa HECH QACHON yuklanmaydi,
     * bo'lim esa rasm yuklanishini kutib yashirin turadi — o'zaro kutish.
     */
    const hidden = Boolean(slot.closest('[data-needs-media]'));
    img.loading = slot.dataset.eager || hidden ? 'eager' : 'lazy';
    img.alt = (lang === 'ru' ? item.altRu : item.altUz) || slot.dataset.alt || '';
    img.onload = () => {
      img.classList.add('is-loaded');
      slot.classList.add('has-media');
      slot.closest('[data-needs-media]')?.classList.add('has-media');
    };
    img.src = item.url;
    slot.append(img);
  });

  document.querySelectorAll<HTMLVideoElement>('video[data-loop]').forEach((video) => {
    const item = items[video.dataset.loop!];
    if (item?.kind === 'video' && item.url) loopVideo(video, item.url);
  });

  document.querySelectorAll<HTMLElement>('[data-video]').forEach((box) => {
    const item = items[box.dataset.video!];
    if (!item || item.kind !== 'youtube' || !item.youtubeId) return;
    box.dataset.youtube = item.youtubeId;
    const poster = box.querySelector<HTMLImageElement>('img[data-poster]');
    if (poster) {
      poster.src = `https://i.ytimg.com/vi/${item.youtubeId}/maxresdefault.jpg`;
      poster.hidden = false;
    }
    box.querySelector('.video__soon')?.remove();
    // Ramka endi bosiladigan — kursor yorlig'i va modal yoqiladi
    box.classList.add('can-play');
    box.setAttribute('role', 'button');
    box.tabIndex = 0;
    // Hero ramkasi: mp4 fon video yo'q bo'lsa — YouTube'ning o'zi fon bo'lib o'ynaydi
    if (box.matches('[data-intro-frame]') && !items['hero-loop']?.url) youtubeBackground(box, item.youtubeId);
    box.closest('[data-needs-media]')?.classList.add('has-media');
  });
}

/* ── Video: faqat bosilganda yuklanadi, kursor yorlig'i ergashadi ── */
function video() {
  document.querySelectorAll<HTMLElement>('.video').forEach((box) => {
    const cursor = box.querySelector<HTMLElement>('.video__cursor');
    if (cursor && window.matchMedia('(hover: hover)').matches) {
      let x = 0;
      let y = 0;
      let tx = 0;
      let ty = 0;
      let raf = 0;
      const loop = () => {
        x += (tx - x) * 0.2;
        y += (ty - y) * 0.2;
        cursor.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(loop) : 0;
      };
      box.addEventListener('pointermove', (e) => {
        const r = box.getBoundingClientRect();
        tx = e.clientX - r.left;
        ty = e.clientY - r.top;
        if (!raf) raf = requestAnimationFrame(loop);
      });
      box.addEventListener('pointerenter', (e) => {
        const r = box.getBoundingClientRect();
        x = tx = e.clientX - r.left;
        y = ty = e.clientY - r.top;
        cursor.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      });
    }

    const play = () => {
      const id = box.dataset.youtube;
      if (!id || box.classList.contains('is-playing')) return;
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1`;
      iframe.title = box.getAttribute('aria-label') ?? 'Video';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      box.append(iframe);
      box.classList.add('is-playing');
    };
    box.addEventListener('click', play);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        play();
      }
    });
  });
}

/* ── 5 bosqich: aylantirish sahnani boshqaradi ── */
function steps() {
  const root = document.querySelector<HTMLElement>('[data-steps]');
  if (!root) return;
  const track = root.querySelector<HTMLElement>('.steps__track')!;
  const scroller = root.querySelector<HTMLElement>('.steps__ol')!;
  const items = [...root.querySelectorAll<HTMLElement>('.step')];
  const scenes = [...root.querySelectorAll<HTMLElement>('.scene')];
  const dots = [...root.querySelectorAll<HTMLElement>('.steps__dots i')];
  const n = items.length;
  // Telefon — karusel (CSS bilan bir xil chegara), kompyuter — aylantirish hikoyasi
  const mobile = window.matchMedia('(max-width: 900px)');
  let active = -1;

  const setActive = (i: number) => {
    if (i === active) return;
    active = i;
    items.forEach((el, k) => {
      el.classList.toggle('is-active', k === i);
      el.classList.toggle('is-past', k < i);
      el.setAttribute('aria-current', k === i ? 'step' : 'false');
    });
    scenes.forEach((el, k) => {
      el.classList.toggle('is-active', k === i);
      el.classList.toggle('is-past', k < i);
    });
    dots.forEach((el, k) => el.classList.toggle('is-active', k === i));
    if (mobile.matches) root.style.setProperty('--p', (i / Math.max(1, n - 1)).toFixed(3));
  };

  /* ── Kompyuter: aylantirish sahnani boshqaradi ── */
  let ticking = false;
  const update = () => {
    ticking = false;
    if (mobile.matches) return;
    const rect = track.getBoundingClientRect();
    const total = track.offsetHeight - window.innerHeight;
    const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
    root.style.setProperty('--p', p.toFixed(4));
    setActive(Math.min(n - 1, Math.floor(p * n * 0.999)));
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  /* ── Telefon: kartalar suriladi, markazdagisi faol ── */
  const io = new IntersectionObserver(
    (entries) => {
      if (!mobile.matches) return;
      for (const e of entries) if (e.isIntersecting) setActive(items.indexOf(e.target as HTMLElement));
    },
    { root: scroller, threshold: 0.6 },
  );
  items.forEach((el) => io.observe(el));

  const showCard = (k: number) => {
    const card = items[k];
    scroller.scrollTo({
      left: card.offsetLeft - (scroller.clientWidth - card.clientWidth) / 2,
      behavior: reduced ? 'auto' : 'smooth',
    });
  };

  if (mobile.matches) setActive(0);
  else update();
  mobile.addEventListener('change', () => (mobile.matches ? setActive(Math.max(0, active)) : update()));

  // Bosqich (kompyuterda) yoki nuqta (telefonda) bosilsa — o'sha bosqichga
  items.forEach((el, k) =>
    el.addEventListener('click', () => {
      if (mobile.matches) return;
      const total = track.offsetHeight - window.innerHeight;
      const top = track.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top + total * ((k + 0.5) / n), behavior: reduced ? 'auto' : 'smooth' });
    }),
  );
  dots.forEach((d, k) => d.addEventListener('click', () => showCard(k)));
}

/* ── Klinikalar jarayoni: chiziq aylantirish bilan to'ladi ── */
function flowLine() {
  const flow = document.querySelector<HTMLElement>('.flow');
  if (!flow) return;
  if (reduced) return flow.style.setProperty('--fp', '1');
  const update = () => {
    const r = flow.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.3)));
    flow.style.setProperty('--fp', p.toFixed(3));
  };
  update();
  window.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
}

/* ── Kartalarda kursorga ergashuvchi yorug'lik ── */
function spotlight() {
  if (!window.matchMedia('(hover: hover)').matches) return;
  document.querySelectorAll<HTMLElement>('.card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });
}

/* ── Zarrachalar: birinchi chizishdan keyin, bo'sh vaqtda ── */
function fx() {
  const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas[data-fx]');
  if (!canvases.length) return;
  const run = () =>
    import('./particles').then(({ mountParticles }) => {
      canvases.forEach((c) => mountParticles(c, { tone: c.dataset.fx === 'dark' ? 'dark' : 'light' }));
    });
  const idle = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => void) | undefined;
  if (document.readyState === 'complete') {
    idle ? idle(run, { timeout: 1200 }) : setTimeout(run, 300);
  } else {
    window.addEventListener('load', () => (idle ? idle(run, { timeout: 1200 }) : setTimeout(run, 300)), { once: true });
  }
}

safe('header', header);
safe('split', splitWords);
safe('reveal', reveal);
safe('steps', steps);
safe('intro', intro);
safe('flow', flowLine);
safe('video', video);
safe('spotlight', spotlight);
safe('fx', fx);
void liveData().catch(() => {});
void media().catch(() => {});
