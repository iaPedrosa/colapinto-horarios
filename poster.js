// HTML de la placa: horarios, resultados, tabla y temporada.
// Lo usan la página (index.html) y scripts/build.mjs, que deja la placa ya escrita en cada
// página para que Google la lea sin JavaScript.
(function () {
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#74ACDF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const DUR = window.sessionDur;

  // Ancho de la placa (cambia en pantalla ancha) y resultado de Franco en cada sesión (id del GP → datos).
  const state = { W: 1080, weekend: {}, countdown: true };

  function sessionRes(r, name) {
    const w = state.weekend[r.id];
    const x = w && w.sessions.find((s) => s.name === name);
    if (!x) return '';
    return `<span class="s-res">${x.dsq ? 'DSQ' : x.dns ? 'DNS' : x.dnf ? 'DNF' : 'P' + x.pos}</span>`;
  }

  // ---------- cuenta regresiva ----------
  // La sesión en curso o la próxima de este GP (null si ya terminó todo).
  function nextSession(r, t = Date.now()) {
    for (const s of window.sessionsOf(r)) {
      if (s.at == null) continue;
      if (t < s.at) return { ...s, live: false };
      if (t < s.at + DUR(s.name)) return { ...s, live: true };
    }
    return null;
  }
  function rowState(r, n, t, day) {
    const at = window.sessionAt(r, day, t);
    if (at == null) return '';
    if (Date.now() >= at + DUR(n)) return ' done';
    const nx = nextSession(r);
    if (nx && nx.at === at && nx.name === n) return nx.live ? ' live' : ' next';
    return '';
  }
  function fmtLeft(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    const p = (x) => String(x).padStart(2, '0');
    if (d >= 1) return `${d} ${d === 1 ? 'DÍA' : 'DÍAS'} ${p(h)}:${p(m)}:${p(sec)}`;
    return `${p(h)}:${p(m)}:${p(sec)}`;
  }
  function countdownHTML(r) {
    const nx = state.countdown && nextSession(r);
    if (!nx) return '';
    return `<div class="cd${nx.live ? ' live' : ''}" data-key="${esc(nx.key)}${nx.live ? '-live' : ''}">
      <div class="cd-label"><span class="cd-dot"></span>${nx.live ? 'EN VIVO' : 'PRÓXIMA'} · ${esc(nx.name.toUpperCase())}</div>
      <div class="cd-time" id="cdTime">${nx.live ? 'AHORA' : fmtLeft(nx.at - Date.now())}</div>
    </div>`;
  }

  const FOOTER = '<div class="footer"><div class="vamos">VAMOS FRANCO</div><div class="sign">ARGENTINA · #43</div></div>';

  function backdrop(withLines) {
    const W = state.W;
    return `
      <div class="big43" aria-hidden="true">43</div>
      <div class="stripe" aria-hidden="true">
        <span style="background:#74ACDF"></span><span style="background:#fff"></span><span style="background:#74ACDF"></span>
        <span style="background:#0090FF;flex:1.4"></span><span style="background:#FF87BC"></span>
      </div>
      ${withLines ? `<svg class="lines" width="${W}" height="180" viewBox="0 1060 ${W} 180" aria-hidden="true">
        <path d="M -40 1180 L 380 1180 L 470 1090 L ${W + 40} 1090" fill="none" stroke="#0090FF" stroke-width="10"/>
        <path d="M -40 1214 L 396 1214 L 486 1124 L ${W + 40} 1124" fill="none" stroke="#FF87BC" stroke-width="10"/>
      </svg>` : ''}`;
  }

  // ---------- horarios ----------
  function schedule(r) {
    const days = r.days.map((d) => `
      <div class="day">
        <div class="day-badge"><div class="dow">${d.dow}</div><div class="dnum">${d.day}</div></div>
        <div class="sessions">${d.s.map(([n, t]) => `
          <div class="session${rowState(r, n, t, d.day)}"><div class="s-name">${esc(n)}</div><div class="s-right">${sessionRes(r, n)}<div class="s-time">${t}</div></div></div>`).join('')}
        </div>
      </div>`).join('');
    return `
      ${backdrop(true)}
      <div class="content">
        <div class="ca">
        <div class="kicker">FÓRMULA 1 · FECHA ${r.round} · ${esc(r.track.toUpperCase())}</div>
        <div class="name">Franco<br>Colapinto</div>
        <div class="gp-row">
          <div class="gp-tag">${esc(r.gp.toUpperCase())}</div>
          <div class="gp-dates">${r.dates}</div>
        </div>
        <div class="sub">${clock} HORARIOS DE ARGENTINA (GMT−3) · ${esc(r.sub.toUpperCase())}</div>
        ${countdownHTML(r)}
        </div>
        <div class="cb">
        <div class="days${r.compact ? ' compact' : ''}${nextSession(r) ? ' with-cd' : ''}">
          ${days}
          <div class="race">
            <div class="day-badge"><div class="dow">${r.race.dow}</div><div class="dnum">${r.race.day}</div></div>
            <div class="race-body">
              <div><div class="race-kicker">${esc(r.race.kicker.toUpperCase())}</div><div class="race-title">Carrera</div></div>
              <div class="s-right">${sessionRes(r, 'Carrera')}<div class="race-time">${r.race.time}</div></div>
            </div>
          </div>
        </div>
        </div>
      </div>
      ${FOOTER}`;
  }

  // ---------- resultados ----------
  function resultsHead(r) {
    return `
      <div class="kicker">FÓRMULA 1 · FECHA ${r.round} · ${esc(r.track.toUpperCase())}</div>
      <div class="name">Franco Colapinto</div>
      <div class="gp-row">
        <div class="gp-tag">${esc(r.gp.toUpperCase())}</div>
        <div class="gp-dates">RESULTADO</div>
      </div>`;
  }
  function resultsShell(inner, withSource) {
    return `${backdrop(false)}<div class="content res">${inner}</div>
      ${withSource ? '<div class="r-src">DATOS: JOLPICA-F1 · OPENF1</div>' : ''}${FOOTER}`;
  }
  const msgBlock = (title, text) => `<div class="ca"><div class="r-msg"><b>${title}</b>${text ? `<span>${text}</span>` : ''}</div></div>`;
  const message = (r, title, text) => resultsShell(`<div class="hd">${resultsHead(r)}</div>${msgBlock(title, text)}`, false);
  const results = (r, data, opts) => resultsShell(window.Results.render(r, data, resultsHead(r), opts), true);

  // ---------- tabla y temporada ----------
  const head = (title, tag, round) => `<div class="hd">
    <div class="kicker">FÓRMULA 1 · TEMPORADA 2026${round ? ' · TRAS LA FECHA ' + round : ''}</div>
    <div class="name">${title}</div>
    <div class="gp-row"><div class="gp-tag">${tag}</div></div></div>`;
  const seasonHead = (round) => head('Franco Colapinto', 'SU TEMPORADA', round);
  const standingsHead = (round) => head('Campeonato', 'PILOTOS Y CONSTRUCTORES', round);
  const shell = (cls, inner, src) => `${backdrop(false)}<div class="content res${cls}">${inner}</div>
    ${src ? '<div class="r-src">DATOS: JOLPICA-F1</div>' : ''}${FOOTER}`;
  const seasonShell = (inner, src) => shell('', inner, src);
  const standingsShell = (inner, src) => shell(' st', inner, src);
  const season = (d, opts) => seasonShell(seasonHead(d.round) + window.Results.renderSeason(d, opts), true);
  const standings = (d, opts) => standingsShell(standingsHead(d.round) + `<div class="full">${window.Results.renderStandings(d, opts)}</div>`, true);

  window.Poster = {
    state, nextSession, fmtLeft, msgBlock,
    schedule, message, results, resultsHead, resultsShell,
    seasonHead, seasonShell, season, standingsHead, standingsShell, standings
  };
})();
