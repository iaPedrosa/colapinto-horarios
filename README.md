# Franco Colapinto · Horarios 2026

Página web con los horarios **en hora argentina (GMT−3)** de cada Gran Premio de Franco Colapinto en la temporada 2026 de Fórmula 1, y los resultados de las fechas ya disputadas.

- Al entrar se muestra automáticamente la **próxima carrera**.
- Con las flechas (o deslizando en el celular, o con ← → del teclado) se navega al resto de los GP.
- Cada GP tiene su propio link, por ejemplo `.../#las-vegas`.

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

Un proceso de GitHub Actions (`.github/workflows/update-data.yml`) corre `scripts/update-data.mjs`,
que descarga los datos y los guarda en `data/`:

- En fin de semana de carrera, cada 30 minutos; el resto de la semana, una vez por día.
- Un GP terminado y completo se guarda una vez y no se vuelve a pedir.
- La tabla y la temporada se reescriben solo si cambiaron.

La página lee primero esos archivos. Si falta alguno o quedó desactualizado (por ejemplo, justo
después de una carrera), consulta la API directamente.

## Publicación

La página está publicada en Vercel, conectado a este repo: cada commit a `main` (incluidos los
de datos que hace el workflow) se publica solo.

## Actualizar horarios

El calendario está en el arreglo `RACES` dentro de `races.js`. El campo `end` indica cuándo termina la carrera: pasado ese momento la página salta sola al siguiente GP.

Horarios tomados del calendario oficial de formula1.com y convertidos a hora argentina.
