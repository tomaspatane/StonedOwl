# Informe de investigación CABA con OpenAI

El objetivo es convertir búsquedas de fuentes locales en fichas utilizables: qué se publicó, dónde, cuándo, estado anunciado/en curso/resuelto y próximo dato que falta verificar. Amplía la lectura RSS existente hacia vivienda, salud y obras; no depende de encontrar publicaciones indexadas de X.

## Ejecución

Con Node 24 y la clave en un archivo local ignorado por Git:

```sh
node --env-file=.env.local scripts/research-caba-openai.mjs --live
```

Si la clave ya está inyectada en el proceso: `npm run research:caba -- --live`. Si el entorno exige su proxy habitual, Node 24 puede usar `NODE_USE_ENV_PROXY=1`; no se cambia la configuración del proxy.

`RESEARCH_DAYS` admite de 1 a 7 días calendario de Buenos Aires, incluido el de consulta. `OPENAI_CREDITS_EXPIRE_AT` bloquea nuevas solicitudes al llegar a la fecha indicada; no consulta ni certifica el saldo. Para el crédito promocional informado con vencimiento el 19/11/2026, el entorno de esta prueba usa un corte conservador el 19/11/2026 a las 00:00 UTC, porque no se confirmó la hora exacta del vencimiento. No se configuraron recargas.

Cada corrida escribe `tmp/caba-research-FECHA.json` y `.md`, incluso si falla o no recupera material. No sobrescribe resultados anteriores. Sin `--live`, sin clave o con el corte de créditos vencido no hay llamada a la API. Los archivos locales y la clave no se incorporan al repositorio.

## Costo y alcance

- Una solicitud Responses por ejecución; hasta cuatro llamadas a herramientas y 3.800 tokens de salida, modelo GPT-6.1 Terra, sin reintentos.
- Registra tokens y llamadas realmente devueltos por la API. El importe exacto se consulta en Usage. Estos límites no son un tope monetario y el control de vencimiento no detecta si se agotó el saldo antes.
- No hay programación periódica ni endpoint público que dispare gasto. La clave sólo se envía a OpenAI, con origen fijo y sin redirecciones.
- Es un informe de investigación con cobertura parcial. No mide volumen de reclamos ni tendencias; tampoco determina culpabilidad o incidentes activos.

## Validación de fuentes

El parser sólo admite enlaces HTTPS de artículos/documentos que aparecen en `web_search_call.action.sources`. Las citas inventadas por el modelo no alcanzan. Conserva identificadores de documentos, retira tracking, deduplica fuentes y rechaza publicaciones de fecha inválida o fuera de ventana. La pertenencia al conjunto de fuentes acredita recuperación del enlace, no lectura completa, veracidad ni independencia de la fuente.

Los resúmenes, fechas, estados y ubicaciones son propuestas del modelo. Las comunas se asignan sólo a nombres explícitos de barrios del catálogo, no a calles o nombres de hospitales. Se mantienen en `editorialLeads`, con `readyToPublish: false`, sin alimentar automáticamente termómetro ni alertas. Una búsqueda vacía devuelve `insufficient_retrieval`: no ausencia de problemas.

## Primera prueba — 17 de noviembre de 2026

Una consulta exploratoria recuperó cinco candidatos sobre alquileres, adecuaciones hospitalarias, cambios de colectivos en Caballito, retiro de material ferroviario en Colegiales y pasos peatonales. Registró 33.982 tokens de entrada, 2.127 de salida y cuatro llamadas a búsqueda. El costo exacto no se verificó.

La validación posterior del comando definitivo también completó la consulta: cinco fichas admitidas de cinco propuestas, 51 URLs recuperadas, 29.790 tokens de entrada, 1.557 de salida y tres llamadas a búsqueda. Incluyó una fuente oficial de Buenos Aires Ciudad y cobertura periodística local. Ambas pruebas fueron invocaciones manuales. `npm test` completo pasó, incluidas diez pruebas nuevas de investigación y las trece del piloto de X.

Una revisión posterior contrastó los artículos mediante su contenido recuperado en búsqueda y distinguió anuncios de actuaciones iniciadas. Algunas páginas bloquearon la apertura directa con HTTP 403; no se presenta eso como lectura del sitio original ni como corroboración independiente. El retiro del playón es una actuación informada como iniciada; no un incendio actual ni una finalización confirmada. Las licitaciones y los proyectos de ley no se presentan como obras ejecutadas o beneficios vigentes.

La captura RSS de control tuvo cobertura degradada: Página/12 agotó el tiempo de espera y dos feeds de El Abasto quedaron antiguos. Se conservaron tres fichas de los colectores (dos de transporte y una de seguridad). La búsqueda OpenAI complementa esos resultados; no encubre la salud de las fuentes.

`npm run test:research` valida la procedencia de URLs, fechas, geografía, duplicados, distinción de estados vacíos/errores, ausencia de consumo sin habilitación, corte de vencimiento y no exposición de claves. Las pruebas son sintéticas y no hacen solicitudes pagas.
