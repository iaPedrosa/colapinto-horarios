// Resultados de Franco Colapinto una vez terminado cada GP.
// Fuentes gratuitas y sin cuenta:
//   - Jolpica-F1 (ex Ergast): resultado, largada, puntos, clasificación, sprint y top 10.
//   - OpenF1 (datos históricos): vueltas, velocidad, neumáticos, paradas y posición vuelta a vuelta.
//
// Para no consultar las APIs en cada visita, un proceso de GitHub (scripts/update-data.mjs)
// guarda los datos en la carpeta data/. La página lee primero esos archivos; si falta alguno
// o quedó desactualizado (recién terminada una sesión) pide /api/data, que consulta las APIs
// con caché compartido en Vercel. Solo como último recurso va directo a las APIs.
(function () {
  const API = (typeof window !== 'undefined' && window.F1_API) || {};
  const JOLPICA = API.jolpica || 'https://api.jolpi.ca/ergast/f1';
  const OPENF1 = API.openf1 || 'https://api.openf1.org/v1';
  const NUM = 43;
  const MATE_NUM = 10;   // Pierre Gasly, compañero en Alpine (para comparar en cada sesión)
  const CACHE_V = 'r2';   // r1 podía tener carreras guardadas como completas sin estarlo

  const dayMs = 86400000;
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function getJSON(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.status + ' ' + url);
    return res.json();
  }

  function cacheGet(key) {
    try { const v = localStorage.getItem(CACHE_V + ':' + key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function cacheSet(key, val) {
    try { localStorage.setItem(CACHE_V + ':' + key, JSON.stringify(val)); } catch (e) { /* sin almacenamiento: no pasa nada */ }
  }

  // Archivo guardado en data/ (null si no existe o no se pudo leer).
  async function getStatic(name) {
    try {
      const res = await fetch(`/data/${name}.json`, { cache: 'no-cache' });
      return res.ok ? await res.json() : null;
    } catch (e) { return null; }
  }
  // Datos frescos desde la función de Vercel (null si no responde).
  async function getLive(name) {
    try {
      const res = await fetch(`/api/data?f=${encodeURIComponent(name)}`);
      return res.ok ? await res.json() : null;
    } catch (e) { return null; }
  }

  // ¿Terminó hace menos de 2 días una sesión que da puntos (sprint o carrera)?
  // En ese lapso la tabla puede haber cambiado y el archivo guardado todavía no.
  function pointsJustScored(t = Date.now()) {
    for (const r of (window.RACES || [])) {
      const ends = window.sessionsOf(r).filter((x) => /^(carrera|carrera sprint)$/i.test(x.name))
        .map((x) => x.at + window.sessionDur(x.name));
      if (!ends.length) ends.push(Date.parse(r.end));
      if (ends.some((e) => t > e && t - e < 2 * dayMs)) return true;
    }
    return false;
  }

  // Último GP que ya terminó (con 2 h de margen para que se publiquen los datos).
  function lastFinishedRace() {
    const t = Date.now();
    const done = (window.RACES || []).filter((r) => Date.parse(r.end) + 2 * 3600000 < t);
    return done[done.length - 1] || null;
  }
  // ¿El archivo ya incluye el último GP terminado?
  function upToDate(file) {
    const lf = lastFinishedRace();
    if (!lf) return true;
    return !!(file && file.lastRaceDate && Date.parse(file.lastRaceDate) >= Date.parse(lf.raceDay) - 1.5 * dayMs);
  }

  // Calendario según Jolpica (para saber la fecha real de cada ronda).
  let seasonList = null;
  async function seasonRaces() {
    if (!seasonList) {
      const data = await getJSON(`${JOLPICA}/2026.json?limit=40`);
      seasonList = data.MRData.RaceTable.Races || [];
    }
    return seasonList;
  }
  const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= 1.5 * dayMs;
  const isFranco = (d) => d && (d.permanentNumber === String(NUM) || /colapinto/i.test(d.familyName || '') || d.driverId === 'colapinto');

  // ---------- Jolpica ----------
  async function jolpicaRound(race) {
    const races = await seasonRaces();
    const hit = races.find((x) => near(x.date, race.raceDay)) || races.find((x) => String(x.round) === String(race.round));
    return hit ? hit.round : race.round;
  }

  async function jolpica(race) {
    const round = await jolpicaRound(race);
    const [res, qual, spr] = await Promise.allSettled([
      getJSON(`${JOLPICA}/2026/${round}/results.json?limit=40`),
      getJSON(`${JOLPICA}/2026/${round}/qualifying.json?limit=40`),
      race.sprint ? getJSON(`${JOLPICA}/2026/${round}/sprint.json?limit=40`) : Promise.resolve(null)
    ]);
    const rr = res.status === 'fulfilled' ? res.value.MRData.RaceTable.Races[0] : null;
    if (!rr || !rr.Results || !rr.Results.length) return null;
    const out = { results: rr.Results, raceName: rr.raceName };
    if (qual.status === 'fulfilled') {
      const q = qual.value.MRData.RaceTable.Races[0];
      const mine = q && q.QualifyingResults && q.QualifyingResults.find((x) => isFranco(x.Driver));
      if (mine) out.qualy = mine.position;
    }
    if (spr.status === 'fulfilled' && spr.value) {
      const s = spr.value.MRData.RaceTable.Races[0];
      const mine = s && s.SprintResults && s.SprintResults.find((x) => isFranco(x.Driver));
      if (mine) out.sprint = { pos: mine.positionText, points: mine.points };
    }
    return out;
  }

  // ---------- OpenF1 ----------
  async function openf1(race) {
    const from = new Date(Date.parse(race.raceDay + 'T00:00:00-03:00') - dayMs).toISOString().slice(0, 10);
    const to = new Date(Date.parse(race.raceDay + 'T00:00:00-03:00') + 2 * dayMs).toISOString().slice(0, 10);
    const sessions = await getJSON(`${OPENF1}/sessions?year=2026&session_name=Race&date_start%3E%3D${from}&date_start%3C${to}`);
    const s = sessions && sessions[0];
    if (!s) return null;
    const k = s.session_key;
    const [laps, stints, pits, pos] = await Promise.allSettled([
      getJSON(`${OPENF1}/laps?session_key=${k}&driver_number=${NUM}`),
      getJSON(`${OPENF1}/stints?session_key=${k}&driver_number=${NUM}`),
      getJSON(`${OPENF1}/pit?session_key=${k}&driver_number=${NUM}`),
      getJSON(`${OPENF1}/position?session_key=${k}&driver_number=${NUM}`)
    ]);
    const val = (p) => (p.status === 'fulfilled' && Array.isArray(p.value) ? p.value : []);
    const L = val(laps), S = val(stints), P = val(pits), POS = val(pos);
    // Si falló algún pedido (por ejemplo por el límite de la API) el dato queda parcial.
    const failed = [laps, stints, pits, pos].filter((p) => p.status !== 'fulfilled').length;
    if (!L.length && !S.length && !POS.length) return null;

    const times = L.map((l) => l.lap_duration).filter((x) => typeof x === 'number' && x > 0);
    const speeds = L.flatMap((l) => [l.st_speed, l.i1_speed, l.i2_speed]).filter((x) => typeof x === 'number' && x > 0);

    // Posición al terminar cada vuelta.
    const posSorted = POS.slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const lapsSorted = L.slice().sort((a, b) => a.lap_number - b.lap_number);
    const perLap = [];
    if (posSorted.length) {
      perLap.push(posSorted[0].position);
      for (let i = 0; i < lapsSorted.length; i++) {
        const next = lapsSorted[i + 1];
        const t = next && next.date_start ? Date.parse(next.date_start)
          : (lapsSorted[i].date_start && lapsSorted[i].lap_duration ? Date.parse(lapsSorted[i].date_start) + lapsSorted[i].lap_duration * 1000 : null);
        if (t == null) continue;
        let p = null;
        for (const x of posSorted) { if (Date.parse(x.date) <= t) p = x.position; else break; }
        if (p != null) perLap.push(p);
      }
    }

    return {
      bestLap: times.length ? Math.min(...times) : null,
      topSpeed: speeds.length ? Math.max(...speeds) : null,
      totalLaps: lapsSorted.length ? lapsSorted[lapsSorted.length - 1].lap_number : null,
      stints: S.slice().sort((a, b) => a.stint_number - b.stint_number)
        .map((x) => ({ compound: (x.compound || '').toUpperCase(), from: x.lap_start, to: x.lap_end })),
      stops: P.length,
      perLap,
      failed
    };
  }

  // Resultado provisorio armado con OpenF1 mientras Jolpica no publica (tarda unas horas).
  // Tiene la misma forma que el de Jolpica, con provisional: true, así se dibuja igual.
  const PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  async function openf1Results(race) {
    const from = new Date(Date.parse(race.raceDay + 'T00:00:00-03:00') - 3 * dayMs).toISOString().slice(0, 10);
    const to = new Date(Date.parse(race.raceDay + 'T00:00:00-03:00') + 2 * dayMs).toISOString().slice(0, 10);
    const list = await getJSON(`${OPENF1}/sessions?year=2026&date_start%3E%3D${from}&date_start%3C${to}`);
    const by = (n) => (list || []).filter((x) => x.session_name === n).pop();
    const raceS = by('Race');
    if (!raceS) return null;
    const k = raceS.session_key;
    const [res, drv, grid] = await Promise.allSettled([
      getJSON(`${OPENF1}/session_result?session_key=${k}`),
      getJSON(`${OPENF1}/drivers?session_key=${k}`),
      getJSON(`${OPENF1}/starting_grid?session_key=${k}`)
    ]);
    const arr = (p) => (p.status === 'fulfilled' && Array.isArray(p.value) ? p.value : []);
    const R = arr(res);
    if (!R.length) return null;
    const names = new Map(arr(drv).map((d) => [d.driver_number, d]));
    const grids = new Map(arr(grid).map((g) => [g.driver_number, g.position]));
    const order = (x) => (x.position != null ? x.position : 100 + (x.dsq ? 2 : x.dns ? 1 : 0));
    const results = R.slice().sort((a, b) => order(a) - order(b) || (b.number_of_laps || 0) - (a.number_of_laps || 0))
      .map((x) => {
        const d = names.get(x.driver_number) || {};
        const out = x.position == null || x.dnf || x.dns || x.dsq;
        return {
          positionText: x.dsq ? 'D' : out ? 'R' : String(x.position),
          points: String(x.points != null ? x.points : (!out && x.position <= 10 ? PTS[x.position - 1] : 0)),
          grid: grids.has(x.driver_number) ? String(grids.get(x.driver_number)) : null,
          status: x.dsq ? 'Disqualified' : x.dns ? 'Did not start' : out ? 'Retired' : 'Finished',
          Driver: { permanentNumber: String(x.driver_number), familyName: d.last_name || d.name_acronym || '#' + x.driver_number }
        };
      });
    const out = { results, raceName: race.gp, provisional: true };
    const mineIn = async (n) => {
      const s = by(n);
      if (!s) return null;
      try { return (await getJSON(`${OPENF1}/session_result?session_key=${s.session_key}&driver_number=${NUM}`))[0] || null; } catch (e) { return null; }
    };
    const [q, spr] = await Promise.all([mineIn('Qualifying'), race.sprint ? mineIn('Sprint') : null]);
    if (q && q.position != null) out.qualy = String(q.position);
    if (spr) out.sprint = { pos: spr.position != null && !spr.dnf ? String(spr.position) : 'R', points: String(spr.points || 0) };
    return out;
  }

  // Datos de un GP directo de las APIs.
  async function fetchRace(race) {
    const [j0, o] = await Promise.allSettled([jolpica(race), openf1(race)]);
    let j = j0;
    if (j.status !== 'fulfilled' || !j.value) j = await openf1Results(race).then((value) => ({ status: 'fulfilled', value }), () => ({ status: 'rejected' }));
    const data = {
      j: j.status === 'fulfilled' ? j.value : null,
      o: o.status === 'fulfilled' ? o.value : null
    };
    if (!data.j && !data.o) return null;
    data.complete = isComplete(data);
    return data;
  }
  function isComplete(d) {
    const o = d && d.o;
    if (!d || !d.j || d.j.provisional || !o || o.failed) return false;
    // Varios juegos de neumáticos sin paradas, o sin vuelta a vuelta: faltan datos.
    if (o.stints.length > 1 && !o.stops) return false;
    return o.perLap.length >= 2;
  }

  // En la página: archivo guardado → copia del navegador → /api/data → API directa.
  // El archivo manda: así un dato malo guardado en el navegador no tapa uno bueno.
  // Copia completa ya guardada en el navegador (sin pedir nada), para dibujar al instante.
  function peek(race) {
    const c = cacheGet(race.id);
    return c && isComplete(c) ? c : null;
  }
  async function load(race) {
    const saved = await getStatic('race-' + race.id);
    if (saved && saved.complete) { cacheSet(race.id, saved); return saved; }
    const cached = cacheGet(race.id);
    if (cached && isComplete(cached)) return cached;
    let data = await getLive('race-' + race.id);
    if (!data) data = await fetchRace(race).catch(() => null);
    if (data && data.complete) cacheSet(race.id, data);
    return data || saved || cached;
  }

  // ---------- resultado de Franco en cada sesión del fin de semana ----------
  const SESSION_ES = {
    'Practice 1': 'Práctica Libre 1', 'Practice 2': 'Práctica Libre 2', 'Practice 3': 'Práctica Libre 3',
    'Sprint Qualifying': 'Clasificación Sprint', 'Sprint Shootout': 'Clasificación Sprint',
    'Sprint': 'Carrera Sprint', 'Qualifying': 'Clasificación', 'Race': 'Carrera'
  };
  // known: sesiones ya guardadas (no se vuelven a pedir; OpenF1 gratis permite 30 pedidos por minuto).
  async function fetchWeekend(race, known) {
    const have = new Map(((known && known.sessions) || []).map((x) => [x.name + '|' + x.end, x]));
    const ss = window.sessionsOf(race);
    if (!ss.length) return null;
    const first = Math.min(...ss.map((x) => x.at));
    const from = new Date(first - dayMs).toISOString().slice(0, 10);
    const to = new Date(Date.parse(race.raceDay + 'T00:00:00-03:00') + 2 * dayMs).toISOString().slice(0, 10);
    const list = await getJSON(`${OPENF1}/sessions?year=2026&date_start%3E%3D${from}&date_start%3C${to}`);
    if (!Array.isArray(list) || !list.length) return null;
    list.sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
    const sessions = [];
    let pending = 0;
    for (const s of list) {
      const name = SESSION_ES[s.session_name];
      if (!name || s.is_cancelled) continue;
      if (Date.parse(s.date_end) > Date.now()) { pending++; continue; }
      const old = have.get(name + '|' + s.date_end);
      if (old) { sessions.push(old); continue; }
      let x = null, mate = null;
      try { x = (await getJSON(`${OPENF1}/session_result?session_key=${s.session_key}&driver_number=${NUM}`))[0]; } catch (e) { /* todavía no está */ }
      if (!x || (x.position == null && !x.dnf && !x.dns && !x.dsq)) { pending++; continue; }
      try { mate = (await getJSON(`${OPENF1}/session_result?session_key=${s.session_key}&driver_number=${MATE_NUM}`))[0]; } catch (e) { /* sin dato del compañero */ }
      const res = (y) => ({ pos: y.position, dnf: !!y.dnf, dns: !!y.dns, dsq: !!y.dsq });
      sessions.push({ name, end: s.date_end, ...res(x), ...(mate ? { mate: res(mate) } : {}) });
    }
    return { id: race.id, sessions, complete: pending === 0 && sessions.length > 0 };
  }

  // Ventana del fin de semana: desde la primera sesión hasta 2 días después de la carrera.
  function inWeekend(race, t = Date.now()) {
    const ss = window.sessionsOf(race);
    if (!ss.length) return false;
    return t >= Math.min(...ss.map((x) => x.at)) && t < Date.parse(race.end) + 2 * dayMs;
  }
  // "Ventana caliente": de que termina una sesión hasta 3 h después. OpenF1 gratis publica los datos
  // unos 30 minutos después del final; en ese rato la página consulta seguido y el resto del tiempo no.
  function hotSession(race, t = Date.now()) {
    return window.sessionsOf(race).some((x) => { const end = x.at + window.sessionDur(x.name); return t >= end && t < end + 3 * 3600000; });
  }
  async function loadWeekend(race) {
    if (!window.sessionsOf(race).length) return null;
    const saved = await getStatic('weekend-' + race.id);
    if ((saved && saved.complete) || !inWeekend(race)) return saved;
    return (await getLive('weekend-' + race.id)) || saved;
  }

  // ---------- presentación ----------
  const fmtLap = (s) => {
    if (s == null) return '—';
    const m = Math.floor(s / 60);
    const r = (s - m * 60).toFixed(3).padStart(6, '0');
    return `${m}:${r}`;
  };
  const posLabel = (r) => {
    if (!r) return '—';
    if (/^\d+$/.test(r.positionText)) return 'P' + r.positionText;
    if (r.positionText === 'D') return 'DSQ';
    return 'DNF';
  };
  const STATUS_ES = { retired: 'ABANDONO', accident: 'ACCIDENTE', collision: 'CHOQUE', 'collision damage': 'DAÑO POR CHOQUE',
    disqualified: 'DESCALIFICADO', 'did not start': 'NO LARGÓ', engine: 'MOTOR', gearbox: 'CAJA DE CAMBIOS', hydraulics: 'HIDRÁULICA',
    brakes: 'FRENOS', suspension: 'SUSPENSIÓN', 'power unit': 'UNIDAD DE POTENCIA', electrical: 'ELÉCTRICO', puncture: 'PINCHAZO', withdrew: 'SE RETIRÓ' };
  const statusEs = (s) => STATUS_ES[String(s).toLowerCase()] || String(s).toUpperCase();
  const TYRE = {
    SOFT: ['#E8002D', '#FFFFFF', 'S'], MEDIUM: ['#FFD12E', '#04142B', 'M'], HARD: ['#EDEDED', '#04142B', 'H'],
    INTERMEDIATE: ['#43B02A', '#FFFFFF', 'I'], WET: ['#0067FF', '#FFFFFF', 'W']
  };

  function chart(perLap, W, h) {
    if (!perLap || perLap.length < 2) return '';
    const H = h || (W < 800 ? 190 : 140), padL = 44, padR = 16, padT = 14, padB = 26;
    const maxP = Math.max(22, ...perLap);
    const x = (i) => padL + (i / (perLap.length - 1)) * (W - padL - padR);
    const y = (p) => padT + ((p - 1) / (maxP - 1)) * (H - padT - padB);
    const pts = perLap.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
    const grid = [1, 5, 10, 15, 20].filter((p) => p <= maxP).map((p) =>
      `<line x1="${padL}" x2="${W - padR}" y1="${y(p)}" y2="${y(p)}" stroke="#163A66" stroke-width="1.5"/>
       <text x="${padL - 10}" y="${y(p) + 7}" text-anchor="end" fill="#74ACDF" font-size="20" font-weight="700">P${p}</text>`).join('');
    const last = perLap.length - 1;
    return `
      <div class="r-label">POSICIÓN VUELTA A VUELTA</div>
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
        ${grid}
        <text x="${padL}" y="${H - 2}" fill="#74ACDF" font-size="18" font-weight="700">LARGADA</text>
        <text x="${W - padR}" y="${H - 2}" text-anchor="end" fill="#74ACDF" font-size="18" font-weight="700">VUELTA ${last}</text>
        <polyline points="${pts}" fill="none" stroke="#FF87BC" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${x(0)}" cy="${y(perLap[0])}" r="7" fill="#0090FF"/>
        <circle cx="${x(last)}" cy="${y(perLap[last])}" r="9" fill="#FF87BC" stroke="#04142B" stroke-width="3"/>
      </svg>`;
  }

  function tyres(stints, totalLaps) {
    if (!stints || !stints.length) return '';
    const total = totalLaps || Math.max(...stints.map((s) => s.to || 0)) || 1;
    const segs = stints.map((s) => {
      const t = TYRE[s.compound] || ['#5A6B85', '#FFFFFF', '?'];
      const laps = Math.max(1, (s.to || total) - (s.from || 1) + 1);
      // En stints cortos solo la letra, para que no se corte el texto.
      const label = laps / total >= 0.22 ? `<span>V${s.from || 1}–${s.to || total}</span>` : '';
      return `<div style="flex:${laps};background:${t[0]};color:${t[1]}${label ? '' : ';justify-content:center;padding:0'}" class="r-tyre">
        <b>${t[2]}</b>${label}</div>`;
    }).join('');
    return `<div class="r-label">NEUMÁTICOS</div><div class="r-tyres">${segs}</div>`;
  }

  function render(race, data, header, opts) {
    const width = (opts && opts.width) || 920;
    const j = data.j, o = data.o;
    const mine = j && j.results.find((x) => isFranco(x.Driver));
    // Sin el resultado oficial (Jolpica tarda unas horas), se usa lo que OpenF1 ya dio de cada sesión.
    const wk = !mine && opts && opts.weekend && opts.weekend.sessions || [];
    const wkOf = (n) => wk.find((x) => x.name === n);
    const wkLabel = (x) => x.dsq ? 'DSQ' : x.dns ? 'DNS' : x.dnf ? 'DNF' : x.pos != null ? 'P' + x.pos : null;
    const wkRace = wkOf('Carrera'), wkQualy = wkOf('Clasificación'), wkSprint = wkOf('Carrera Sprint');
    const pos = mine ? posLabel(mine) : (wkRace && wkLabel(wkRace)) || '—';
    const grid = mine && mine.grid != null ? (mine.grid === '0' ? 'BOXES' : 'P' + mine.grid) : null;
    const gained = mine && mine.grid != null && /^\d+$/.test(mine.positionText) && mine.grid !== '0'
      ? Number(mine.grid) - Number(mine.positionText) : null;
    const gainTxt = gained == null ? '' : gained > 0 ? `+${gained} PUESTOS` : gained < 0 ? `${gained} PUESTOS` : 'MISMO PUESTO';
    const pts = mine ? Number(mine.points) : null;

    const tiles = [];
    if (j && j.qualy) tiles.push(['CLASIFICACIÓN', 'P' + j.qualy]);
    else if (wkQualy && wkLabel(wkQualy)) tiles.push(['CLASIFICACIÓN', wkLabel(wkQualy)]);
    if (j && j.sprint) tiles.push(['SPRINT', /^\d+$/.test(j.sprint.pos) ? 'P' + j.sprint.pos : 'DNF']);
    else if (wkSprint && wkLabel(wkSprint)) tiles.push(['SPRINT', wkLabel(wkSprint)]);
    if (o) {
      tiles.push(['MEJOR VUELTA', fmtLap(o.bestLap)]);
      tiles.push(['VEL. MÁXIMA', o.topSpeed ? Math.round(o.topSpeed) + ' km/h' : '—']);
      tiles.push(['PARADAS', String(o.stops)]);
    }

    let top = '';
    if (j) {
      const ten = j.results.slice(0, 10).map((r) => `
        <div class="r-row${isFranco(r.Driver) ? ' me' : ''}"><span>${posLabel(r)}</span>${esc((r.Driver.familyName || '').toUpperCase())}</div>`).join('');
      const extra = mine && !j.results.slice(0, 10).includes(mine)
        ? `<div class="r-row me wide"><span>${pos}</span>COLAPINTO</div>` : '';
      top = `<div class="r-label">TOP 10</div><div class="r-top">${ten}${extra}</div>`;
    }

    return `<div class="hd">${header}</div><div class="ca">
      <div class="r-hero">
        <div class="r-pos">${pos}</div>
        <div class="r-hero-side">
          ${grid ? `<div>LARGÓ <b>${grid}</b>${gainTxt ? ` · ${gainTxt}` : ''}</div>` : ''}
          ${pts != null ? `<div class="r-pts">${pts} ${pts === 1 ? 'PUNTO' : 'PUNTOS'}</div>` : ''}
          ${mine && mine.status && !/^\d+$/.test(mine.positionText) ? `<div>${esc(statusEs(mine.status))}</div>` : ''}
          ${!mine || j.provisional ? `<div>RESULTADO OFICIAL EN CAMINO</div>` : ''}
        </div>
      </div>
      ${tiles.length ? `<div class="r-tiles" style="grid-template-columns:repeat(${tiles.length},minmax(0,1fr));--tile-cols:${tiles.length % 3 === 0 || tiles.length === 5 ? 3 : 2}">
        ${tiles.map(([k, v]) => `<div class="r-tile"><div>${k}</div><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
      ${o ? tyres(o.stints, o.totalLaps) : ''}</div>
      <div class="cb">${o ? chart(o.perLap, width, opts && opts.chartH) : ''}
      ${top}</div>`;
  }

  // ---------- tabla del campeonato ----------
  // Se guarda una hora en el navegador: cambia solo después de cada carrera.
  async function fetchStandings() {
    const [d, c] = await Promise.all([
      getJSON(`${JOLPICA}/2026/driverstandings.json?limit=40`),
      getJSON(`${JOLPICA}/2026/constructorstandings.json?limit=40`)
    ]);
    const dl = d.MRData.StandingsTable.StandingsLists[0];
    const cl = c.MRData.StandingsTable.StandingsLists[0];
    if (!dl && !cl) return null;
    const round = (dl && dl.round) || (cl && cl.round) || null;
    const rr = round ? (await seasonRaces()).find((x) => String(x.round) === String(round)) : null;
    return {
      round,
      lastRaceDate: rr ? rr.date : null,
      drivers: dl ? dl.DriverStandings.map((x) => ({
        pos: x.positionText || x.position, pts: Number(x.points), wins: Number(x.wins || 0),
        name: `${x.Driver.givenName || ''} ${x.Driver.familyName || ''}`.trim(),
        last: x.Driver.familyName || '',
        id: x.Driver.driverId,
        team: teamName((x.Constructors && x.Constructors.length ? x.Constructors[x.Constructors.length - 1].name : '')),
        me: isFranco(x.Driver)
      })) : [],
      teams: cl ? cl.ConstructorStandings.map((x) => ({
        pos: x.positionText || x.position, pts: Number(x.points), wins: Number(x.wins || 0),
        name: teamName(x.Constructor.name), me: /alpine/i.test(x.Constructor.name || '')
      })) : []
    };
  }

  // Navegador → archivo guardado si está al día → /api/data → API directa → archivo aunque esté viejo.
  // Recién terminada una sprint o carrera se saltea el archivo y el navegador guarda solo 10 minutos.
  async function cachedOrFetch(key, fileName, fetcher) {
    const fresh = pointsJustScored();
    const c = cacheGet(key);
    if (c && Date.now() - c.at < (fresh ? 600000 : 3600000) && upToDate(c.data)) return c.data;
    const saved = await getStatic(fileName);
    if (saved && upToDate(saved) && !fresh) { cacheSet(key, { at: Date.now(), data: saved }); return saved; }
    let data = await getLive(fileName);
    if (!data) {
      try { data = await fetcher(); } catch (e) { if (!saved) throw e; }
    }
    if (data) { cacheSet(key, { at: Date.now(), data }); return data; }
    return saved;
  }

  const loadStandings = () => cachedOrFetch('standings', 'standings', fetchStandings);

  const teamName = (n) => String(n || '').replace(/\s+F1 Team$/i, '');

  function standingsList(rows, title, kind, maxPts) {
    if (!rows.length) return '';
    const max = maxPts || Math.max(1, ...rows.map((r) => r.pts));
    const items = rows.map((r) => `
      <div class="st-row${r.me ? (kind === 'teams' ? ' team' : ' me') : ''}">
        <div class="st-bar" style="width:${((r.pts / max) * 100).toFixed(1)}%"></div>
        <div class="st-pos">${esc(r.pos)}</div>
        <div class="st-who"><b>${esc((kind === 'drivers' ? r.last : r.name).toUpperCase())}</b>${kind === 'drivers' && r.team ? `<span>${esc(r.team.toUpperCase())}</span>` : ''}</div>
        <div class="st-pts">${r.pts}<small>PTS</small></div>
      </div>`).join('');
    return `<div><div class="r-label" style="margin-top:0">${title}</div><div class="st-list">${items}</div></div>`;
  }

  function renderStandings(d, opts) {
    const two = opts && opts.twoCols;
    if (opts && opts.wide) {
      // Pantalla ancha: los pilotos en dos columnas y los constructores en la tercera.
      const half = Math.ceil(d.drivers.length / 2);
      const max = Math.max(1, ...d.drivers.map((r) => r.pts));
      return `<div class="st-cols three">
        ${standingsList(d.drivers.slice(0, half), 'PILOTOS', 'drivers', max)}
        ${standingsList(d.drivers.slice(half), '&nbsp;', 'drivers', max)}
        ${standingsList(d.teams, 'CONSTRUCTORES', 'teams')}
      </div>`;
    }
    return `<div class="st-cols${two ? ' two' : ''}">
      ${standingsList(d.drivers, 'PILOTOS', 'drivers')}
      ${standingsList(d.teams, 'CONSTRUCTORES', 'teams')}
    </div>`;
  }

  // ---------- temporada de Franco + duelo con su compañero ----------
  const num = (t) => (/^\d+$/.test(String(t)) ? Number(t) : null);

  async function driverSeason(id) {
    const [res, qual, spr] = await Promise.all([
      getJSON(`${JOLPICA}/2026/drivers/${id}/results.json?limit=100`),
      getJSON(`${JOLPICA}/2026/drivers/${id}/qualifying.json?limit=100`),
      getJSON(`${JOLPICA}/2026/drivers/${id}/sprint.json?limit=100`).catch(() => null)
    ]);
    const races = {};
    for (const r of res.MRData.RaceTable.Races || []) {
      const x = r.Results && r.Results[0];
      if (!x) continue;
      races[r.round] = { round: Number(r.round), date: r.date, posText: x.positionText, pos: num(x.positionText),
        order: Number(x.position), points: Number(x.points) || 0, status: x.status };
    }
    const quali = {};
    for (const r of (qual.MRData.RaceTable.Races || [])) {
      const x = r.QualifyingResults && r.QualifyingResults[0];
      if (x) quali[r.round] = Number(x.position);
    }
    const sprint = {};
    for (const r of ((spr && spr.MRData.RaceTable.Races) || [])) {
      const x = r.SprintResults && r.SprintResults[0];
      if (x) sprint[r.round] = Number(x.points) || 0;
    }
    return { races, quali, sprint };
  }

  async function fetchSeason(standings) {
    const st = standings || await loadStandings();
    if (!st) return null;
    const me = st.drivers.find((d) => d.me);
    const mate = st.drivers.find((d) => !d.me && /alpine/i.test(d.team));
    const meId = (me && me.id) || 'colapinto';
    const mateId = (mate && mate.id) || 'gasly';
    const [a, b] = await Promise.all([driverSeason(meId), driverSeason(mateId)]);
    return { round: st.round, lastRaceDate: st.lastRaceDate || null,
      me: me || { last: 'Colapinto' }, mate: mate || { last: 'Gasly' }, a, b };
  }

  const loadSeason = () => cachedOrFetch('season', 'season', () => fetchSeason());

  function cumulative(d) {
    const rounds = [...new Set([...Object.keys(d.races), ...Object.keys(d.sprint)].map(Number))].sort((x, y) => x - y);
    let acc = 0;
    return rounds.map((r) => { acc += (d.races[r] ? d.races[r].points : 0) + (d.sprint[r] || 0); return { round: r, pts: acc }; });
  }

  function pointsChart(ca, cb, W, nameA, nameB) {
    const rounds = [...new Set([...ca, ...cb].map((p) => p.round))].sort((x, y) => x - y);
    if (rounds.length < 2) return '';
    const H = W < 800 ? 230 : 190, padL = 50, padR = 70, padT = 14, padB = 30;
    const maxV = Math.max(10, ...ca.map((p) => p.pts), ...cb.map((p) => p.pts));
    const step = maxV > 100 ? 50 : maxV > 40 ? 20 : 10;
    const top = Math.ceil(maxV / step) * step;
    const x = (r) => padL + ((rounds.indexOf(r)) / (rounds.length - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - v / top) * (H - padT - padB);
    const line = (arr, col, w) => {
      if (!arr.length) return '';
      const pts = arr.map((p) => `${x(p.round).toFixed(1)},${y(p.pts).toFixed(1)}`).join(' ');
      const last = arr[arr.length - 1];
      return `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${x(last.round)}" cy="${y(last.pts)}" r="7" fill="${col}"/>
        <text x="${x(last.round) + 12}" y="${y(last.pts) + 7}" fill="${col}" font-size="22" font-weight="800">${last.pts}</text>`;
    };
    const grid = [];
    for (let v = 0; v <= top; v += step) {
      grid.push(`<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="#163A66" stroke-width="1.5"/>
        <text x="${padL - 10}" y="${y(v) + 7}" text-anchor="end" fill="#74ACDF" font-size="18" font-weight="700">${v}</text>`);
    }
    return `
      <div class="r-label">PUNTOS ACUMULADOS ·
        <span style="color:#FF87BC">${esc(nameA.toUpperCase())}</span> VS <span style="color:#74ACDF">${esc(nameB.toUpperCase())}</span></div>
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
        ${grid.join('')}
        <text x="${padL}" y="${H - 4}" fill="#74ACDF" font-size="18" font-weight="700">FECHA ${rounds[0]}</text>
        <text x="${W - padR}" y="${H - 4}" text-anchor="end" fill="#74ACDF" font-size="18" font-weight="700">FECHA ${rounds[rounds.length - 1]}</text>
        ${line(cb, '#74ACDF', 4)}
        ${line(ca, '#FF87BC', 5)}
      </svg>`;
  }

  function renderSeason(d, opts) {
    const W = (opts && opts.width) || 920;
    const A = Object.values(d.a.races), B = d.b.races;
    const classified = A.filter((r) => r.pos != null);
    const best = classified.length ? classified.reduce((m, r) => (r.pos < m.pos ? r : m)) : null;
    const avg = classified.length ? classified.reduce((s2, r) => s2 + r.pos, 0) / classified.length : null;
    const inPts = A.filter((r) => r.points > 0).length;
    const dnf = A.filter((r) => r.pos == null).length;
    const ca = cumulative(d.a), cb = cumulative(d.b);
    const ptsA = d.me.pts != null ? d.me.pts : (ca.length ? ca[ca.length - 1].pts : 0);
    const ptsB = d.mate.pts != null ? d.mate.pts : (cb.length ? cb[cb.length - 1].pts : 0);

    const tiles = [
      ['PUNTOS', String(ptsA)],
      ['CAMPEONATO', d.me.pos ? 'P' + d.me.pos : '—'],
      ['MEJOR RESULTADO', best ? 'P' + best.pos : '—'],
      ['PROMEDIO', avg ? 'P' + avg.toFixed(1).replace('.', ',') : '—'],
      ['EN LOS PUNTOS', `${inPts}/${A.length}`],
      ['ABANDONOS', String(dnf)]
    ];

    // Duelo con el compañero: solo fechas en las que corrieron los dos.
    let qa = 0, qb = 0, ra = 0, rb = 0;
    for (const k of Object.keys(d.a.quali)) if (d.b.quali[k] != null) (d.a.quali[k] < d.b.quali[k] ? qa++ : qb++);
    for (const k of Object.keys(d.a.races)) if (B[k]) (d.a.races[k].order < B[k].order ? ra++ : rb++);
    const bestB = Object.values(B).filter((r) => r.pos != null).reduce((m, r) => (!m || r.pos < m.pos ? r : m), null);
    const duel = [
      ['CLASIFICACIÓN', qa, qb, true],
      ['CARRERA', ra, rb, true],
      ['PUNTOS', ptsA, ptsB, true],
      ['MEJOR RESULTADO', best ? 'P' + best.pos : '—', bestB ? 'P' + bestB.pos : '—', false]
    ].map(([k, va, vb, bar]) => {
      const tot = (Number(va) || 0) + (Number(vb) || 0);
      const pa = bar && tot ? (Number(va) / tot) * 100 : 50;
      return `<div class="du-row">
        <div class="du-vals"><b class="du-a">${esc(va)}</b><span>${k}</span><b class="du-b">${esc(vb)}</b></div>
        ${bar ? `<div class="du-bar"><i style="width:${pa.toFixed(1)}%"></i></div>` : ''}
      </div>`;
    }).join('');

    const chips = A.sort((x, y) => x.round - y.round).map((r) => `
      <div class="sz-chip${r.points > 0 ? ' pts' : ''}${r.pos == null ? ' out' : ''}">
        <span>F${r.round}</span><b>${r.pos != null ? 'P' + r.pos : 'DNF'}</b></div>`).join('');

    return `<div class="ca">
      <div class="r-tiles sz-tiles">${tiles.map(([k, v]) => `<div class="r-tile"><div>${k}</div><b>${esc(v)}</b></div>`).join('')}</div>
      ${pointsChart(ca, cb, W, d.me.last || 'Colapinto', d.mate.last || 'Gasly')}</div>
      <div class="cb"><div class="r-label">DUELO EN ALPINE · <span style="color:#FF87BC">${esc((d.me.last || 'Colapinto').toUpperCase())}</span> VS <span style="color:#74ACDF">${esc((d.mate.last || 'Gasly').toUpperCase())}</span></div>
      <div class="du">${duel}</div>
      <div class="r-label">CARRERA A CARRERA</div>
      <div class="sz-legend">
        <span><i class="pts"></i>SUMÓ PUNTOS</span>
        <span><i></i>SIN PUNTOS</span>
        <span><i class="out"></i>ABANDONO</span>
      </div>
      <div class="sz-chips">${chips}</div></div>`;
  }

  window.Results = {
    load, peek, render, loadStandings, renderStandings, loadSeason, renderSeason, loadWeekend, inWeekend, hotSession, isComplete,
    // usados por scripts/update-data.mjs y api/data.js
    fetchRace, fetchStandings, fetchSeason, fetchWeekend
  };
})();
