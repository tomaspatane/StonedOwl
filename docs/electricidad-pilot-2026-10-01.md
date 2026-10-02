# Piloto Electricidad — validación manual 2026-10-01

## Objetivo

Validar si el vocabulario ciudadano diseñado para Stoned Owl encuentra señales territoriales útiles de problemas eléctricos en CABA y detectar qué fuentes aportan señal real versus ruido.

## Prueba realizada

Se ejecutó una batería manual de más de 20 consultas combinando:

- expresiones: `sin luz`, `corte de luz`, `apagón`, `baja tensión`, `transformador`, `microcortes`, `otra vez sin luz`, `estamos sin luz`, `no volvió la luz`, `toda la cuadra sin luz`, `se cortó la luz`;
- barrios: Flores, Caballito, Villa Lugano, Almagro, Boedo, Villa Urquiza, Mataderos, Parque Patricios, Belgrano;
- entidades: Edesur, Edenor;
- fuentes: web abierta, noticias y Reddit.

## Hallazgos

### 1. El vocabulario funciona

Las expresiones de experiencia personal recuperan señales mucho más útiles que términos genéricos como `electricidad` o `servicio eléctrico`.

Patrones especialmente valiosos:

- `sin luz` + barrio;
- `baja tensión` + empresa/barrio;
- `otra vez sin luz`;
- `hace X horas/días`;
- `varios en la cuadra`;
- `se quemó la heladera/electrodomésticos`;
- `reclamo` + Edesur/ENRE.

### 2. Noticias ≠ termómetro social

Google News, Bing News y GDELT son útiles para confirmar eventos grandes, pero tienden a devolver:

- apagones masivos;
- notas replicadas por múltiples medios;
- hechos ya consolidados.

Por sí solos no alcanzan para detectar temprano problemas de cuadra o edificio.

### 3. Reddit aporta señal ciudadana de alta calidad

Las búsquedas en Reddit recuperaron relatos directos con atributos que Stoned Owl necesita extraer:

- duración concreta del problema;
- barrio o microzona;
- varias viviendas afectadas;
- empresa responsable;
- reclamos previos;
- consecuencias materiales;
- repetición del problema.

Conclusión: Reddit debe entrar al MVP de Electricidad como fuente prioritaria, no como agregado posterior.

### 4. ENRE debe funcionar como fuente de confirmación

El ENRE mantiene información de estado del servicio de Edenor y Edesur que se actualiza aproximadamente cada cinco minutos y publica detalle territorial, usuarios afectados y normalización estimada.

Uso propuesto:

- no usar ENRE para reemplazar la señal ciudadana;
- usarlo para confirmar, dimensionar y cerrar eventos;
- aumentar `confidence` cuando coincide con una señal social;
- detectar falsos positivos cuando una queja aislada no aparece acompañada por otras señales.

### 5. Google Web sigue siendo necesario

Las fuentes de noticias no capturan suficientemente bien frases como `se me cortó la luz en Flores` o `hace horas que estamos sin luz`.

El colector Google Web vía Serper ya está previsto en el MVP. Debe activarse con `SERPER_API_KEY` para probar búsquedas en web general y medir su aporte incremental.

## Ajuste de arquitectura

Orden de fuentes recomendado para Electricidad:

1. Reddit / foros y relatos ciudadanos públicos.
2. Google Web para descubrimiento transversal.
3. ENRE como confirmación oficial y medición de alcance.
4. Google News / Bing News / GDELT como confirmación mediática y contexto.

## Criterio de éxito del MVP

El MVP se considera validado cuando, sobre una muestra de eventos reales:

- detecta al menos una señal territorial antes o cerca de la primera cobertura periodística;
- identifica correctamente barrio/comuna;
- agrupa menciones del mismo incidente;
- evita contar republicaciones como fuentes independientes;
- separa intensidad de confianza;
- puede contrastar el evento con ENRE.

## Próximos pasos

1. Integrar Reddit al endpoint `/api/electricidad`.
2. Integrar ENRE como fuente `official_confirmation`.
3. Activar Serper/Google Web.
4. Crear corpus de casos sintéticos y reales anonimizados para evaluar precisión.
5. Medir falsos positivos por expresión y comenzar estadísticas de performance del vocabulario.
6. Recién después incorporar baseline histórico de 28 días.
