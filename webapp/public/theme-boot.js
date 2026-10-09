/*
 * Mavzu birinchi bo'yashdan OLDIN qo'yiladi (index.html dan chiqarilgan).
 *
 * Alohida fayl bo'lishining sababi — Content-Security-Policy: ilova
 * sahifasida inline skript taqiqlangan (XSS bo'lsa ham begona skript
 * ishlamasin). Mantiq `src/lib/theme.ts` dagi bilan bir xil bo'lishi SHART.
 */
(function () {
  try {
    var saved = localStorage.getItem('klinikatop.theme') || 'light';
    var actual = saved;
    if (saved === 'auto') {
      /*
        Ko'prik `defer` bilan yuklanadi, ya'ni SHU YERDA u hali
        yo'q — va shunday bo'lishi kerak, aks holda u yana
        render'ni to'sardi. Shuning uchun bu yerda tizim
        sozlamasiga tayanamiz; Telegram aytgan aniq rangni esa
        `main.tsx` ko'prik yuklangach qo'yadi.

        Farq faqat "auto" tanlagan va Telegram mavzusi tizim
        mavzusidan BOSHQA bo'lgan odamda sezilishi mumkin —
        bir lahzalik. Bir yarim soniya oq ekrandan arzonroq.
      */
      var tg = window.Telegram && window.Telegram.WebApp;
      if (tg && !tg.initData) tg = null;
      actual = tg && tg.colorScheme
        ? (tg.colorScheme === 'dark' ? 'dark' : 'light')
        : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    document.documentElement.setAttribute('data-theme', actual);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', actual === 'dark' ? '#0c1817' : '#eaf0ee');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();

/*
 * Shriftlar render'ni to'smaydi: `<link id="font-css" media="print">`
 * yuklangach `all` ga o'tkaziladi. Ilgari bu `onload="..."` atributi
 * edi — CSP inline hodisa ishlovchilarini taqiqlaydi.
 */
(function () {
  var f = document.getElementById('font-css');
  if (!f) return;
  var on = function () {
    f.media = 'all';
  };
  if (f.sheet) on();
  else f.addEventListener('load', on);
})();
