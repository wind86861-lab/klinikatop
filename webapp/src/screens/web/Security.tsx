/**
 * Hisob xavfsizligi — klinika va admin uchun.
 *
 * Uch narsa bir joyda, chunki odam bu yerga bitta sabab bilan keladi:
 * "hisobimni himoyalayman". Ular boshqa-boshqa bo'limlarga tarqalsa,
 * eng muhimi — 2FA — hech qachon yoqilmasdi.
 *
 * Bu ekran shu sababdan yozildi: 2FA uchun server tomonida hammasi
 * tayyor edi, lekin uni yoqishning yo'li yo'q edi. Ishlaydigan API —
 * hali ishlaydigan imkoniyat emas.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import QRCode from 'qrcode';
import { popVariants } from '@/lib/motion';
import { useApp } from '@/store/app';
import { webToken } from '@/lib/session';
import { Button, Card, Field, IconCheck, IconShield, Input, Notice, Section } from '@/ui';

const BASE = import.meta.env.VITE_API_URL ?? '';

interface Account {
  id: number;
  phone: string;
  email: string | null;
  fullName: string;
  level: string;
  totpEnabled: boolean;
  lastLoginAt: string | null;
}

interface SessionRow {
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  expiresAt: string;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/web${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${webToken() ?? ''}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? 'Xatolik yuz berdi');
  return data as T;
}

export function Security() {
  const { toast } = useApp();

  const [account, setAccount] = useState<Account | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);

  const load = async () => {
    try {
      const me = await call<{ account: Account }>('/me');
      setAccount(me.account);
      setSessions(await call<SessionRow[]>('/sessions'));
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!account) return <Card className="stack">Yuklanmoqda…</Card>;

  return (
    <>
      <TwoFactor account={account} onChange={load} />
      <PasswordChange onChanged={load} />
      <Sessions rows={sessions} />
    </>
  );
}

/* ═════════════════  Ikki bosqichli tasdiq  ═════════════════ */

