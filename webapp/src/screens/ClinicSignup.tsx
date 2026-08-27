/**
 * Klinika arizasi — OCHIQ veb-sahifa.
 *
 * Bu ekran Telegramdan tashqarida, oddiy brauzerda ochiladi va hech qanday
 * autentifikatsiya talab qilmaydi. Shuning uchun u ilovaning kirish
 * to'sig'idan OLDIN chiziladi (App.tsx).
 *
 * Nima uchun shunday: klinika egasidan ariza qoldirish uchun Telegram
 * talab qilish keraksiz to'siq. U arizani qoldiradi, moderator tekshiradi,
 * tasdiqlangach bot orqali hisobini biriktiradi.
 */
import { useEffect, useState, type ChangeEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { popVariants } from '@/lib/motion';
import { Button, Card, Chip, Field, IconCheck, Input, Notice, Select, Textarea } from '@/ui';
import type { City, Operation } from '@shared/types';

const BASE = import.meta.env.VITE_API_URL ?? '';

interface Reference {
  cities: City[];
  operations: Operation[];
}

export function ClinicSignup() {
  const [ref, setRef] = useState<Reference | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [name, setName] = useState('');
  const [cityId, setCityId] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [about, setAbout] = useState('');
  const [operationIds, setOperationIds] = useState<number[]>([]);

  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/public/reference`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setRef)
      .catch(() => setLoadError(true));
  }, []);

  const valid =
    name.trim().length >= 2 &&
    cityId !== null &&
    address.trim().length >= 3 &&
    licenseNo.trim().length >= 3 &&
    contactName.trim().length >= 2 &&
    contactPhone.trim().length >= 7 &&
    operationIds.length > 0;

  const submit = async () => {
    if (!valid) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/public/clinic-application`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          cityId,
          address: address.trim(),
          about: about.trim(),
          licenseNo: licenseNo.trim(),
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim(),
          contactEmail: contactEmail.trim() || null,
          operationIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Xatolik yuz berdi');
      setDone(data.id);
    } catch (err: any) {
      setError(err?.message ?? 'Xatolik yuz berdi');
    } finally {
      setSending(false);
    }
  };

  /* ── Yuborilgandan keyin ── */
  if (done !== null) {
    return (
      <div className="signup">
        <motion.div className="signup__box" variants={popVariants} initial="initial" animate="animate">
          <div className="signup__done">
            <IconCheck size={34} />
          </div>
          <h1 className="signup__title">Arizangiz qabul qilindi</h1>
          <p className="signup__text">
            Ariza raqami: <strong className="num">#{done}</strong>
          </p>
          <p className="signup__text">
            Moderator litsenziyangizni tekshiradi va ko‘rsatgan raqamingizga bog‘lanadi. Odatda 1–2 ish kuni.
          </p>
          <Notice tone="info">
            Tasdiqlangach sizga <strong>ulanish kodi</strong> beriladi. O‘sha kodni Telegram botimizga
            kiritasiz va kabinetingiz ochiladi.
          </Notice>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="signup">
      <motion.div className="signup__box" variants={popVariants} initial="initial" animate="animate">
        <div className="signup__mark">KlinikaTop</div>
        <h1 className="signup__title">Klinika sifatida ro‘yxatdan o‘tish</h1>
        <p className="signup__text">
          Bemorlar so‘rov qoldiradi — siz narx taklif qilasiz. Birinchi oylar bepul, komissiya faqat
          bemor tasdiqlagan bitimdan olinadi.
        </p>

        {loadError && <Notice tone="danger">Ma’lumotlarni yuklab bo‘lmadi. Sahifani yangilang.</Notice>}

        {ref && (
          <>
            <Field label="Klinika nomi">
              <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </Field>

            <Field label="Viloyat">
              <Select
                value={cityId ?? ''}
                aria-label="Viloyat"
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  setCityId(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Tanlang</option>
                {ref.cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameUz}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Manzil">
              <Input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
            </Field>

            <Field label="Litsenziya raqami" hint="Tibbiy faoliyat litsenziyasi — moderator tekshiradi">
              <Input value={licenseNo} maxLength={120} onChange={(e) => setLicenseNo(e.target.value)} />
            </Field>

            {/* Moderator shu odamga qo'ng'iroq qiladi */}
            <Field label="Mas’ul shaxs">
              <Input value={contactName} maxLength={120} onChange={(e) => setContactName(e.target.value)} />
            </Field>

            <Field label="Telefon" hint="Moderator shu raqamga bog‘lanadi">
              <Input
                type="tel"
                value={contactPhone}
                maxLength={40}
                placeholder="+998 __ ___ __ __"
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </Field>

            <Field label="Email · ixtiyoriy">
              <Input
                type="email"
                value={contactEmail}
                maxLength={160}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </Field>

            <Field
              label="Qaysi operatsiyalarni qilasiz"
              hint={operationIds.length > 0 ? `${operationIds.length} ta tanlangan` : 'Kamida bittasini tanlang'}
            >
              <div className="signup__ops">
                {ref.operations.map((op) => (
                  <Chip
                    key={op.id}
                    size="sm"
                    active={operationIds.includes(op.id)}
                    onClick={() =>
                      setOperationIds((prev) =>
                        prev.includes(op.id) ? prev.filter((x) => x !== op.id) : [...prev, op.id],
                      )
                    }
                  >
                    {operationIds.includes(op.id) && <IconCheck size={11} />} {op.nameUz}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="Klinika haqida · ixtiyoriy">
              <Textarea rows={4} value={about} maxLength={1500} onChange={(e) => setAbout(e.target.value)} />
            </Field>

            <AnimatePresence>
              {error && (
                <motion.div variants={popVariants} initial="initial" animate="animate" exit="exit">
                  <Notice tone="danger">{error}</Notice>
                </motion.div>
              )}
            </AnimatePresence>

            <Button block loading={sending} disabled={!valid} onClick={submit}>
              Ariza yuborish
            </Button>

            <p className="signup__fine">
              Ariza yuborish orqali ma’lumotlaringiz tekshirilishiga rozilik bildirasiz. Tasdiqlangach
              Telegram bot orqali kabinetingizga kirasiz.
            </p>
          </>
        )}

        {!ref && !loadError && (
          <motion.div
            className="signup__loading"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          >
            Yuklanmoqda…
          </motion.div>
        )}
      </motion.div>

      <Card className="signup__note">
        <p className="tiny">
          Savol bo‘lsa: <strong>@klinikatop_bot</strong>
        </p>
      </Card>
    </div>
  );
}
