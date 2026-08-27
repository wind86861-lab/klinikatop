/**
 * Veb kabinetga kirish — klinika va admin uchun.
 *
 * Ikki bosqichli: avval email va parol, keyin (yoqilgan bo'lsa) ilovadagi
 * kod. Ikkinchi bosqich alohida ekran sifatida ko'rsatiladi — parol
 * to'g'ri kelgani allaqachon ma'lum va odam nima kutilayotganini aniq
 * biladi.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
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

export function CabinetLogin() {
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  /** Parol to'g'ri kelgan, lekin 2FA kutilyapti */
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = (token: string, level: string) => {
    setWebToken(token);
    navigate(level === 'full' ? '/admin' : '/clinic', { replace: true });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await post('/login', { login: login.trim(), password });
      if (res.mfaRequired) setPending(res.token);
      else enter(res.token, res.user.level);
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
      const me = await fetch(`${BASE}/api/web/me`, {
        headers: { authorization: `Bearer ${pending}` },
      }).then((r) => r.json());
      enter(pending, me.account.level);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wa">
      <motion.div
        className="wa__box"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
      >
        <span className="wa__mark">KlinikaTop</span>

        {pending === null ? (
          <>
            <h1 className="wa__title">Kabinetga kirish</h1>
            <p className="wa__sub">Klinika va administrator hisoblari uchun</p>

            <form
              className="wa__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (login.trim() && password) void submit();
              }}
            >
              <Field label="Telefon raqami" hint="Ariza qoldirgan raqamingiz">
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

            <p className="wa__fine">
              Hisobingiz yo‘qmi? <a href="/klinika">Klinika sifatida ariza qoldiring</a>
            </p>
          </>
        ) : (
          <>
            <h1 className="wa__title">Tasdiqlash kodi</h1>
            <p className="wa__sub">Autentifikatsiya ilovangizdagi 6 xonali kodni kiriting</p>

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
          </>
        )}
      </motion.div>
    </div>
  );
}
