# StonedOwl

Radar de problemas de CABA para construir agenda pública y cuestionar la gestión con evidencia.

## Objetivo de producto — 8 de octubre de 2026

Entregar casos concretos para trabajo de comunicación política: qué sucede, dónde, cuándo, qué fuente lo documenta, qué respuesta se puede exigir y qué responsabilidad falta establecer. Un episodio aislado puede ser relevante; no necesita una tendencia ni un color alto para aparecer.

La salida principal es `editorialCases`, disponible en el endpoint y en cada captura del piloto. Distingue casos documentados en una fuente de pistas para verificar. Incluye evidencia, pregunta a investigar, responsabilidad pendiente y siguiente paso. Las pistas no modifican el termómetro. No se generan acusaciones ni crecimiento a partir de menciones aisladas; una nota que cita ENRE no cuenta como corroboración independiente de ENRE.

La interfaz preparada prioriza “Casos para trabajar”; el mapa queda como complemento. “Sin señal suficiente” reemplaza “Normal”: ausencia de resultados no acredita buen funcionamiento de los servicios.

El alcance operativo sigue siendo Electricidad. La reparación del 19 de octubre agrega feeds públicos directos de cinco medios, sin clave ni créditos; Reddit directo y ENRE continúan. Serper queda como respaldo opcional sólo cuando no funciona ninguna solicitud de la fuente gratuita. Los feeds no son un archivo exhaustivo ni prueba de ausencia de incidentes. Se conserva la procedencia y se indica que sólo se leyó título/resumen RSS, no el cuerpo completo.

El piloto busca casos publicados en los últimos 7 días (`CAPTURE_SPAN=1w`, configurable a `6h`, `1d`, `3d`). La fecha de publicación no es la del incidente ni confirma un corte vigente. El filtro territorial rota por los 48 barrios en grupos de 12, pero trabaja sobre los mismos feeds, no finge consultas independientes. El frontend preparado requiere un despliegue separado; actualizar esta rama cambia el escritor utilizado por el workflow horario, no publica una web nueva.

Criterio de éxito: casos relevantes recuperados a tiempo, correctamente ubicados y con evidencia consultable que permitan una acción concreta de comunicación o reclamo. El volumen de consultas y los colores no son resultados de comunicación.


## Estado actual

El desarrollo activo está concentrado en el **MVP de Electricidad** del PR #10 (`feat/electricidad-mvp-v01`). El objetivo es validar primero detección, geolocalización, calidad de evidencia y termómetro antes de sumar otras familias de problemas.

### Runtime activo

- `src/worker.js` — entrada de Wrangler.
- `worker-v11.js` — guardrails y termómetro calibrado.
- `worker-v10.js` — ingestión, clasificación territorial y armado del radar.
- `worker-v09.js` — base compartida de fuentes/búsqueda; sigue siendo dependencia activa.
- `data/` — barrios, vocabulario, clasificación de evidencia y reglas del termómetro.
- `sources/` — feeds públicos de medios, Reddit directo, ENRE y Serper opcional.
- `scripts/live-electricidad-smoke.mjs` — captura real del piloto.
- `tests/` — fixtures y tests de parser, geografía y termómetro.
- `public/` — frontend/assets usados por Wrangler.

## Monitoreo del piloto

Existe un workflow horario en `main` (`.github/workflows/electricidad-pilot-hourly.yml`) que hace checkout de esta rama, ejecuta los tests, corre una captura real con fuentes públicas + ENRE (Serper opcional) y guarda el JSON como artifact durante 14 días. Esto permite construir una serie de observación sin mezclarla con el radar viejo.

## Legacy

Las versiones viejas y prototipos que ya no pertenecen al runtime activo están en `legacy/`. No se deben usar como base para nuevas funcionalidades.

Los archivos estáticos de la raíz (`index.html`, `app.js`, `style.css`) se mantienen temporalmente por compatibilidad con el despliegue histórico de GitHub Pages. El frontend activo de Wrangler vive en `public/`.

## Principio de desarrollo

Primero precisión, después cobertura. Una mención no es un evento; un evento no cambia de color sin guardrails de evidencia, corroboración e impacto.


## Salud y comparación: límites explícitos

- `ok` indica captura íntegra; `captureUsable` permite conservar casos útiles aun con cobertura parcial. `coverage.status` distingue `healthy`, `degraded` y `failed`. Resolver una promesa o recibir HTML con HTTP 200 no demuestra éxito de una fuente.
- El smoke siempre escribe `tmp/live-electricidad-report.json` y devuelve código 1 si la captura es degradada o fallida. El job de pruebas de código y el de fuentes en vivo son independientes; un sitio externo caído no se oculta como verde.
- ENRE requiere localidad y jurisdicción CABA, conserva cantidades desconocidas como `null` y diferencia fecha de observación de fecha de actualización. Una hora sin fecha sólo se completa si coincide, con una demora máxima de 10 minutos, con la fecha de modificación HTTP del archivo; se conserva la base de esa inferencia y el valor original. Nunca se usa la hora de descarga para inventar la fecha. Una fecha oficial ausente o antigua deja el caso pendiente de verificar y no eleva el termómetro actual.
- `PREVIOUS_REPORT=/ruta/reporte.json npm run smoke:electricidad` compara dos capturas mediante `snapshotComparison`. Se requieren ambas empresas sanas, fechas completas y frescas, intervalo comparable, registros completos y las mismas agrupaciones de barrio/empresa/tipo. No se rellenan ausencias con cero. Se excluyen programados. Esto no es crecimiento de reclamos ciudadanos ni una tendencia sostenida.
- El workflow horario existente conserva artifacts, pero todavía no descarga automáticamente el anterior: sin `PREVIOUS_REPORT` la comparación devuelve desconocida, no inventa un baseline. La frecuencia real depende del programador de GitHub y debe auditarse.
- Los otros temas de CABA y un historial comparable de reclamos siguen pendientes; esta reparación no pretende resolverlos usando noticias o cortes eléctricos como sustituto.

### Verificación local

`npm test` ejecuta parsers, geografía, evidencia, termómetro, salud, RSS y comparación de snapshots. `npm run smoke:electricidad` usa fuentes reales y no necesita clave. No se guardan claves ni datos simulados como captura real.
