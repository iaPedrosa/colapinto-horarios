// Descarga los datos de las APIs y los guarda en data/ para que la página no tenga
// que consultarlas en cada visita. Lo corre GitHub Actions (.github/workflows/update-data.yml).
//
//   - Un GP terminado y completo no se vuelve a pedir nunca.
//   - La tabla y la temporada se reescriben solo si cambiaron (así no hay commits vacíos).
//   - Respeta los límites de OpenF1 (30 pedidos por minuto en el plan gratuito).
//
// Uso: node scripts/update-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

// --- fetch con pausas entre pedidos, según la API ---
const realFetch = globalThis.fetch;
const lastCall = {};
const GAP = { 'api.openf1.org': 2200, default: 400 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
globalThis.fetch = async (url, opts = {}) => {
  const host = new URL(url).host;
  const gap = GAP[host] ?? GAP.default;
  const wait = (lastCall[host] || 0) + gap - Date.now();
  lastCall[host] = Date.now() + Math.max(0, wait);
  if (wait > 0) await sleep(wait);
  calls++;
  for (let attempt = 1; ; attempt++) {
    const res = await realFetch(url, { ...opts, headers: { 'User-Agent': 'colapinto-horarios (GitHub Pages)', ...(opts.headers || {}) } });
    if (res.status !== 429 || attempt >= 3) return res;
    await sleep(15000 * attempt);   // demasiados pedidos: esperar y reintentar
  }
};

// --- cargar el mismo código que usa la página ---
globalThis.window = globalThis;
if (process.env.JOLPICA_URL || process.env.OPENF1_URL) {
  window.F1_API = { jolpica: process.env.JOLPICA_URL, openf1: process.env.OPENF1_URL };
}
for (const f of ['races.js', 'results.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const { RACES, Results } = window;

const file = (name) => path.join(DATA, name + '.json');
const readJSON = (name) => { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return null; } };
function writeIfChanged(name, data) {
  const text = JSON.stringify(data);
  const prev = fs.existsSync(file(name)) ? fs.readFileSync(file(name), 'utf8') : null;
  if (prev === text) return false;
  fs.writeFileSync(file(name), text);
  return true;
}

const now = Date.now();
const log = [];
let changed = 0;

// 1) Resultados de cada GP terminado.
for (const race of RACES) {
  if (Date.parse(race.end) + 2 * 3600000 > now) continue;   // todavía no terminó (o recién)
  const prev = readJSON('race-' + race.id);
  if (prev && prev.complete) continue;                       // ya está completo: no se pide más
  try {
    const data = await Results.fetchRace(race);
    if (!data) { log.push(`${race.id}: todavía sin datos`); continue; }
    if (writeIfChanged('race-' + race.id, data)) changed++;
    log.push(`${race.id}: ${data.complete ? 'completo' : 'parcial'}`);
  } catch (e) {
    log.push(`${race.id}: error (${e.message})`);
  }
}

// 2) Tabla del campeonato y 3) temporada de Franco.
try {
  const st = await Results.fetchStandings();
  if (st) {
    if (writeIfChanged('standings', st)) changed++;
    log.push(`tabla: tras la fecha ${st.round}`);
    const season = await Results.fetchSeason(st);
    if (season && writeIfChanged('season', season)) changed++;
    log.push('temporada: ok');
  }
} catch (e) {
  log.push(`tabla/temporada: error (${e.message})`);
}

console.log(log.join('\n'));
console.log(`${calls} pedidos a las APIs · ${changed} archivos actualizados`);
