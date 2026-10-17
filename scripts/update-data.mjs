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

// 1b) Resultado de Franco en cada sesión del fin de semana (prácticas, clasificación, sprint).
for (const race of RACES) {
  const ss = window.sessionsOf(race);
  if (!ss.length || ss[0].at > now) continue;                 // sin horarios o todavía no empezó
  const prev = readJSON('weekend-' + race.id);
  if (prev && prev.complete) continue;
  try {
    const data = await Results.fetchWeekend(race);
    if (!data || !data.sessions.length) continue;
    if (writeIfChanged('weekend-' + race.id, data)) changed++;
    log.push(`${race.id}: ${data.sessions.length} sesiones${data.complete ? ' (completo)' : ''}`);
  } catch (e) {
    log.push(`${race.id} sesiones: error (${e.message})`);
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

// --- Jolpica directo (para lo que no usa la página) ---
const JOLPICA = process.env.JOLPICA_URL || 'https://api.jolpi.ca/ergast/f1';
const jget = async (p) => {
  const res = await fetch(`${JOLPICA}/${p}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(res.status + ' ' + p);
  return (await res.json()).MRData;
};
const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= 1.5 * 86400000;
const HISTORY_YEARS = [2024, 2025];

// 4) Circuitos: dónde queda cada GP y qué pasó ahí en 2024 y 2025 (ganador, vueltas, resultado de Franco).
//    Son datos del pasado: se arma una vez y no se vuelve a pedir.
try {
  if (!readJSON('circuits')) {
    const cal = (await jget('2026.json?limit=40')).RaceTable.Races;
    const past = {};
    for (const y of HISTORY_YEARS) {
      const winners = (await jget(`${y}/results/1.json?limit=40`)).RaceTable.Races;
      const mine = (await jget(`${y}/drivers/colapinto/results.json?limit=40`)).RaceTable.Races;
      past[y] = { winners, mine };
    }
    const out = {};
    for (const race of RACES) {
      const c = cal.find((x) => near(x.date, race.raceDay)) || cal.find((x) => String(x.round) === String(race.round));
      if (!c) continue;
      const id = c.Circuit.circuitId;
      const history = HISTORY_YEARS.map((y) => {
        const w = past[y].winners.find((x) => x.Circuit.circuitId === id);
        if (!w) return null;
        const m = past[y].mine.find((x) => x.Circuit.circuitId === id);
        const r = m && m.Results[0];
        return {
          year: y, gp: w.raceName, winner: `${w.Results[0].Driver.givenName} ${w.Results[0].Driver.familyName}`, laps: Number(w.Results[0].laps),
          franco: r ? { pos: r.positionText, grid: r.grid, points: Number(r.points), team: r.Constructor.name.replace(/\s+F1 Team$/i, ''), status: r.status } : null
        };
      }).filter(Boolean);
      out[race.id] = {
        circuitId: id, name: c.Circuit.circuitName, locality: c.Circuit.Location.locality, country: c.Circuit.Location.country,
        lat: Number(c.Circuit.Location.lat), long: Number(c.Circuit.Location.long), history
      };
    }
    if (writeIfChanged('circuits', out)) changed++;
    log.push(`circuitos: ${Object.keys(out).length}`);
  }
} catch (e) {
  log.push(`circuitos: error (${e.message})`);
}

// 5) Pronóstico del clima del próximo GP (Open-Meteo, gratis y sin clave), desde 10 días antes.
//    Valores redondeados para no generar un commit por cada décima de grado.
try {
  const circuits = readJSON('circuits') || {};
  for (const race of RACES) {
    const ss = window.sessionsOf(race);
    const c = circuits[race.id];
    const days = (Date.parse(race.raceDay) - now) / 86400000;
    if (!ss.length || !c || days < -1 || days > 10) continue;
    const from = new Date(Date.parse(race.raceDay) - 2 * 86400000).toISOString().slice(0, 10);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.long}&timezone=auto`
      + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&start_date=${from}&end_date=${race.raceDay}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status + ' open-meteo');
    const d = (await res.json()).daily;
    const out = { id: race.id, days: d.time.map((date, i) => ({
      date, max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]),
      rain: Math.round((d.precipitation_probability_max[i] ?? 0) / 10) * 10, code: d.weather_code[i]
    })) };
    if (writeIfChanged('weather-' + race.id, out)) changed++;
    log.push(`clima ${race.id}: ok`);
  }
} catch (e) {
  log.push(`clima: error (${e.message})`);
}

// 6) La carrera de Franco en la F1, año por año (para su ficha). Los años terminados se guardan una vez.
try {
  const prev = readJSON('career') || {};
  const out = { ...prev };
  for (const y of [...HISTORY_YEARS, 2026]) {
    if (prev[y] && prev[y].final) continue;
    const res = (await jget(`${y}/drivers/colapinto/results.json?limit=40`)).RaceTable.Races.map((r) => r.Results[0]);
    const qual = (await jget(`${y}/drivers/colapinto/qualifying.json?limit=40`)).RaceTable.Races.map((r) => Number(r.QualifyingResults[0].position));
    const st = (await jget(`${y}/drivers/colapinto/driverstandings.json`)).StandingsTable.StandingsLists[0];
    const ds = st && st.DriverStandings[0];
    const pos = res.filter((r) => /^\d+$/.test(r.positionText)).map((r) => Number(r.positionText));
    out[y] = {
      team: [...new Set(res.map((r) => r.Constructor.name.replace(/\s+F1 Team$/i, '')))].join(' y '),
      races: res.length,
      points: ds ? Number(ds.points) : res.reduce((a, r) => a + Number(r.points), 0),
      position: ds ? Number(ds.position) : null,
      best: pos.length ? Math.min(...pos) : null,
      inPoints: res.filter((r) => Number(r.points) > 0).length,
      dnf: res.filter((r) => !/^\d+$/.test(r.positionText)).length,
      bestQuali: qual.length ? Math.min(...qual) : null,
      final: y < 2026
    };
  }
  if (writeIfChanged('career', out)) changed++;
  log.push('carrera de Franco: ok');
} catch (e) {
  log.push(`carrera de Franco: error (${e.message})`);
}

console.log(log.join('\n'));
console.log(`${calls} pedidos a las APIs · ${changed} archivos actualizados`);
