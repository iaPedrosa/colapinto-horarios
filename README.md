# Franco Colapinto · Horarios 2026

Página web con los horarios **en hora argentina (GMT−3)** de cada Gran Premio que le queda a Franco Colapinto en la temporada 2026 de Fórmula 1.

- Al entrar se muestra automáticamente la **próxima carrera**.
- Con las flechas (o deslizando en el celular, o con ← → del teclado) se navega al resto de los GP.
- Cada GP tiene su propio link, por ejemplo `.../#las-vegas`.

## Publicarla con GitHub Pages

1. En el repo, entrá a **Settings → Pages**.
2. En *Build and deployment* elegí **Deploy from a branch**, rama `main` y carpeta `/ (root)`.
3. Guardá. En un par de minutos la página queda en `https://<tu-usuario>.github.io/<nombre-del-repo>/`.

## Actualizar horarios

Todos los datos están en el arreglo `RACES` dentro de `index.html`. El campo `end` indica cuándo termina la carrera: pasado ese momento la página salta sola al siguiente GP.

Horarios tomados del calendario oficial de formula1.com y convertidos a hora argentina.
