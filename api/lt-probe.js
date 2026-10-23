// TEMPORAL: prueba si Vercel puede leer el live timing de la F1 (no mergear).
const B = 'https://livetiming.formula1.com/static';
export default async function handler(req, res) {
  const out = {};
  try {
    const r = await fetch(`${B}/2026/Index.json`);
    out.index = r.status;
    if (r.ok) {
      const d = JSON.parse((await r.text()).replace(/^﻿/, ''));
      const m = d.Meetings.filter((x) => /United States/.test(x.Name)).pop();
      out.sessions = m.Sessions.map((s) => ({ name: s.Name, end: s.EndDate, path: s.Path }));
      for (const s of m.Sessions.filter((s) => s.Path)) {
        const info = {};
        for (const f of ['ArchiveStatus.json', 'SessionStatus.json', 'TimingData.json']) {
          const x = await fetch(B + '/' + s.Path + f);
          info[f] = { status: x.status, modified: x.headers.get('last-modified') };
          if (x.ok && f !== 'TimingData.json') info[f].body = (await x.text()).replace(/^﻿/, '');
          if (x.ok && f === 'TimingData.json') {
            const t = JSON.parse((await x.text()).replace(/^﻿/, ''));
            info.colapinto = t.Lines['43'] && t.Lines['43'].Position;
            info.gasly = t.Lines['10'] && t.Lines['10'].Position;
          }
        }
        out[s.Name] = info;
      }
    }
  } catch (e) { out.error = String(e); }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
