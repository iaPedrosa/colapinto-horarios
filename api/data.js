// /api/data?f=<archivo>  (standings, season, race-<id>, weekend-<id>)
//
// Lo pide la página cuando el archivo guardado en data/ todavía no tiene lo último
// (por ejemplo, minutos después de una sesión). Consulta las APIs y la respuesta queda en
// el caché de Vercel unos minutos: todos los visitantes comparten un mismo pedido.
//
// Si encuentra datos más nuevos que los guardados y existe la variable GH_DISPATCH_TOKEN,
// dispara el workflow de GitHub para que los guarde en data/ (y Vercel vuelva a publicar).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const REPO = process.env.GH_REPO || 'iaPedrosa/colapinto-horarios';

let lib = null;
function load() {
  if (!lib) {
    const ctx = vm.createContext({ console, fetch, setTimeout, clearTimeout, URL });
    ctx.window = ctx;
    for (const f of ['races.js', 'results.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    lib = ctx;
  }
  return lib;
}

function saved(name) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name + '.json'), 'utf8')); } catch { return null; }
}

async function dispatch() {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update-data.yml/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'colapinto-horarios' },
      body: JSON.stringify({ ref: 'main' })
    });
  } catch (e) { /* lo guardará el próximo workflow programado */ }
}

function send(res, data, seconds) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // El navegador no guarda; el caché de Vercel sí, y sirve la copia vieja mientras actualiza.
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 2}`);
  res.status(200).send(JSON.stringify(data ?? null));
}

export default async function handler(req, res) {
  const f = String((req.query && req.query.f) || '');
  const { RACES, Results } = load();
  const m = /^(race|weekend)-([a-z0-9-]+)$/.exec(f);
  const race = m && RACES.find((r) => r.id === m[2]);
  if (!['standings', 'season'].includes(f) && !race) { res.status(404).json({ error: 'no existe' }); return; }

  const prev = saved(f);
  if (prev && prev.complete) return send(res, prev, 86400);

  let data = null;
  try {
    if (f === 'standings') data = await Results.fetchStandings();
    else if (f === 'season') data = await Results.fetchSeason(await Results.fetchStandings());
    else if (m[1] === 'race') data = Date.parse(race.end) < Date.now() ? await Results.fetchRace(race) : null;
    else data = await Results.fetchWeekend(race);
  } catch (e) { data = null; }

  if (!data) return send(res, prev, 120);
  // Solo vale la pena guardar si hay algo nuevo (un fin de semana sin sesiones corridas no cuenta).
  const empty = m && m[1] === 'weekend' && !data.sessions.length;
  if (!empty && JSON.stringify(data) !== JSON.stringify(prev)) await dispatch();
  send(res, data, data.complete ? 3600 : 300);
}
