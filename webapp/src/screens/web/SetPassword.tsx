/**
 * Birinchi kirish — parol o'rnatish.
 *
 * Klinikaga moderator bir martalik havola yuboradi. Parolni klinikaning
 * o'zi qo'yadi: vaqtinchalik parol berilsa, u telefonda aytilgan yoki
 * yozishmada qolgan bo'lardi va o'zgartirilmay yillab ishlatilardi.
 */
import { useState } from 'react';
import { m } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EASE } from '@/lib/motion';
import { Button, Field, Input, Notice } from '@/ui';

const BASE = import.meta.env.VITE_API_URL ?? '';

export function SetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Parol o'rnatilgach hisob DARAJASI ma'lum bo'ladi va odamni o'z
   * kirish sahifasiga yuboramiz: admin va klinika alohida eshikdan
   * kiradi, shuning uchun "Kirish sahifasiga" tugmasi ikki xil joyga
   * olib boradi.
   */
  const [level, setLevel] = useState<string | null>(null);
  const done = level !== null;

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = repeat.length > 0 && repeat !== password;
  const valid = password.length >= 10 && repeat === password;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/web/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Xatolik yuz berdi');
      setLevel(data?.level ?? 'clinic_admin');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="wa">
        <div className="wa__box">
          <span className="wa__mark">KlinikaTop</span>
          <Notice tone="danger">Havola to‘liq emas. Moderator yuborgan manzilni to‘liq oching.</Notice>
        </div>
      </div>
    );
  }

  return (
    <div className="wa">
      <m.div
        className="wa__box"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
      >
        <span className="wa__mark">KlinikaTop</span>

        {done ? (
          <>
            <h1 className="wa__title">Parol o‘rnatildi</h1>
            <p className="wa__sub">Endi kabinetingizga kira olasiz.</p>
            <Button
              block
              onClick={() => navigate(level === 'full' ? '/admin/login' : '/kabinet', { replace: true })}
            >
              Kirish sahifasiga
            </Button>
          </>
        ) : (
          <>
            <h1 className="wa__title">Parolingizni qo‘ying</h1>
            <p className="wa__sub">Bu havola bir martalik — parol o‘rnatilgach ishlamaydi.</p>

            <form
              className="wa__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) void submit();
              }}
            >
              <Field label="Yangi parol" hint="Kamida 10 belgi">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>

              <Field label="Takrorlang">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              </Field>

              {tooShort && <Notice tone="warning">Parol kamida 10 belgidan iborat bo‘lsin</Notice>}
              {mismatch && <Notice tone="warning">Parollar mos kelmadi</Notice>}
              {error && <Notice tone="danger">{error}</Notice>}

              <Button block type="submit" loading={busy} disabled={!valid}>
                Saqlash
              </Button>
            </form>
          </>
        )}
      </m.div>
    </div>
  );
}
