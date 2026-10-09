/**
 * Bemor ilovasi bosh sahifasidagi bannerlar.
 *
 * Har bir banner: rasm (ixtiyoriy), sarlavha va izoh (uz/ru), havola,
 * faol/nofaol, tartib. Rasm yo'q bo'lsa bemor matnli bannerni ko'radi —
 * ya'ni banner rasm tayyor bo'lishini kutmasdan ishlay boshlaydi.
 *
 * Saqlash darhol: deploy kerak emas. Bemor yangi bannerni bosh
 * sahifani qayta ochganda ko'radi.
 */
import { useEffect, useState } from 'react';
import { useApp } from '@/store/app';
import { api, type AppBannerBody } from '@/lib/api';
import { haptic } from '@/lib/telegram';
import { Button, Card, Chip, Field, Input, Notice, Select, Skeleton } from '@/ui';
import { PageHeader } from './ui';
import { BannerSlide } from '@/components/HomeBanners';
import type { AppBanner } from '@shared/types';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_VIDEO_BYTES = 8 * 1024 * 1024;

/** Bannerni bosganda qayerga — ko'p ishlatiladiganlari ro'yxatdan */
const LINKS: { value: string; label: string }[] = [
  { value: '/new?kind=lab', label: 'Tahlil / MRT, MSKT — tekshiruv tanlash' },
  { value: '/new?kind=operation', label: 'Operatsiya so‘rovi' },
  { value: '/new?kind=referral', label: 'Laboratoriya so‘rovi (yo‘llanma)' },
  { value: '/new', label: 'Yangi so‘rov (boshidan)' },
  { value: '/requests', label: 'Mening so‘rovlarim' },
];
const CUSTOM = '__custom';

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

