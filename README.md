# StonedOwl

Radar de problemas de CABA para construir agenda pública y cuestionar la gestión con evidencia.

## Objetivo de producto — 8 de octubre de 2026

Entregar casos concretos para trabajo de comunicación política: qué sucede, dónde, cuándo, qué fuente lo documenta, qué respuesta se puede exigir y qué responsabilidad falta establecer. Un episodio aislado puede ser relevante; no necesita una tendencia ni un color alto para aparecer.

La salida principal es `editorialCases`, disponible en el endpoint y en cada captura del piloto. Distingue casos documentados en una fuente de pistas para verificar. Incluye evidencia, pregunta a investigar, responsabilidad pendiente y siguiente paso. Las pistas no modifican el termómetro. No se generan acusaciones ni crecimiento a partir de menciones aisladas; una nota que cita ENRE no cuenta como corroboración independiente de ENRE.

La interfaz preparada prioriza “Casos para trabajar”; el mapa queda como complemento. “Sin señal suficiente” reemplaza “Normal”: ausencia de resultados no acredita buen funcionamiento de los servicios.

El alcance operativo sigue siendo Electricidad. La reparación del 19 de octubre agrega feeds públicos directos de cinco medios, sin clave ni créditos; Reddit directo y ENRE continúan. Serper queda como respaldo opcional sólo cuando no funciona ninguna solicitud de la fuente gratuita. Los feeds no son un archivo exhaustivo ni prueba de ausencia de incidentes. Se conserva la procedencia y se indica que sólo se leyó título/resumen RSS, no el cuerpo completo.

El piloto busca casos publicados en los últimos 7 días (`CAPTURE_SPAN=1w`, configurable a `6h`, `1d`, `3d`). La fecha de publicación no es la del incidente ni confirma un corte vigente. El filtro territorial rota por los 48 barrios en grupos de 12, pero trabaja sobre los mismos feeds, no finge consultas independientes. La integración existente de Cloudflare puede generar una vista previa pública al publicar una rama, aunque su PR sea borrador. Una vista previa no equivale a integrar los cambios en `main`, en producción o en el workflow horario.

Criterio de éxito: casos relevantes recuperados a tiempo, correctamente ubicados y con evidencia consultable que permitan una acción concreta de comunicación o reclamo. El volumen de consultas y los colores no son resultados de comunicación.


## Estado actual

La captura programada sigue usando el **MVP de Electricidad** del PR #10 (`feat/electricidad-mvp-v01`). La ampliación del PR #12 (`feat/caba-topics-v01`), apilada sobre esa reparación, prepara los otros tres temas sin incorporarlos todavía al monitoreo horario.

### Runtime activo

- `src/worker.js` — entrada de Wrangler.
- `worker-topics.js` — rutas de los tres temas nuevos; delega Electricidad al runtime existente.
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
- El workflow horario existente de Electricidad conserva artifacts y restaura el anterior mediante `restore-previous-electricidad.mjs`. Si no hay baseline válido, la comparación devuelve desconocida, no lo inventa. La frecuencia real depende del programador de GitHub y debe auditarse.
- La captura programada de los otros temas y un historial comparable de reclamos siguen pendientes; las fichas de publicaciones no sustituyen una serie de reclamos o incidentes confirmados.

### Verificación local

`npm test` ejecuta parsers, geografía, evidencia, termómetro, salud, RSS y comparación de snapshots. `npm run smoke:electricidad` usa fuentes reales y no necesita clave. No se guardan claves ni datos simulados como captura real.

## Expansión en borrador de temas CABA — 20 de octubre de 2026

La rama `feat/caba-topics-v01`, basada en la reparación de Electricidad, agrega:

- `GET /api/basura`, `/api/transporte`, `/api/seguridad`: casos de basura/limpieza, transporte/subte y seguridad.
- `GET /api/temas`: las tres capturas, con salud separada por tema.
- `npm run smoke:topics`: dry-run real sin claves; escribe `tmp/live-topics-report.json`. Código de salida 1 si alguna cobertura está degradada/fallida. Una captura útil no se presenta como íntegra.
- Selector mínimo en la interfaz existente. Sólo Electricidad conserva mapa y termómetro. Los otros temas no producen colores, zonas peligrosas ni tendencias a partir de noticias aisladas.

Se consultan RSS públicos de Pura Ciudad, Revista El Abasto y Página/12. Los feeds se comparten entre consultas concurrentes, pero cada tema clasifica de forma separada. Las búsquedas upstream pueden coincidir con palabras del cuerpo que no aparecen en el resumen: esa coincidencia no es evidencia. No se leen automáticamente artículos completos, no se compran créditos y no se requieren cuentas nuevas.

Cada ficha distingue publicación de fecha del hecho (desconocida si no se verificó), ubicación del reporte, nivel y alcance de confianza, respuesta oficial pendiente, orientación de competencia y próximo paso. Una mención a la policía o a un operador en un medio no equivale a confirmación primaria. En Seguridad se omiten nombres, edades, nacionalidades, antecedentes y otros datos personales no necesarios. Una detención no se presenta como nuevo robo ni culpabilidad. Las notas idénticas y una misma medida de subte de igual fecha/red/motivo se agrupan sin inferir corroboración independiente. Otras posibles duplicaciones quedan sujetas a revisión; el número de fichas no es incidencia delictiva ni cantidad de reclamos.

