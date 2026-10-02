# StonedOwl

Radar experimental de señales urbanas para CABA.

## Estado actual

El desarrollo activo está concentrado en el **MVP de Electricidad** del PR #10 (`feat/electricidad-mvp-v01`). El objetivo es validar primero detección, geolocalización, calidad de evidencia y termómetro antes de sumar otras familias de problemas.

### Runtime activo

- `src/worker.js` — entrada de Wrangler.
- `worker-v11.js` — guardrails y termómetro calibrado.
- `worker-v10.js` — ingestión, clasificación territorial y armado del radar.
- `worker-v09.js` — base compartida de fuentes/búsqueda; sigue siendo dependencia activa.
- `data/` — barrios, vocabulario, clasificación de evidencia y reglas del termómetro.
- `sources/` — ENRE, Serper y Reddit.
- `scripts/live-electricidad-smoke.mjs` — captura real del piloto.
- `tests/` — fixtures y tests de parser, geografía y termómetro.
- `public/` — frontend/assets usados por Wrangler.

## Monitoreo del piloto

Existe un workflow horario en `main` (`.github/workflows/electricidad-pilot-hourly.yml`) que hace checkout de esta rama, ejecuta los tests, corre una captura real con Serper + ENRE y guarda el JSON como artifact durante 14 días. Esto permite construir una serie de observación sin mezclarla con el radar viejo.

## Legacy

Las versiones viejas y prototipos que ya no pertenecen al runtime activo están en `legacy/`. No se deben usar como base para nuevas funcionalidades.

Los archivos estáticos de la raíz (`index.html`, `app.js`, `style.css`) se mantienen temporalmente por compatibilidad con el despliegue histórico de GitHub Pages. El frontend activo de Wrangler vive en `public/`.

## Principio de desarrollo

Primero precisión, después cobertura. Una mención no es un evento; un evento no cambia de color sin guardrails de evidencia, corroboración e impacto.
