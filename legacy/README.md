# Legacy StonedOwl

Esta carpeta conserva versiones anteriores del producto para referencia histórica. No forman parte del runtime activo del piloto de Electricidad.

## Archivado

- `frontend/v06.html` + `frontend/app-v06.js`: interfaz v0.6.
- `frontend/v07.html` + `frontend/app-v07.js`: interfaz v0.7.
- `workers/worker-v07.js`: worker anterior del radar general CABA/noticias.

## Runtime activo del piloto

- `src/worker.js` -> entrada de Wrangler.
- `worker-v11.js` -> capa actual del termómetro calibrado.
- `worker-v10.js` -> ingestión y clasificación territorial.
- `worker-v09.js` -> base compartida de búsqueda/fuentes. Sigue siendo dependencia activa y por eso no se archiva todavía.
- `data/` -> vocabulario, geografía, clasificación de evidencia y termómetro.
- `sources/` -> ENRE, Serper y Reddit.
- `scripts/live-electricidad-smoke.mjs` -> captura real del piloto.
- `tests/` -> fixtures y guardrails.

## Compatibilidad

Los archivos `public/index.html`, `public/app.js` y `public/style.css` siguen siendo los assets actuales de Wrangler. Los archivos estáticos de la raíz (`index.html`, `app.js`, `style.css`) se mantienen por ahora por compatibilidad con el despliegue histórico de GitHub Pages; no deben confundirse con el motor actual.

No agregar nuevas funcionalidades dentro de `legacy/`. Cualquier desarrollo nuevo debe ir al runtime activo.
