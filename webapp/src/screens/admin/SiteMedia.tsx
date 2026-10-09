/**
 * Admin: klinikatop.uz sahifalaridagi rasm va videolar.
 *
 * Sayt statik HTML, lekin media shu yerdan almashtiriladi — qayta
 * build kerak emas. Har joyning nomi, sahifadagi o'rni va tavsiya
 * o'lchami ko'rinadi. "Saytda ko'rish" tugmasi sahifani belgilangan
 * joylari bilan ochadi (`?preview=slots`).
 *
 * Rasm og'ir bo'lmasin: sahifa tezligi Google reytingiga ta'sir
 * qiladi. Shuning uchun 3 MB chegara va WEBP tavsiyasi.
 */
import { useMemo, useRef, useState } from 'react';
import { useApp } from '@/store/app';
import { api } from '@/lib/api';
import { Async, useResource } from '@/screens/clinic/shell';
import { Button, Input } from '@/ui';
import type { SiteMediaItem, SiteMediaSlot } from '@shared/siteMedia';
import { PageHeader, Tag } from './ui';

/** Server chegaralari bilan bir xil (services/siteMedia.ts) */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_VIDEO_BYTES = 8 * 1024 * 1024;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function SiteMedia() {
  const res = useResource(() => api.adminSiteMedia());

  return (
    <>
      <PageHeader
        title="Sayt media"
        description="klinikatop.uz sahifalaridagi rasm va videolar. Yuklangan zahoti saytda ko‘rinadi."
        actions={
          <>
            <a className="btn btn--secondary btn--sm" href="/?preview=slots" target="_blank" rel="noopener">
              Bosh sahifada ko‘rish
            </a>
            <a className="btn btn--secondary btn--sm" href="/klinikalar-uchun/?preview=slots" target="_blank" rel="noopener">
              Klinikalar sahifasi
            </a>
          </>
        }
      />
      <Async resource={res}>
        {(data) => <Groups slots={data.slots} items={data.items} onSaved={res.reload} />}
      </Async>
    </>
  );
}

/** Faqat rasm joylari — "Sayt" bo'limidagi "Rasmlar" tabi uchun */
export function SiteImages({ onChanged, brand = false }: { onChanged?: () => void; brand?: boolean }) {
  const res = useResource(() => api.adminSiteMedia());
  return (
    <Async resource={res}>
      {(data) => (
        <Groups
          slots={data.slots.filter((s) => s.kind === 'image' && (s.group === 'Brend') === brand)}
          items={data.items.filter((i) => i.kind === 'image')}
          onSaved={() => {
            res.reload();
            onChanged?.();
          }}
        />
      )}
    </Async>
  );
}

