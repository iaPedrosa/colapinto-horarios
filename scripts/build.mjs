// Arma la carpeta dist/ que publica Vercel: una página HTML por dirección, ya escrita
// (título, descripción, datos estructurados y el texto de cada página), más sitemap.xml y robots.txt.
// Vercel lo corre con cada commit, también con los de datos que hace GitHub Actions.
//
// Uso: node scripts/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
// En Vercel, VERCEL_PROJECT_PRODUCTION_URL es el dominio principal (si se agrega un .com.ar, pasa a ser ese).
const SITE = 'https://' + (process.env.SITE_DOMAIN || process.env.VERCEL_PROJECT_PRODUCTION_URL || 'colapinto-horarios.vercel.app');

// --- el mismo código que usa la página ---
const ctx = vm.createContext({ console });
ctx.window = ctx;
for (const f of ['races.js', 'results.js', 'poster.js', 'seo.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const { RACES, Seo, Poster } = ctx;
// La placa ya escrita: sin cuenta regresiva (cambia cada segundo; la agrega la página).
Poster.state.countdown = false;

const readData = (name) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name + '.json'), 'utf8')); } catch { return null; } };
const data = {
  standings: readData('standings'),
  season: readData('season'),
  race: Object.fromEntries(RACES.map((r) => [r.id, readData('race-' + r.id)])),
  weekend: Object.fromEntries(RACES.map((r) => [r.id, readData('weekend-' + r.id)])),
  weatherOf: Object.fromEntries(RACES.map((r) => [r.id, readData('weather-' + r.id)])),
  circuits: readData('circuits'),
  career: readData('career')
};
// Datos de un GP para su página (y para la principal, que muestra el próximo).
const gpData = (r) => ({ ...data, race: data.race[r.id], weekend: data.weekend[r.id], weather: data.weatherOf[r.id] });
for (const r of RACES) if (data.weekend[r.id]) Poster.state.weekend[r.id] = data.weekend[r.id];

// --- copiar archivos estáticos ---
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'gp'), { recursive: true });
for (const f of ['races.js', 'results.js', 'poster.js', 'seo.js', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'favicon.ico', 'manifest.webmanifest', 'og.png']) {
  if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
}
fs.cpSync(path.join(ROOT, 'data'), path.join(DIST, 'data'), { recursive: true });
fs.cpSync(path.join(ROOT, 'fonts'), path.join(DIST, 'fonts'), { recursive: true });

// --- páginas ---
const template = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const attr = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const verification = process.env.GOOGLE_SITE_VERIFICATION;

function head(p, extraLD) {
  const url = SITE + p.path;
  const ld = [p.jsonld && { ...p.jsonld, url }, ...extraLD].filter(Boolean);
  return `<title>${attr(p.title)}</title>
<meta name="description" content="${attr(p.description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:locale" content="es_AR">
<meta property="og:site_name" content="Horarios Colapinto">
<meta property="og:title" content="${attr(p.title)}">
<meta property="og:description" content="${attr(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/${fs.existsSync(path.join(ROOT, 'og.png')) ? 'og.png' : 'icon-512.png'}">
<meta name="twitter:card" content="summary_large_image">
${verification ? `<meta name="google-site-verification" content="${attr(verification)}">\n` : ''}${ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n')}`;
}

const crumbs = (items) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + p }))
});

// Placa de cada página, como la dibuja la página en una pantalla de computadora angosta (1080 de ancho).
function posterFor(kind, r, slug) {
  if (kind === 'pais') {
    const c = Seo.countryBySlug(slug), up = Seo.upcoming(now);
    return up.days ? Poster.schedule(up, { tz: c.tz, label: Seo.countryLabel(c, up) }) : '';
  }
  if (kind === 'ficha') kind = 'temporada';
  if (kind === 'tabla') return data.standings ? Poster.standings(data.standings, { twoCols: true }) : '';
  if (kind === 'temporada') return data.season ? Poster.season(data.season, { width: 920 }) : '';
  if (Date.parse(r.end) > now || !data.race[r.id]) return r.days ? Poster.schedule(r) : '';
  return Poster.results(r, data.race[r.id], { width: 920 });
}

function write(file, p, extraLD = [], posterHTML = '') {
  let html = template
    .replace(/<!--seo[\s\S]*?<!--\/seo-->/, head(p, extraLD))
    .replace(/<!--poster-->[\s\S]*?<!--\/poster-->/, posterHTML)
    .replace(/<!--info-->[\s\S]*?<!--\/info-->/, Seo.section(p));
  fs.writeFileSync(path.join(DIST, file), html);
}

const now = Date.now();
const pages = [];
const home = Seo.page('home', null, gpData(Seo.upcoming(now)), now);
write('index.html', home, [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Horarios Colapinto', alternateName: 'Horarios de Franco Colapinto', url: SITE + '/', inLanguage: 'es-AR' }], posterFor('home', Seo.upcoming(now)));
pages.push(['/', 1.0]);

for (const r of RACES) {
  const p = Seo.page('gp', r, gpData(r), now);
  write(`gp/${r.id}.html`, p, [crumbs([['Horarios Colapinto', '/'], [r.gp, p.path]])], posterFor('gp', r));
  pages.push([p.path, Date.parse(r.end) > now ? 0.9 : 0.6]);
}
for (const kind of ['tabla', 'temporada']) {
  const p = Seo.page(kind, null, data, now);
  write(`${kind}.html`, p, [crumbs([['Horarios Colapinto', '/'], [p.h1, p.path]])], posterFor(kind));
  pages.push([p.path, 0.8]);
}
{
  const p = Seo.page('ficha', null, data, now);
  write('franco-colapinto.html', p, [crumbs([['Horarios Colapinto', '/'], ['Franco Colapinto', p.path]])], posterFor('ficha'));
  pages.push([p.path, 0.8]);
}
for (const c of Seo.countries) {
  const p = Seo.page('pais', null, gpData(Seo.upcoming(now)), now, c.slug);
  write(`${c.slug}.html`, p, [crumbs([['Horarios Colapinto', '/'], [`Horarios en ${c.name}`, p.path]])], posterFor('pais', null, c.slug));
  pages.push([p.path, 0.7]);
}

// --- sitemap y robots ---
const today = new Date(now).toISOString().slice(0, 10);
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(([p, pr]) => `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod><priority>${pr.toFixed(1)}</priority></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`${pages.length} páginas en dist/ para ${SITE}`);
