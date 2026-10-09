/**
 * Bosh sahifa bannerlari — slayder. Admin panelidan boshqariladi.
 *
 * Media: rasm, yuklangan video, YouTube yoki to'g'ridan-to'g'ri .mp4.
 * Rasm yo'q bo'lsa — sarlavha va izohli matnli banner (bo'sh joy yoki
 * "rasm yo'q" belgisi bemorga ko'rinmasin).
 *
 * Bir nechta banner bo'lsa:
 *   • barmoq bilan suriladi (scroll-snap — tabiiy, inertsiyali), keyingi
 *     banner chetdan ko'rinib turadi — surish mumkinligi o'zi aytiladi;
 *   • o'zi almashadi; pastdagi faol nuqta qancha vaqt qolganini to'ldirib
 *     ko'rsatadi;
 *   • odam tekkanda pauza — o'qiyotgan bannerni qo'ldan tortib olmaydi;
 *   • ekrandan chiqsa yoki ilova fonda bo'lsa — to'xtaydi;
 *   • "harakatni kamaytirish" yoqilgan bo'lsa — avtomatik almashmaydi.
 *
 * Video faqat FAOL va ko'rinib turgan slaydda o'ynaydi: qolganlari
 * pauzada, YouTube esa umuman yuklanmaydi (muqova ko'rinadi). Mobil
 * internetda bir vaqtda uchta video oqimi — bu trafik va batareya.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@/lib/router';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import type { AppBanner } from '@shared/types';

const BASE = import.meta.env.VITE_API_URL ?? '';
/** Bitta slayd qancha turadi */
const SLIDE_MS = 5500;
/** Video slaydga ko'proq vaqt — u endi boshlangan bo'ladi */
const VIDEO_SLIDE_MS = 9000;
/** Odam qo'lini olgandan keyin avtomatik almashish qachon qaytadi */
const RESUME_MS = 4000;

