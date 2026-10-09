/**
 * 2-bo'lim: ochiluvchi video ramka — antigravity `landing-video-section`.
 *
 * Ularda GSAP:
 *   from(section, { scale: .5, ease: 'power2.out',
 *     scrollTrigger: { start: 'top bottom', end: 'top center', scrub: 1 } })
 * Bu yerda xuddi shu hisob qo'lda, kutubxonasiz: bo'lim tepasi ekran
 * pastida → 0.5, ekran o'rtasida → 1. `scrub: 1` — qiymat nishonga
 * silliq, ~1 soniyada yetib boradi.
 *
 * Kursor yorlig'i: ramkaga kirganda sakrab chiqadi (back.out), keyin
 * kechikib ergashadi (quickTo 0.35s). Bosilsa — to'liq YouTube video
 * modal oynada.
 */

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function intro() {
  const section = document.querySelector<HTMLElement>('[data-intro]');
  if (!section) return;
  const scaler = section.querySelector<HTMLElement>('[data-intro-scaler]')!;
  const frame = section.querySelector<HTMLElement>('[data-intro-frame]')!;
  const cursor = frame.querySelector<HTMLElement>('.intro__cursor')!;

  /* ── Kattalashish ── */
  // Telefonda 0.5 juda mayda — u yerda boshlang'ich o'lcham kattaroq
  const min = window.innerWidth < 720 ? 0.78 : 0.5;
  let current = min;
  let target = min;
  let raf = 0;

  const compute = () => {
    // Masshtab `scaler` da — o'lchov o'zgarmaydigan `section` dan olinadi
    const top = section.getBoundingClientRect().top;
    const vh = window.innerHeight;
    const p = Math.min(1, Math.max(0, (vh - top) / (vh / 2)));
    const eased = 1 - (1 - p) * (1 - p); // power2.out
    target = min + (1 - min) * eased;
  };
  const apply = () => scaler.style.setProperty('--s', current.toFixed(4));
  const tick = () => {
    current += (target - current) * 0.1;
    if (Math.abs(target - current) < 0.0005) current = target;
    apply();
    raf = current === target ? 0 : requestAnimationFrame(tick);
  };

  if (reduced) {
    current = 1;
    apply();
  } else {
    compute();
    current = target;
    apply();
    const onScroll = () => {
      compute();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
  }

  /* ── Kursor yorlig'i ── */
  if (window.matchMedia('(hover: hover)').matches) {
    let x = 0;
    let y = 0;
    let tx = 0;
    let ty = 0;
    let follow = 0;
    const place = () => {
      cursor.style.setProperty('--cx', `${x}px`);
      cursor.style.setProperty('--cy', `${y}px`);
    };
    const loop = () => {
      x += (tx - x) * 0.2;
      y += (ty - y) * 0.2;
      place();
      follow = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(loop) : 0;
    };
    // Ramka kattalashtirilgan bo'lishi mumkin — koordinata masshtabga bo'linadi
    const local = (e: PointerEvent) => {
      const r = frame.getBoundingClientRect();
      const k = r.width ? frame.offsetWidth / r.width : 1;
      return [(e.clientX - r.left) * k, (e.clientY - r.top) * k] as const;
    };
    frame.addEventListener('pointerenter', (e) => {
      if (!frame.classList.contains('can-play')) return;
      [x, y] = local(e);
      tx = x;
      ty = y;
      place();
      frame.classList.add('is-hover');
      // Sakrash tugagach joylashuv o'tishsiz — ergashishni JS silliqlaydi
      window.setTimeout(() => frame.classList.contains('is-hover') && frame.classList.add('is-following'), 300);
    });
    frame.addEventListener('pointermove', (e) => {
      if (!frame.classList.contains('is-hover')) return;
      [tx, ty] = local(e);
      if (!follow) follow = requestAnimationFrame(loop);
    });
    frame.addEventListener('pointerleave', () => frame.classList.remove('is-following', 'is-hover'));
  }

  /* ── Modal video ── */
  const dialog = section.querySelector<HTMLDialogElement>('[data-ytm]');
  const holder = section.querySelector<HTMLElement>('[data-ytm-frame]');
  const open = () => {
    const id = frame.dataset.youtube;
    if (!id || !dialog || !holder) return;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1`;
    iframe.title = frame.getAttribute('aria-label') ?? 'Video';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    holder.replaceChildren(iframe);
    frame.classList.remove('is-following', 'is-hover');
    dialog.showModal();
    frame.dispatchEvent(new CustomEvent('intro:modal', { detail: true }));
  };
  frame.addEventListener('click', open);
  frame.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  // Yopilganda iframe olib tashlanadi — ovoz fonda davom etmasin
  dialog?.addEventListener('close', () => {
    holder?.replaceChildren();
    frame.dispatchEvent(new CustomEvent('intro:modal', { detail: false }));
  });
  dialog?.querySelector('[data-ytm-close]')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

/** Takrorlanuvchi fon video — faqat ekranda ko'ringanda o'ynaydi */
export function loopVideo(video: HTMLVideoElement, url: string) {
  const frame = video.closest<HTMLElement>('[data-intro-frame]');
  video.src = url;
  /*
   * Video faqat haqiqatan O'YNAY BOSHLAGANDA ko'rsatiladi va xato
   * bersa yashiriladi: aks holda buzilgan yoki dekodlanmagan fayl
   * ramkani bo'sh oq to'rtburchakka aylantirardi. Ikkala holatda ham
   * ostida ilova namunasi turadi.
   */
  video.addEventListener('playing', () => frame?.classList.add('has-video'));
  video.addEventListener('error', () => frame?.classList.remove('has-video'));
  if (reduced) {
    video.preload = 'metadata';
    return;
  }
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) void video.play().catch(() => {});
    else video.pause();
  });
  io.observe(video);
}

/**
 * YouTube video — ramka ichida FON sifatida: ovozsiz, takrorlanuvchi,
 * boshqaruvsiz. Bosilganda o'sha video modal oynada ovozi bilan ochiladi.
 *
 * Tezlik uchun: iframe (~600 KB YouTube skripti) faqat ramka ekranga
 * YAQINLASHGANDA yaratiladi — bosh sahifa ochilishi sekinlashmaydi.
 * Ekrandan chiqsa pauza (YouTube iframe API `postMessage` orqali).
 */
export function youtubeBackground(frame: HTMLElement, id: string) {
  const holder = document.createElement('div');
  holder.className = 'intro__yt';
  holder.setAttribute('aria-hidden', 'true');
  frame.querySelector('.intro__video')?.after(holder);

  let iframe: HTMLIFrameElement | null = null;
  const command = (func: 'playVideo' | 'pauseVideo') =>
    iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');

  const create = () => {
    const params = new URLSearchParams({
      autoplay: '1',
      mute: '1',
      loop: '1',
      playlist: id, // bitta video takrorlanishi uchun YouTube shuni talab qiladi
      controls: '0',
      cc_load_policy: '0', // ovozsiz rejimda YouTube subtitrni o'zi yoqadi — fon videoda kerak emas
      disablekb: '1',
      fs: '0',
      iv_load_policy: '3',
      modestbranding: '1',
      playsinline: '1',
      rel: '0',
      enablejsapi: '1',
    });
    iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
    iframe.title = frame.getAttribute('aria-label') ?? 'Video';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.tabIndex = -1;
    /*
     * Ramka faqat video HAQIQATAN O'YNAY BOSHLAGANDA ko'rsatiladi
     * (YouTube API: playerState 1). Yuklanish sekin bo'lsa, video
     * joylashtirishga yopiq bo'lsa yoki xato bersa — qora quti yoki
     * "Video unavailable" o'rniga ilova namunasi turaveradi.
     */
    iframe.addEventListener('load', () =>
      iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'intro', channel: 'widget' }), '*'),
    );
    window.addEventListener('message', (e) => {
      if (e.source !== iframe?.contentWindow || typeof e.data !== 'string') return;
      try {
        const msg = JSON.parse(e.data) as { info?: { playerState?: number } };
        if (msg.info?.playerState === 1) frame.classList.add('has-yt');
      } catch {
        /* YouTube'dan boshqa xabar */
      }
    });
    holder.append(iframe);
  };

  if (reduced) return; // harakat kamaytirilgan — fon video yo'q, faqat bosib ko'rish
  let visible = false;
  /*
   * Kuzatuv sahifa TO'LIQ yuklangandan keyin boshlanadi va chegara 0:
   * ramka sahifa ochilishida ekran chetida turadi, oldinroq boshlansa
   * YouTube birinchi ekran bilan birga yuklanib, uni sekinlashtirardi.
   */
  const watch = () =>
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !iframe) create();
      else command(visible ? 'playVideo' : 'pauseVideo');
    }).observe(frame);
  if (document.readyState === 'complete') watch();
  else window.addEventListener('load', watch, { once: true });
  let modal = false;
  const sync = () => command(document.hidden || !visible || modal ? 'pauseVideo' : 'playVideo');
  document.addEventListener('visibilitychange', sync);
  // Modal ochiq paytda fon video to'xtaydi — ikki video bir vaqtda o'ynamasin
  frame.addEventListener('intro:modal', (e) => {
    modal = (e as CustomEvent<boolean>).detail;
    sync();
  });
}
