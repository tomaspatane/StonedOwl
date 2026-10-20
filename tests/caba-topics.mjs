import assert from 'node:assert/strict';
import { topicSignal, topicGeography, classifyTopicArticle, buildTopicCases } from '../data/caba-topics.js';
const now = Date.parse('2026-10-20T14:00:00Z');
const options = { now, span: '1w' };
const item = (title, snippet = '', extra = {}) => ({ title, snippet, date: '2026-10-20T13:00:00Z', url: 'https://publisher.test/case', source: 'publisher.test', ...extra });
const classify = (title, topic, snippet = '', extra = {}) => classifyTopicArticle(item(title, snippet, extra), topic, options);
assert.equal(topicSignal('seguridad', 'La Ciudad aprobó un proyecto de compostaje'), null, 'robo is not a substring of aprobó');
assert.equal(topicSignal('transporte', 'Agredieron a un policía en la estación del subte A'), null, 'Security incident is not necessarily a service interruption');
assert.equal(topicSignal('basura', 'La limpieza de un mural en un centro cultural'), null);
assert.equal(topicSignal('transporte', 'El subte ampliará su horario para recitales'), null, 'Extra service is not a service failure');
assert.equal(topicSignal('seguridad', 'Un tren quedó detenido en Palermo por una falla'), null);
assert.equal(topicSignal('seguridad', 'Robots de limpieza en Palermo'), null);
assert.equal(topicGeography(item('Robo en Palermo, Sicilia'), 'seguridad').accepted, false);
assert.equal(topicSignal('seguridad', 'Seguridad operacional del transporte público'), null);
assert.ok(topicSignal('basura', 'Vecinos de Almagro reclaman por contenedores desbordados'));
assert.ok(topicSignal('transporte', 'Interrupciones en el subte'));

assert.equal(topicGeography(item('Basura acumulada en Almagro'), 'basura').scope, 'barrio');
assert.equal(topicGeography(item('Basura acumulada en Almagro, España'), 'basura').accepted, false, 'Foreign location is not CABA');
for (const text of ['Robaron un auto en Quilmes; investigó la Policía de la Ciudad', 'Robo en Rosario: la víctima vive en Palermo', 'El jugador Núñez sufrió un robo', 'Detuvieron en Tucumán al acusado de robar en La Boca', 'Un robo en la calle Belgrano de Mendoza']) {
  assert.equal(topicGeography(item(text), 'seguridad').accepted, false, text);
}
assert.equal(topicGeography(item('Robo en Parque Avellaneda'), 'seguridad').accepted, true);
assert.equal(topicGeography(item('Un porteño sufrió un robo en Chile'), 'seguridad').accepted, false);
assert.equal(topicGeography(item('Paro en todas las líneas del subte'), 'transporte').scope, 'network');
assert.equal(topicGeography(item('El metro de Madrid tuvo un paro'), 'transporte').accepted, false);
assert.deepEqual(topicGeography(item('Una falla en la estación Constitución del subte'), 'transporte').barrios, [], 'Station does not establish barrio');