export function AppBanners() {
  const { toast } = useApp();
  const [list, setList] = useState<AppBanner[] | null>(null);

  const load = () =>
    api
      .appBanners()
      .then(setList)
      .catch((err) => toast(err?.message ?? 'Yuklab bo‘lmadi', 'error'));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    try {
      await api.createAppBanner({ titleUz: 'Yangi banner', link: '/new', active: false });
      await load();
    } catch (err: any) {
      toast(err?.message ?? 'Xatolik', 'error');
    }
  };

  const move = async (i: number, d: number) => {
    if (!list) return;
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setList(next);
    try {
      setList(await api.reorderAppBanners(next.map((b) => b.id)));
    } catch (err: any) {
      toast(err?.message ?? 'Xatolik', 'error');
      void load();
    }
  };

  return (
    <>
      <PageHeader
        title="Ilova bannerlari"
        description="Bemor ilovasining bosh sahifasida, «Yangi so‘rov yuborish» tugmasi ostida chiqadi. Bir nechta faol banner bo‘lsa — avtomatik almashadigan slayder. Media yo‘q bo‘lsa — matnli banner."
        actions={
          <Button size="sm" onClick={add}>
            + Banner qo‘shish
          </Button>
        }
      />
      <Notice>
        Tavsiya etilgan o‘lcham: <b>1200×500</b> (12:5). Rasm: JPG/PNG/WEBP, 2 MB gacha. Video: MP4/WEBM, 8 MB gacha
        yoki YouTube / .mp4 havolasi. Muhim matnni chetga qo‘ymang — telefonda burchaklar yumaloqlanadi.
      </Notice>

      {list === null ? (
        <Skeleton h={260} />
      ) : list.length === 0 ? (
        <p className="muted">Banner yo‘q.</p>
      ) : (
        <div className="stack">
          {list.map((b, i) => (
            <BannerEditor
              key={b.id}
              banner={b}
              first={i === 0}
              last={i === list.length - 1}
              onMove={(d) => move(i, d)}
              onSaved={(nb) => setList((l) => l?.map((x) => (x.id === nb.id ? nb : x)) ?? null)}
              onDeleted={() => setList((l) => l?.filter((x) => x.id !== b.id) ?? null)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function BannerEditor({
  banner,
  first,
  last,
  onMove,
  onSaved,
  onDeleted,
}: {
  banner: AppBanner;
  first: boolean;
  last: boolean;
  onMove: (d: number) => void;
  onSaved: (b: AppBanner) => void;
  onDeleted: () => void;
}) {
  const { toast } = useApp();
  const [form, setForm] = useState({
    titleUz: banner.titleUz,
    titleRu: banner.titleRu,
    subUz: banner.subUz ?? '',
    subRu: banner.subRu ?? '',
    link: banner.link,
  });
  const preset = LINKS.some((l) => l.value === form.link);
  const [custom, setCustom] = useState(!preset);
  const [busy, setBusy] = useState(false);
  const [videoLink, setVideoLink] = useState('');

  const dirty =
    form.titleUz !== banner.titleUz ||
    form.titleRu !== banner.titleRu ||
    form.subUz !== (banner.subUz ?? '') ||
    form.subRu !== (banner.subRu ?? '') ||
    form.link !== banner.link;

  const save = async (extra: AppBannerBody = {}, okText = 'Saqlandi'): Promise<boolean> => {
    setBusy(true);
    try {
      const nb = await api.updateAppBanner(banner.id, {
        titleUz: form.titleUz,
        titleRu: form.titleRu,
        subUz: form.subUz || null,
        subRu: form.subRu || null,
        link: form.link,
        ...extra,
      });
      onSaved(nb);
      haptic.success();
      toast(okText, 'success');
      return true;
    } catch (err: any) {
      toast(err?.message ?? 'Saqlab bo‘lmadi', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const pickVideo = async (file: File | undefined) => {
    if (!file) return;
    if (!['video/mp4', 'video/webm'].includes(file.type)) {
      toast('Video MP4 yoki WEBM bo‘lsin', 'error');
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      toast('Video 8 MB dan katta — qisqaroq yoki 720p qilib siqing', 'error');
      return;
    }
    await save({ videoMimeType: file.type, videoBase64: await readBase64(file) }, 'Video yuklandi');
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('Rasm JPG, PNG yoki WEBP bo‘lsin', 'error');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast('Rasm 2 MB dan katta — kichikroq qiling', 'error');
      return;
    }
    await save({ mimeType: file.type, dataBase64: await readBase64(file) }, 'Rasm yuklandi');
  };

  const remove = async () => {
    if (!window.confirm('Banner o‘chirilsinmi?')) return;
    try {
      await api.deleteAppBanner(banner.id);
      onDeleted();
    } catch (err: any) {
      toast(err?.message ?? 'O‘chirib bo‘lmadi', 'error');
    }
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card className={`abanner ${banner.active ? '' : 'is-off'}`}>
      <div className="abanner__preview">
        {/* Bemor ko'radigan slaydning o'zi — kiritilayotgan matn bilan */}
        <BannerSlide
          banner={{ ...banner, titleUz: form.titleUz, subUz: form.subUz || null }}
          active
          live
          onOpen={() => undefined}
        />

        <div className="abanner__media">
          <span className="tiny muted">Rasm {banner.video ? '(videoga muqova)' : ''}</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className={`btn btn--secondary btn--sm ${busy ? 'is-busy' : ''}`}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  void pickImage(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {banner.imageUrl ? 'Rasmni almashtirish' : 'Rasm yuklash'}
            </label>
            {banner.imageUrl && (
              <Button size="sm" variant="ghost" onClick={() => save({ removeImage: true }, 'Rasm olib tashlandi')}>
                Olib tashlash
              </Button>
            )}
          </div>

          <span className="tiny muted">
            Video{' '}
            {banner.video
              ? banner.video.kind === 'youtube'
                ? '— YouTube'
                : banner.video.kind === 'file'
                  ? '— yuklangan fayl'
                  : '— havola'
              : '— yo‘q'}
          </span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className={`btn btn--secondary btn--sm ${busy ? 'is-busy' : ''}`}>
              <input
                type="file"
                accept="video/mp4,video/webm"
                hidden
                onChange={(e) => {
                  void pickVideo(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              Video fayl yuklash
            </label>
            {banner.video && (
              <Button size="sm" variant="ghost" onClick={() => save({ removeVideo: true }, 'Video olib tashlandi')}>
                Videoni olib tashlash
              </Button>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Input
              placeholder="YouTube yoki https://… .mp4 havolasi"
              value={videoLink}
              maxLength={500}
              onChange={(e) => setVideoLink(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!videoLink.trim()}
              loading={busy}
              onClick={async () => {
                if (await save({ videoLink: videoLink.trim() }, 'Video havolasi saqlandi')) setVideoLink('');
              }}
            >
              Qo‘yish
            </Button>
          </div>
          <span className="tiny muted">
            Video ovozsiz, avtomatik va aylanib o‘ynaydi. Fayl: MP4/WEBM, 8 MB gacha (5–15 soniya, 720p tavsiya).
          </span>
        </div>
      </div>

      <div className="abanner__form">
        <div className="abanner__grid">
          <Field label="Sarlavha (UZ)">
            <Input value={form.titleUz} maxLength={80} onChange={set('titleUz')} />
          </Field>
          <Field label="Sarlavha (RU)">
            <Input value={form.titleRu} maxLength={80} onChange={set('titleRu')} />
          </Field>
          <Field label="Izoh (UZ)">
            <Input value={form.subUz} maxLength={140} onChange={set('subUz')} />
          </Field>
          <Field label="Izoh (RU)">
            <Input value={form.subRu} maxLength={140} onChange={set('subRu')} />
          </Field>
        </div>
        <p className="tiny muted">
          Rasm yoki video bo‘lsa matn faqat «Matn media ustida» yoqilganda chiqadi; aks holda sarlavha rasm tavsifi
          (alt) bo‘lib qoladi.
        </p>

        <Field label="Bosilganda qayerga">
          <Select
            value={custom ? CUSTOM : form.link}
            onChange={(e) => {
              if (e.target.value === CUSTOM) {
                setCustom(true);
                return;
              }
              setCustom(false);
              setForm((f) => ({ ...f, link: e.target.value }));
            }}
          >
            {LINKS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
            <option value={CUSTOM}>Boshqa manzil…</option>
          </Select>
        </Field>
        {custom && (
          <Field label="Manzil" hint="Ilova ichidagi yo‘l (/new?kind=lab) yoki https:// havola">
            <Input value={form.link} maxLength={300} onChange={set('link')} />
          </Field>
        )}

        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip size="sm" active={banner.active} onClick={() => save({ active: !banner.active }, banner.active ? 'Banner o‘chirildi' : 'Banner yoqildi')}>
            {banner.active ? 'Faol' : 'Nofaol'}
          </Chip>
          {(banner.imageUrl || banner.video) && (
            <Chip size="sm" active={banner.overlay} onClick={() => save({ overlay: !banner.overlay }, 'Saqlandi')}>
              {banner.overlay ? 'Matn media ustida' : 'Matnsiz (faqat media)'}
            </Chip>
          )}
          <Button size="sm" variant="ghost" disabled={first} onClick={() => onMove(-1)}>
            ↑
          </Button>
          <Button size="sm" variant="ghost" disabled={last} onClick={() => onMove(1)}>
            ↓
          </Button>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="danger" onClick={remove}>
            O‘chirish
          </Button>
          <Button size="sm" loading={busy} disabled={!dirty} onClick={() => save()}>
            Saqlash
          </Button>
        </div>
      </div>
    </Card>
  );
}