Fechas antiguas, futuras, sin zona horaria, relatos retrospectivos explícitos, contexto territorial incompatible y URLs inseguras se descartan. Las cancelaciones y normalizaciones explícitas se distinguen de reportes; ningún resultado RSS por sí solo se marca como incidente activo. La publicación reciente no garantiza que un hecho sea reciente: los casos permanecen pendientes de lectura y verificación.

La salud de consulta contempla errores HTTP, HTML, XML inválido, timeout y fuentes cuya publicación más reciente quedó fuera de ventana. Un feed válido vacío es distinto de uno fallido. `healthy` se refiere a consultas configuradas, no a cobertura exhaustiva; no encontrar casos no demuestra que no existan problemas. El historial compara publicaciones recuperadas, nunca incidentes: tendencia de problemas desconocida.

`docs/caba-topic-verified-cases-2026-10-20.json` contiene ejemplos revisados y fechados, incluidos casos resueltos, planeados y cancelados. Son evidencia de validación, no alertas estáticas que el runtime recicle. La observación operativa del subte sólo valía al instante indicado y exige reconsulta antes de tratarla como vigente.

Esta expansión incorpora un job de captura y artifacts a CI del PR; no cambia horarios ni la rama que consume el piloto. Se publica como PR #12 en borrador, apilado sobre el PR #10. Cloudflare genera automáticamente una vista previa pública de la rama; se autorizó ese efecto, no un merge ni la publicación en el sitio principal. Mientras no se integre, el workflow horario continúa capturando sólo Electricidad.


## Historial persistente de los otros temas (rama de trabajo)

- `npm run capture:topics` consulta las fuentes sin claves y guarda una captura inmutable por fecha en `tmp/topic-history/`. Cada archivo tiene SHA-256, esquema y versión de análisis; repetir exactamente la misma captura es idempotente. Conflictos, archivos corruptos, symlinks y límites de tamaño fallan de forma segura. No se descarta una captura degradada para buscar otra más favorable.
- Las siguientes ejecuciones comparan contra la captura inmediatamente anterior de ese directorio, incluso tras reiniciar el proceso. El reporte legible queda en `tmp/live-topics-report.json`; `tmp/topic-capture-artifact/` contiene el reporte y el sobre íntegro `topic-snapshot.json`. El directorio debe conservarse entre ejecuciones: memoria de un Worker o un runner nuevo no es almacenamiento persistente.
- `PREVIOUS_TOPICS_SNAPSHOT=/ruta/topic-snapshot.json npm run capture:topics` usa exclusivamente ese sobre como baseline. Si falta o es inválido, no vuelve silenciosamente a otro archivo local. `TOPICS_HISTORY_DIR` cambia el directorio de historial; `CAPTURE_SPAN` cambia la ventana. Se impide escribir salidas encima del historial.
- La comparación cuenta URLs canónicas de publicaciones, no fichas agrupadas ni hechos. Distingue incorporadas desde la captura anterior, presentes, no recuperadas, fuera de ventana y cambios de datos/agrupación. Una publicación incorporada puede ser vieja o haber aparecido en una captura todavía anterior; una ausente no significa resuelta.
- Requiere mismo tema, ventana, versión, fuentes y estado de cada feed; fechas válidas, captura actual de hasta 2 horas, separación de 5 minutos a 48 horas y ventanas solapadas. Feeds fallidos o sin fechas bloquean los deltas. Fuentes antiguas estables sólo permiten comparación explícitamente parcial. Cambios de cobertura dejan los conteos comparativos en `null`, no cero. Dos capturas nunca establecen tendencia de incidentes.
- La API pública sigue haciendo consultas transitorias: muestra que **no se guardan** en un historial. No hay base duradera configurada en Cloudflare y no se simula una. El HTML congelado generado con `npm run preview:topics` sí puede mostrar el reporte persistido, con sus fechas exactas, sin actualización automática; filtrar a una ventana distinta invalida su comparación.
- CI del PR guarda una captura por ejecución como `stonedowl-topics-ci-RUN_ID` durante 14 días. Con los permisos actuales sólo publica el artifact de su propia ejecución; no restaura el anterior y no es un historial horario ni la fuente de la API. Los fallos/coverage parcial quedan rojos y el artifact se sube igualmente.
- `scripts/restore-previous-topics.mjs` está preparado para el workflow horario existente, pero **no está activado**. Usa sólo lecturas con su permiso `actions: read` existente, verifica el último run previo, repositorio/rama/workflow y sobre íntegro, sin elegir un artifact más viejo si el inmediato falta o está corrupto. No envía el token al almacenamiento de descarga. El primer run no tendrá baseline.

`docs/topic-history-activation.patch` propone añadir un job independiente al workflow horario de `main`, con el mismo cron, permisos y retención de 14 días; deja intacto el job de Electricidad. Es una propuesta pendiente de aprobación, no un cambio aplicado. Aumentaría las consultas públicas y minutos de Actions; capturaría desde `feat/caba-topics-v01` sin fusionar el código de la ampliación en la web principal. Sin embargo, un commit del workflow en `main` puede disparar un build/deploy automático de Cloudflare con el código actual de `main`: no hay una exclusión de paths verificada. El antecedente `2ae9b383` quedó `skipped`, pero no garantiza futuros resultados. Esa posibilidad debe incluirse en la aprobación antes de activar; este patch no modifica la integración. La retención de artifacts no es un archivo permanente: después de 14 días expiran. Para más retención o servir el historial por API se necesita una decisión de almacenamiento separada.
