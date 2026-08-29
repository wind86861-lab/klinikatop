/**
 * Klinika arizasi — OCHIQ veb-sahifa.
 *
 * Bu klinika ko'radigan BIRINCHI sahifa, shuning uchun u ikki ish qiladi:
 * avval nima uchun kerakligini tushuntiradi, keyin arizani oladi.
 * Faqat forma bo'lsa — klinika nima uchun to'ldirayotganini bilmaydi.
 *
 * Telegramdan tashqarida, oddiy brauzerda ochiladi va autentifikatsiya
 * talab qilmaydi (App.tsx da kirish to'sig'idan oldin chiziladi).
 *
 * Forma uch bosqichga bo'lingan: klinika → aloqa → yo'nalishlar. Bir
 * ekranda 9 ta maydon ko'rsatish qo'rqitadi; bosqichma-bosqich esa har
 * safar 3-4 ta savol bo'ladi va oxirigacha yetib borish oson.
 */
import { useEffect, useState, type ChangeEvent } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { EASE, popVariants, spring } from '@/lib/motion';
import { Button, Chip, Field, IconCheck, Input, Notice, Select, Textarea } from '@/ui';
import type { City, Operation } from '@shared/types';

const BASE = import.meta.env.VITE_API_URL ?? '';

interface Reference {
  cities: City[];
  operations: Operation[];
}

const STEPS = ['clinic', 'contact', 'operations'] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLES: Record<Step, { title: string; sub: string }> = {
  clinic: { title: 'Klinika haqida', sub: 'Rasmiy nom va manzil' },
  contact: { title: 'Kim bilan bog‘lanamiz', sub: 'Moderator shu odamga qo‘ng‘iroq qiladi' },
  operations: { title: 'Qaysi operatsiyalarni qilasiz', sub: 'So‘rovlar shu yo‘nalishlar bo‘yicha keladi' },
};

