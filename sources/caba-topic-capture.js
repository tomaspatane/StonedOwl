import { parsePublisherRss, readPublisherFeed } from './free-electricidad.js';
import { TOPICS, CAPTURE_WINDOWS, topicSignal, buildTopicCases } from '../data/caba-topics.js';

// Publisher-owned discovery feeds only. No paid search, account or API key.
// Search matches article bodies upstream, but our filter uses only RSS title and
// excerpt; a query hit is not evidence of a topic, location or incident.
const searchFeed = (id, name, base, term) => ({ id: `${id}_${term}`, name, url: `${base}/?s=${encodeURIComponent(term)}&feed=rss2` });
const society = { id: 'pagina12_sociedad', name: 'Página/12', url: 'https://www.pagina12.com.ar/arc/outboundfeeds/rss/secciones/sociedad/notas' };
function localFeeds(terms) {
  return terms.flatMap(term => [searchFeed('pura_ciudad', 'Pura Ciudad', 'https://www.puraciudad.com.ar', term), searchFeed('el_abasto', 'Revista El Abasto', 'https://www.revistaelabasto.com.ar', term)]);
}
export const TOPIC_FEEDS = Object.freeze({
  basura: Object.freeze([...localFeeds(['basura', 'limpieza']), society]),
  transporte: Object.freeze([...localFeeds(['subte', 'colectivos']), society]),
  seguridad: Object.freeze([
    { id: 'pura_ciudad_policiales', name: 'Pura Ciudad', url: 'https://www.puraciudad.com.ar/category/policiales/feed/' },
    searchFeed('pura_ciudad', 'Pura Ciudad', 'https://www.puraciudad.com.ar', 'robo'),
    searchFeed('el_abasto', 'Revista El Abasto', 'https://www.revistaelabasto.com.ar', 'robo'), society
  ])
});

export async function captureTopic(topic, { span = '1w', now = Date.now(), feeds = TOPIC_FEEDS[topic], timeoutMs = 12000 } = {}, fetchImpl = fetch) {
  if (!TOPICS[topic] || !CAPTURE_WINDOWS[span]) throw new Error('Tema o ventana no soportados');
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('Fecha de captura inválida');
  if (!Array.isArray(feeds) || !feeds.length) throw new Error('No hay fuentes configuradas');
  const timeout = Math.max(1, Math.min(30000, Number(timeoutMs) || 12000));
  const settled = await Promise.all(feeds.map(async feed => {
    try {
      const response = await readPublisherFeed(feed, timeout, fetchImpl);
      const parsed = parsePublisherRss(response.raw, { feed, span, now: nowMs, matches: text => Boolean(topicSignal(topic, text)) });
      return { articles: parsed.articles, diagnostic: { feedId: feed.id, url: feed.url, publisher: feed.name, ok: true,
        ...parsed.diagnostics, status: parsed.diagnostics.stale ? 'stale' : parsed.diagnostics.rawCount > 0 && !parsed.diagnostics.latestPublishedAt ? 'undated' : 'healthy', contentType: response.contentType } };
    } catch (error) {
      return { articles: [], diagnostic: { feedId: feed.id, url: feed.url, publisher: feed.name, ok: false, status: 'failed', code: error.code || 'network_error', error: String(error.message || error) } };
    }
  }));
  const diagnostics = settled.map(item => item.diagnostic);
  const successful = diagnostics.filter(item => item.ok).length;
  const fresh = diagnostics.filter(item => item.status === 'healthy').length;
  const undated = diagnostics.filter(item => item.status === 'undated').length;
  const stale = diagnostics.filter(item => item.stale).length;
  const failed = diagnostics.length - successful;
  const status = fresh === diagnostics.length ? 'healthy' : successful ? 'degraded' : 'failed';
  const result = buildTopicCases(settled.flatMap(item => item.articles), topic, { now: nowMs, span });
  const health = { status, usable: successful > 0, successful, failed, stale, undated,
    successfulPublishers: [...new Set(diagnostics.filter(item => item.ok).map(item => item.publisher))],
    interpretation: 'Salud de consulta a las fuentes configuradas, no cobertura exhaustiva ni ausencia de problemas.' };
  return {
    ok: status === 'healthy', captureUsable: health.usable, version: 'caba-topics-v1', topicId: topic, topic: TOPICS[topic].label,
    span, fetchedAt: new Date(nowMs).toISOString(), captureHealth: health, coverage: health,
    sourceHealth: diagnostics, counts: result.diagnostics, editorialCases: result.editorialCases,
    radar: [], thermometer: { status: 'not_calibrated', reason: 'Estos temas no convierten reportes aislados en colores ni zonas peligrosas.' },
    trend: { status: 'unknown', reason: 'sin_historial_comparable_de_incidentes', comparableSnapshots: 0 },
    limitations: [
      'Fuentes limitadas y no exhaustivas; no es un relevamiento de todos los reclamos ni de todos los barrios.',
      'Se lee únicamente título y resumen RSS. La fecha de publicación no confirma fecha ni vigencia del hecho.',
      'Una fuente identificada no confirma el hecho. No se infiere independencia entre medios que repiten un comunicado.',
      'Las respuestas oficiales y la responsabilidad del caso requieren verificación. No se asigna culpabilidad.',
      'Una noticia republicada sin indicación temporal explícita puede requerir descarte tras leer su fuente.',
      'Sin historial comparable, tendencia desconocida. Sin calibración, no se generan alertas territoriales.'
    ]
  };
}

export async function captureAllTopics(options = {}, fetchImpl = fetch) {
  const results = await Promise.all(Object.keys(TOPICS).map(async topic => [topic, await captureTopic(topic, options, fetchImpl)]));
  const topics = Object.fromEntries(results);
  const all = Object.values(topics);
  const status = all.every(item => item.ok) ? 'healthy' : all.some(item => item.captureUsable) ? 'degraded' : 'failed';
  return { ok: status === 'healthy', captureUsable: all.some(item => item.captureUsable), version: 'caba-topics-v1',
    fetchedAt: new Date().toISOString(), captureHealth: { status }, topics,
    editorialCases: all.flatMap(item => item.editorialCases),
    trend: { status: 'unknown', reason: 'sin_historial_comparable_de_incidentes' } };
}
