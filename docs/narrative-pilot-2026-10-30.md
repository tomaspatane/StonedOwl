# Primera aplicación del radar: comparación de fuentes

Implementado el 30 de octubre de 2026 en el PR de evaluación. JavaScript local, sin modelos ni APIs pagas. El piloto queda fuera del runtime: genera evidencia para decidir una futura integración, sin publicar agrupaciones nuevas.

## Qué hace

- Extrae actor explícito, acción, objeto, alcance de servicio y estado de titulares de subte mediante reglas acotadas. Cada campo conserva el ID de fuente y los offsets del fragmento exacto que lo respalda; `evidenceText(source, field)` devuelve la cita. Los offsets son UTF-16 y apuntan al texto original, nunca al normalizado.
- Conserva las letras de Línea A/B/C/D/E/H al tokenizar. Antes se perdían como palabras de una letra.
- Distingue anuncio, fin de medida, servicio restablecido y extensión horaria. Una diferencia de estado se deriva a revisión: puede ser evolución temporal, no necesariamente contradicción.
- Señala énfasis observables: impacto barrial, estación, sorpresa, detenciones y conciertos. No infiere ideología, intención ni veracidad.
- Compara pares sin agrupar por transitividad. Todas las propuestas mantienen `autoMerge: false`, `independentCorroboration: false`, `activeIncident: null` y `affectsThermometer: false`.
- Usa una ventana de dos días de publicación sólo para proponer candidatos. No reemplaza la fecha del hecho. Las fechas ISO explícitas se registran como menciones textuales; su interpretación requiere revisión. Fechas relativas, negación, modalidad, alcance ambiguo o campos necesarios faltantes bloquean la propuesta.

El actor queda vacío si el titular omite quién ejecuta la acción. Un trabajador mencionado como detenido no se convierte automáticamente en actor del paro. No es un analizador sintáctico general ni una implementación completa de los papers.

## Ejecución y resultado

```sh
npm run benchmark:narratives
npm run benchmark:retrieval
npm test
```

El informe reproducible se escribe en `tmp/narrative-pilot-report.json`: fuentes, campos, offsets, decisiones por par, diferencias de énfasis y métricas. La muestra congelada está en `docs/caba-narrative-pilot-v0.json`, con URLs y fechas de publicación verificadas. Una nota de El Abasto fue comprobada mediante la republicación atribuida de CEMBA porque el original no abrió; se conserva esa procedencia y no se cuenta como otra fuente.

Diez titulares, dos medios, tres episodios, cinco etapas, 45 pares y cinco pares positivos según etiquetas del asistente. Las etiquetas se guardan separadas y no entran al extractor ni al comparador. Positivo significa mismo episodio **y** misma etapa; anuncio y cancelación pueden pertenecer al mismo episodio sin ser duplicados intercambiables.

| Método | Pares correctos propuestos | Falsas coincidencias | Pares válidos omitidos |
|---|---:|---:|---:|
| TF-IDF/coseno, umbral 0,35 | 4 | 4 | 1 |
| TF-IDF/coseno + misma ventana de publicación | 4 | 4 | 1 |
| Candidatos con campos y estado | 4 | 0 | 1 |

Los cuatro falsos positivos textuales mezclan anuncio y cancelación de la medida de Línea A. El método estructurado los mantiene para revisión. Omite una coincidencia válida del paro de toda la red porque uno de sus titulares no explicita el alcance: no lo completa con el resumen del caso. Quince pares requieren revisión, incluyendo cambios de estado.

Sensibilidad del baseline con ventana: a umbral 0,25 propone cinco pares correctos y cuatro falsos; a 0,50, dos correctos y dos falsos. No se eligió un umbral ganador. La evaluación es de desarrollo: reglas y etiquetas se construyeron viendo los mismos casos. **No prueba mejora en producción**, ni permite extrapolar a otros temas o medios. Los pares comparten artículos, por lo que tampoco son 45 observaciones independientes.

## Corrección del benchmark anterior

El índice agregaba el resumen y lugar anotado del caso a cada documento. Se retiraron para evitar que fuentes distintas parecieran similares por información agregada por el evaluador. También se retiraron las descripciones parafraseadas y el barrio asignado a negativos; se indexa únicamente texto registrado de las fuentes.

El anuncio de horarios de Emova sin captura textual queda excluido y registrado como `no_recorded_source_text`. La muestra pasa de 15 a 14 documentos, con los mismos ocho casos. BM25, TF-IDF y RRF obtienen MRR 0,917 y recall @10 de 100%; con sólo 14 documentos, ese corte es poco exigente. Se mantiene `insufficient_sample` y ninguna recomendación. Los resultados anteriores no son comparables con esta versión.

## Usar titulares nuevos

```sh
npm run benchmark:narratives -- /ruta/input.json
```

`input.json` contiene `documents`, un array de objetos con `id`, `text` (titular original de 1–500 caracteres), `url`, `publisher` y `publicationDate` (`YYYY-MM-DD` o ISO). `retrievedFrom` es opcional para republicaciones. El límite es 200 titulares por lote: el piloto compara todos los pares. No pasar resúmenes del analista ni páginas completas.

`labels` es opcional, con un objeto por ID: `{ "episode": "identificador", "stage": "etapa" }`. Sin etiquetas sólo produce propuestas, nunca métricas ficticias. Antes de una promoción al runtime hacen falta nuevos episodios sin ajustar las reglas a sus resultados, anotación independiente, contenido suficiente para validar fechas y causas y comparación con la agrupación de producción. Este baseline de coseno no es el agrupador productivo.

## Validación e inspiración

La suite cubre negaciones, modalidad, alcance ausente o contradictorio, cambio de estado, fechas inválidas, días explícitos diferentes, actores distintos, evidencia con offsets inválidos, IDs repetidos, separación del gold y orden de entrada. Pasaron la suite completa y ambos comandos de evaluación.

Las ideas de conservar evidencia y contrastar coberturas se toman del radar: [comparación de coberturas](https://arxiv.org/abs/2610.35208), [estructura de actores/acciones/objetos](https://arxiv.org/abs/2610.37804) y [preservación de evidencia](https://arxiv.org/abs/2610.37624). Esta primera aplicación utiliza reglas propias pequeñas y auditables; no reproduce sus modelos ni sus resultados.
