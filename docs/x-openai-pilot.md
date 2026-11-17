# Búsqueda de publicaciones de X con créditos OpenAI

Este piloto agrega `npm run capture:x` a la rama de temas de StonedOwl. Usa la Responses API de OpenAI y `web_search`, limitado a `x.com` y `twitter.com`. Recupera pistas con enlaces para revisión; no es un cliente de la API de X ni una escucha exhaustiva o en tiempo real.

## Activación

1. Crear/conectar una clave de un proyecto de la organización OpenAI a la que se acreditó el saldo. OpenAI Developers en ChatGPT permite crear claves de manera segura; alternativamente se configura desde API Platform. No pegar claves en chats, código, argumentos de consola o archivos públicos.
2. Inyectar `OPENAI_API_KEY` como secreto de entorno del proceso.
3. Ejecutar `npm run capture:x -- --live`. Por defecto consulta los cuatro temas existentes en las últimas 24 horas. `X_TOPIC=transporte` limita a un tema; `CAPTURE_SPAN` acepta `6h`, `1d`, `3d`, `1w`.
4. Revisar `tmp/x-openai-report.md` y `tmp/x-openai-report.json`. `tmp/` está excluido de Git.

Sin `--live` no se hace ninguna solicitud. Sin clave no se simulan resultados. Las pruebas usan respuestas sintéticas y no consumen créditos. No se agrega un endpoint público con facturación ni se activa una tarea periódica. Para ponerlo en el flujo horario o en Cloudflare hay que conectar el secreto y validar primero una captura real.

## Consumo

Cada ejecución explícita hace una sola solicitud de Responses, como máximo dos llamadas a herramientas integradas y 2.500 tokens de salida, incluido razonamiento. Modelo: `gpt-6.1-terra`, razonamiento bajo y contexto de búsqueda bajo. No hay reintentos automáticos ni proveedor pago alternativo.

Estos límites acotan el trabajo, **no constituyen un tope exacto en dólares**: también se factura el contexto recuperado. El reporte registra los tokens que devuelve la API y las llamadas realizadas; el importe real se consulta en Usage. Un timeout de cliente no prueba que no hubo consumo. El script no consulta el saldo ni modifica recargas o facturación; OpenAI puede usar saldo comprado cuando se agota el promocional. Para esta primera validación conviene una única ejecución, revisar resultados y consumo antes de repetir.

## Evidencia y límites

- Sólo se aceptan URLs de posts que estén en la lista de fuentes devuelta por la herramienta de búsqueda. Una URL escrita únicamente por el modelo o en sus citas no alcanza.
- Se validan dominio, protocolo y formato, se eliminan parámetros y se deduplican los identificadores de los posts. No se siguen URLs arbitrarias.
- La fecha de publicación se deriva del identificador Snowflake de X con BigInt; se descartan identificadores fuera de la ventana o del futuro. Esa fecha no acredita la fecha del hecho ni la existencia del post fuera del índice consultado.
- Los temas y la ubicación propuesta se filtran con las reglas de StonedOwl sobre el resumen del modelo; **no son geolocalización verificada ni texto original del post**. Las comunas se toman del catálogo existente sólo cuando hay un barrio propuesto.
- Los resultados se guardan en `editorialLeads`, con `readyToPublish: false` y `affectsThermometer: false`. No alimentan automáticamente `editorialCases`, tendencias o alertas del mapa. Un resultado con enlace no confirma una denuncia.
- Una captura completada sin pistas es distinta de error, búsqueda no realizada, respuesta incompleta, falta de clave o créditos. No hay publicaciones de ejemplo presentadas como capturas reales.
- Se requiere abrir el post original para validar la síntesis, lugar, estado anunciado/cancelado/restablecido y fecha del hecho. La indexación puede ser insuficiente: si el piloto no recupera material útil, no corresponde escalar su consumo; el acceso directo a X requiere credenciales y facturación independientes.

## Fuentes técnicas

- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://developers.openai.com/api/docs/models/gpt-6.1-terra
- https://developers.openai.com/api/docs/guides/chatgpt-api-credits
- https://docs.x.com/fundamentals/x-ids
