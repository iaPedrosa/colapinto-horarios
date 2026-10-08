// Resultados de Franco Colapinto una vez terminado cada GP.
// Fuentes gratuitas y sin cuenta:
//   - Jolpica-F1 (ex Ergast): resultado, largada, puntos, clasificación, sprint y top 10.
//   - OpenF1 (datos históricos): vueltas, velocidad, neumáticos, paradas y posición vuelta a vuelta.
(function () {
  const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
  const OPENF1 = 'https://api.openf1.org/v1';
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

  const dayMs = 86400000;
  const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= 1.5 * dayMs;
  const isFranco = (d) => d && (d.permanentNumber === String(NUM) || /colapinto/i.test(d.familyName || '') || d.driverId === 'colapinto');

  // ---------- Jolpica ----------
  async function jolpicaRound(race) {
    const data = await getJSON(`${JOLPICA}/2026.json?limit=40`);
    const races = data.MRData.RaceTable.Races || [];
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

  async function load(race) {
    const cached = cacheGet(race.id);
    if (cached && cached.complete) return cached;
    const [j, o] = await Promise.allSettled([jolpica(race), openf1(race)]);
    const data = {
      j: j.status === 'fulfilled' ? j.value : null,
      o: o.status === 'fulfilled' ? o.value : null
    };
    if (!data.j && !data.o) return null;
    data.complete = !!(data.j && data.o);
    if (data.complete) cacheSet(race.id, data);
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
  async function loadStandings() {
    const KEY = 'standings';
    try {
      const c = cacheGet(KEY);
      if (c && Date.now() - c.at < 3600000) return c.data;
    } catch (e) { /* sin caché */ }
    const [d, c] = await Promise.all([
      getJSON(`${JOLPICA}/2026/driverstandings.json?limit=40`),
      getJSON(`${JOLPICA}/2026/constructorstandings.json?limit=40`)
    ]);
    const dl = d.MRData.StandingsTable.StandingsLists[0];
    const cl = c.MRData.StandingsTable.StandingsLists[0];
    if (!dl && !cl) return null;
    const data = {
      round: (dl && dl.round) || (cl && cl.round) || null,
      drivers: dl ? dl.DriverStandings.map((x) => ({
        pos: x.positionText || x.position, pts: Number(x.points), wins: Number(x.wins || 0),
        name: `${x.Driver.givenName || ''} ${x.Driver.familyName || ''}`.trim(),
        last: x.Driver.familyName || '',
        team: teamName((x.Constructors && x.Constructors.length ? x.Constructors[x.Constructors.length - 1].name : '')),
        me: isFranco(x.Driver)
      })) : [],
      teams: cl ? cl.ConstructorStandings.map((x) => ({
        pos: x.positionText || x.position, pts: Number(x.points), wins: Number(x.wins || 0),
        name: teamName(x.Constructor.name), me: /alpine/i.test(x.Constructor.name || '')
      })) : []
    };
    cacheSet(KEY, { at: Date.now(), data });
    return data;
  }

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

  window.Results = { load, render, loadStandings, renderStandings };
})();
