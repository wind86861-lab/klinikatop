/**
 * Ochiq sayt (site/dist) va ilovani (webapp/dist) bitta papkaga yig'ish.
 *
 * Ikkalasi bitta domenda, bitta nginx ildizida turadi:
 *
 *   /                    → sayt: index.html (statik, SEO)
 *   /ru/, /klinikalar-uchun/ ...  → sayt sahifalari
 *   /_site/…             → sayt asset'lari (hash bilan)
 *   /app, /kabinet, /admin, … → ilova: app.html (SPA)
 *   /assets/…            → ilova asset'lari (hash bilan)
 *
 * Ikkalasi ham `index.html` yasaydi — shuning uchun ilovaniki
 * `app.html` ga qayta nomlanadi. nginx: `try_files $uri $uri/index.html /app.html`.
 *
 *   node deploy/merge-site.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const web = path.join(root, 'webapp/dist');
const site = path.join(root, 'site/dist');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(site, 'index.html'))) fail('site/dist yo‘q — avval `npm run build --prefix site`');

const spaIndex = path.join(web, 'index.html');
const appHtml = path.join(web, 'app.html');

/*
 * Qayta ishga tushirilsa ham xavfsiz bo'lsin: index.html ILOVANIKI
 * bo'lsagina ko'chiriladi (ichida `id="root"` bor). Aks holda u
 * allaqachon saytniki va app.html joyida.
 */
if (fs.existsSync(spaIndex) && fs.readFileSync(spaIndex, 'utf8').includes('id="root"')) {
  fs.renameSync(spaIndex, appHtml);
}
if (!fs.existsSync(appHtml)) fail('webapp/dist/app.html yo‘q — avval `npm run build --workspace=webapp`');

fs.cpSync(site, web, { recursive: true, force: true });

// Nom to'qnashuvi bo'lmasin: sayt `/assets/` ga yozmasligi kerak
if (fs.existsSync(path.join(site, 'assets'))) fail('site/dist/assets — ilova papkasi bilan to‘qnashadi');

console.log('✓ Sayt va ilova birlashtirildi →', path.relative(root, web));
