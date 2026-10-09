/**
 * Bemor RO'YXATDAN O'TISHI va PAROLNI TIKLASH — sahifa mantig'i.
 *
 * Raqam faqat shu yerda, BIR MARTA kod bilan tasdiqlanadi; keyin bemor
 * parol qo'yadi va har kirishda `/kirish/` da telefon + parol bilan
 * kiradi (SMS'siz). Ikki rejim:
 *   register (sukut)  telefon → kod → parol → profil
 *   reset (?tiklash)  telefon → kod → yangi parol
 *
 * Server API'lari:
 *   POST /api/auth/phone/request-code  { phone, purpose } → { sent, channel }
 *   POST /api/auth/phone/verify-code   → { token, user } (kod bilan ochilgan sessiya)
 *   POST /api/auth/phone/set-password  → faqat shu yangi sessiyadan
 *   PATCH /api/me                      → profil
 *   POST /api/me/onboarded             → tanishtiruvni shu sahifa o'tadi
 *
 * Token `klinikatop.patient` kalitiga yoziladi — ilova (`/app`)
 * aynan shu kalitdan o'qiydi va kirishni qayta so'ramaydi.
 */

const PATIENT_KEY = 'klinikatop.patient';
const RESEND_SEC = 60;

type Step = 'phone' | 'code' | 'password' | 'profile' | 'nosms' | 'done';

const card = document.querySelector<HTMLElement>('[data-auth]');
if (card) init(card);

