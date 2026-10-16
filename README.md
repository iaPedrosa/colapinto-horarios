# Franco Colapinto · Horarios 2026

Página web con los horarios **en hora argentina (GMT−3)** de cada Gran Premio de Franco Colapinto en la temporada 2026 de Fórmula 1, y los resultados de las fechas ya disputadas.

- Al entrar se muestra automáticamente la **próxima carrera**.
- Con las flechas (o deslizando en el celular, o con ← → del teclado) se navega al resto de los GP.
- Cada GP tiene su propia página, por ejemplo `/gp/las-vegas` (los links viejos `/#las-vegas` siguen andando). También `/tabla` y `/temporada`.
- Durante el fin de semana, al lado de cada sesión ya corrida aparece la posición de Franco.
- En computadora la placa ocupa todo el ancho, en dos columnas; en el celular se ve igual que siempre.

## Resultados

Cuando un GP ya terminó, la página muestra el resultado de Franco (con un botón para volver a los horarios):
posición final, largada, puntos, clasificación, sprint, mejor vuelta, velocidad máxima, paradas,
neumáticos, posición vuelta a vuelta y el top 10.

Los datos vienen de dos APIs gratuitas que no piden cuenta ni clave, consultadas directo desde el navegador (`results.js`):

- [Jolpica-F1](https://github.com/jolpica/jolpica-f1): resultados, clasificación y sprint.
- [OpenF1](https://openf1.org/): vueltas, velocidades, neumáticos, paradas y posiciones (datos históricos, gratis).

Los resultados suelen aparecer unas horas después de la carrera. Una vez completos, quedan guardados en el navegador.

## Más vistas

- **Cuenta regresiva**: en la placa de horarios, cuánto falta para la próxima sesión (o "EN VIVO" mientras se corre). Las sesiones ya hechas se ven atenuadas.
- **Tabla**: campeonato de pilotos y de constructores.
- **Temporada**: el año de Franco (puntos, mejor resultado, promedio, abandonos, resultado de cada fecha) y el duelo con su compañero de Alpine en clasificación, carrera y puntos.

## Datos guardados (sin llamar a las APIs en cada visita)

La carpeta `data/` es la base de datos: un JSON por GP (`race-*.json`), uno por fin de semana con el
resultado de Franco en cada sesión (`weekend-*.json`), la tabla (`standings.json`) y la temporada (`season.json`).

- `scripts/update-data.mjs` los descarga. Lo corre GitHub Actions (`.github/workflows/update-data.yml`)
  con un cron (GitHub lo ejecuta cada varias horas, no a horario exacto) y cada vez que `/api/data` lo dispara.
- Un GP o un fin de semana completo se guarda una vez y no se vuelve a pedir nunca.
- La página lee primero esos archivos. Si falta uno o quedó viejo (por ejemplo, minutos después de una
  sesión), pide `/api/data` (función de Vercel, `api/data.js`): consulta las APIs y Vercel guarda la respuesta
  unos minutos para todos los visitantes. Si encuentra datos nuevos, dispara el workflow para que queden en `data/`.
  Para eso hace falta la variable `GH_DISPATCH_TOKEN` en Vercel (token de GitHub con permiso *Actions: read and write*
  sobre este repo). Sin ella todo funciona igual, pero los datos se guardan recién en la próxima corrida del cron.

## Publicación y Google

Vercel corre `node scripts/build.mjs` con cada commit (incluidos los de datos) y publica `dist/`:
una página HTML ya escrita por cada dirección, con título, descripción, datos estructurados (SportsEvent)
y el texto de abajo de la placa (`seo.js`), más `sitemap.xml`, `robots.txt` y la imagen para compartir `og.png`.

- El dominio sale de `VERCEL_PROJECT_PRODUCTION_URL` (si se agrega un dominio propio, se usa solo).
- Para verificar el sitio en Google Search Console por etiqueta HTML: variable `GOOGLE_SITE_VERIFICATION` en Vercel.

## Actualizar horarios

El calendario está en el arreglo `RACES` dentro de `races.js`. El campo `end` indica cuándo termina la carrera: pasado ese momento la página salta sola al siguiente GP.

Horarios tomados del calendario oficial de formula1.com y convertidos a hora argentina.
