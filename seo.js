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
  // Hora de la clasificación y la carrera en otros países, como tarjetas.
  function countriesBlock(r) {
    const race = raceSession(r);
    const quali = window.sessionsOf(r).find((s) => s.name === 'Clasificación');
    const items = COUNTRIES.slice(1).map(([c, tz]) => `<li><b>${countryByName(c) ? `<a href="/${countryByName(c).slug}">${c}</a>` : c}</b>
      ${quali ? `<span>Clasificación ${timeIn(quali.at, tz)}</span>` : ''}<span>Carrera <b>${timeIn(race.at, tz)}</b></span></li>`).join('');
    return `<h2>Horario del ${esc(r.gp)} en otros países</h2><ul class="i-tz">${items}</ul>`;
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
    return `<p>${text}</p>`;
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

  // La tabla completa está en la placa; acá, un resumen.
  function standingsText(st) {
    if (!st) return '<p>La tabla del campeonato no está disponible en este momento.</p>';
    const [p1, p2] = st.drivers, [c1] = st.teams;
    const me = st.drivers.find((x) => x.me), alp = st.teams.find((x) => x.me);
    return `<p>Tras la fecha ${esc(st.round)} del Mundial de Fórmula 1 2026, <b>${esc(p1.name)}</b> (${esc(p1.team)}) lidera el campeonato de pilotos con
      ${p1.pts} puntos, ${p1.pts - p2.pts} más que ${esc(p2.name)}. En constructores manda <b>${esc(c1.name)}</b> con ${c1.pts} puntos.
      ${me ? `Franco Colapinto es <b>${esc(me.pos)}.º con ${me.pts} puntos</b>` : ''}${alp ? ` y Alpine está ${esc(alp.pos)}.º entre los equipos, con ${alp.pts}` : ''}.</p>`;
  }

  function seasonBlock(sz) {
    if (!sz) return '<p>Los datos de la temporada no están disponibles en este momento.</p>';
    const A = Object.values(sz.a.races).sort((x, y) => x.round - y.round);
    const done = A.filter((x) => x.pos != null);
    const best = done.reduce((m, x) => (!m || x.pos < m.pos ? x : m), null);
    const inPts = A.filter((x) => x.points > 0).length;
    const mate = sz.mate.name || sz.mate.last;
    return `<p>Tras la fecha ${esc(sz.round)}, Franco Colapinto suma <b>${sz.me.pts} puntos</b> y está ${sz.me.pos ? `<b>${sz.me.pos}.º</b> en el campeonato de pilotos` : 'en el campeonato'} con Alpine.
      Su mejor resultado es ${best ? `un <b>P${best.pos}</b>` : '—'} y terminó en los puntos en ${inPts} de ${A.length} carreras.
      Su compañero de equipo, ${esc(mate)}, tiene ${sz.mate.pts} puntos.</p>`;
  }

  // ---------- crónica del fin de semana ----------
  const puestos = (n) => `${n} ${n === 1 ? 'puesto' : 'puestos'}`;
  function outcome(x, kind) {
    if (x.dsq) return 'fue descalificado';
    if (x.dns) return 'no largó';
    if (x.dnf) return 'abandonó';
    return kind === 'quali' ? `quedó P${x.pos}` : kind === 'race' ? `terminó P${x.pos}` : `fue P${x.pos}`;
  }
  // Una frase por sesión corrida, comparando con el compañero y con la práctica anterior, y la próxima sesión.
  function chronicle(r, w, mateName, t) {
    const ss = (w && w.sessions) || [];
    if (!ss.length) return '';
    const mate = mateName || 'Gasly';
    let lastPractice = null;
    const lines = ss.map((x, i) => {
      const kind = /clasificaci/i.test(x.name) ? 'quali' : /carrera/i.test(x.name) ? 'race' : 'practice';
      let s = `En la ${esc(x.name)}${i === 0 ? ', Franco' : ''} <b>${outcome(x, kind)}</b>`;
      if (kind === 'practice' && x.pos != null) {
        if (lastPractice && lastPractice.pos != null && lastPractice.pos !== x.pos) {
          const d = lastPractice.pos - x.pos;
          s += d > 0 ? ` y mejoró ${puestos(d)} respecto de la ${esc(lastPractice.name)}` : ` y perdió ${puestos(-d)} respecto de la ${esc(lastPractice.name)}`;
        }
        lastPractice = x;
      }
      const m = x.mate;
      if (m && x.pos != null && m.pos != null) {
        const diff = x.pos - m.pos;
        s += diff < 0 ? `; quedó ${puestos(-diff)} delante de ${esc(mate)} (P${m.pos})` : `; quedó ${puestos(diff)} detrás de ${esc(mate)} (P${m.pos})`;
      } else if (m && (m.dnf || m.dns || m.dsq)) {
        s += `; ${esc(mate)} ${outcome(m, kind)}`;
      }
      return s + '.';
    });
    const next = window.sessionsOf(r).find((s) => s.at > t);
    const nextTxt = next ? ` La próxima sesión es la <b>${esc(next.name)}</b>, el ${longDay(next.at)} a las ${next.time} (hora argentina).` : '';
    const last = ss[ss.length - 1];
    return `<h2>Crónica del fin de semana</h2><p>${lines.join(' ')}${nextTxt}</p>
      <p class="i-note">Actualizado después de la ${esc(last.name)}.</p>`;
  }

  // ---------- previa: el circuito, lo que pasó ahí antes y el clima ----------
  const WMO = (c) => c === 0 ? 'despejado' : c <= 2 ? 'algo nublado' : c === 3 ? 'nublado' : c <= 48 ? 'niebla'
    : c <= 57 ? 'llovizna' : c <= 67 ? 'lluvia' : c <= 77 ? 'nieve' : c <= 82 ? 'chaparrones' : 'tormentas';
  const dayName = (date) => cap(new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'long', day: 'numeric' }).format(Date.parse(date + 'T12:00:00Z')).replace(',', ''));
  function previa(r, c, weather) {
    if (!c && !weather) return '';
    const parts = [];
    if (c) {
      const laps = c.history.length ? c.history[c.history.length - 1].laps : null;
      parts.push(`Se corre en ${esc(r.track)}${r.sub && !/sprint|noche/i.test(r.sub) ? ` (${esc(r.sub)})` : ''}${laps ? ` y la carrera tiene ${laps} vueltas` : ''}.`);
      for (const h of c.history.slice().reverse()) {
        const f = h.franco;
        let s = `En ${h.year} ganó ${esc(h.winner)}`;
        if (f) {
          const fin = /^\d+$/.test(f.pos) ? `terminó P${f.pos}` : 'abandonó';
          s += ` y Franco, con ${esc(f.team)}, largó ${f.grid === '0' ? 'desde boxes' : 'P' + f.grid} y ${fin}${f.points ? ` (${f.points} ${f.points === 1 ? 'punto' : 'puntos'})` : ''}`;
        } else {
          s += h.year === 2024 ? '; Franco todavía no había debutado en la Fórmula 1' : '; Franco no corrió esa carrera';
        }
        parts.push(s + '.');
      }
    }
    let clima = '';
    if (weather && weather.days && weather.days.length) {
      clima = `<h3>Pronóstico del clima</h3><ul class="i-tz">${weather.days.map((d) => `<li><b>${dayName(d.date)}</b>
        <span>${WMO(d.code)}</span><span>${d.max}° / ${d.min}° · lluvia ${d.rain}%</span></li>`).join('')}</ul>
        <p class="i-note">Pronóstico de Open-Meteo para el circuito; se actualiza todos los días.</p>`;
    }
    return `<h2>Previa del ${esc(r.gp)}</h2>${parts.length ? `<p>${parts.join(' ')}</p>` : ''}${clima}`;
  }

  // ---------- horarios por país (Argentina sigue siendo la principal) ----------
  const COUNTRY_PAGES = [
    { slug: 'mexico', name: 'México', tz: 'America/Mexico_City' },
    { slug: 'espana', name: 'España', tz: 'Europe/Madrid' },
    { slug: 'chile', name: 'Chile', tz: 'America/Santiago' },
    { slug: 'colombia', name: 'Colombia', tz: 'America/Bogota' },
    { slug: 'uruguay', name: 'Uruguay', tz: 'America/Montevideo' },
    { slug: 'peru', name: 'Perú', tz: 'America/Lima' }
  ];
  const countryBySlug = (slug) => COUNTRY_PAGES.find((c) => c.slug === slug) || null;
  const countryByName = (name) => COUNTRY_PAGES.find((c) => c.name === name) || null;
  // "GMT−6" en la fecha indicada (cambia con el horario de verano).
  const gmt = (tz, at) => (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(at)
    .find((x) => x.type === 'timeZoneName') || { value: 'GMT' }).value.replace('-', '−');
  // Si el país cambia la hora en medio del fin de semana (pasa en España en octubre), el cartel va sin GMT.
  function countryLabel(c, r) {
    const ss = r ? window.sessionsOf(r) : [];
    const offs = new Set(ss.map((s) => gmt(c.tz, s.at)));
    return offs.size === 1 ? `${c.name.toUpperCase()} (${[...offs][0]})` : c.name.toUpperCase();
  }
  const longDayIn = (ms, tz) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }, tz).format(ms).replace(',', '');

  function countryBody(c, d, t) {
    const r = upcoming(t);
    const rs = raceSession(r);
    const done = finished(r, t);
    let body = '';
    if (rs && !done) {
      body += `<p>La próxima carrera de Franco Colapinto es el <b>${esc(r.gp)}</b>: <b>${longDayIn(rs.at, c.tz)} a las ${hhmm(rs.at, c.tz)}</b> en hora de ${c.name}
        (${rs.time} en Argentina). Arriba están todos los horarios del fin de semana en hora de ${c.name}.</p>`;
      body += chronicle(r, d.weekend, d.season && d.season.mate && d.season.mate.last, t);
    }
    const rows = RACES.filter((x) => !finished(x, t) && raceSession(x)).map((x) => {
      const q = window.sessionsOf(x).find((s) => s.name === 'Clasificación');
      const xr = raceSession(x);
      const when = (s) => s ? `${cap(longDayIn(s.at, c.tz))}, ${hhmm(s.at, c.tz)}` : '—';
      return `<li><a href="/gp/${x.id}">${esc(x.gp)}</a><span>Clasificación: ${when(q)}</span><span>Carrera: <b>${when(xr)}</b></span></li>`;
    }).join('');
    if (rows) body += `<h2>Lo que queda de la temporada, en hora de ${c.name}</h2><ul class="i-cal i-rest">${rows}</ul>`;
    body += `<p>¿Estás en Argentina? <a href="/">Mirá los horarios en hora argentina</a>.</p>`;
    return body;
  }

  // ---------- ficha de Franco ----------
  // Datos biográficos chequeados en Wikipedia (es/en); las estadísticas salen de la API (data/career.json).
  const BIRTH = '2003-05-27';
  const ageAt = (t) => {
    const n = new Date(t), b = new Date(BIRTH + 'T12:00:00-03:00');
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  };
  function careerTable(career) {
    if (!career) return '';
    const years = Object.keys(career).sort();
    const sum = (k) => years.reduce((a, y) => a + (career[y][k] || 0), 0);
    const best = Math.min(...years.map((y) => career[y].best).filter(Boolean));
    const rows = years.map((y) => {
      const x = career[y];
      return `<tr><td>${y}</td><td>${esc(x.team)}</td><td>${x.races}</td><td><b>${x.points}</b></td><td>${x.position ? x.position + '.º' : '—'}${x.final ? '' : ' (en curso)'}</td><td>${x.best ? 'P' + x.best : '—'}</td><td>${x.bestQuali ? 'P' + x.bestQuali : '—'}</td></tr>`;
    }).join('');
    return `<div class="i-scroll"><table class="i-table"><thead><tr><th>Año</th><th>Equipo</th><th>Carreras</th><th>Puntos</th><th>Campeonato</th><th>Mejor resultado</th><th>Mejor clasificación</th></tr></thead>
      <tbody>${rows}<tr class="tot"><td>Total</td><td></td><td>${sum('races')}</td><td><b>${sum('points')}</b></td><td></td><td>P${best}</td><td></td></tr></tbody></table></div>`;
  }
  function fichaBody(d, t) {
    const career = d.career;
    const years = career ? Object.keys(career).sort() : [];
    const now = career && career[years[years.length - 1]];
    const team = (now && now.team) || 'Alpine';
    const mate = (d.season && d.season.mate && d.season.mate.name) || 'Pierre Gasly';
    const total = years.reduce((a, y) => a + career[y].points, 0);
    const races = years.reduce((a, y) => a + career[y].races, 0);
    const age = ageAt(t);
    return `<p>Franco Alejandro Colapinto es un piloto argentino de Fórmula 1. Nació el 27 de mayo de 2003 en Pilar, provincia de Buenos Aires,
        y tiene <b>${age} años</b>. Corre con el <b>número 43</b> en <b>${esc(team)}</b>, donde su compañero de equipo es ${esc(mate)}.</p>
      <h2>De las categorías menores a la Fórmula 1</h2>
      <p>Fue campeón de la Fórmula 4 española en 2019. Después pasó por la Fórmula Regional Europea y la Fórmula 3, donde terminó cuarto en 2023 con MP Motorsport,
        y en 2024 corrió en la Fórmula 2 con el mismo equipo.</p>
      <p>Debutó en la Fórmula 1 en el Gran Premio de Italia 2024, en Monza, con Williams, en reemplazo de Logan Sargeant, y terminó 12.º.
        En el Gran Premio de Azerbaiyán de ese año terminó 8.º y se convirtió en el primer argentino en sumar puntos en la categoría desde Carlos Reutemann,
        segundo en el Gran Premio de Sudáfrica de 1982.</p>
      <p>Para 2025 firmó con Alpine como piloto de reserva y, después de las primeras seis carreras, pasó a ser titular en reemplazo de Jack Doohan.
        Tiene contrato con el equipo al menos hasta el final de 2027.</p>
      ${career ? `<h2>Sus números en la Fórmula 1</h2>
      <p>En total corrió <b>${races} Grandes Premios</b> y sumó <b>${total} puntos</b>.</p>${careerTable(career)}` : ''}
      <h2>Preguntas frecuentes</h2>
      <h3>¿Cuántos años tiene Franco Colapinto?</h3><p>${age} años. Nació el 27 de mayo de 2003.</p>
      <h3>¿En qué equipo corre?</h3><p>En ${esc(team)}${now ? `, con el que lleva ${now.points} puntos en ${years[years.length - 1]}` : ''}.</p>
      <h3>¿Qué número usa?</h3><p>El 43.</p>
      <h3>¿Cuántos puntos tiene en la Fórmula 1?</h3><p>${career ? `${total} puntos en ${races} carreras.` : 'Los datos no están disponibles en este momento.'}</p>
      <h3>¿A qué hora es su próxima carrera?</h3><p><a href="/">Acá están los horarios de la próxima carrera en hora argentina</a>, con la cuenta regresiva.</p>`;
  }
  function personLD(d) {
    const career = d.career;
    const years = career ? Object.keys(career).sort() : [];
    const team = (career && career[years[years.length - 1]].team) || 'Alpine';
    return {
      '@context': 'https://schema.org', '@type': 'Person',
      name: 'Franco Colapinto', alternateName: 'Franco Alejandro Colapinto',
      birthDate: BIRTH, birthPlace: { '@type': 'Place', name: 'Pilar, Buenos Aires, Argentina' },
      nationality: 'Argentina', jobTitle: 'Piloto de Fórmula 1',
      memberOf: { '@type': 'SportsTeam', name: team, sport: 'Fórmula 1' }
    };
  }

  // Links a las demás páginas, al pie de todas.
  function moreLinks(currentPath) {
    const items = [['/', 'Próxima carrera en hora argentina'], ['/tabla', 'Tabla de la Fórmula 1 2026'], ['/temporada', 'La temporada de Franco'],
      ['/franco-colapinto', 'Quién es Franco Colapinto'], ...COUNTRY_PAGES.map((c) => ['/' + c.slug, `Horarios en ${c.name}`])]
      .filter(([p]) => p !== currentPath);
    return `<h2>Más de Colapinto</h2><ul class="i-more">${items.map(([p, t]) => `<li><a href="${p}">${t}</a></li>`).join('')}</ul>`;
  }

  // ---------- páginas ----------
  // kind: 'home' | 'gp' | 'tabla' | 'temporada' | 'ficha' | 'pais' (slug = país).
  // d: { race, weekend, standings, season, circuits, weather, career } (lo que haya).
  function page(kind, race, d = {}, t = Date.now(), slug) {
    const p = pageBody(kind, race, d, t, slug);
    return { ...p, body: p.body + moreLinks(p.path) };
  }
  function pageBody(kind, race, d, t, slug) {
    const year = 2026;
    if (kind === 'ficha') {
      return {
        path: '/franco-colapinto',
        title: 'Franco Colapinto: edad, número 43, equipo y estadísticas en la F1',
        description: `Quién es Franco Colapinto: piloto argentino de Fórmula 1 en Alpine, nacido en Pilar el 27 de mayo de 2003. Edad, número, de dónde viene y sus números en cada temporada.`,
        h1: 'Franco Colapinto',
        body: fichaBody(d, t),
        jsonld: personLD(d)
      };
    }
    if (kind === 'pais') {
      const c = countryBySlug(slug);
      const r = upcoming(t), rs = raceSession(r);
      return {
        path: '/' + c.slug,
        title: `Horario de Colapinto en ${c.name}: Fórmula 1 ${year} en hora local`,
        description: `¿A qué hora corre Colapinto en ${c.name}?${rs && !finished(r, t) ? ` Próxima carrera: ${r.gp}, ${longDayIn(rs.at, c.tz)} a las ${hhmm(rs.at, c.tz)} (hora de ${c.name}).` : ''} Todos los horarios de la Fórmula 1 ${year} en hora de ${c.name}.`,
        h1: `Horarios de Franco Colapinto en hora de ${c.name}`,
        body: countryBody(c, d, t),
        jsonld: rs ? eventLD(r, '/' + c.slug) : null
      };
    }
    if (kind === 'tabla') {
      const round = d.standings && d.standings.round;
      return {
        path: '/tabla',
        title: `Tabla de la Fórmula 1 ${year}: pilotos y constructores`,
        description: `Posiciones del Mundial de Fórmula 1 ${year}${round ? ` tras la fecha ${round}` : ''}: campeonato de pilotos y de constructores, con Franco Colapinto y Alpine.`,
        h1: `Tabla de posiciones de la Fórmula 1 ${year}`,
        body: standingsText(d.standings) + calendar(d.season, t)
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
        ${r.sprint ? 'Es un fin de semana con carrera sprint.' : ''}${quali ? ` La clasificación es el ${longDay(quali.at)} a las ${quali.time}.` : ''}
        Todos los horarios de arriba están en hora argentina (GMT−3), igual que en Uruguay.</p>`;
      body = intro + chronicle(r, d.weekend, d.season && d.season.mate && d.season.mate.last, t)
        + previa(r, d.circuits && d.circuits[r.id], d.weather) + countriesBlock(r);
    } else {
      body = resultBlock(r, d.race) + chronicle(r, d.weekend, d.season && d.season.mate && d.season.mate.last, t);
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
      title: `Colapinto en el ${gpYear}: horarios en hora argentina`,
      description: `Horarios del ${gpYear} en hora argentina: ${quali ? `clasificación ${quali.dow.toLowerCase()} ${quali.time} y ` : ''}carrera ${rs ? `${rs.dow.toLowerCase()} ${rs.day} a las ${rs.time}` : ''}. Prácticas${r.sprint ? ', sprint' : ''}, cuenta regresiva y resultados de Franco Colapinto.`,
      h1: `Franco Colapinto en el ${gpYear}: horarios`
    };
    return { ...meta, body, jsonld: eventLD(r, meta.path) };
  }

  function eventLD(r, path) {
    const ss = window.sessionsOf(r);
    const start = ss.length ? isoAR(Math.min(...ss.map((s) => s.at))) : r.raceDay;
    const rs = raceSession(r);
    const place = { '@type': 'Place', name: r.track, address: r.sub && !/sprint|noche/i.test(r.sub) ? r.sub : r.track };
    const franco = { '@type': 'Person', name: 'Franco Colapinto', nationality: 'Argentina', url: '/franco-colapinto' };
    // Campos que Google recomienda para eventos. La imagen va como ruta: build.mjs la pasa a dirección completa.
    // offers apunta a la venta oficial de entradas de la F1 (sin precio: lo fija cada GP).
    const common = {
      image: ['/og.png'],
      performer: franco,
      organizer: { '@type': 'Organization', name: 'Fórmula 1', url: 'https://www.formula1.com' },
      offers: { '@type': 'Offer', url: 'https://tickets.formula1.com', availability: 'https://schema.org/InStock' },
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: place
    };
    return {
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: `${r.gp} 2026 de Fórmula 1`,
      description: `${r.gp}, fecha ${r.round} del Mundial de Fórmula 1 2026 en ${r.track}${rs ? `. Carrera: ${rs.dow.toLowerCase()} ${rs.day} a las ${rs.time} (hora argentina)` : ''}. Horarios de Franco Colapinto (Alpine).`,
      sport: 'Fórmula 1',
      startDate: start,
      endDate: rs ? isoAR(rs.at + 2 * 3600000) : r.raceDay,
      ...common,
      competitor: franco,
      url: path,
      ...(rs ? { subEvent: ss.map((s) => ({
        '@type': 'SportsEvent',
        name: `${s.name} · ${r.gp}`,
        description: `${s.name} del ${r.gp} 2026 de Fórmula 1, a las ${s.time} (hora argentina).`,
        startDate: isoAR(s.at),
        endDate: isoAR(s.at + 3600000 * (s.name === 'Carrera' ? 2 : 1)),
        ...common
      })) } : {})
    };
  }

  // HTML de la sección (h1 + cuerpo).
  const section = (p) => `<h1>${esc(p.h1)}</h1>${p.body}
    <p class="i-src">Horarios tomados del calendario oficial de la Fórmula 1 y convertidos a hora argentina. Resultados: Jolpica-F1 y OpenF1.</p>`;

  window.Seo = { page, section, upcoming, countries: COUNTRY_PAGES, countryBySlug, countryLabel };
})();
