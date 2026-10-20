import { CABA_BARRIOS, normalizePlaceText } from './caba-barrios.js';

export const TOPICS = Object.freeze({
  basura: { label: 'Basura y limpieza', question: '¿Se retiraron los residuos y qué respuesta recibió el reclamo?',
    nextStep: 'Verificar el lugar, la fecha del hecho y la respuesta del servicio de higiene urbana.' },
  transporte: { label: 'Transporte y subte', question: '¿Qué servicio se afectó, durante cuánto tiempo y qué respuesta recibió el usuario?',
    nextStep: 'Confirmar vigencia, línea, alcance y último aviso del operador antes de comunicar una interrupción.' },
  seguridad: { label: 'Seguridad', question: '¿Qué hecho fue denunciado y qué actuación policial o judicial está documentada?',
    nextStep: 'Verificar fecha, lugar y actuación oficial sin identificar innecesariamente a víctimas ni inferir zonas peligrosas.' }
});
export const CAPTURE_WINDOWS = Object.freeze({ '6h': 21600000, '1d': 86400000, '3d': 259200000, '1w': 604800000 });
const normalize = normalizePlaceText;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (text, phrase) => new RegExp(`(^|[^a-z0-9])${escape(normalize(phrase))}([^a-z0-9]|$)`).test(text);
const CABA = /\bcaba\b|\bcapital federal\b|\bciudad (?:autonoma )?de buenos aires\b/;
const OUTSIDE = /\b(?:espana|italia|sicilia|roma|madrid|barcelona|miami|nueva york|francia|alemania|chile|uruguay|brasil|paraguay|bolivia|colombia|peru|mexico|provincia de buenos aires|conurbano|la plata|mar del plata|rosario|mendoza|cordoba|san juan|tucuman|la matanza|moron|quilmes|lanus|avellaneda|san isidro|san martin|tigre|san fernando|berazategui|florencio varela|lomas de zamora|merlo|moreno|ezeiza|escobar|pilar|vicente lopez)\b/;
// Do not assign barrios from names, football clubs, streets, station terminals or
// words such as "once" and "retiro". Named locations need a locative construction.
export function topicGeography(article = {}, topic) {
  const title = normalize(article.title || '');
  const snippet = normalize(article.snippet || '');
  const text = `${title}. ${snippet}`;
  const hasCity = CABA.test(text);
  const withoutCabaNames = value => CABA_BARRIOS.reduce((text, barrio) => text.replace(new RegExp(`\\b${escape(normalize(barrio.name))}\\b`, 'g'), ''), value);
  const outsideTitle = OUTSIDE.test(withoutCabaNames(title));
  const outsideText = OUTSIDE.test(withoutCabaNames(text));
  if (outsideTitle) return { accepted: false, barrios: [], reason: 'conflicting_non_caba_title' };
  const barrios = CABA_BARRIOS.filter(barrio => {
    const names = [barrio.name, ...(barrio.aliases || []).filter(name => !['Boca', 'Once', 'Urquiza', 'Devoto'].includes(name))];
    return names.some(name => {
      const n = escape(normalize(name));
      const re = new RegExp(`(?:\\ben (?:el barrio (?:porteno )?de )?|\\bbarrio (?:porteno )?de |\\bvecinos de |\\bzona de )${n}(?![a-z0-9])`);
      return re.test(text) && !new RegExp(`(?:calle|avenida|av\\.?|estacion|terminal|club|hospital)\\s+${n}(?![a-z0-9])`).test(text);
    });
  });
  if (outsideText) return { accepted: false, barrios: [], reason: 'conflicting_non_caba_context' };
  if (barrios.length > 2) return hasCity ? { accepted: true, barrios: [], scope: 'citywide', reason: 'multiple_locations_not_attributed' } : { accepted: false, barrios: [], reason: 'ambiguous_geography' };
  if (barrios.length) return { accepted: true, barrios: barrios.map(b => b.name), scope: 'barrio', reason: 'explicit_locative_barrio' };
  if (hasCity) return { accepted: true, barrios: [], scope: 'citywide', reason: 'explicit_caba_marker' };
  // The Buenos Aires Subte/Premetro network is inherently in CABA; do not assign
  // every barrio along a line or infer station-to-barrio mappings from names.
  if (topic === 'transporte' && /\bsubtes?\b|\bpremetro\b/.test(text) && !OUTSIDE.test(text) && !/\b(?:madrid|barcelona|santiago|chile|nueva york|paris|londres)\b/.test(text)) return { accepted: true, barrios: [], scope: 'network', reason: 'subte_network_no_barrio_assignment' };
  return { accepted: false, barrios: [], reason: 'caba_location_unverified' };
}