const base = classify('Basura acumulada en Almagro', 'basura');
assert.equal(base.accepted, true);
assert.equal(base.case.incidentDate, null);
assert.equal(base.case.activeIncident, null);
assert.equal(base.case.confirmed, false);
assert.equal(base.case.trend, 'desconocida');
assert.equal(base.case.affectsThermometer, false);
assert.equal(base.case.readyToPublish, false);
assert.equal(base.case.confidence.level, 'media');
assert.equal(base.case.officialResponse.statement, null);
assert.equal(classify('Basura acumulada en Almagro', 'basura', '', { date: '2026-10-10T12:00:00Z' }).reason, 'publication_outside_window');
assert.equal(classify('Basura acumulada en Almagro', 'basura', '', { date: '2026-10-21T12:00:00Z' }).accepted, false);
assert.equal(classify('Basura acumulada en Almagro', 'basura', '', { date: '2026-10-20T12:00:00' }).accepted, false);
assert.equal(classify('Basura acumulada en Almagro', 'basura', '', { url: 'javascript:alert(1)' }).accepted, false);
assert.equal(classify('Recuerdan el incendio de un contenedor en Almagro en 2022', 'basura').reason, 'historical_or_recycled_event_requires_review');
assert.equal(classify('Levantaron el paro de subtes en la Línea A', 'transporte').case.reportedStatus, 'cancelado_segun_fuente');
assert.equal(classify('Suspendieron el paro de subtes', 'transporte').case.reportedStatus, 'cancelado_segun_fuente');
assert.equal(classify('Suspendieron el servicio de subte por el paro', 'transporte').case.reportedStatus, 'reportado_no_verificado');
assert.equal(classify('No se levantó el paro de subtes', 'transporte').case.reportedStatus, 'reportado_no_verificado');
for (const negated of ['No se canceló el paro de subtes', 'No se suspendió el paro de subtes', 'No se reanudó el servicio de subte tras demoras']) assert.equal(classify(negated, 'transporte').case.reportedStatus, 'reportado_no_verificado');
assert.equal(classify('El subte normalizó el servicio tras las demoras', 'transporte').case.reportedStatus, 'resuelto_segun_fuente');
assert.equal(classify('Anuncian un paro de subtes para mañana', 'transporte').case.reportedStatus, 'anunciado_no_verificado');

const police = classify('Detuvieron a dos hombres en Constitución con celulares sin documentación', 'seguridad', 'Según la Policía de la Ciudad. Sus nombres y nacionalidad no se publican en la ficha.');
assert.equal(police.case.eventType, 'actuacion_policial');
assert.doesNotMatch(police.case.title, /robo/);
assert.doesNotMatch(police.case.reportedFact, /nacionalidad|nombres/);
assert.equal(police.case.officialResponse.status, 'organismo_mencionado_respuesta_no_verificada');
assert.equal(police.case.confirmed, false, 'A publisher saying Police does not make primary confirmation');

const dup = buildTopicCases([item('Robo en Almagro'), item('Robo en Almagro', '', { url: 'https://publisher.test/case?utm_source=x' }), item('Robo en Almagro', '', { url: 'https://syndicated.test/same', source: 'syndicated.test' })], 'seguridad', options);
assert.equal(dup.editorialCases.length, 1);
assert.equal(dup.editorialCases[0].evidence.length, 2);
assert.equal(dup.editorialCases[0].independentCorroboration, false);
assert.equal(dup.editorialCases[0].confidence.level, 'media');
const aliases = buildTopicCases([item('Robo en Almagro'), item('Robo en Almagro', '', { url: 'https://second.test/case' }), item('Otro reporte de robo en Almagro', '', { url: 'https://second.test/case' })], 'seguridad', options);
assert.equal(aliases.editorialCases.length, 1, 'Merged URL aliases remain deduped after title changes');
const strike = buildTopicCases([
  item('Paro total de subtes y Premetro por la detención de trabajadores'),
  item('Paro sorpresivo de subtes tras la detención de trabajadores y delegados', '', { url: 'https://second.test/strike' }),
  item('Paro sorpresivo en el subte: todas las líneas están interrumpidas', 'La medida se tomó tras el intento de arrestar a dirigentes.', { url: 'https://third.test/strike' })
], 'transporte', options);
assert.equal(strike.editorialCases.length, 1, 'Same day/network/motive strike is one case, not three independent events');
assert.equal(strike.editorialCases[0].evidence.length, 3);
const conflicting = buildTopicCases([item('Paro en el subte de la Línea A'), item('Levantaron el paro en el subte de la Línea A')], 'transporte', options);
assert.equal(conflicting.editorialCases[0].reportedStatus, 'versiones_en_conflicto');
const lines = buildTopicCases([item('Paro en el subte de la Línea A por la detención de trabajadores'), item('Paro en el subte de la Línea B por la detención de trabajadores', '', { url: 'https://second.test/line-b' })], 'transporte', options);
assert.equal(lines.editorialCases.length, 2, 'Different line measures do not merge');
console.log('CABA topics: relevance, geography, temporal uncertainty, cancellation, privacy and dedup OK');
