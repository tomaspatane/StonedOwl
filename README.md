# StonedOwl

Radar de problemas de CABA para construir agenda pública y cuestionar la gestión con evidencia.

## Objetivo de producto — 8 de octubre de 2026

Entregar casos concretos para trabajo de comunicación política: qué sucede, dónde, cuándo, qué fuente lo documenta, qué respuesta se puede exigir y qué responsabilidad falta establecer. Un episodio aislado puede ser relevante; no necesita una tendencia ni un color alto para aparecer.

La salida principal es `editorialCases`, disponible en el endpoint y en cada captura del piloto. Distingue casos documentados en una fuente de pistas para verificar. Incluye evidencia, pregunta a investigar, responsabilidad pendiente y siguiente paso. Las pistas no modifican el termómetro. No se generan acusaciones ni crecimiento a partir de menciones aisladas; una nota que cita ENRE no cuenta como corroboración independiente de ENRE.

La interfaz preparada prioriza “Casos para trabajar”; el mapa queda como complemento. “Sin señal suficiente” reemplaza “Normal”: ausencia de resultados no acredita buen funcionamiento de los servicios.

El alcance de captura sigue siendo Electricidad. Este cambio implementa la nueva salida y recupera como pista la formulación omitida “sin suministro eléctrico”; no implementa todavía lectura del cuerpo de las notas, nuevas fuentes, los otros cinco temas, rotación del piloto ni un nuevo programador. La frecuencia observada sigue pendiente de solución. El cambio de frontend requiere un despliegue separado; actualizar la rama sí cambia el escritor que usa el workflow horario.

Criterio de éxito: casos relevantes recuperados a tiempo, correctamente ubicados y con evidencia consultable que permitan una acción concreta de comunicación o reclamo. El volumen de consultas y los colores no son resultados de comunicación.


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