export function topicSignal(topic, rawText = '') {
  const text = normalize(rawText);
  if (topic === 'basura') {
    const waste = /\bbasura\b|\bresiduos\b|\brecoleccion\b|\bcontenedor(?:es)?\b|\blimpieza\b|\bbasurales?\b/;
    const problem = /\bacumula\w*\b|\bdesbord\w*\b|\bmicrobasural\w*\b|\bbasurales?\b|\bsin reco\w*\b|\bfalta de\b|\bno (?:pasa|recog|retir|recolect|funciona)\w*\b|\breclam\w*\b|\bdenunci\w*\b|\bparo\b|\binund\w*\b|\bsuci[oa]\w*\b|\bmalos? olores?\b|\bplaga\w*\b|\bratas\b|\bquem\w*\b|\bincendi\w*\b/;
    return waste.test(text) && problem.test(text) ? { type: /\bparo\b/.test(text) ? 'medida_gremial' : 'reporte_limpieza' } : null;
  }
  if (topic === 'transporte') {
    const transport = /\bsubtes?\b|\bpremetro\b|\bcolectivos?\b|\btrenes?\b|\bferrocarril\b|\bestacion(?:es)?\b|\btransporte publico\b/;
    const problem = /\bparo\w*\b|\bdemora\w*\b|\binterrump\w*\b|\binterrupcion\w*\b|\bsuspend\w*\b|\bsuspension\w*\b|\bcerrad[ao]\w*\b|\bcierre\w*\b|\breducid[ao]\w*\b|\blimitad[ao]\w*\b|\bfalla\w*\b|\bno (?:funciona|circula)\w*\b|\breclam\w*\b|\baccidente\w*\b|\bchoqu\w*\b|\bdescarril\w*\b|\basbesto\b/;
    return transport.test(text) && problem.test(text) ? { type: /\bparo\w*\b/.test(text) ? 'medida_gremial' : 'afectacion_transporte' } : null;
  }
  if (topic === 'seguridad') {
    const policeContext = /\b(?:policia|hombres?|mujer(?:es)?|persona(?:s)?|sospechoso(?:s)?|joven(?:es)?|acusad[oa]s?|profug[oa]s?|celulares|trabajadores)\b/.test(text);
    if (/\b(?:desalojo|desalojaron|allanamiento|allanaron)\b/.test(text) || (policeContext && /\b(?:detuvieron|detuvo|detenid[oa]s?|detencion)\b/.test(text))) return { type: 'actuacion_policial' };
    const categories = [ ['robo', /\b(?:robo|robos|robar|robaron|robaban|robando|robad[oa]s?|robarles?)\b|\basalt\w*\b|\bmotochorros?\b/], ['violencia', /\bhomicidi\w*\b|\btirote\w*\b|\bbalacera\w*\b|\bapu[ñn]ala\w*\b|\bbalead[oa]\w*\b/], ['denuncia_seguridad', /\binseguridad\b|\bdenuncia\w*.{0,35}\bamenaza\w*\b/] ];
    return categories.find(([, re]) => re.test(text)) ? { type: categories.find(([, re]) => re.test(text))[0] } : null;
  }
  return null;
}

function canonicalUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}
function reportedStatus(topic, text) {
  if (/\b(?:no|nunca|desmintio|niegan|nego)\b/.test(text)) return 'reportado_no_verificado';
  if (/\b(?:levanto|levantaron|levantan|desactivo|desactivaron|cancelo|cancelaron|cancelado)\b.{0,50}\b(?:paro|medida de fuerza|huelga)\b|\b(?:paro|huelga)\b.{0,35}\b(?:levantado|cancelado|suspendido)\b|\b(?:suspendio|suspendieron) (?:el |la )?(?:paro|medida de fuerza|huelga)\b/.test(text)) return 'cancelado_segun_fuente';
  if (/\b(?:restablecio|restablecieron|normalizo|normalizaron|reanudo|reanudaron|extinguieron|apagaron)\b|\bservicio normalizado\b|\bvolvio a funcionar\b/.test(text)) return 'resuelto_segun_fuente';
  if (topic !== 'seguridad' && /\b(?:anunci\w*|convoc\w*|previsto|programad[oa]|proximo|manana)\b/.test(text)) return 'anunciado_no_verificado';
  return 'reportado_no_verificado';
}
function historicalCue(text, now) {
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1]));
  return /\b(?:aniversario|efemeride|hace (?:un|dos|tres|cuatro|cinco|\d+) anos|anos atras|recordamos|se cumplen)\b/.test(text) || years.some(year => year < new Date(now).getUTCFullYear());
}
function publicAgencyMention(text, topic) {
  const known = topic === 'transporte' ? ['Emova', 'SBASE', 'Subterráneos de Buenos Aires', 'Metrovías', 'Trenes Argentinos', 'CNRT'] : topic === 'basura' ? ['Gobierno de la Ciudad', 'Higiene Urbana'] : ['Policía de la Ciudad', 'Ministerio Público Fiscal', 'Fiscalía'];
  return known.find(name => word(text, name)) || null;
}
function jurisdiction(topic, text) {
  // These are investigation routes, not assignments of fault or a determination
  // of legal competence in a particular incident.
  if (topic === 'transporte' && /\bsubtes?\b|\bpremetro\b/.test(text)) return { operator: 'Emova (verificar para este caso)', government: 'GCBA / SBASE (orientación por red)', status: 'competencia_del_caso_por_verificar', referenceUrls: ['https://boletinoficial.buenosaires.gob.ar/normativaba/norma/pdf/861330'] };
  if (topic === 'basura') return { operator: null, government: 'Higiene urbana de CABA (orientación por servicio)', status: 'prestador_y_competencia_del_caso_por_verificar', referenceUrls: ['https://buenosaires.gob.ar/gcaba_historico/noticias/buenos-aires-limpia-todo-lo-que-necesitas-saber-para-cuidar-tu-barrio'] };
  return { operator: null, government: null, status: 'por_verificar' };
}

