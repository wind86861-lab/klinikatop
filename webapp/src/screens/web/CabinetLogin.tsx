/**
 * Veb kabinetga kirish.
 *
 * IKKI ALOHIDA ESHIK, bitta forma:
 *   /kabinet      — klinika hisobi
 *   /admin/login  — platforma administratori
 *
 * Nega ajratilgan: bular butunlay boshqa odamlar. Klinika xodimi admin
 * degan so'zni ko'rishi shart emas, administrator esa klinikalar uchun
 * yozilgan yordam matnlari orasidan o'z joyini qidirmasligi kerak.
 * Server ham shu sahifani tekshiradi — noto'g'ri eshikdan kirilmaydi
 * (webAuth.ts, `LoginScope`).
 *
 * Kirishning o'zi ikki bosqichli: avval raqam va parol, keyin (yoqilgan
 * bo'lsa) ilovadagi kod. Ikkinchi bosqich alohida ekran sifatida
 * ko'rsatiladi — parol to'g'ri kelgani allaqachon ma'lum va odam nima
 * kutilayotganini aniq biladi.
 */
import { useState } from 'react';
import { m } from 'framer-motion';
import { setWebToken } from '@/lib/session';
import { EASE } from '@/lib/motion';
import { Button, Field, Input, Notice } from '@/ui';

const BASE = import.meta.env.VITE_API_URL ?? '';

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${BASE}/api/web${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Xatolik yuz berdi');
  return data;
}

export type LoginScope = 'clinic' | 'admin';

/** Har eshikning o'z matni. Bitta joyda — ikkalasi bir-biriga qarab yoziladi. */
const FACE: Record<
  LoginScope,
  { title: string; sub: string; hint: string; home: string }
> = {
  clinic: {
    title: 'Kabinetga kirish',
    sub: 'Klinika hisobingiz bilan',
    hint: 'Ariza qoldirgan raqamingiz',
    home: '/clinic',
  },
  admin: {
    title: 'Administrator paneli',
    sub: 'Platforma xodimlari uchun xizmat sahifasi',
    hint: 'Hisobingizga biriktirilgan raqam',
    home: '/admin',
  },
};

export function CabinetLogin({ scope = 'clinic' }: { scope?: LoginScope }) {
  const face = FACE[scope];
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  /** Parol to'g'ri kelgan, lekin 2FA kutilyapti */
  const [pending, setPending] = useState<string | null>(null);
  /** Kod qayerdan keladi: Telegram (bot) yoki autentifikatsiya ilovasi */
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'telegram'>('totp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Ichkariga kirish — TO'LIQ sahifa yuklash bilan.
   *
   * Yo'l bo'yicha o'tish (`navigate`) bu yerda ishlamaydi va ishlamagan
   * ham: token `localStorage` ga yoziladi, lekin ildiz komponent uni
   * faqat ilova ochilganda bir marta o'qiydi. Shuning uchun u sessiyani
   * hali ham yo'q deb bilib, odamni shu zahoti kirish sahifasiga qaytarib
   * yuborardi — parol to'g'ri, token joyida, lekin ekran o'zgarmasdi.
   * Odam sahifani qo'lda yangilagandagina ichkariga kirardi.
   *
   * To'liq yuklash bu tugunni butunlay yechadi: ilova yangi token bilan
   * noldan ko'tariladi.
   */
  const enter = () => {
    window.location.replace(face.home);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await post('/login', { login: login.trim(), password, scope });
      if (res.mfaRequired) {
        setMfaMethod(res.mfaMethod === 'telegram' ? 'telegram' : 'totp');
        setCode('');
        setPending(res.token);
      }
      else {
        setWebToken(res.token);
        enter();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await post('/mfa', { code: code.trim() }, pending);
      setWebToken(pending);
      enter();
    } catch (err: any) {
      // Kod eskirgan yoki urinishlar tugagan — sessiya yopildi, parolga qaytamiz
      if (/eskirgan|5 marta/.test(err?.message ?? '')) {
        setPending(null);
        setCode('');
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`wa wa--${scope}`}>
      <m.div
        className="wa__box"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
      >
        <span className="wa__mark">
          KlinikaTop
          {scope === 'admin' && <em className="wa__badge">xizmat</em>}
        </span>

        {pending === null ? (
          <>
            <h1 className="wa__title">{face.title}</h1>
            <p className="wa__sub">{face.sub}</p>

            <form
              className="wa__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (login.trim() && password) void submit();
              }}
            >
              <Field label="Telefon raqami" hint={face.hint}>
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="username"
                  placeholder="+998 __ ___ __ __"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                />
              </Field>

              <Field label="Parol">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>

              {error && <Notice tone="danger">{error}</Notice>}

              <Button block type="submit" loading={busy} disabled={!login.trim() || !password}>
                Kirish
              </Button>
            </form>

            {scope === 'clinic' ? (
              <p className="wa__fine">
                Hisobingiz yo‘qmi? <a href="/klinika">Klinika sifatida ariza qoldiring</a>
              </p>
            ) : (
              <p className="wa__fine">
                Klinika xodimimisiz? <a href="/kabinet">Kabinetga kiring</a>
              </p>
            )}
          </>
        ) : (
          <>
            <h1 className="wa__title">Tasdiqlash kodi</h1>
            <p className="wa__sub">
              {mfaMethod === 'telegram'
                ? 'Kod Telegram’ingizga — KlinikaTop botiga yuborildi. 6 xonali kodni kiriting (5 daqiqa amal qiladi).'
                : 'Autentifikatsiya ilovangizdagi 6 xonali kodni kiriting'}
            </p>

            <form
              className="wa__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim().length >= 6) void submitCode();
              }}
            >
              <Input
                className="wa__code num"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                aria-label="Tasdiqlash kodi"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />

              {error && <Notice tone="danger">{error}</Notice>}

              <Button block type="submit" loading={busy} disabled={code.trim().length < 6}>
                Tasdiqlash
              </Button>
            </form>

            <p className="wa__fine">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setPending(null);
                  setCode('');
                  setError(null);
                }}
              >
                ↩ Orqaga — qaytadan kirish
              </a>
            </p>
          </>
        )}
      </m.div>
    </div>
  );
}
