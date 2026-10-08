// Resultados de Franco Colapinto una vez terminado cada GP.
// Fuentes gratuitas y sin cuenta:
//   - Jolpica-F1 (ex Ergast): resultado, largada, puntos, clasificación, sprint y top 10.
//   - OpenF1 (datos históricos): vueltas, velocidad, neumáticos, paradas y posición vuelta a vuelta.
//
// Para no consultar las APIs en cada visita, un proceso de GitHub (scripts/update-data.mjs)
// guarda los datos en la carpeta data/. La página lee primero esos archivos y solo
// va a la API si falta el archivo o quedó desactualizado.
(function () {
  const API = (typeof window !== 'undefined' && window.F1_API) || {};
  const JOLPICA = API.jolpica || 'https://api.jolpi.ca/ergast/f1';
  const OPENF1 = API.openf1 || 'https://api.openf1.org/v1';
  const NUM = 43;
  const CACHE_V = 'r1';

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
      const res = await fetch(`data/${name}.json`, { cache: 'no-cache' });
      return res.ok ? await res.json() : null;
    } catch (e) { return null; }
  }

  const dayMs = 86400000;
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
      perLap
    };
  }

  // Datos de un GP directo de las APIs.
  async function fetchRace(race) {
    const [j, o] = await Promise.allSettled([jolpica(race), openf1(race)]);
    const data = {
      j: j.status === 'fulfilled' ? j.value : null,
      o: o.status === 'fulfilled' ? o.value : null
    };
    if (!data.j && !data.o) return null;
    data.complete = !!(data.j && data.o);
    return data;
  }

  // En la página: navegador → archivo guardado → API.
  async function load(race) {
    const cached = cacheGet(race.id);
    if (cached && cached.complete) return cached;
    const saved = await getStatic('race-' + race.id);
    if (saved && saved.complete) { cacheSet(race.id, saved); return saved; }
    const data = await fetchRace(race);
    if (!data && saved) return saved;
    if (data && data.complete) cacheSet(race.id, data);
    return data;
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
  const TYRE = {
    SOFT: ['#E8002D', '#FFFFFF', 'S'], MEDIUM: ['#FFD12E', '#04142B', 'M'], HARD: ['#EDEDED', '#04142B', 'H'],
    INTERMEDIATE: ['#43B02A', '#FFFFFF', 'I'], WET: ['#0067FF', '#FFFFFF', 'W']
  };

  function chart(perLap, W) {
    if (!perLap || perLap.length < 2) return '';
    const H = W < 800 ? 190 : 140, padL = 44, padR = 16, padT = 14, padB = 26;
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
    const pos = posLabel(mine);
    const grid = mine ? (mine.grid === '0' ? 'BOXES' : 'P' + mine.grid) : null;
    const gained = mine && /^\d+$/.test(mine.positionText) && mine.grid !== '0'
      ? Number(mine.grid) - Number(mine.positionText) : null;
    const gainTxt = gained == null ? '' : gained > 0 ? `+${gained} PUESTOS` : gained < 0 ? `${gained} PUESTOS` : 'MISMO PUESTO';
    const pts = mine ? Number(mine.points) : null;

    const tiles = [];
    if (j && j.qualy) tiles.push(['CLASIFICACIÓN', 'P' + j.qualy]);
    if (j && j.sprint) tiles.push(['SPRINT', /^\d+$/.test(j.sprint.pos) ? 'P' + j.sprint.pos : 'DNF']);
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

    return `${header}
      <div class="r-hero">
        <div class="r-pos">${pos}</div>
        <div class="r-hero-side">
          ${grid ? `<div>LARGÓ <b>${grid}</b>${gainTxt ? ` · ${gainTxt}` : ''}</div>` : ''}
          ${pts != null ? `<div class="r-pts">${pts} ${pts === 1 ? 'PUNTO' : 'PUNTOS'}</div>` : ''}
          ${mine && mine.status && !/^\d+$/.test(mine.positionText) ? `<div>${esc(mine.status.toUpperCase())}</div>` : ''}
        </div>
      </div>
      ${tiles.length ? `<div class="r-tiles" style="grid-template-columns:repeat(${tiles.length},minmax(0,1fr));--tile-cols:${tiles.length % 3 === 0 || tiles.length === 5 ? 3 : 2}">
        ${tiles.map(([k, v]) => `<div class="r-tile"><div>${k}</div><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
      ${o ? tyres(o.stints, o.totalLaps) : ''}
      ${o ? chart(o.perLap, width) : ''}
      ${top}`;
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

  // Navegador (1 h) → archivo guardado si está al día → API → archivo aunque esté viejo.
  async function cachedOrFetch(key, fileName, fetcher) {
    const c = cacheGet(key);
    if (c && Date.now() - c.at < 3600000 && upToDate(c.data)) return c.data;
    const saved = await getStatic(fileName);
    if (saved && upToDate(saved)) { cacheSet(key, { at: Date.now(), data: saved }); return saved; }
    try {
      const data = await fetcher();
      if (data) { cacheSet(key, { at: Date.now(), data }); return data; }
    } catch (e) {
      if (!saved) throw e;
    }
    return saved;
  }

  const loadStandings = () => cachedOrFetch('standings3', 'standings', fetchStandings);

  const teamName = (n) => String(n || '').replace(/\s+F1 Team$/i, '');

  function standingsList(rows, title, kind) {
    if (!rows.length) return '';
    const max = Math.max(1, ...rows.map((r) => r.pts));
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

  const loadSeason = () => cachedOrFetch('season2', 'season', () => fetchSeason());

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

    return `
      <div class="r-tiles sz-tiles">${tiles.map(([k, v]) => `<div class="r-tile"><div>${k}</div><b>${esc(v)}</b></div>`).join('')}</div>
      ${pointsChart(ca, cb, W, d.me.last || 'Colapinto', d.mate.last || 'Gasly')}
      <div class="r-label">DUELO EN ALPINE · <span style="color:#FF87BC">${esc((d.me.last || 'Colapinto').toUpperCase())}</span> VS <span style="color:#74ACDF">${esc((d.mate.last || 'Gasly').toUpperCase())}</span></div>
      <div class="du">${duel}</div>
      <div class="r-label">CARRERA A CARRERA</div>
      <div class="sz-legend">
        <span><i class="pts"></i>SUMÓ PUNTOS</span>
        <span><i></i>SIN PUNTOS</span>
        <span><i class="out"></i>ABANDONO</span>
      </div>
      <div class="sz-chips">${chips}</div>`;
  }

  window.Results = {
    load, render, loadStandings, renderStandings, loadSeason, renderSeason,
    // usados por scripts/update-data.mjs
    fetchRace, fetchStandings, fetchSeason
  };
})();