export function classifyTopicArticle(article, topic, { now = Date.now(), span = '1w' } = {}) {
  const config = TOPICS[topic];
  if (!config || !CAPTURE_WINDOWS[span]) throw new Error('Tema o ventana no soportados');
  const url = canonicalUrl(article.url);
  if (!url) return { accepted: false, reason: 'unsafe_or_invalid_url' };
  const publicationMs = Date.parse(article.date || '');
  if (!Number.isFinite(publicationMs) || !/(?:Z|[+-]\d\d:?\d\d)$/.test(article.date || '')) return { accepted: false, reason: 'publication_date_unverified' };
  if (publicationMs > now || now - publicationMs > CAPTURE_WINDOWS[span]) return { accepted: false, reason: 'publication_outside_window' };
  const text = normalize(`${article.title || ''} ${article.snippet || ''}`);
  const signal = topicSignal(topic, text);
  if (!signal) return { accepted: false, reason: 'no_topic_problem_signal' };
  if (historicalCue(text, now)) return { accepted: false, reason: 'historical_or_recycled_event_requires_review' };
  if (/\b(?:opinion|editorial|pelicula|novela|serie de netflix|simulacro)\b/.test(text)) return { accepted: false, reason: 'non_incident_content' };
  const geography = topicGeography(article, topic);
  if (!geography.accepted) return { accepted: false, reason: geography.reason };
  const status = reportedStatus(topic, text);
  const place = geography.barrios.length ? geography.barrios.join(', ') : geography.scope === 'network' ? 'Red de subte de CABA; alcance exacto por verificar' : 'CABA; lugar exacto por verificar';
  const agency = publicAgencyMention(text, topic);
  const security = topic === 'seguridad';
  const securitySubject = signal.type === 'actuacion_policial' ? 'actuación policial' : signal.type === 'robo' ? 'robo' : signal.type === 'violencia' ? 'hecho violento' : 'seguridad';
  const securityContext = /\bcelulares\b/.test(text) && /sin documentacion/.test(text) ? 'procedimiento por teléfonos sin documentación'
    : /\bmoto(?:cicleta)? robada\b/.test(text) ? 'procedimiento por una moto reportada como robada'
    : /\bdesalojo\b/.test(text) ? 'desalojo vinculado a denuncias vecinales'
    : /\bprofugos?\b/.test(text) ? 'detenciones vinculadas a causas previas' : securitySubject;
  const safeTitle = security ? `Reporte de ${securityContext} en ${place}` : article.title;
  const originalSummary = (article.snippet?.length > 35 ? article.snippet : article.title || '').split(/Continuar leyendo en/i)[0].trim().slice(0, 320);
  const reportedFact = security ? `La fuente publica un reporte de ${securityContext} en ${place}. No confirma un nuevo delito, culpabilidad ni una tendencia barrial.` : originalSummary;
  const sharedStrike = topic === 'transporte' && /\bparo\b/.test(text) && /\b(?:subtes?|premetro)\b/.test(text) && /\b(?:detencion|detenidos|detenidos?|arrestar)\b/.test(text) && !/\blinea [abcdeh]\b/.test(text);
  const duplicateKey = sharedStrike ? `subte_network_strike_detainees|${article.date.slice(0, 10)}|${status}` : `${normalize(article.title)}|${geography.barrios.join('|')}|${article.date.slice(0, 10)}`;
  return { accepted: true, reason: 'dated_caba_source', case: {
    id: `${topic}|${url}`, topicId: topic, topic: config.label, title: safeTitle, reportedFact,
    barrios: geography.barrios, location: { label: place, scope: geography.scope, basis: geography.reason, preciseAddress: null },
    evidenceStatus: 'fuente_identificada', evidenceLabel: 'Reportado por una fuente; hecho no confirmado',
    evidence: [{ url, source: article.source || new URL(url).hostname, date: article.date, publicationDate: article.date, provenance: article.provenance || null }],
    publicationDate: article.date, incidentDate: null, incidentDateStatus: 'no_verificada',
    dateStatus: 'publicacion_reciente_no_fecha_del_hecho', eventType: signal.type, reportedStatus: status,
    currentStatus: 'no_verificado', confirmed: false,
    confidence: { level: geography.scope === 'barrio' ? 'media' : 'baja', scope: 'relevancia_y_ubicacion_del_reporte_no_veracidad_del_hecho', basis: ['fuente_y_publicacion_identificadas', geography.reason, 'solo_titulo_y_resumen_rss'] },
    responsibility: jurisdiction(topic, text),
    officialResponse: { status: agency ? 'organismo_mencionado_respuesta_no_verificada' : 'sin_respuesta_verificada', agency, sourceUrl: agency ? url : null, statement: null },
    question: config.question, nextStep: config.nextStep,
    missing: ['Fecha del hecho', 'Estado actual', 'Lectura completa y corroboración', 'Respuesta oficial y competencia del caso'],
    trend: 'desconocida', trendReason: 'sin_historial_comparable_de_incidentes', readyToPublish: false,
    activeIncident: null, affectsThermometer: false, sourceCount: 1, independentCorroboration: false
  }, duplicateKey };
}

export function buildTopicCases(articles, topic, options = {}) {
  const cases = [];
  const keys = new Map();
  const rejected = {};
  let duplicates = 0;
  for (const article of articles) {
    const result = classifyTopicArticle(article, topic, options);
    if (!result.accepted) { rejected[result.reason] = (rejected[result.reason] || 0) + 1; continue; }
    const existing = keys.get(result.case.id) || keys.get(result.duplicateKey);
    if (existing) {
      duplicates++;
      keys.set(result.case.id, existing);
      keys.set(result.duplicateKey, existing);
      for (const source of result.case.evidence) if (!existing.evidence.some(item => item.url === source.url)) existing.evidence.push(source);
      if (existing.reportedStatus !== result.case.reportedStatus) {
        existing.reportedStatus = 'versiones_en_conflicto';
        existing.nextStep = 'Las versiones de esta publicación discrepan. Abrir la fuente y verificar su estado antes de utilizarla.';
      }
      existing.sourceCount = new Set(existing.evidence.map(item => item.source)).size;
      // Repeated/syndicated wording does not establish independent confirmation.
      existing.duplicateHandling = 'url_titular_o_misma_medida_red_fecha_motivo_sin_inferir_corroboracion';
      if (result.case.reportedFact.length > existing.reportedFact.length) existing.reportedFact = result.case.reportedFact;
      continue;
    }
    cases.push(result.case);
    keys.set(result.case.id, result.case);
    keys.set(result.duplicateKey, result.case);
  }
  return { editorialCases: cases.sort((a, b) => b.publicationDate.localeCompare(a.publicationDate)), diagnostics: { candidateCount: articles.length, acceptedCount: cases.length, duplicates, rejected } };
}