const src = (url: string) => (url.startsWith('/') ? `${BASE}${url}` : url);
const ytThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export function HomeBanners() {
  const [banners, setBanners] = useState<AppBanner[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .banners()
      .then((list) => alive && setBanners(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (banners.length === 0) return null;
  return <Slider banners={banners} />;
}

function Slider({ banners }: { banners: AppBanner[] }) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(true);
  const [holding, setHolding] = useState(false);
  /** Har almashishda yangilanadi — nuqtadagi progress qaytadan boshlansin */
  const [cycle, setCycle] = useState(0);
  const resumeTimer = useRef<number>();

  const many = banners.length > 1;
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const current = banners[active];
  const duration = current?.video ? VIDEO_SLIDE_MS : SLIDE_MS;
  const playing = many && !reduced && visible && !holding;

  /* Ekranda ko'rinadimi va ilova oldindami */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && !document.hidden), { threshold: 0.5 });
    io.observe(el);
    const onVis = () => setVisible(!document.hidden && el.getBoundingClientRect().bottom > 0);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  /** Bitta slayd qadami: kenglik + oraliq */
  const step = useCallback(() => {
    const track = trackRef.current;
    const first = track?.children[0] as HTMLElement | undefined;
    if (!track || !first) return 1;
    const gap = parseFloat(getComputedStyle(track).columnGap || '0') || 0;
    return first.offsetWidth + gap;
  }, []);

  const goTo = useCallback(
    (i: number, smooth = true) => {
      const track = trackRef.current;
      if (!track) return;
      track.scrollTo({ left: i * step(), behavior: smooth && !reduced ? 'smooth' : 'auto' });
    },
    [step, reduced],
  );

  /* Faol slayd — surish holatidan */
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !many) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = Math.max(0, Math.min(banners.length - 1, Math.round(track.scrollLeft / step())));
        setActive((prev) => {
          if (prev !== i) setCycle((c) => c + 1);
          return i;
        });
      });
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      track.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [many, banners.length, step]);

  /* Avtomatik almashish */
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => goTo((active + 1) % banners.length), duration);
    return () => window.clearTimeout(t);
  }, [playing, active, cycle, duration, banners.length, goTo]);

  /* Tegish — pauza; qo'l olingach biroz kutib davom etadi */
  const hold = () => {
    window.clearTimeout(resumeTimer.current);
    setHolding(true);
  };
  const release = () => {
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      setHolding(false);
      setCycle((c) => c + 1);
    }, RESUME_MS);
  };
  useEffect(() => () => window.clearTimeout(resumeTimer.current), []);

  const open = (b: AppBanner) => {
    haptic.press();
    if (b.link.startsWith('/')) navigate(b.link);
    else window.open(b.link, '_blank', 'noopener');
  };

  return (
    <div
      ref={rootRef}
      className={`hslider ${many ? 'hslider--many' : ''}`}
      onPointerDown={many ? hold : undefined}
      onPointerUp={many ? release : undefined}
      onPointerCancel={many ? release : undefined}
      onTouchStart={many ? hold : undefined}
      onTouchEnd={many ? release : undefined}
    >
      <div ref={trackRef} className="hslider__track" role="region" aria-roledescription="carousel">
        {banners.map((b, i) => (
          <BannerSlide key={b.id} banner={b} active={i === active} live={i === active && visible} onOpen={() => open(b)} />
        ))}
      </div>

      {many && (
        <div className="hslider__dots" role="tablist">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`${i + 1} / ${banners.length}`}
              className={`hslider__dot ${i === active ? 'is-active' : ''}`}
              onClick={() => {
                hold();
                goTo(i);
                release();
              }}
            >
              {i === active && (
                <span
                  key={cycle}
                  className="hslider__fill"
                  style={{
                    animationDuration: `${duration}ms`,
                    animationPlayState: playing ? 'running' : 'paused',
                  }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bitta slayd — admin oldindan ko'rishda ham shu ishlatiladi */
export function BannerSlide({
  banner,
  active,
  live,
  onOpen,
}: {
  banner: AppBanner;
  active: boolean;
  /** Faol va ekranda — video shu holatdagina o'ynaydi */
  live: boolean;
  onOpen: () => void;
}) {
  const { lang } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const title = lang === 'ru' ? banner.titleRu : banner.titleUz;
  const sub = lang === 'ru' ? banner.subRu : banner.subUz;
  const v = banner.video;
  const poster = banner.imageUrl ? src(banner.imageUrl) : v?.kind === 'youtube' ? ytThumb(v.id) : undefined;
  const hasMedia = Boolean(v || banner.imageUrl);
  const showText = !hasMedia || banner.overlay;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (live) {
      el.muted = true;
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, [live]);

  return (
    <div className={`hslide ${active ? 'is-active' : ''} ${hasMedia ? 'hslide--media' : ''}`}>
      {/* Media qatlami */}
      {v && v.kind !== 'youtube' ? (
        <video
          ref={videoRef}
          className="hslide__media"
          src={src(v.src)}
          poster={poster}
          muted
          loop
          playsInline
          preload={active ? 'auto' : 'metadata'}
          aria-hidden="true"
        />
      ) : v?.kind === 'youtube' ? (
        live ? (
          <iframe
            className="hslide__media hslide__yt"
            src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&mute=1&loop=1&playlist=${v.id}&controls=0&playsinline=1&modestbranding=1&rel=0&disablekb=1&iv_load_policy=3`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture"
            tabIndex={-1}
          />
        ) : (
          <img className="hslide__media" src={poster} alt="" loading="lazy" decoding="async" />
        )
      ) : banner.imageUrl ? (
        <img className="hslide__media" src={poster} alt={banner.overlay ? '' : title} loading="lazy" decoding="async" />
      ) : (
        <span className="hslide__art" aria-hidden="true">
          <span className="hslide__orb hslide__orb--a" />
          <span className="hslide__orb hslide__orb--b" />
          <span className="hslide__emoji">🧲</span>
        </span>
      )}

      {showText && (
        <span className={`hslide__text ${hasMedia ? 'hslide__text--overlay' : ''}`}>
          <span className="hslide__title">{title}</span>
          {sub && <span className="hslide__sub">{sub}</span>}
          <span className="hslide__cta" aria-hidden="true">
            →
          </span>
        </span>
      )}

      {/* Butun slayd bosiladi; iframe/video bosilishni o'ziga olib qolmasin */}
      <button type="button" className="hslide__hit" aria-label={title} onClick={onOpen} />
    </div>
  );
}
