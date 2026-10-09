import { defineConfig } from 'astro/config';

/*
 * Statik sayt: har sahifa tayyor HTML bo'lib chiqadi (SEO).
 *
 * `trailingSlash: 'always'` + `format: 'directory'` — har sahifa
 * `/klinikalar-uchun/index.html` bo'ladi va nginx uni `$uri/index.html`
 * orqali topadi. Bir xil sahifaga ikki xil manzil (slesh bilan va
 * slesh'siz) bo'lmasligi uchun kanonik shakl bitta.
 */
export default defineConfig({
  site: 'https://klinikatop.uz',
  trailingSlash: 'always',
  build: { format: 'directory', assets: '_site' },
  compressHTML: true,
  server: { port: 4321 },
  vite: {
    server: {
      // Ishlab chiqishda API mahalliy serverga boradi
      proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: true } },
    },
  },
});
