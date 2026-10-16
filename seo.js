// Texto de cada página para Google: título, descripción, datos estructurados y la sección
// "info" que va debajo de la placa. Lo usan la página (al navegar) y scripts/build.mjs
// (que deja cada página ya escrita en el HTML, para que Google la lea sin JavaScript).
(function () {
  const RACES = window.RACES;
  const AR = 'America/Argentina/Buenos_Aires';
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  const fmt = (opts, tz = AR) => new Intl.DateTimeFormat('es-AR', { timeZone: tz, ...opts });
  const longDay = (ms) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(ms).replace(',', '');
  const hhmm = (ms, tz = AR) => fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz).format(ms);
  const ymd = (ms, tz) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, tz).format(ms);
  // ISO con el huso de Argentina (−03:00, sin horario de verano).
  const isoAR = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(0, 19) + '-03:00';

  // Hora de la carrera en otros países (el navegador y Node calculan solos el horario de verano).
  const COUNTRIES = [
    ['Argentina', AR], ['Uruguay', 'America/Montevideo'], ['Chile', 'America/Santiago'],
    ['Paraguay', 'America/Asuncion'], ['Bolivia', 'America/La_Paz'], ['Perú', 'America/Lima'],
    ['Colombia', 'America/Bogota'], ['Ecuador', 'America/Guayaquil'], ['Venezuela', 'America/Caracas'],
    ['México', 'America/Mexico_City'], ['España', 'Europe/Madrid']
  ];
  function timeIn(ms, tz) {
    const t = hhmm(ms, tz);
    const d = (Date.parse(ymd(ms, tz).split('/').reverse().join('-')) - Date.parse(ymd(ms, AR).split('/').reverse().join('-'))) / 86400000;
    return d ? `${t} (${d > 0 ? 'día siguiente' : 'día anterior'})` : t;
  }

  const finished = (r, t) => Date.parse(r.end) <= t;
  const upcoming = (t) => RACES.find((r) => Date.parse(r.end) > t) || RACES[RACES.length - 1];
  const raceSession = (r) => window.sessionsOf(r).find((s) => s.key === 'race');
  const isFranco = (d) => d && (d.permanentNumber === '43' || /colapinto/i.test(d.familyName || ''));
  const posTxt = (p) => (/^\d+$/.test(String(p)) ? 'P' + p : p === 'D' ? 'descalificado' : 'abandono');
  // Resultado de Franco en un GP según la temporada guardada (la ronda de la API puede no coincidir).
  function seasonResult(season, r) {
    if (!season) return null;
    return Object.values(season.a.races).find((x) => Math.abs(Date.parse(x.date) - Date.parse(r.raceDay)) <= 1.5 * 86400000) || null;
  }

  // ---------- bloques ----------
  function scheduleTable(r, weekend) {
    const res = {};
    for (const s of (weekend && weekend.sessions) || []) res[s.name] = s;
    const rows = window.sessionsOf(r).map((s) => {
      const x = res[s.name];
      const out = x ? (x.dsq ? 'DSQ' : x.dns ? 'No largó' : x.dnf ? 'Abandono' : 'P' + x.pos) : '';
      return `<tr><td>${cap(longDay(s.at))}</td><td>${esc(s.name)}</td><td><b>${s.time}</b></td>${weekend ? `<td>${out}</td>` : ''}</tr>`;
    }).join('');
    return `<table class="i-table"><thead><tr><th>Día</th><th>Sesión</th><th>Hora argentina</th>${weekend ? '<th>Franco</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function countriesBlock(r) {
    const race = raceSession(r);
    const quali = window.sessionsOf(r).find((s) => s.name === 'Clasificación');
    const rows = COUNTRIES.map(([c, tz]) => `<tr><td>${c}</td><td>${quali ? timeIn(quali.at, tz) : '—'}</td><td><b>${timeIn(race.at, tz)}</b></td></tr>`).join('');
    return `<h2>Horario del ${esc(r.gp)} en otros países</h2>
      <table class="i-table"><thead><tr><th>País</th><th>Clasificación</th><th>Carrera</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function resultBlock(r, data) {
    const j = data && data.j, o = data && data.o;
    const mine = j && j.results.find((x) => isFranco(x.Driver));
    if (!mine) return `<p>Los resultados del ${esc(r.gp)} todavía no están disponibles. Suelen publicarse unas horas después de la carrera.</p>`;
    const pts = Number(mine.points);
    const classified = /^\d+$/.test(mine.positionText);
    const parts = [classified ? `Franco Colapinto terminó <b>${posTxt(mine.positionText)}</b> en el ${esc(r.gp)}`
      : `Franco Colapinto ${mine.positionText === 'D' ? 'fue descalificado' : 'abandonó'} en el ${esc(r.gp)}`];
    if (mine.grid && mine.grid !== '0') parts.push(`largó ${posTxt(mine.grid)}`);
    if (j.qualy) parts.push(`había clasificado ${posTxt(j.qualy)}`);
    let text = parts.join(', ') + ` y sumó <b>${pts} ${pts === 1 ? 'punto' : 'puntos'}</b>.`;
    if (j.sprint) text += /^\d+$/.test(j.sprint.pos) ? ` En la carrera sprint fue ${posTxt(j.sprint.pos)}.` : ' En la carrera sprint abandonó.';
    if (o && o.bestLap) {
      const m = Math.floor(o.bestLap / 60);
      text += ` Su mejor vuelta fue ${m}:${(o.bestLap - m * 60).toFixed(3).padStart(6, '0')}`;
      text += o.topSpeed ? ` y su velocidad máxima, ${Math.round(o.topSpeed)} km/h.` : '.';
    }
    if (o && o.stops) text += ` Hizo ${o.stops} ${o.stops === 1 ? 'parada' : 'paradas'} en boxes.`;
    const rows = j.results.slice(0, 10).concat(classified && Number(mine.position) > 10 ? [mine] : classified ? [] : [mine])
      .map((x) => `<tr${isFranco(x.Driver) ? ' class="me"' : ''}><td>${/^\d+$/.test(x.positionText) ? x.positionText : 'DNF'}</td><td>${esc(x.Driver.givenName)} ${esc(x.Driver.familyName)}</td><td>${esc(((x.Constructor && x.Constructor.name) || '').replace(/\s+F1 Team$/i, ''))}</td><td>${Number(x.points)}</td></tr>`).join('');
    return `<p>${text}</p>
      <h2>Resultado del ${esc(r.gp)} 2026</h2>
      <table class="i-table"><thead><tr><th>Pos.</th><th>Piloto</th><th>Equipo</th><th>Puntos</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function calendar(season, t, currentId) {
    const items = RACES.map((r) => {
      const res = finished(r, t) ? seasonResult(season, r) : null;
      const tag = res ? ` · <b>${res.pos != null ? 'P' + res.pos : 'abandono'}</b>` : finished(r, t) ? '' : r === upcoming(t) ? ' · <b>próxima</b>' : '';
      const label = `Fecha ${r.round}: ${esc(r.gp)}`;
      return `<li${r.id === currentId ? ' aria-current="page"' : ''}><a href="/gp/${r.id}">${label}</a> <span>${esc(r.dates)}${tag}</span></li>`;
    }).join('');
    return `<h2>Calendario 2026 de Colapinto</h2><ol class="i-cal">${items}</ol>`;
  }

  function standingsTables(st) {
    if (!st) return '<p>La tabla del campeonato no está disponible en este momento.</p>';
    const d = st.drivers.map((x) => `<tr${x.me ? ' class="me"' : ''}><td>${esc(x.pos)}</td><td>${esc(x.name)}</td><td>${esc(x.team)}</td><td>${x.pts}</td></tr>`).join('');
    const c = st.teams.map((x) => `<tr${x.me ? ' class="me"' : ''}><td>${esc(x.pos)}</td><td>${esc(x.name)}</td><td>${x.pts}</td></tr>`).join('');
    return `<h2>Campeonato de pilotos</h2>
      <table class="i-table"><thead><tr><th>Pos.</th><th>Piloto</th><th>Equipo</th><th>Puntos</th></tr></thead><tbody>${d}</tbody></table>
      <h2>Campeonato de constructores</h2>
      <table class="i-table"><thead><tr><th>Pos.</th><th>Equipo</th><th>Puntos</th></tr></thead><tbody>${c}</tbody></table>`;
  }

  function seasonBlock(sz) {
    if (!sz) return '<p>Los datos de la temporada no están disponibles en este momento.</p>';
    const A = Object.values(sz.a.races).sort((x, y) => x.round - y.round);
    const done = A.filter((x) => x.pos != null);
    const best = done.reduce((m, x) => (!m || x.pos < m.pos ? x : m), null);
    const inPts = A.filter((x) => x.points > 0).length;
    const mate = sz.mate.name || sz.mate.last;
    const byDate = (x) => RACES.find((r) => Math.abs(Date.parse(r.raceDay) - Date.parse(x.date)) <= 1.5 * 86400000);
    const rows = A.map((x) => {
      const r = byDate(x);
      const q = sz.a.quali[x.round];
      return `<tr><td>${x.round}</td><td>${r ? `<a href="/gp/${r.id}">${esc(r.gp)}</a>` : '—'}</td><td>${q ? 'P' + q : '—'}</td><td>${x.pos != null ? 'P' + x.pos : 'Abandono'}</td><td>${x.points + (sz.a.sprint[x.round] || 0)}</td></tr>`;
    }).join('');
    return `<p>Tras la fecha ${esc(sz.round)}, Franco Colapinto suma <b>${sz.me.pts} puntos</b> y está ${sz.me.pos ? `<b>${sz.me.pos}.º</b> en el campeonato de pilotos` : 'en el campeonato'} con Alpine.
      Su mejor resultado es ${best ? `un <b>P${best.pos}</b>` : '—'} y terminó en los puntos en ${inPts} de ${A.length} carreras.
      Su compañero de equipo, ${esc(mate)}, tiene ${sz.mate.pts} puntos.</p>
      <h2>Carrera a carrera</h2>
      <table class="i-table"><thead><tr><th>Fecha</th><th>Gran Premio</th><th>Clasificó</th><th>Resultado</th><th>Puntos</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ---------- páginas ----------
  // kind: 'home' | 'gp' | 'tabla' | 'temporada'. d: { race, weekend, standings, season } (lo que haya).
  function page(kind, race, d = {}, t = Date.now()) {
    const year = 2026;
    if (kind === 'tabla') {
      const round = d.standings && d.standings.round;
      return {
        path: '/tabla',
        title: `Tabla de la Fórmula 1 ${year}: pilotos y constructores`,
        description: `Posiciones del Mundial de Fórmula 1 ${year}${round ? ` tras la fecha ${round}` : ''}: campeonato de pilotos y de constructores, con Franco Colapinto y Alpine.`,
        h1: `Tabla de posiciones de la Fórmula 1 ${year}`,
        body: standingsTables(d.standings) + calendar(d.season, t)
      };
    }
    if (kind === 'temporada') {
      return {
        path: '/temporada',
        title: `Franco Colapinto ${year}: temporada, puntos y resultados`,
        description: `La temporada ${year} de Franco Colapinto en Alpine: puntos, mejor resultado, resultado de cada Gran Premio y duelo con su compañero de equipo.`,
        h1: `Temporada ${year} de Franco Colapinto`,
        body: seasonBlock(d.season) + calendar(d.season, t)
      };
    }
    const r = race || upcoming(t);
    const done = finished(r, t);
    const rs = raceSession(r);
    const quali = window.sessionsOf(r).find((x) => x.name === 'Clasificación');
    const when = rs ? `el ${longDay(rs.at)} a las ${rs.time} (hora argentina)` : '';
    const where = `${r.track}${r.sub && !/sprint|noche/i.test(r.sub) ? ', ' + r.sub : ''}`;
    let intro, body;
    if (!done && rs) {
      intro = `<p>La carrera del <b>${esc(r.gp)}</b> es <b>${esc(when)}</b>. Es la fecha ${r.round} de 23 del Mundial de Fórmula 1 ${year} y se corre en ${esc(where)}.
        ${r.sprint ? 'Es un fin de semana con carrera sprint.' : ''} Estos son todos los horarios de Franco Colapinto con Alpine, en hora argentina (GMT−3):</p>`;
      body = intro + scheduleTable(r, d.weekend) + countriesBlock(r);
    } else {
      body = resultBlock(r, d.race) + (rs ? `<h2>Horarios del fin de semana</h2>${scheduleTable(r, d.weekend)}` : '');
    }
    if (kind === 'home') {
      body += `<h2>¿A qué hora corre Colapinto?</h2>
        <p>${done ? `La temporada ${year} ya terminó.` : `La próxima carrera de Franco Colapinto es el ${esc(r.gp)}, ${esc(when)}.`}
        Esta página muestra siempre la próxima fecha con la cuenta regresiva a la siguiente sesión, y cuando termina cada Gran Premio, el resultado de Franco:
        posición, largada, puntos, mejor vuelta, neumáticos y posición vuelta a vuelta.</p>`;
    }
    body += calendar(d.season, t, kind === 'gp' ? r.id : null);

    const gpYear = `${r.gp} ${year}`;
    const meta = kind === 'home' ? {
      path: '/',
      title: `Horarios de Colapinto ${year}: próxima carrera en hora argentina`,
      description: `¿A qué hora corre Colapinto? Horarios en hora argentina de cada Gran Premio de Franco Colapinto en la Fórmula 1 ${year}${!done && rs ? `. Próxima carrera: ${r.gp}, ${longDay(rs.at)} a las ${rs.time}` : ''}. Resultados, tabla y temporada.`,
      h1: `Horarios de Franco Colapinto en la Fórmula 1 ${year}`
    } : done ? {
      path: '/gp/' + r.id,
      title: `Colapinto en el ${gpYear}: resultado y horarios`,
      description: `Cómo le fue a Franco Colapinto en el ${gpYear}: posición final, largada, puntos, mejor vuelta, neumáticos y el top 10 de la carrera.`,
      h1: `Franco Colapinto en el ${gpYear}`
    } : {
      path: '/gp/' + r.id,
      title: `Horarios de Colapinto en el ${gpYear} (hora argentina)`,
      description: `Horarios del ${gpYear} en hora argentina: ${quali ? `clasificación ${quali.dow.toLowerCase()} ${quali.time} y ` : ''}carrera ${rs ? `${rs.dow.toLowerCase()} ${rs.day} a las ${rs.time}` : ''}. Prácticas${r.sprint ? ', sprint' : ''}, cuenta regresiva y resultados de Franco Colapinto.`,
      h1: `Horarios de Colapinto en el ${gpYear}`
    };
    return { ...meta, body, jsonld: eventLD(r, meta.path) };
  }

  function eventLD(r, path) {
    const ss = window.sessionsOf(r);
    const start = ss.length ? isoAR(Math.min(...ss.map((s) => s.at))) : r.raceDay;
    const rs = raceSession(r);
    return {
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: `${r.gp} 2026 de Fórmula 1`,
      sport: 'Fórmula 1',
      startDate: start,
      endDate: rs ? isoAR(rs.at + 2 * 3600000) : r.raceDay,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: { '@type': 'Place', name: r.track, address: r.sub && !/sprint|noche/i.test(r.sub) ? r.sub : r.track },
      competitor: { '@type': 'Person', name: 'Franco Colapinto', nationality: 'Argentina' },
      url: path,
      ...(rs ? { subEvent: ss.map((s) => ({ '@type': 'SportsEvent', name: `${s.name} · ${r.gp}`, startDate: isoAR(s.at), location: { '@type': 'Place', name: r.track, address: r.track } })) } : {})
    };
  }

  // HTML de la sección (h1 + cuerpo).
  const section = (p) => `<h1>${esc(p.h1)}</h1>${p.body}
    <p class="i-src">Horarios tomados del calendario oficial de la Fórmula 1 y convertidos a hora argentina. Resultados: Jolpica-F1 y OpenF1.</p>`;

  window.Seo = { page, section, upcoming };
})();
