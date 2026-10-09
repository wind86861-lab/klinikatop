/**
 * sitemap.xml — ikki tilli, hreflang bilan.
 *
 * Qo'lda yoziladi: sahifalar kam va har birining juftini aniq
 * ko'rsatish kerak. Yangi sahifa qo'shilsa — shu ro'yxatga ham.
 */
import { site } from '../site';

const pairs: [string, string][] = [
  ['/', '/ru/'],
  ['/klinikalar-uchun/', '/ru/dlya-klinik/'],
  ['/royxatdan-otish/', '/ru/registratsiya/'],
  ['/kirish/', '/ru/vkhod/'],
];

export function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const url = (loc: string, uz: string, ru: string) => `  <url>
    <loc>${site.url}${loc}</loc>
    <lastmod>${today}</lastmod>
    <xhtml:link rel="alternate" hreflang="uz" href="${site.url}${uz}"/>
    <xhtml:link rel="alternate" hreflang="ru" href="${site.url}${ru}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${site.url}${uz}"/>
  </url>`;
  const body = pairs.flatMap(([uz, ru]) => [url(uz, uz, ru), url(ru, uz, ru)]).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>
`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
}
