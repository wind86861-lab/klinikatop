/**
 * Ekran klaviaturasi — ko'rinadigan maydonni kuzatish.
 *
 * Muammo: Telegram'ning iOS versiyasida (va iOS Safari'da) klaviatura
 * ochilganda sahifa QISQARMAYDI — klaviatura uning ustiga chiqadi.
 * `100vh` ham, `100dvh` ham buni bilmaydi, shuning uchun pastga
 * yopishgan yozish paneli klaviatura ostida qolardi va odam nima
 * yozayotganini ko'rmasdi. Android'da esa sahifa qisqaradi, lekin
 * iOS bilan bir xil kod ikkalasida ham to'g'ri ishlashi kerak.
 *
 * Yechim — `visualViewport`: u ekranning HAQIQATAN ko'rinadigan qismini
 * aytadi. `<html>` ga quyidagilar yoziladi:
 *
 *   --vvh     ko'rinadigan balandlik (px)
 *   --vv-top  ko'rinadigan maydon sahifaning qayeridan boshlanadi (iOS
 *             fokusda sahifani yuqoriga suradi)
 *   --kb      klaviatura sahifaning pastki qismidan qancha yopyapti
 *   .kb-open  klaviatura ochiq
 *
 * Chat ekranlari shularga tayanadi (`.screen--chat`, `.action-bar`).
 */

const KB_MIN = 120;

export function installViewportTracking(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) return;

  /*
   * "To'liq" balandlik — klaviatura yo'q paytdagi eng katta qiymat.
   * Android'da sahifaning o'zi qisqaradi (innerHeight ham kichrayadi),
   * shuning uchun klaviaturani faqat `innerHeight - vv.height` bilan
   * aniqlab bo'lmaydi — eng katta ko'rilgan balandlik bilan solishtiramiz.
   * Ekran burilsa qaytadan o'lchanadi.
   */
  let fullHeight = Math.max(window.innerHeight, vv.height);
  let raf = 0;

  const editing = () => {
    const el = document.activeElement as HTMLElement | null;
    return Boolean(el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|range)$/.test((el as HTMLInputElement).type)) || el.isContentEditable));
  };

  const update = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const height = vv.height;
      const top = Math.max(0, vv.offsetTop);
      if (!editing()) fullHeight = Math.max(window.innerHeight, height);

      // iOS: sahifa o'z joyida, klaviatura pastini yopadi
      const covered = Math.max(0, window.innerHeight - height - top);
      const open = editing() && (covered > KB_MIN || fullHeight - height > KB_MIN);

      root.style.setProperty('--vvh', `${Math.round(height)}px`);
      root.style.setProperty('--vv-top', `${Math.round(top)}px`);
      root.style.setProperty('--kb', `${Math.round(covered)}px`);
      root.classList.toggle('kb-open', open);
    });
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  window.addEventListener('orientationchange', () => {
    fullHeight = 0;
    setTimeout(update, 300);
  });
  // Fokus o'zgarishi — klaviatura ochilish/yopilish animatsiyasidan oldin keladi
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => setTimeout(update, 50));
  update();
}

/** Klaviatura ochilganda/yopilganda chaqiriladi (masalan chatni oxiriga surish) */
export function onKeyboardChange(cb: (open: boolean) => void): () => void {
  const root = document.documentElement;
  let last = root.classList.contains('kb-open');
  const mo = new MutationObserver(() => {
    const now = root.classList.contains('kb-open');
    if (now !== last) {
      last = now;
      cb(now);
    }
  });
  mo.observe(root, { attributes: true, attributeFilter: ['class'] });
  // Ochiq holatda ham balandlik o'zgaradi (bashorat qatori chiqadi) — oxirida qolsin
  const vv = window.visualViewport;
  const onResize = () => last && cb(true);
  vv?.addEventListener('resize', onResize);
  return () => {
    mo.disconnect();
    vv?.removeEventListener('resize', onResize);
  };
}

/**
 * Yozish maydoni matn bilan birga o'sadi (CSS `max-height` gacha —
 * keyin ichida suriladi). Bir qatorli maydonda uzun xabarning boshi
 * yoki oxiri ko'rinmay qolardi va odam nima yozganini tekshira olmasdi.
 */
export function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}