function Groups({
  slots,
  items,
  onSaved,
}: {
  slots: SiteMediaSlot[];
  items: SiteMediaItem[];
  onSaved: () => void;
}) {
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const groups = useMemo(() => {
    const map = new Map<string, SiteMediaSlot[]>();
    for (const s of slots) {
      const list = map.get(s.group);
      if (list) list.push(s);
      else map.set(s.group, [s]);
    }
    return [...map.entries()];
  }, [slots]);

  const filled = items.filter((i) => i.url || i.youtubeId).length;

  return (
    <div className="stack">
      <p className="tiny">
        To‘ldirilgan: {filled} / {slots.length}. Rasm yuklanmagan joyda sayt o‘zining namuna ko‘rinishini chiqaradi.
      </p>
      {groups.map(([group, list]) => (
        <section key={group} className="stack">
          <h2 className="section-title">
            {group} <span className="tiny">({list.length})</span>
          </h2>
          <div className="smedia">
            {list.map((slot) => (
              <SlotCard key={slot.key} slot={slot} item={byKey.get(slot.key)} onSaved={onSaved} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SlotCard({
  slot,
  item,
  onSaved,
}: {
  slot: SiteMediaSlot;
  item?: SiteMediaItem;
  onSaved: () => void;
}) {
  const { toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [altUz, setAltUz] = useState(item?.altUz ?? '');
  const [altRu, setAltRu] = useState(item?.altRu ?? '');
  const [youtube, setYoutube] = useState(item?.youtubeId ? `https://youtu.be/${item.youtubeId}` : '');
  const [busy, setBusy] = useState(false);

  const has = Boolean(item?.url || item?.youtubeId);
  const isVideo = slot.kind === 'video';

  const upload = async (file: File) => {
    if (file.size > (isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
      toast(
        isVideo ? 'Video 8 MB dan katta. Qisqaroq qiling yoki siqib yuklang.' : 'Rasm 3 MB dan katta. WEBP formatida siqib yuklang.',
        'error',
      );
      return;
    }
    setBusy(true);
    try {
      const dataBase64 = await readBase64(file);
      await api.setSiteMedia(slot.key, { mimeType: file.type, dataBase64, altUz, altRu });
      toast('Rasm yuklandi', 'success');
      onSaved();
    } catch (err: any) {
      toast(err?.message ?? 'Yuklanmadi', 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveVideo = async () => {
    setBusy(true);
    try {
      await api.setSiteMedia(slot.key, { youtubeUrl: youtube, altUz, altRu });
      toast('Video saqlandi', 'success');
      onSaved();
    } catch (err: any) {
      toast(err?.message ?? 'Saqlanmadi', 'error');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm(`"${slot.label}" olib tashlansinmi?`)) return;
    setBusy(true);
    try {
      await api.clearSiteMedia(slot.key);
      toast('Olib tashlandi', 'success');
      setYoutube('');
      onSaved();
    } catch (err: any) {
      toast(err?.message ?? 'Bajarilmadi', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="smedia__card">
      <div className={`smedia__preview ${slot.key === 'logo-light' ? 'is-dark' : ''}`}>
        {item?.url && isVideo && <video src={item.url} muted loop autoPlay playsInline />}
        {item?.url && !isVideo && <img src={item.url} alt={item.altUz} />}
        {item?.youtubeId && <img src={`https://i.ytimg.com/vi/${item.youtubeId}/hqdefault.jpg`} alt="" />}
        {!has && <span className="tiny">{slot.kind === 'image' ? 'Rasm yo‘q' : 'Video yo‘q'}</span>}
      </div>

      <div className="smedia__body">
        <div className="smedia__title">
          <b>{slot.label}</b>
          {has ? <Tag tone="good">bor</Tag> : <Tag tone="neutral">bo‘sh</Tag>}
        </div>
        <p className="tiny">{slot.where}</p>
        <p className="tiny">
          <code>{slot.key}</code>
          {slot.size && <> · {slot.size}</>}
        </p>

        {slot.kind === 'youtube' ? (
          <Input
            placeholder="https://youtu.be/..."
            value={youtube}
            onChange={(e) => setYoutube(e.target.value)}
            aria-label={`${slot.label} — YouTube havolasi`}
          />
        ) : (
          <div className="smedia__alts">
            <Input placeholder="Alt-matn (UZ)" value={altUz} onChange={(e) => setAltUz(e.target.value)} />
            <Input placeholder="Alt-matn (RU)" value={altRu} onChange={(e) => setAltRu(e.target.value)} />
          </div>
        )}

        <div className="smedia__actions">
          {slot.kind === 'youtube' ? (
            <Button size="sm" loading={busy} disabled={!youtube.trim()} onClick={saveVideo}>
              Saqlash
            </Button>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept={
                  isVideo
                    ? 'video/mp4,video/webm'
                    : slot.svg
                      ? 'image/svg+xml,image/png,image/webp,image/jpeg'
                      : 'image/webp,image/png,image/jpeg,image/avif'
                }
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <Button size="sm" loading={busy} onClick={() => fileRef.current?.click()}>
                {item?.url ? 'Almashtirish' : isVideo ? 'Video yuklash' : 'Rasm yuklash'}
              </Button>
            </>
          )}
          {has && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={clear}>
              Olib tashlash
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
