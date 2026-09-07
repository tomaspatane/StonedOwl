# StonedOwl

Radar de agenda en desarrollo sobre Cloudflare Workers. La producción de referencia continúa en v0.7. Esta rama incorpora **0.7.1-stories**: consultas resistentes a fallas, normalización y agrupación de artículos en historias.

## Qué cambia

- `/api/news`, `/api/gdelt` y `/api/stories` entregan notas normalizadas y grupos de títulos similares con sus enlaces y medios.
- Una fuente caída permite resultados parciales; todas caídas devuelven HTTP 503. Un RSS válido vacío devuelve HTTP 200. Se rechazan respuestas HTML que aparentan éxito.
- Límites de 6,5 s para Bing/Google y 2,5 s para GDELT, incluyendo lectura del cuerpo. La interfaz cancela a los 12 s y permite reintentar.
- Decodificación de entidades, fechas consistentes, eliminación de enlaces duplicados y parámetros de seguimiento. Se conservan publicaciones de distintos medios con el mismo título.
- Todos los proveedores respetan la ventana temporal. Las fechas ausentes/inválidas se excluyen porque no permiten confirmar el período.
- Las consultas simples filtran coincidencia temática en título/resumen. CABA admite variantes explícitas; cuando no hay evidencia geográfica, la nota se conserva marcada como ubicación por verificar. Consultas con operadores avanzados se delegan al proveedor sin reinterpretarlas.
- Historias agrupadas por similitud conservadora de títulos y ventana de publicación de 72 h, ordenadas por cantidad de medios y fecha. La agrupación puede cometer errores y no es una medición de crecimiento.
- La interfaz mantiene accesos rápidos a Salud CABA, Universidad y Subte, muestra evidencia desplegable y distingue cobertura parcial de una consulta vacía.

## Pruebas

Node.js 24, sin instalar dependencias:

```sh
node --test tests/*.test.mjs
```

Las pruebas de interfaz ejecutan los manejadores reales sobre controles DOM mínimos; no reemplazan la revisión visual en navegador.

## Despliegue

`wrangler.jsonc` conserva `src/worker.js` como entrada y `public/` como assets. No se modificaron bindings, D1 ni cron. Esta rama debe probarse en una vista previa de Cloudflare antes de promoverla a `main`.

La acción de GitHub Pages existente publica archivos estáticos; **no ejecuta el Worker ni sus APIs**. La aplicación funcional depende del despliegue de Cloudflare Workers.

## Pendiente

Persistencia D1, captura periódica, historias persistentes y comparación temporal. Ningún score ni porcentaje de crecimiento se muestra sin histórico. Continuar desde esta base y las ramas experimentales preservadas; no reiniciar la infraestructura.

Ver `docs/estado-2026-09-07.md` para diagnóstico y límites de validación.
