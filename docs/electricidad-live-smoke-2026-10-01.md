# Stoned Owl — Electricidad live smoke test (2026-10-01)

## Objetivo

Probar el MVP de Electricidad contra fuentes reales, sin desplegar el branch a producción, para verificar tres cosas: acceso efectivo a las fuentes, geolocalización por barrio y utilidad operativa de los datos.

## Resultado general

El smoke test en GitHub Actions terminó correctamente. La fuente ENRE respondió y produjo datos utilizables de CABA. El acceso directo a Reddit desde el runner fue bloqueado por rate limits / protecciones anti-bot (HTTP 403/429).

## ENRE

El ENRE respondió correctamente para EDESUR y EDENOR.

Totales reportados al momento de la corrida:

- EDESUR: 4.202 usuarios sin suministro; actualización 20:35.
- EDENOR: 439 usuarios sin suministro; actualización 20:35.

Registros de CABA detectados:

- La Boca: 393 usuarios afectados, corte programado.
- San Nicolás: 267 usuarios afectados, corte programado.
- Monserrat: 124 usuarios afectados, corte programado.
- Villa Lugano: 86 usuarios afectados, baja tensión.
- Villa del Parque: 37 usuarios afectados, baja tensión.

## Hallazgo de geocodificación

La primera corrida asignó erróneamente un registro de San Nicolás también a Balvanera porque la detección libre encontraba el alias `Once` dentro de metadatos del registro oficial. Se corrigió la lógica: para fuentes estructuradas como ENRE se prioriza match exacto sobre `localidad` y sólo se usa detección textual como fallback.

Después de la corrección, el radar pasó de seis barrios señalados a cinco y San Nicolás quedó correctamente asignado sólo a San Nicolás.

## Reddit

El acceso directo a los RSS de r/BuenosAires, r/argentina y r/AskArgentina fue rechazado con HTTP 403/429 desde GitHub Actions. Esto confirma que Reddit directo no debe ser la ruta principal del producto.

Se agregó un colector alternativo `Google Web / Reddit` vía Serper. Cuando exista `SERPER_API_KEY`, Stoned Owl buscará posts de Reddit a través de Google Web y usará Reddit directo sólo como fallback cuando no haya key.

## Decisión de arquitectura

Para el MVP de Electricidad, el orden práctico de fuentes queda:

1. Google Web / Reddit para relatos ciudadanos, cuando Serper esté configurado.
2. ENRE para confirmación oficial y dimensión de usuarios afectados.
3. Google News / Bing News / GDELT para cobertura mediática y contraste.
4. Reddit directo sólo como fallback experimental.

## Estado

- CI de parsers: verde.
- Smoke test de fuentes reales: verde.
- ENRE real: operativo.
- Geocodificación oficial: corregida.
- Reddit directo: no confiable desde infraestructura cloud.
- Serper / Google Web: código listo, falta configurar `SERPER_API_KEY` para probarlo en el pipeline.
- Baseline histórico: pendiente.
- Producción: sin cambios; el PR sigue en draft.
