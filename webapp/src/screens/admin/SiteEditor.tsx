/**
 * Admin: klinikatop.uz saytini boshqarish — matnlar, video, rasmlar, hamkorlar.
 *
 * Hammasi QAYTA BUILD'SIZ: server sahifani har safar shablon + bazadagi
 * o'zgarishlar bilan to'ldirib beradi (server/src/services/siteContent.ts).
 * Saqlash — darhol saytda. O'ng tomonda saytning jonli ko'rinishi, har
 * saqlashdan keyin o'zi yangilanadi.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/store/app';
import { api, type SitePartner, type SiteTextEntry } from '@/lib/api';
import { Async, useResource } from '@/screens/clinic/shell';
import { Button, Input, Segment, Skeleton, Textarea } from '@/ui';
import type { SiteMediaItem, SiteMediaSlot } from '@shared/siteMedia';
import { SiteImages } from './SiteMedia';
import { Empty, PageHeader, Tag } from './ui';

type Tab = 'video' | 'texts' | 'logo' | 'images' | 'partners';

const PREVIEW_PAGES = [
  { value: '/', label: 'Bosh sahifa' },
  { value: '/klinikalar-uchun/', label: 'Klinikalar' },
  { value: '/royxatdan-otish/', label: 'Ro‘yxatdan o‘tish' },
  { value: '/kirish/', label: 'Kirish' },
] as const;

export function SiteEditor() {
  const [tab, setTab] = useState<Tab>('video');
  const [page, setPage] = useState<string>('/');
  const [stamp, setStamp] = useState(Date.now());
  /** Har saqlashdan keyin jonli ko'rinish yangilanadi */
  const refresh = () => setStamp(Date.now());

  return (
    <div className="se">
      <div className="se__main stack">
        <PageHeader
          title="Sayt"
          description="klinikatop.uz matnlari, videosi, rasmlari va hamkorlari. Saqlangan zahoti saytda — qayta build kerak emas."
          actions={
            <a className="btn btn--secondary btn--sm" href={page} target="_blank" rel="noopener">
              Saytni ochish ↗
            </a>
          }
        />
        <Segment
          value={tab}
          onChange={setTab}
          options={[
            { value: 'video', label: 'Video' },
            { value: 'texts', label: 'Matnlar' },
            { value: 'logo', label: 'Logo' },
            { value: 'images', label: 'Rasmlar' },
            { value: 'partners', label: 'Hamkorlar' },
          ]}
        />
        {tab === 'video' && <VideoTab onChanged={refresh} />}
        {tab === 'texts' && <TextsTab onChanged={refresh} onPage={setPage} />}
        {tab === 'logo' && (
          <div className="stack">
            <p className="tiny">
              Logo saytning hamma joyida almashadi: menyu, bosh ekran, footer, 5-bosqichdagi radar va brauzer yorlig‘idagi belgi
              (favicon). SVG eng yaxshisi — har qanday o‘lchamda tiniq. Brauzer eski belgini bir muddat keshda saqlashi mumkin.
            </p>
            <SiteImages brand onChanged={refresh} />
          </div>
        )}
        {tab === 'images' && <SiteImages onChanged={refresh} />}
        {tab === 'partners' && <PartnersTab onChanged={refresh} />}
      </div>

      <aside className="se__preview" aria-label="Saytning jonli ko‘rinishi">
        <div className="se__previewBar">
          <select value={page} onChange={(e) => setPage(e.target.value)} aria-label="Sahifa">
            {PREVIEW_PAGES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <button type="button" className="link-btn" onClick={refresh}>
            Yangilash
          </button>
        </div>
        <iframe key={`${page}${stamp}`} src={`${page}?v=${stamp}`} title="Sayt ko‘rinishi" />
      </aside>
    </div>
  );
}

/* ═════════════════  Video (YouTube)  ═════════════════ */

/** YouTube havolasidan ID — serverdagi bilan bir xil qoida */
function youtubeId(raw: string): string | null {
  const s = raw.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return /^[A-Za-z0-9_-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* URL emas */
  }
  return null;
}