function init(card: HTMLElement) {
  const lang = card.dataset.lang === 'ru' ? 'ru' : 'uz';
  const $ = <T extends Element>(sel: string) => card.querySelector<T>(sel)!;
  const steps = [...card.querySelectorAll<HTMLElement>('[data-step]')];
  const dots = [...card.querySelectorAll<HTMLElement>('[data-step-dot]')];
  const errorEl = $<HTMLElement>('[data-error]');

  let phone = '';
  let token = '';
  let resendTimer = 0;
  let profileDone = false;

  const mode: 'register' | 'reset' = new URLSearchParams(location.search).has('tiklash') ? 'reset' : 'register';
  if (mode === 'reset') {
    card.classList.add('is-reset');
    document.querySelectorAll<HTMLElement>('[data-reset-text]').forEach((el) => {
      el.textContent = el.dataset.resetText!;
    });
  }

  const show = (name: Step) => {
    steps.forEach((s) => s.classList.toggle('is-active', s.dataset.step === name));
    const idx = { phone: 0, nosms: 0, code: 1, password: 2, profile: 3, done: 4 }[name];
    dots.forEach((d, i) => {
      d.classList.toggle('is-active', i === idx);
      d.classList.toggle('is-done', i < idx || name === 'done');
    });
    setError(null);
    const first = card.querySelector<HTMLInputElement>(`[data-step="${name}"] input:not([type=radio])`);
    // Telefonda klaviatura sakrab chiqmasin — faqat kompyuterda avtofokus
    if (first && window.matchMedia('(hover: hover)').matches) setTimeout(() => first.focus(), 60);
  };

  const setError = (msg: string | null) => {
    errorEl.hidden = !msg;
    errorEl.textContent = msg ?? '';
  };

  const busy = (form: HTMLFormElement, on: boolean) => {
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]');
    if (btn) {
      btn.disabled = on;
      btn.classList.toggle('is-busy', on);
    }
  };

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || errorEl.dataset.fallback);
    return data as T;
  }

  show('phone');

  /* ── Telefon: +998 XX XXX XX XX ko'rinishida ── */
  const phoneInput = $<HTMLInputElement>('[data-step="phone"] input[name=phone]');
  const formatPhone = (raw: string) => {
    let d = raw.replace(/\D/g, '');
    if (!d.startsWith('998')) d = '998' + d.replace(/^998/, '');
    d = d.slice(0, 12);
    const p = [d.slice(0, 3), d.slice(3, 5), d.slice(5, 8), d.slice(8, 10), d.slice(10, 12)].filter(Boolean);
    return '+' + p.join(' ');
  };
  phoneInput.addEventListener('input', () => {
    phoneInput.value = formatPhone(phoneInput.value);
  });

  const startResend = () => {
    const btn = $<HTMLButtonElement>('[data-resend]');
    let left = RESEND_SEC;
    clearInterval(resendTimer);
    const tick = () => {
      btn.disabled = left > 0;
      btn.textContent = left > 0 ? btn.dataset.wait!.replace('{s}', String(left)) : btn.dataset.label!;
      left--;
      if (left < -1) clearInterval(resendTimer);
    };
    tick();
    resendTimer = window.setInterval(tick, 1000);
  };

  async function requestCode(form: HTMLFormElement) {
    busy(form, true);
    try {
      const res = await call<{ found: boolean; sent: boolean; channel: 'telegram' | 'sms' | null }>(
        '/auth/phone/request-code',
        { method: 'POST', body: JSON.stringify({ phone, purpose: mode }) },
      );
      if (!res.sent) {
        show('nosms');
        return;
      }
      const sub = $<HTMLElement>('[data-code-sub]');
      sub.textContent = (res.channel === 'sms' ? sub.dataset.sms! : sub.dataset.tg!).replace('{phone}', phone);
      show('code');
      startResend();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      busy(form, false);
    }
  }

  const phoneForm = $<HTMLFormElement>('[data-step="phone"]');
  phoneForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const digits = phoneInput.value.replace(/\D/g, '');
    if (digits.length !== 12) {
      setError(lang === 'ru' ? 'Введите номер полностью' : 'Telefon raqamini to‘liq kiriting');
      return;
    }
    phone = '+' + digits;
    void requestCode(phoneForm);
  });

  $<HTMLButtonElement>('[data-resend]').addEventListener('click', () => void requestCode(phoneForm));
  card.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => show('phone')));

  /* ── Kod ── */
  const codeForm = $<HTMLFormElement>('[data-step="code"]');
  const codeInput = $<HTMLInputElement>('[data-step="code"] input[name=code]');
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    // 6 raqam to'lsa o'zi yuboriladi — SMS avtoto'ldirishda ham
    if (codeInput.value.length === 6) codeForm.requestSubmit();
  });

  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (codeInput.value.length !== 6) return;
    busy(codeForm, true);
    try {
      const res = await call<{ token: string; user: { profileCompletedAt: string | null; onboardedAt: string | null } }>(
        '/auth/phone/verify-code',
        { method: 'POST', body: JSON.stringify({ phone, code: codeInput.value }) },
      );
      token = res.token;
      try {
        localStorage.setItem(PATIENT_KEY, token);
      } catch {
        /* shaxsiy rejim — ilova baribir kirishni so'raydi */
      }
      profileDone = Boolean(res.user.profileCompletedAt);
      show('password');
    } catch (err) {
      codeInput.value = '';
      setError((err as Error).message);
    } finally {
      busy(codeForm, false);
    }
  });

  /* ── Parol ── */
  const passwordForm = $<HTMLFormElement>('[data-step="password"]');
  const pw = passwordForm.querySelector<HTMLInputElement>('input[name=password]')!;
  const pw2 = passwordForm.querySelector<HTMLInputElement>('input[name=password2]')!;
  passwordForm.querySelector<HTMLInputElement>('[data-show-password]')!.addEventListener('change', (e) => {
    const type = (e.target as HTMLInputElement).checked ? 'text' : 'password';
    pw.type = type;
    pw2.type = type;
  });

  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pw.value !== pw2.value) {
      setError(passwordForm.querySelector<HTMLElement>('[data-mismatch]')!.dataset.mismatch!);
      return;
    }
    busy(passwordForm, true);
    try {
      await call('/auth/phone/set-password', { method: 'POST', body: JSON.stringify({ password: pw.value }) });
      if (profileDone) {
        await finish();
      } else {
        await loadCities();
        show('profile');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      busy(passwordForm, false);
    }
  });

  /* ── Profil ── */
  async function loadCities() {
    const select = $<HTMLSelectElement>('[data-cities]');
    if (select.options.length > 1) return;
    try {
      const ref = await call<{ cities: { id: number; nameUz: string; nameRu: string }[] }>('/public/reference');
      for (const c of ref.cities) select.add(new Option(lang === 'ru' ? c.nameRu : c.nameUz, String(c.id)));
    } catch {
      /* ro'yxat kelmasa — forma yuborishda xato ko'rsatiladi */
    }
  }

  const profileForm = $<HTMLFormElement>('[data-step="profile"]');
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(profileForm);
    const firstName = String(f.get('firstName') ?? '').trim();
    const lastName = String(f.get('lastName') ?? '').trim();
    const cityId = Number(f.get('cityId'));
    const birthYear = Number(f.get('birthYear'));
    const gender = f.get('gender');
    const year = new Date().getFullYear();

    if (firstName.length < 2 || lastName.length < 2 || !cityId || !gender || birthYear < year - 110 || birthYear >= year) {
      setError(lang === 'ru' ? 'Заполните все поля' : 'Hamma maydonni to‘ldiring');
      return;
    }

    busy(profileForm, true);
    try {
      await call('/me', {
        method: 'PATCH',
        body: JSON.stringify({ firstName, lastName, cityId, birthYear, gender, lang }),
      });
      await finish();
    } catch (err) {
      setError((err as Error).message);
      busy(profileForm, false);
    }
  });

  /** Tanishtiruv shu sahifada o'tildi — ilova to'g'ridan-to'g'ri bosh ekranni ochadi */
  async function finish() {
    try {
      await call('/me/onboarded', { method: 'POST' });
    } catch {
      /* muhim emas: ilova o'zi so'raydi */
    }
    show('done');
    setTimeout(() => location.replace('/app'), 900);
  }
}

// Modul — nomlar boshqa skriptlar bilan to'qnashmasin
export {};
