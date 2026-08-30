/**
 * banisa.uz'dan ulanish.
 *
 * Klinika banisa panelidagi tugmani bosgach shu yerga tushadi.
 * U ariza to'ldirmaydi, moderator qo'ng'irog'ini kutmaydi va
 * yo'nalishlarini qaytadan tanlamaydi — hammasi banisa'dan keladi.
 *
 * Ekran bitta ish qiladi: ko'chiriladigan ma'lumotni ko'rsatib,
 * tasdiqlatadi. Yagona savol — shahar, va u faqat avtomatik
 * topilmaganda so'raladi.
 */
import { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EASE } from '@/lib/motion';
import { Button, Field, Notice, Select } from '@/ui';
import type { City } from '@shared/types';

const BASE = import.meta.env.VITE_API_URL ?? '';

interface Preview {
  externalId: string;
  name: string;
  address: string;
  region: string | null;
  phones: string[];
  licenseNumber: string | null;
  cityId: number | null;
  operationCount: number;
  unknownOperations: number;
  alreadyLinked: boolean;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/web${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Xatolik yuz berdi');
  return data as T;
}

export function BanisaLink() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ticket = params.get('ticket') ?? '';

  const [preview, setPreview] = useState<Preview | null>(null);
  const [handoff, setHandoff] = useState('');
  const [cities, setCities] = useState<City[]>([]);
  const [cityId, setCityId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ticket) {
      setError('Havola to‘liq emas. banisa.uz panelidan qaytadan urinib ko‘ring.');
      return;
    }

    void fetch(`${BASE}/api/public/reference`)
      .then((r) => r.json())
      .then((d) => setCities(d.cities ?? []))
      .catch(() => {});

    call<{ preview: Preview; handoff: string }>('/link/banisa/preview', { ticket })
      .then(({ preview, handoff }) => {
        setPreview(preview);
        setHandoff(handoff);
        setCityId(preview.cityId);
      })
      .catch((err) => setError(err.message));
  }, [ticket]);

  const confirm = async () => {
    if (!cityId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call<{
        setupToken: string | null;
        accountExists: boolean;
      }>('/link/banisa/complete', { handoff, cityId });

      if (result.setupToken) {
        navigate(`/kabinet/parol?token=${result.setupToken}`, { replace: true });
      } else {
        // Hisob allaqachon bor — oddiy kirish sahifasiga
        navigate('/kabinet', { replace: true });
      }
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (error && !preview) {
    return (
      <Shell>
        <Notice tone="danger">{error}</Notice>
        <Button block variant="secondary" onClick={() => (window.location.href = '/kabinet')}>
          Kirish sahifasiga
        </Button>
      </Shell>
    );
  }

  if (!preview) {
    return (
      <Shell>
        <m.span
          className="bl__wait"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.3, repeat: Infinity }}
        >
          banisa.uz’dan ma’lumot olinmoqda…
        </m.span>
      </Shell>
    );
  }

  return (
    <Shell title={preview.name}>
      <span className="bl__from">banisa.uz’dan</span>

      <dl className="bl__facts">
        {preview.address && <Fact k="Manzil" v={preview.address} />}
        {preview.phones[0] && <Fact k="Telefon" v={preview.phones[0]} mono />}
        {preview.licenseNumber && <Fact k="Litsenziya" v={preview.licenseNumber} mono />}
        <Fact
          k="Yo‘nalishlar"
          v={`${preview.operationCount} ta`}
          note={
            preview.unknownOperations > 0
              ? `${preview.unknownOperations} tasi bizning katalogda yo‘q`
              : undefined
          }
        />
      </dl>

      <Notice tone="info">
        banisa.uz sizni allaqachon tasdiqlagan — litsenziyani qayta yuborish shart emas.
        Yo‘nalishlaringiz shu yerda ham avtomatik yangilanib turadi.
      </Notice>

      {/*
        Shahar faqat avtomatik topilmaganda so'raladi.
        Jimgina taxmin qilinmaydi: noto'g'ri shahar so'rovlarni
        butunlay to'xtatib qo'yadi va buni haftalab sezmaslik mumkin.
      */}
      {preview.cityId === null && (
        <Field
          label="Shahringiz"
          hint={preview.region ? `banisa.uz’da: "${preview.region}"` : undefined}
        >
          <Select
            value={cityId ?? ''}
            aria-label="Shahar"
            onChange={(e) => setCityId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Tanlang</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameUz}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {preview.alreadyLinked && (
        <Notice tone="warning">
          Bu klinika allaqachon ulangan. Davom etsangiz ma’lumot yangilanadi.
        </Notice>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      <Button block loading={busy} disabled={!cityId} onClick={confirm}>
        Bu meniki — davom etaman
      </Button>
    </Shell>
  );
}

function Fact({ k, v, note, mono }: { k: string; v: string; note?: string; mono?: boolean }) {
  return (
    <div className="bl__fact">
      <dt>{k}</dt>
      <dd className={mono ? 'num' : undefined}>
        {v}
        {note && <span className="bl__note">{note}</span>}
      </dd>
    </div>
  );
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="wa">
      <m.div
        className="wa__box"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
      >
        <span className="wa__mark">KlinikaTop</span>
        {title && <h1 className="wa__title">{title}</h1>}
        {children}
      </m.div>
    </div>
  );
}