export function ClinicSignup() {
  const [ref, setRef] = useState<Reference | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState<Step>('clinic');
  const [direction, setDirection] = useState(1);

  const [name, setName] = useState('');
  const [cityId, setCityId] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [about, setAbout] = useState('');
  const [operationIds, setOperationIds] = useState<number[]>([]);
  const [opQuery, setOpQuery] = useState('');

  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/public/reference`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setRef)
      .catch(() => setLoadError(true));
  }, []);

  /** Har bosqichning o'z sharti — keyingisiga o'tishdan oldin tekshiriladi. */
  const stepValid: Record<Step, boolean> = {
    clinic: name.trim().length >= 2 && cityId !== null && address.trim().length >= 3 && licenseNo.trim().length >= 3,
    contact: contactName.trim().length >= 2 && contactPhone.trim().length >= 7,
    operations: operationIds.length > 0,
  };

  const index = STEPS.indexOf(step);
  const isLast = index === STEPS.length - 1;

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= STEPS.length) return;
    setDirection(delta);
    setStep(STEPS[next]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async () => {
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
      window.scrollTo({ top: 0 });
    } catch (err: any) {
      setError(err?.message ?? 'Xatolik yuz berdi');
    } finally {
      setSending(false);
    }
  };

  /* ─────────────  Yuborilgandan keyin  ───────────── */
  if (done !== null) {
    return (
      <div className="cs">
        <div className="cs__shell cs__shell--narrow">
          <m.div className="cs__card cs__success" variants={popVariants} initial="initial" animate="animate">
            <m.div
              className="cs__successMark"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...spring, delay: 0.1 }}
            >
              <IconCheck size={30} />
            </m.div>

            <h1 className="cs__h1">Arizangiz qabul qilindi</h1>
            <p className="cs__lede">
              Ariza raqami <strong className="num">#{done}</strong>
            </p>

            <ol className="cs__next">
              <li>
                <span className="cs__nextN">1</span>
                <span>Moderator litsenziyangizni tekshiradi — odatda 1–2 ish kuni</span>
              </li>
              <li>
                <span className="cs__nextN">2</span>
                <span>
                  Tasdiqlangach botimizga <strong>/start</strong> bosasiz va shu raqamingizni
                  yuborasiz — bot sizni tanib oladi
                </span>
              </li>
              <li>
                <span className="cs__nextN">3</span>
                <span>Parolingizni qo‘yasiz va kabinetga kirasiz — Telegramda ham, brauzerda ham</span>
              </li>
            </ol>
          </m.div>
        </div>
      </div>
    );
  }

  /* ─────────────  Asosiy sahifa  ───────────── */
  return (
    <div className="cs">
      <header className="cs__top">
        <div className="cs__shell cs__topRow">
          <span className="cs__mark">KlinikaTop</span>
          <a className="cs__topLink" href="https://t.me/klinikatop_bot" target="_blank" rel="noreferrer">
            Savol bormi?
          </a>
        </div>
      </header>

      <div className="cs__shell cs__grid">
        {/* ── Chap: nima uchun ── */}
        <m.aside
          className="cs__pitch"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          <h1 className="cs__h1">
            Bemorlar sizni <span className="cs__accent">qidirib topadi</span>
          </h1>
          <p className="cs__lede">
            Bemor bitta so‘rov qoldiradi — shahringizdagi mos klinikalar narx taklif qiladi. Siz
            raqobatlashasiz, bemor tanlaydi.
          </p>

          <ul className="cs__points">
            <li>
              <strong>Birinchi oylar bepul</strong>
              <span>Obuna to‘lovi yo‘q — platforma o‘zini isbotlagach to‘laysiz</span>
            </li>
            <li>
              <strong>Komissiya faqat natijadan</strong>
              <span>Bemor operatsiyani tasdiqlagandagina olinadi. Taklif yuborish bepul</span>
            </li>
            <li>
              <strong>So‘rovlarni ko‘rish har doim bepul</strong>
              <span>Nima o‘tayotganini ko‘rib turasiz, keyin qaror qilasiz</span>
            </li>
          </ul>

          <div className="cs__note">
            Kirish uchun <strong>telefon raqamingiz</strong> yetarli. Kabinet Telegramda ham,
            brauzerda ham ochiladi.
          </div>
        </m.aside>

        {/* ── O'ng: forma ── */}
        <m.section
          className="cs__card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE, delay: 0.08 }}
        >
          {/* Qadam ko'rsatkichi */}
          <div className="cs__steps" aria-hidden>
            {STEPS.map((s, i) => (
              <m.span
                key={s}
                className={`cs__stepBar ${i <= index ? 'is-done' : ''}`}
                animate={{ flex: i === index ? 1.5 : 1 }}
                transition={spring}
              />
            ))}
          </div>

          <div className="cs__stepHead">
            <span className="cs__stepCount num">
              {index + 1} / {STEPS.length}
            </span>
            <h2 className="cs__h2">{STEP_TITLES[step].title}</h2>
            <p className="cs__sub">{STEP_TITLES[step].sub}</p>
          </div>

          {loadError && <Notice tone="danger">Ma’lumotlarni yuklab bo‘lmadi. Sahifani yangilang.</Notice>}

          {!ref && !loadError && (
            <div className="cs__skeleton">
              {[0, 1, 2].map((i) => (
                <m.span
                  key={i}
                  animate={{ opacity: [0.35, 0.8, 0.35] }}
                  transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </div>
          )}

          {ref && (
            <>
              <AnimatePresence mode="wait" custom={direction}>
                <m.div
                  key={step}
                  className="cs__fields"
                  initial={{ opacity: 0, x: direction * 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: direction * -24 }}
                  transition={{ duration: 0.24, ease: EASE }}
                >
                  {step === 'clinic' && (
                    <>
                      <Field label="Klinika nomi" hint="Litsenziyadagi rasmiy nom">
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
                        <Input
                          value={address}
                          maxLength={300}
                          placeholder="Ko‘cha, uy raqami"
                          onChange={(e) => setAddress(e.target.value)}
                        />
                      </Field>

                      <Field label="Litsenziya raqami" hint="Tibbiy faoliyat litsenziyasi — moderator tekshiradi">
                        <Input
                          value={licenseNo}
                          maxLength={120}
                          onChange={(e) => setLicenseNo(e.target.value)}
                        />
                      </Field>
                    </>
                  )}

                  {step === 'contact' && (
                    <>
                      <Field label="Mas’ul shaxs" hint="Ism va lavozim">
                        <Input
                          value={contactName}
                          maxLength={120}
                          placeholder="Aziz Karimov, bosh shifokor"
                          onChange={(e) => setContactName(e.target.value)}
                        />
                      </Field>

                      <Field
                label="Telefon"
                hint="Kabinetga shu raqam bilan kirasiz. Moderator ham shu raqamga qo‘ng‘iroq qiladi."
              >
                        <Input
                          type="tel"
                          value={contactPhone}
                          maxLength={40}
                          placeholder="+998 __ ___ __ __"
                          onChange={(e) => setContactPhone(e.target.value)}
                        />
                      </Field>

                      <Field label="Email · ixtiyoriy" hint="Xabar yuborish uchun">
                        <Input
                          type="email"
                          value={contactEmail}
                          maxLength={160}
                          onChange={(e) => setContactEmail(e.target.value)}
                        />
                      </Field>

                      <Field label="Klinika haqida · ixtiyoriy" hint="Bemor taklifingizni ko‘rganda shuni o‘qiydi">
                        <Textarea
                          rows={4}
                          value={about}
                          maxLength={1500}
                          onChange={(e) => setAbout(e.target.value)}
                        />
                      </Field>
                    </>
                  )}

                  {step === 'operations' && (
                    <>
                      <Input
                        value={opQuery}
                        placeholder="Qidirish…"
                        aria-label="Operatsiya qidirish"
                        onChange={(e) => setOpQuery(e.target.value)}
                      />

                      {operationIds.length > 0 && (
                        <div className="cs__picked">
                          <span className="cs__pickedN num">{operationIds.length}</span>
                          <span className="tiny">ta yo‘nalish tanlandi</span>
                          <button className="cs__clear" onClick={() => setOperationIds([])}>
                            Tozalash
                          </button>
                        </div>
                      )}

                      <div className="cs__ops">
                        {ref.operations
                          .filter((op) =>
                            opQuery.trim()
                              ? op.nameUz.toLowerCase().includes(opQuery.trim().toLowerCase())
                              : true,
                          )
                          .map((op) => (
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
                    </>
                  )}
                </m.div>
              </AnimatePresence>

              <AnimatePresence>
                {error && (
                  <m.div variants={popVariants} initial="initial" animate="animate" exit="exit">
                    <Notice tone="danger">{error}</Notice>
                  </m.div>
                )}
              </AnimatePresence>

              <div className="cs__actions">
                {index > 0 && (
                  <Button variant="secondary" onClick={() => go(-1)}>
                    Orqaga
                  </Button>
                )}
                <Button
                  block
                  loading={sending}
                  disabled={!stepValid[step]}
                  onClick={() => (isLast ? submit() : go(1))}
                >
                  {isLast ? 'Ariza yuborish' : 'Davom etish'}
                </Button>
              </div>

              {isLast && (
                <p className="cs__fine">
                  Ariza yuborish orqali ma’lumotlaringiz tekshirilishiga rozilik bildirasiz.
                </p>
              )}
            </>
          )}
        </m.section>
      </div>
    </div>
  );
}