function VideoTab({ onChanged }: { onChanged: () => void }) {
  const res = useResource(() => api.adminSiteMedia());
  return (
    <Async resource={res} skeleton={<Skeleton h={260} />}>
      {(data) => {
        const slots = data.slots.filter((s) => s.kind === 'youtube');
        const byKey = new Map(data.items.map((i) => [i.key, i]));
        return (
          <div className="stack">
            <p className="tiny">
              YouTube havolasini qo‘ying — video saytdagi katta ramkada ovozsiz, takrorlanib o‘ynaydi, bosilganda ovozi bilan
              ochiladi. Video <b>16:9</b> bo‘lsin va YouTube’da <b>“Joylashtirishga ruxsat”</b> (Allow embedding) yoqilgan bo‘lsin.
            </p>
            {slots.map((slot) => (
              <VideoCard
                key={slot.key}
                slot={slot}
                item={byKey.get(slot.key)}
                onSaved={() => {
                  res.reload();
                  onChanged();
                }}
              />
            ))}
          </div>
        );
      }}
    </Async>
  );
}

function VideoCard({ slot, item, onSaved }: { slot: SiteMediaSlot; item?: SiteMediaItem; onSaved: () => void }) {
  const { toast } = useApp();
  const [url, setUrl] = useState(item?.youtubeId ? `https://youtu.be/${item.youtubeId}` : '');
  const [busy, setBusy] = useState(false);
  const id = youtubeId(url);
  const saved = item?.youtubeId ?? null;
  const dirty = (id ?? '') !== (saved ?? '');

  const save = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await api.setSiteMedia(slot.key, { youtubeUrl: url, altUz: '', altRu: '' });
      toast('Video saqlandi — saytda ko‘rinmoqda', 'success');
      onSaved();
    } catch (err: any) {
      toast(err?.message ?? 'Saqlanmadi', 'error');
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    if (!window.confirm('Video olib tashlansinmi?')) return;
    setBusy(true);
    try {
      await api.clearSiteMedia(slot.key);
      setUrl('');
      toast('Olib tashlandi', 'success');
      onSaved();
    } catch (err: any) {
      toast(err?.message ?? 'Bajarilmadi', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="se-card">
      <div className="se-card__head">
        <b>{slot.label}</b>
        {saved ? <Tag tone="good">saytda</Tag> : <Tag tone="neutral">bo‘sh</Tag>}
      </div>
      <p className="tiny">{slot.where}</p>
      <div className="se-video">
        {id ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}?rel=0`}
            title={slot.label}
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <span className="tiny">{url.trim() ? 'Havolani tanib bo‘lmadi — YouTube havolasini to‘liq qo‘ying' : 'Video yo‘q'}</span>
        )}
      </div>
      <Input placeholder="https://youtu.be/… yoki https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" loading={busy} disabled={!id || !dirty} onClick={save}>
          Saqlash
        </Button>
        {saved && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={clear}>
            Olib tashlash
          </Button>
        )}
      </div>
    </article>
  );
}

/* ═════════════════  Matnlar  ═════════════════ */

const PAGES = [
  { value: 'home', label: 'Bosh sahifa', path: '/' },
  { value: 'clinics', label: 'Klinikalar', path: '/klinikalar-uchun/' },
  { value: 'auth', label: 'Ro‘yxatdan o‘tish', path: '/royxatdan-otish/' },
  { value: 'login', label: 'Kirish', path: '/kirish/' },
  { value: 'common', label: 'Menyu va footer', path: '/' },
] as const;

const SECTION: Record<string, string> = {
  meta: 'Google (SEO)',
  hero: 'Bosh ekran',
  stats: 'Raqamlar',
  problem: 'Muammo va yechim',
  steps: '5 bosqich',
  video: 'Video',
  benefits: 'Bemorlarga afzalliklar',
  services: 'Xizmatlar',
  clinicsBand: 'Klinikalar bloki',
  trust: 'Ishonch',
  partners: 'Hamkorlar',
  faq: 'Savol-javob',
  cta: 'Yakuniy chaqiruv',
  why: 'Afzalliklar',
  flow: 'Jarayon',
  cabinet: 'Kabinet',
  pricing: 'Shartlar',
  phone: 'Telefon qadami',
  code: 'Kod qadami',
  password: 'Parol qadami',
  profile: 'Profil qadami',
  reset: 'Parolni tiklash',
  noSms: 'SMS ishlamaganda',
  nav: 'Menyu',
  common: 'Umumiy',
  footer: 'Footer',
  links: 'Havolalar',
};

const FIELD: Record<string, string> = {
  title: 'Sarlavha',
  description: 'Tavsif',
  eyebrow: 'Ustki yozuv',
  lead: 'Matn',
  text: 'Matn',
  sub: 'Izoh',
  primary: 'Asosiy tugma',
  secondary: 'Ikkinchi tugma',
  submit: 'Tugma',
  q: 'Savol',
  a: 'Javob',
  label: 'Maydon nomi',
  cta: 'Tugma',
  points: 'Band',
  items: 'Band',
  tags: 'Teg',
  chips: 'Belgi',
  before: 'Hozir',
  after: 'KlinikaTop bilan',
};

/** `home.faq.items.2.q` → "Savol-javob · 3-band · Savol" */
function labelFor(key: string): { section: string; field: string } {
  const parts = key.split('.');
  const rest = ['home', 'clinics', 'auth', 'login'].includes(parts[0]) ? parts.slice(1) : parts;
  const section = SECTION[rest[0]] ?? rest[0];
  const field = rest
    .slice(1)
    .map((p) => (/^\d+$/.test(p) ? `${Number(p) + 1}-` : FIELD[p] ?? p))
    .join(' ')
    .replace(/(\d+-) (\S)/g, '$1$2')
    .trim();
  return { section, field: field || section };
}

function TextsTab({ onChanged, onPage }: { onChanged: () => void; onPage: (path: string) => void }) {
  const [lang, setLang] = useState<'uz' | 'ru'>('uz');
  const [page, setPage] = useState<(typeof PAGES)[number]['value']>('home');
  const [query, setQuery] = useState('');
  const res = useResource(() => api.adminSiteTexts(lang), [lang]);

  useEffect(() => {
    const p = PAGES.find((x) => x.value === page)!.path;
    onPage(lang === 'ru' ? { '/': '/ru/', '/klinikalar-uchun/': '/ru/dlya-klinik/', '/royxatdan-otish/': '/ru/registratsiya/', '/kirish/': '/ru/vkhod/' }[p] ?? p : p);
  }, [page, lang, onPage]);

  return (
    <div className="stack">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Segment
          value={page}
          onChange={setPage}
          options={PAGES.map((p) => ({ value: p.value, label: p.label }))}
        />
        <Segment
          value={lang}
          onChange={setLang}
          options={[
            { value: 'uz', label: 'O‘zbekcha' },
            { value: 'ru', label: 'Русский' },
          ]}
        />
      </div>
      <Input placeholder="Matn bo‘yicha qidirish…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <Async resource={res} skeleton={<Skeleton h={320} />}>
        {(entries) => (
          <TextList
            entries={entries}
            page={page}
            query={query}
            lang={lang}
            onSaved={() => {
              res.reload();
              onChanged();
            }}
          />
        )}
      </Async>
    </div>
  );
}

function TextList({
  entries,
  page,
  query,
  lang,
  onSaved,
}: {
  entries: SiteTextEntry[];
  page: string;
  query: string;
  lang: 'uz' | 'ru';
  onSaved: () => void;
}) {
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = entries.filter(
      (e) =>
        (q ? true : e.page === page) &&
        (!q || e.default.toLowerCase().includes(q) || (e.value ?? '').toLowerCase().includes(q)),
    );
    const map = new Map<string, SiteTextEntry[]>();
    for (const e of list) {
      const { section } = labelFor(e.id);
      const g = map.get(section);
      if (g) g.push(e);
      else map.set(section, [e]);
    }
    return [...map.entries()];
  }, [entries, page, query]);

  const changed = entries.filter((e) => e.value !== null).length;
  if (!groups.length) return <Empty title="Matn topilmadi" hint="Boshqa so‘z bilan qidirib ko‘ring" />;

  return (
    <div className="stack">
      <p className="tiny">
        O‘zgartirilgan: {changed} ta. Matnni tahrirlab “Saqlash”ni bosing — saytda darhol almashadi. “Asl matn” — boshlang‘ich holiga
        qaytaradi.
      </p>
      {groups.map(([section, list]) => (
        <section key={section} className="stack">
          <h2 className="section-title">{section}</h2>
          {list.map((e) => (
            <TextRow key={`${lang}:${e.id}`} entry={e} lang={lang} onSaved={onSaved} />
          ))}
        </section>
      ))}
    </div>
  );
}

function TextRow({ entry, lang, onSaved }: { entry: SiteTextEntry; lang: 'uz' | 'ru'; onSaved: () => void }) {
  const { toast } = useApp();
  const current = entry.value ?? entry.default;
  const [text, setText] = useState(current);
  const [busy, setBusy] = useState(false);
  const dirty = text.trim() !== current.trim();
  const { field } = labelFor(entry.id);

  const save = async (value: string | null) => {
    setBusy(true);
    try {
      await api.setSiteText(lang, entry.id, value);
      if (value === null) setText(entry.default);
      toast(value === null ? 'Asl matn qaytarildi' : 'Saqlandi — saytda yangilandi', 'success');
      onSaved();
    } catch (err: any) {
      toast(err?.message ?? 'Saqlanmadi', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`se-text ${entry.value !== null ? 'is-changed' : ''}`}>
      <div className="se-text__head">
        <span className="tiny">
          <b>{field}</b>
          {entry.keys.length > 1 && ` · ${entry.keys.length} joyda ishlatiladi`}
        </span>
        {entry.value !== null && <Tag tone="warn">o‘zgartirilgan</Tag>}
      </div>
      <Textarea value={text} rows={Math.min(6, Math.max(1, Math.ceil(text.length / 70)))} onChange={(e) => setText(e.target.value)} />
      {(dirty || entry.value !== null) && (
        <div className="row" style={{ gap: 8 }}>
          {dirty && (
            <Button size="sm" loading={busy} disabled={!text.trim()} onClick={() => save(text)}>
              Saqlash
            </Button>
          )}
          {dirty && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setText(current)}>
              Bekor qilish
            </Button>
          )}
          {entry.value !== null && !dirty && (
            <Button size="sm" variant="ghost" loading={busy} onClick={() => save(null)}>
              Asl matn
            </Button>
          )}
        </div>
      )}
      {entry.value !== null && <p className="tiny se-text__orig">Asl: {entry.default}</p>}
    </div>
  );
}

/* ═════════════════  Hamkorlar  ═════════════════ */

const MAX_LOGO = 1024 * 1024;

function readFile(file: File): Promise<{ mimeType: string; dataBase64: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ mimeType: file.type, dataBase64: String(r.result).split(',')[1] ?? '' });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function PartnersTab({ onChanged }: { onChanged: () => void }) {
  const res = useResource(() => api.adminPartners());
  const reload = () => {
    res.reload();
    onChanged();
  };
  return (
    <div className="stack">
      <p className="tiny">
        Saytdagi “Platformadagi klinikalar” lentasi. Istalgancha hamkor qo‘shish mumkin; tartibni ↑ ↓ bilan o‘zgartiring. Hamkor
        bo‘lmasa bo‘lim saytda ko‘rinmaydi. Logo: shaffof PNG yoki SVG, 1 MB gacha.
      </p>
      <AddPartner onAdded={reload} />
      <Async resource={res} skeleton={<Skeleton h={200} />}>
        {(list) => (list.length ? <PartnerList list={list} onChanged={reload} /> : <Empty title="Hali hamkor yo‘q" />)}
      </Async>
    </div>
  );
}

function AddPartner({ onAdded }: { onAdded: () => void }) {
  const { toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  const add = async () => {
    if (!file || !name.trim()) return;
    if (file.size > MAX_LOGO) return toast('Logo 1 MB dan katta', 'error');
    setBusy(true);
    try {
      await api.addPartner({ name: name.trim(), url: url.trim() || null, ...(await readFile(file)) });
      setName('');
      setUrl('');
      setFile(null);
      toast('Hamkor qo‘shildi', 'success');
      onAdded();
    } catch (err: any) {
      toast(err?.message ?? 'Qo‘shilmadi', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="se-card se-partner-add">
      <b>Yangi hamkor</b>
      <div className="se-partner-add__row">
        <button type="button" className="se-logo" onClick={() => fileRef.current?.click()} aria-label="Logo tanlash">
          {preview ? <img src={preview} alt="" /> : <span className="tiny">Logo</span>}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/webp,image/jpeg,image/svg+xml"
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div className="stack" style={{ gap: 8, flex: 1 }}>
          <Input placeholder="Klinika nomi" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Sayt havolasi (ixtiyoriy)" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
      </div>
      <Button size="sm" loading={busy} disabled={!file || !name.trim()} onClick={add}>
        Qo‘shish
      </Button>
    </article>
  );
}

function PartnerList({ list, onChanged }: { list: SitePartner[]; onChanged: () => void }) {
  const { toast } = useApp();
  const move = async (i: number, d: -1 | 1) => {
    const ids = list.map((p) => p.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await api.reorderPartners(ids);
      onChanged();
    } catch (err: any) {
      toast(err?.message ?? 'Bajarilmadi', 'error');
    }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="tiny">Jami: {list.length} ta</span>
      {list.map((p, i) => (
        <PartnerRow key={p.id} p={p} first={i === 0} last={i === list.length - 1} onMove={(d) => move(i, d)} onChanged={onChanged} />
      ))}
    </div>
  );
}

function PartnerRow({
  p,
  first,
  last,
  onMove,
  onChanged,
}: {
  p: SitePartner;
  first: boolean;
  last: boolean;
  onMove: (d: -1 | 1) => void;
  onChanged: () => void;
}) {
  const { toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(p.name);
  const [url, setUrl] = useState(p.url ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== p.name || (url.trim() || null) !== p.url;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'success');
      onChanged();
    } catch (err: any) {
      toast(err?.message ?? 'Bajarilmadi', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="se-partner">
      <button type="button" className="se-logo" onClick={() => fileRef.current?.click()} title="Logoni almashtirish">
        <img src={p.logoUrl} alt={p.name} />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/webp,image/jpeg,image/svg+xml"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > MAX_LOGO) return toast('Logo 1 MB dan katta', 'error');
          const data = await readFile(f);
          void run(() => api.updatePartner(p.id, data), 'Logo almashtirildi');
        }}
      />
      <div className="se-partner__fields">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nomi" />
        <Input value={url} placeholder="Sayt havolasi (ixtiyoriy)" onChange={(e) => setUrl(e.target.value)} aria-label="Havola" />
      </div>
      <div className="se-partner__actions">
        {dirty && (
          <Button size="sm" loading={busy} onClick={() => run(() => api.updatePartner(p.id, { name: name.trim(), url: url.trim() || null }), 'Saqlandi')}>
            Saqlash
          </Button>
        )}
        <button type="button" className="se-icon" disabled={first || busy} onClick={() => onMove(-1)} aria-label="Yuqoriga">
          ↑
        </button>
        <button type="button" className="se-icon" disabled={last || busy} onClick={() => onMove(1)} aria-label="Pastga">
          ↓
        </button>
        <button
          type="button"
          className="se-icon is-danger"
          disabled={busy}
          onClick={() => window.confirm(`"${p.name}" o‘chirilsinmi?`) && run(() => api.deletePartner(p.id), 'O‘chirildi')}
          aria-label="O‘chirish"
        >
          ×
        </button>
      </div>
    </div>
  );
}