function TwoFactor({ account, onChange }: { account: Account; onChange: () => void }) {
  const { toast } = useApp();

  /** Sozlash jarayoni: sir olindi, kod kutilyapti */
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [disabling, setDisabling] = useState(false);

  /*
   * QR brauzerda chiziladi, serverda emas: sir hech qachon rasm
   * sifatida tarmoqdan o'tmasin va jurnalga tushmasin.
   */
  useEffect(() => {
    if (!setup) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(setup.otpauth, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [setup]);

  const start = async () => {
    setBusy(true);
    try {
      setSetup(await call<{ secret: string; otpauth: string }>('/totp/start', {}));
      setCode('');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await call('/totp/confirm', { code: code.trim() });
      toast('Ikki bosqichli tasdiq yoqildi', 'success');
      setSetup(null);
      onChange();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await call('/totp/disable', { password });
      toast('Ikki bosqichli tasdiq o‘chirildi', 'success');
      setDisabling(false);
      setPassword('');
      onChange();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Ikki bosqichli tasdiq">
      <Card className="stack">
        <div className="sec__head">
          <span className={`sec__badge ${account.totpEnabled ? 'is-on' : 'is-off'}`}>
            {account.totpEnabled ? <IconCheck size={13} /> : <IconShield size={13} />}
            {account.totpEnabled ? 'Yoqilgan' : 'Yoqilmagan'}
          </span>
        </div>

        <p className="tiny">
          Parol o‘g‘irlansa ham hisobga kirib bo‘lmaydi: kirishda telefoningizdagi ilova
          bergan 6 xonali kod ham so‘raladi.
        </p>

        {account.totpEnabled ? (
          disabling ? (
            <>
              <Notice tone="warning">
                O‘chirilsa hisobingizni faqat parol himoya qiladi.
              </Notice>
              <Field label="Parolingiz">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <div className="sec__actions">
                <Button variant="danger" loading={busy} disabled={!password} onClick={disable}>
                  O‘chirish
                </Button>
                <Button variant="ghost" onClick={() => setDisabling(false)}>
                  Bekor qilish
                </Button>
              </div>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setDisabling(true)}>
              O‘chirish
            </Button>
          )
        ) : (
          <AnimatePresence mode="wait">
            {setup ? (
              <motion.div key="setup" className="stack" variants={popVariants} initial="initial" animate="animate">
                <ol className="sec__steps">
                  <li>
                    Telefoningizga autentifikatsiya ilovasini o‘rnating — Google Authenticator,
                    Authy yoki shunga o‘xshash
                  </li>
                  <li>Quyidagi kodni skanerlang</li>
                  <li>Ilova ko‘rsatgan 6 xonali raqamni kiriting</li>
                </ol>

                {qr && <img className="sec__qr" src={qr} alt="QR kod" width={220} height={220} />}

                <div className="sec__secret">
                  <span className="tiny">Skanerlab bo‘lmasa qo‘lda kiriting:</span>
                  <code className="num">{setup.secret}</code>
                </div>

                <Field label="Ilovadagi kod">
                  <Input
                    className="sec__code num"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>

                <div className="sec__actions">
                  <Button loading={busy} disabled={code.length < 6} onClick={confirm}>
                    Yoqish
                  </Button>
                  <Button variant="ghost" onClick={() => setSetup(null)}>
                    Bekor qilish
                  </Button>
                </div>
              </motion.div>
            ) : (
              <Button key="start" loading={busy} onClick={start}>
                Yoqish
              </Button>
            )}
          </AnimatePresence>
        )}
      </Card>
    </Section>
  );
}

/* ═════════════════  Parol  ═════════════════ */

function PasswordChange({ onChanged }: { onChanged: () => void }) {
  const { toast } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = current.length > 0 && next.length >= 10 && next === repeat;

  const submit = async () => {
    setBusy(true);
    try {
      await call('/password', { currentPassword: current, newPassword: next });
      toast('Parol almashtirildi. Boshqa qurilmalardagi sessiyalar yopildi.', 'success');
      setCurrent('');
      setNext('');
      setRepeat('');
      onChanged();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Parol">
      <Card className="stack">
        <Field label="Joriy parol">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="Yangi parol" hint="Kamida 10 belgi">
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
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

        {repeat.length > 0 && next !== repeat && (
          <Notice tone="warning">Parollar mos kelmadi</Notice>
        )}

        <p className="tiny">
          Almashtirilgach boshqa qurilmalardagi sessiyalar yopiladi — bu sahifadan tashqari.
        </p>

        <Button loading={busy} disabled={!valid} onClick={submit}>
          Saqlash
        </Button>
      </Card>
    </Section>
  );
}

/* ═════════════════  Sessiyalar  ═════════════════ */

function Sessions({ rows }: { rows: SessionRow[] | null }) {
  if (!rows || rows.length === 0) return null;

  return (
    <Section title="Ochiq sessiyalar">
      <Card className="stack" style={{ gap: 'var(--s-3)' }}>
        {/* Notanish qurilma ko'rinsa — parolni almashtirish vaqti kelgan */}
        {rows.map((s, i) => (
          <div key={i} className="sec__session">
            <div className="stack" style={{ gap: 1 }}>
              <span className="num">{s.ip ?? 'noma’lum manzil'}</span>
              <span className="tiny truncate">{deviceOf(s.userAgent)}</span>
            </div>
            {s.current && <span className="sec__badge is-on">Shu qurilma</span>}
          </div>
        ))}
      </Card>
    </Section>
  );
}

/** Uzun `user-agent` satridan odam tushunadigan nom. */
function deviceOf(ua: string | null): string {
  if (!ua) return 'noma’lum qurilma';
  if (/Telegram/i.test(ua)) return 'Telegram';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iOS/i.test(ua)) return 'iPhone / iPad';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return ua.slice(0, 40);
}
