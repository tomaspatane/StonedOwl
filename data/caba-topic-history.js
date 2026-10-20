import { TOPICS, CAPTURE_WINDOWS } from './caba-topics.js';

export const TOPIC_SNAPSHOT_SCHEMA = 'caba-topic-snapshot-v1';
export const TOPIC_ANALYSIS_VERSION = 'caba-topics-analysis-2026-10-20.1';
export const TOPIC_HISTORY_LIMITS = Object.freeze({ minIntervalMs: 300000, maxIntervalMs: 172800000, maxCurrentAgeMs: 7200000, maxClockSkewMs: 120000 });
const CAVEATS = [
  'Compara publicaciones recuperadas, no incidentes, reclamos, víctimas ni crecimiento de problemas.',
  'Una URL incorporada no estaba en la captura inmediatamente anterior; puede ser una noticia antigua, republicada o ya observada antes.',
  'Una publicación ausente puede haber salido del RSS o de la ventana temporal. No demuestra resolución ni mejora.',
  'Un cambio en el estado reportado es un cambio en lo publicado, no confirmación del estado actual.',
  'Dos capturas no establecen una tendencia sostenida. Las fuentes configuradas nunca constituyen cobertura exhaustiva.'
];
export function snapshotTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const ms = Date.parse(value);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(ms) || d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null;
  const clock = value.slice(11, 19).split(':').map(Number);
  return clock[0] < 24 && clock[1] < 60 && clock[2] < 60 ? ms : null;
}
function canonical(raw, stripTracking = true) {
  try {
    if (typeof raw !== 'string' || raw.length > 8192) return null;
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    u.hash = '';
    if (stripTracking) for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch { return null; }
}
const sorted = values => [...new Set(values)].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validNow = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8640000000000000;

function inspect(snapshot) {
  const errors = [];
  const add = reason => { if (!errors.includes(reason)) errors.push(reason); };
  const feeds = new Map();
  const publications = new Map();
  const publicationsByFeed = new Map();
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { errors: ['missing_snapshot'], feeds, publications, time: null };
  const time = snapshotTime(snapshot.fetchedAt);
  if (time === null) add('invalid_capture_time');
  if (snapshot.snapshotSchema !== TOPIC_SNAPSHOT_SCHEMA || snapshot.analysisVersion !== TOPIC_ANALYSIS_VERSION) add('unsupported_analysis_schema');
  if (!Object.hasOwn(TOPICS, snapshot.topicId || '') || !Object.hasOwn(CAPTURE_WINDOWS, snapshot.span || '')) add('invalid_topic_or_window');
  const windowMs = CAPTURE_WINDOWS[snapshot.span];
  if (!Array.isArray(snapshot.sourceHealth) || !snapshot.sourceHealth.length || snapshot.sourceHealth.length > 100) add('invalid_feed_inventory');
  for (const f of Array.isArray(snapshot.sourceHealth) ? snapshot.sourceHealth : []) {
    const url = canonical(f?.url, false);
    if (!object(f) || typeof f.feedId !== 'string' || !f.feedId || typeof f.publisher !== 'string' || !f.publisher || !url || feeds.has(f.feedId) || !['healthy', 'stale', 'failed', 'undated'].includes(f.status) || f.ok !== (f.status !== 'failed')) { add('invalid_feed_inventory'); continue; }
    const latest = snapshotTime(f.latestPublishedAt);
    if (f.ok) {
      if (!integer(f.rawCount) || !integer(f.acceptedCount) || f.acceptedCount > f.rawCount ||
          (f.latestPublishedAt !== null && latest === null)) add('invalid_feed_dates_or_counts');
      if (latest !== null && time !== null && latest > time) add('future_feed_date');
      // A stale feed has old dated items but no in-window candidates. An empty
      // valid feed is healthy; it is not a failure and never proves zero events.
      if (time !== null && windowMs) {
        const derivedStatus = f.rawCount === 0 ? 'healthy' : latest === null ? 'undated' : time - latest > windowMs ? 'stale' : 'healthy';
        if (f.status !== derivedStatus || f.stale !== (derivedStatus === 'stale') ||
            (f.rawCount === 0 && latest !== null) || (derivedStatus !== 'healthy' && f.acceptedCount !== 0)) add('inconsistent_feed_health');
      }
    }
    feeds.set(f.feedId, { id: f.feedId, url, publisher: f.publisher, status: f.status,
      rawCount: f.rawCount, acceptedCount: f.acceptedCount, latestPublishedAt: latest });
  }
  const states = [...feeds.values()].map(f => f.status);
  const derivedHealth = states.every(s => s === 'healthy') ? 'healthy' : states.every(s => s === 'failed') ? 'failed' : 'degraded';
  const h = snapshot.captureHealth;
  if (!h || h.status !== derivedHealth || h.successful !== states.filter(s => s !== 'failed').length || h.failed !== states.filter(s => s === 'failed').length || h.stale !== states.filter(s => s === 'stale').length || h.undated !== states.filter(s => s === 'undated').length) add('inconsistent_capture_health');
  if (!Array.isArray(snapshot.editorialCases) || snapshot.editorialCases.length > 2000) add('invalid_publication_inventory');
  for (const item of Array.isArray(snapshot.editorialCases) ? snapshot.editorialCases : []) {
    if (!object(item) || item.topicId !== snapshot.topicId || !Array.isArray(item.evidence) || !item.evidence.length || item.evidence.length > 100 ||
        !Array.isArray(item.barrios) || item.barrios.length > 48 || item.barrios.some(barrio => typeof barrio !== 'string' || barrio.length > 100) ||
        typeof item.reportedStatus !== 'string' || !item.reportedStatus || item.reportedStatus.length > 128) { add('invalid_publication_inventory'); continue; }
    for (const e of item.evidence) {
      if (!object(e)) { add('invalid_publication_inventory'); continue; }
      const url = canonical(e.url);
      const date = e.publicationDate ?? e.date;
      const ms = snapshotTime(date);
      if (!url || ms === null || (e.date && snapshotTime(e.date) !== ms) || ms > time || time - ms > CAPTURE_WINDOWS[snapshot.span]) { add('invalid_publication_date_or_url'); continue; }
      const provenance = e.provenance;
      const sourceFeed = object(provenance) && feeds.get(provenance.feedId);
      if (!sourceFeed || provenance.provider !== 'publisher_rss' || canonical(provenance.feedUrl, false) !== sourceFeed.url ||
          snapshotTime(provenance.retrievedAt) !== time || sourceFeed.status !== 'healthy' ||
          !integer(sourceFeed.rawCount) || !integer(sourceFeed.acceptedCount) || sourceFeed.acceptedCount < 1 ||
          sourceFeed.latestPublishedAt === null || ms > sourceFeed.latestPublishedAt) {
        add('invalid_publication_provenance'); continue;
      }
      const observed = publicationsByFeed.get(sourceFeed.id) || new Set();
      observed.add(url);
      publicationsByFeed.set(sourceFeed.id, observed);
      const existing = publications.get(url);
      if (existing && existing.time !== ms) { add('conflicting_publication_dates'); continue; }
      const record = existing || { url, publicationDate: new Date(ms).toISOString(), time: ms, reportedStatuses: [], barrios: [] };
      record.reportedStatuses = sorted([...record.reportedStatuses, item.reportedStatus || 'no_verificado']);
      record.barrios = sorted([...record.barrios, ...item.barrios]);
      publications.set(url, record);
    }
  }
  for (const [feedId, observed] of publicationsByFeed) {
    const source = feeds.get(feedId);
    if (observed.size > source.rawCount || observed.size > source.acceptedCount) add('inconsistent_publication_coverage');
  }
  const rawTotal = [...feeds.values()].filter(f => f.status !== 'failed').reduce((total, f) => total + f.rawCount, 0);
  if (!integer(rawTotal) || publications.size > rawTotal) add('inconsistent_publication_coverage');
  if (!snapshot.counts || snapshot.counts.acceptedCount !== snapshot.editorialCases?.length) add('inconsistent_case_count');
  return { errors, feeds, publications, time, snapshot };
}
function publicRecord(record) {
  return { url: record.url, publicationDate: record.publicationDate, reportedStatuses: record.reportedStatuses, barrios: record.barrios };
}

export function compareTopicSnapshots(previous, current, { now = Date.now(), limits = TOPIC_HISTORY_LIMITS } = {}) {
  const a = inspect(previous), b = inspect(current);
  const reasons = [];
  const add = r => { if (!reasons.includes(r)) reasons.push(r); };
  const validLimits = object(limits) && Object.entries(limits).every(([key, value]) => Object.hasOwn(TOPIC_HISTORY_LIMITS, key) && Number.isFinite(value) && value >= 0);
  const policy = validLimits ? { ...TOPIC_HISTORY_LIMITS, ...limits } : TOPIC_HISTORY_LIMITS;
  if (!validLimits || policy.minIntervalMs <= 0 || policy.maxIntervalMs < policy.minIntervalMs || policy.maxCurrentAgeMs <= 0) add('invalid_comparison_limits');
  a.errors.forEach(r => add(`previous_${r}`));
  b.errors.forEach(r => add(`current_${r}`));
  const intervalMs = a.time === null || b.time === null ? null : b.time - a.time;
  if (previous && current) {
    if (previous.topicId !== current.topicId) add('topic_changed');
    if (previous.span !== current.span) add('window_changed');
    if (previous.analysisVersion !== current.analysisVersion || previous.snapshotSchema !== current.snapshotSchema) add('analysis_changed');
  }
  if (intervalMs !== null) {
    if (intervalMs < policy.minIntervalMs) add('interval_too_short_or_reversed');
    if (intervalMs > policy.maxIntervalMs) add('interval_too_long');
    if (intervalMs >= CAPTURE_WINDOWS[current?.span]) add('non_overlapping_windows');
  }
  if (!validNow(now)) add('invalid_comparison_time');
  else if (b.time !== null) {
    if (b.time > now + policy.maxClockSkewMs) add('current_snapshot_in_future');
    if (now - b.time > policy.maxCurrentAgeMs) add('current_snapshot_too_old');
  }
  const coverageChanges = [];
  for (const id of sorted([...a.feeds.keys(), ...b.feeds.keys()])) {
    const before = a.feeds.get(id), after = b.feeds.get(id);
    if (!before || !after || before.url !== after.url || before.publisher !== after.publisher) coverageChanges.push({ feedId: id, kind: 'configuration_changed', before: before || null, after: after || null });
    else if (before.status !== after.status) coverageChanges.push({ feedId: id, kind: 'health_changed', before: before.status, after: after.status });
  }
  if (previous && coverageChanges.length) add('coverage_changed');
  if ([...a.feeds.values(), ...b.feeds.values()].some(f => ['failed', 'undated'].includes(f.status))) add('unusable_feed_coverage');
  const partial = [...a.feeds.values(), ...b.feeds.values()].some(f => f.status === 'stale');
  const base = {
    version: 'caba-topic-comparison-v1', metric: 'retrieved_publication_urls', status: 'unknown', eligible: false,
    label: 'Sin dos capturas comparables', topicId: current?.topicId || null,
    previousCapturedAt: previous?.fetchedAt || null, currentCapturedAt: current?.fetchedAt || null,
    comparedAt: validNow(now) ? new Date(now).toISOString() : null, intervalMs, reasons, coverageChanges,
    counts: null, changes: null, incidentTrend: 'unknown', problemGrowth: null,
    caveats: CAVEATS, limits: policy
  };
  if (reasons.length) return base;
  const added = [], retained = [], notObserved = [], outsideWindow = [], updated = [];
  for (const [url, record] of b.publications) {
    const old = a.publications.get(url);
    if (!old) added.push({ ...publicRecord(record), publicationPredatesPreviousCapture: record.time <= a.time });
    else {
      retained.push(publicRecord(record));
      const fields = ['publicationDate', 'reportedStatuses', 'barrios'].filter(k => !same(old[k], record[k]));
      if (fields.length) updated.push({ url, fields, previous: publicRecord(old), current: publicRecord(record), interpretation: 'Cambio en los datos publicados o su agrupación; estado del hecho no confirmado.' });
    }
  }
  for (const [url, record] of a.publications) if (!b.publications.has(url)) {
    (b.time - record.time > CAPTURE_WINDOWS[current.span] ? outsideWindow : notObserved).push(publicRecord(record));
  }
  return { ...base, eligible: true, status: partial ? 'partial' : 'comparable', label: partial ? 'Comparación parcial de publicaciones; mismas fuentes antiguas' : 'Dos inventarios de publicaciones comparables',
    counts: { previousPublications: a.publications.size, currentPublications: b.publications.size, inventoryDelta: b.publications.size - a.publications.size, addedSincePrevious: added.length, retained: retained.length, notObserved: notObserved.length, outsideWindow: outsideWindow.length, updated: updated.length },
    changes: { addedSincePrevious: added, retained, notObserved, outsideWindow, updated },
    caveats: partial ? ['La misma cobertura parcial se mantiene en ambas capturas. No es una comparación completa de fuentes.', ...CAVEATS] : CAVEATS
  };
}

export function compareTopicReports(previous, current, options = {}) {
  return Object.fromEntries(Object.keys(TOPICS).map(topic => [topic, compareTopicSnapshots(previous?.topics?.[topic], current?.topics?.[topic], options)]));
}
