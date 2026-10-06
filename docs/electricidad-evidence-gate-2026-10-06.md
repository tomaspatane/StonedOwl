# Corrección de evidencia local — 6 de octubre de 2026

Muestra observada: https://github.com/tomaspatane/StonedOwl/actions/runs/37485840736
Captura: 2026-10-06T15:15:04.135Z (12:15 en Buenos Aires).

De 107 resultados territoriales, el clasificador anterior aceptó 3. La revisión encontró un anuncio de luces, un aviso de alternador con un fragmento sobre un corte y un reel con fragmentos geográficos mezclados. Ninguno tenía fecha de publicación. No son tres cortes confirmados.

## Cambio

- La evidencia web barrial requiere incidente eléctrico y ubicación en un mismo fragmento, más fecha de publicación interpretable dentro de la ventana consultada.
- Se excluyen patrones comerciales, índices, condicionales y menciones débiles; el dominio de una red social no convierte evidencia débil en un reporte válido.
- Las fechas ausentes, no interpretables, futuras o antiguas tienen motivos explícitos de exclusión. El filtro temporal del buscador no reemplaza la fecha del resultado.
- La regla se aplica a las entradas territoriales, generales y noticias heredadas. La ingestión estructurada de ENRE no se modifica.
- El artefacto horario conserva todas las evaluaciones territoriales, con entrada original, URL, fecha y motivo, para poder repetir auditorías. No se reescriben capturas anteriores.

## Validación y límites

Los tres resultados previamente aceptados quedan excluidos, incluso si se les agrega una fecha reciente como control. Pasan 15 casos sintéticos de clasificación, controles de fecha y pruebas de las tres entradas web del runtime. Se conserva el registro oficial de Constitución con 38 usuarios afectados en la prueba de ingestión. También pasa la suite previa de vocabulario, geografía, fuentes, termómetro y sintaxis de frontend.

Esto verifica regresiones concretas, no mide recall ni precisión de toda la búsqueda. La restricción de fecha reduce cobertura cuando el buscador omite metadatos. Las reglas son heurísticas y pueden excluir reportes reales o dejar pasar otros falsos positivos. El siguiente paso es revisar nuevas capturas del mismo piloto y sus exclusiones. No se amplían fuentes, consultas ni temas, y no se modifica el despliegue de la web.

El fixture reproduce títulos y fragmentos observados; omite un teléfono comercial por no ser necesario para la prueba.
