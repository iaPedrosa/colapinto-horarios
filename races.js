// Calendario 2026 de Franco Colapinto (horarios en hora de Argentina, GMT-3).
// Lo usan la página (index.html) y el script que guarda los datos (scripts/update-data.mjs).
(function () {
// "end" = fin aproximado de la carrera: a partir de ese momento la página pasa a mostrar el siguiente GP.
const PAST = (id, round, gp, track, dates, raceDay, sprint) =>
  ({ id, round, gp, track, dates, end: raceDay + 'T20:00:00-03:00', sprint: !!sprint, past: true });

const RACES = [
  // Fechas ya disputadas: solo resultados.
  PAST('australia', 1, 'GP de Australia', 'Albert Park', '6 — 8 MAR 2026', '2026-03-08'),
  PAST('china', 2, 'GP de China', 'Shanghái', '13 — 15 MAR 2026', '2026-03-15', true),
  PAST('japon', 3, 'GP de Japón', 'Suzuka', '27 — 29 MAR 2026', '2026-03-29'),
  PAST('miami', 4, 'GP de Miami', 'Miami', '1 — 3 MAY 2026', '2026-05-03', true),
  PAST('canada', 5, 'GP de Canadá', 'Gilles Villeneuve', '22 — 24 MAY 2026', '2026-05-24', true),
  PAST('monaco', 6, 'GP de Mónaco', 'Montecarlo', '5 — 7 JUN 2026', '2026-06-07'),
  PAST('barcelona', 7, 'GP de Barcelona', 'Montmeló', '12 — 14 JUN 2026', '2026-06-14'),
  PAST('austria', 8, 'GP de Austria', 'Spielberg', '26 — 28 JUN 2026', '2026-06-28'),
  PAST('gran-bretana', 9, 'GP de Gran Bretaña', 'Silverstone', '3 — 5 JUL 2026', '2026-07-05', true),
  PAST('belgica', 10, 'GP de Bélgica', 'Spa-Francorchamps', '17 — 19 JUL 2026', '2026-07-19'),
  PAST('hungria', 11, 'GP de Hungría', 'Hungaroring', '24 — 26 JUL 2026', '2026-07-26'),
  PAST('paises-bajos', 12, 'GP de Países Bajos', 'Zandvoort', '21 — 23 AGO 2026', '2026-08-23', true),
  PAST('italia', 13, 'GP de Italia', 'Monza', '4 — 6 SEP 2026', '2026-09-06'),
  PAST('espana', 14, 'GP de España', 'Madrid', '11 — 13 SEP 2026', '2026-09-13'),
  PAST('azerbaiyan', 15, 'GP de Azerbaiyán', 'Bakú', '24 — 26 SEP 2026', '2026-09-26'),
  PAST('bahrein', 16, 'GP de Bahréin', 'Sepang, Malasia', '2 — 4 OCT 2026', '2026-10-04'),

  { id: 'singapur', round: 17, gp: 'GP de Singapur', track: 'Marina Bay', dates: '9 — 11 OCT 2026',
    sub: 'Fin de semana sprint', end: '2026-10-11T11:30:00-03:00',
    days: [
      { dow: 'VIE', day: '09', s: [['Práctica Libre 1', '05:30'], ['Clasificación Sprint', '09:30']] },
      { dow: 'SÁB', day: '10', s: [['Carrera Sprint', '06:00'], ['Clasificación', '10:00']] }
    ],
    race: { dow: 'DOM', day: '11', time: '09:00', kicker: 'La gran cita' } },
  { id: 'estados-unidos', round: 18, gp: 'GP de Estados Unidos', track: 'Circuito de las Américas', dates: '23 — 25 OCT 2026',
    sub: 'Austin, Texas', end: '2026-10-25T19:00:00-03:00',
    days: [
      { dow: 'VIE', day: '23', s: [['Práctica Libre 1', '14:30'], ['Práctica Libre 2', '18:00']] },
      { dow: 'SÁB', day: '24', s: [['Práctica Libre 3', '14:30'], ['Clasificación', '18:00']] }
    ],
    race: { dow: 'DOM', day: '25', time: '17:00', kicker: 'La gran cita' } },
  { id: 'mexico', round: 19, gp: 'GP de México', track: 'Autódromo Hermanos Rodríguez', dates: '30 OCT — 1 NOV 2026',
    sub: 'Ciudad de México', end: '2026-11-01T19:00:00-03:00',
    days: [
      { dow: 'VIE', day: '30', s: [['Práctica Libre 1', '15:30'], ['Práctica Libre 2', '19:00']] },
      { dow: 'SÁB', day: '31', s: [['Práctica Libre 3', '14:30'], ['Clasificación', '18:00']] }
    ],
    race: { dow: 'DOM', day: '01', time: '17:00', kicker: 'La gran cita' } },
  { id: 'brasil', round: 20, gp: 'GP de São Paulo', track: 'Interlagos', dates: '6 — 8 NOV 2026',
    sub: 'São Paulo, Brasil', end: '2026-11-08T16:00:00-03:00',
    days: [
      { dow: 'VIE', day: '06', s: [['Práctica Libre 1', '12:30'], ['Práctica Libre 2', '16:00']] },
      { dow: 'SÁB', day: '07', s: [['Práctica Libre 3', '11:30'], ['Clasificación', '15:00']] }
    ],
    race: { dow: 'DOM', day: '08', time: '14:00', kicker: 'La gran cita' } },
  { id: 'las-vegas', round: 21, gp: 'GP de Las Vegas', track: 'Las Vegas Strip', dates: '19 — 22 NOV 2026',
    sub: 'Todo de noche / madrugada', end: '2026-11-22T03:00:00-03:00', compact: true,
    days: [
      { dow: 'JUE', day: '19', s: [['Práctica Libre 1', '21:30']] },
      { dow: 'VIE', day: '20', s: [['Práctica Libre 2', '01:00'], ['Práctica Libre 3', '21:30']] },
      { dow: 'SÁB', day: '21', s: [['Clasificación', '01:00']] }
    ],
    race: { dow: 'DOM', day: '22', time: '01:00', kicker: 'Sábado a la noche' } },
  { id: 'qatar', round: 22, gp: 'GP de Qatar', track: 'Lusail', dates: '27 — 29 NOV 2026',
    sub: 'Lusail, Qatar', end: '2026-11-29T15:00:00-03:00',
    days: [
      { dow: 'VIE', day: '27', s: [['Práctica Libre 1', '10:30'], ['Práctica Libre 2', '14:00']] },
      { dow: 'SÁB', day: '28', s: [['Práctica Libre 3', '11:30'], ['Clasificación', '15:00']] }
    ],
    race: { dow: 'DOM', day: '29', time: '13:00', kicker: 'La gran cita' } },
  { id: 'abu-dabi', round: 23, gp: 'GP de Abu Dabi', track: 'Yas Marina · Última fecha', dates: '4 — 6 DIC 2026',
    sub: 'Yas Marina, EAU', end: '2026-12-06T12:00:00-03:00',
    days: [
      { dow: 'VIE', day: '04', s: [['Práctica Libre 1', '06:30'], ['Práctica Libre 2', '10:00']] },
      { dow: 'SÁB', day: '05', s: [['Práctica Libre 3', '07:30'], ['Clasificación', '11:00']] }
    ],
    race: { dow: 'DOM', day: '06', time: '10:00', kicker: 'La gran cita' } }
];

RACES.forEach((r) => {
  r.raceDay = r.end.slice(0, 10);
  if (r.days) r.sprint = r.days.some((d) => d.s.some(([n]) => /sprint/i.test(n)));
});

window.RACES = RACES;
})();
