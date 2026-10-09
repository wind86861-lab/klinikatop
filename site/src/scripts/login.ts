/**
 * Bemor kirishi — telefon + parol (`POST /api/auth/phone/login`).
 * Token `klinikatop.patient` ga yoziladi — ilova (`/app`) shundan o'qiydi.
 */
const PATIENT_KEY = 'klinikatop.patient';

const form = document.querySelector<HTMLFormElement>('[data-login-form]');
if (form) init(form);

function init(form: HTMLFormElement) {
  const phoneInput = form.querySelector<HTMLInputElement>('input[name=phone]')!;
  const passwordInput = form.querySelector<HTMLInputElement>('input[name=password]')!;
  const errorEl = document.querySelector<HTMLElement>('[data-login-error]')!;
  const done = document.querySelector<HTMLElement>('[data-login-done]')!;
  const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const ru = document.documentElement.lang === 'ru';

  const setError = (msg: string | null) => {
    errorEl.hidden = !msg;
    errorEl.textContent = msg ?? '';
  };

  /*
   * Saqlangan token bo'lsa ham bu yerda avtomatik /app ga O'TKAZILMAYDI:
   * token eskirgan bo'lsa ilova yana kirishga yuborardi — cheksiz aylanish.
   */

  phoneInput.addEventListener('input', () => {
    let d = phoneInput.value.replace(/\D/g, '');
    if (!d.startsWith('998')) d = '998' + d.replace(/^998/, '');
    d = d.slice(0, 12);
    const p = [d.slice(0, 3), d.slice(3, 5), d.slice(5, 8), d.slice(8, 10), d.slice(10, 12)].filter(Boolean);
    phoneInput.value = '+' + p.join(' ');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const digits = phoneInput.value.replace(/\D/g, '');
    if (digits.length !== 12 || !passwordInput.value) {
      setError(ru ? 'Введите номер и пароль' : 'Raqam va parolni kiriting');
      return;
    }
    setError(null);
    btn.disabled = true;
    btn.classList.add('is-busy');
    try {
      const res = await fetch('/api/auth/phone/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '+' + digits, password: passwordInput.value }),
      });
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error || form.dataset.fallback);
      try {
        localStorage.setItem(PATIENT_KEY, data.token);
      } catch {
        /* shaxsiy rejim */
      }
      form.classList.remove('is-active');
      done.classList.add('is-active');
      setTimeout(() => location.replace('/app'), 700);
    } catch (err) {
      passwordInput.value = '';
      setError((err as Error).message);
      btn.disabled = false;
      btn.classList.remove('is-busy');
    }
  });
}

// Modul — nomlar boshqa skriptlar bilan to'qnashmasin
export {};
