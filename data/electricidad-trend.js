import { findBarrioExact, normalizePlaceText } from './caba-barrios.js';

const COMPANIES = ['EDENOR', 'EDESUR'];
const ACTIVE_TYPES = new Set(['baja_tension', 'media_tension', 'preventivo', 'interrupcion']);
const SCHEDULED_TYPES = new Set(['programado', 'programado_comunicado']);
const CABA_DISTRICTS = new Set(['capital', 'capital federal', 'caba', 'ciudad autonoma de buenos aires', 'ciudad de buenos aires']);

export const ELECTRICITY_TREND_LIMITS = Object.freeze({
  minIntervalMs: 5 * 60 * 1000,
  maxIntervalMs: 24 * 60 * 60 * 1000,
  maxSnapshotAgeMs: 2 * 60 * 60 * 1000,
  maxSourceAgeMs: 30 * 60 * 1000,
  maxClockSkewMs: 2 * 60 * 1000
});

const CAVEATS = [
  'Compara solamente dos capturas; no demuestra una tendencia sostenida ni reconstruye historia.',
  'Suma los usuarios informados en registros ENRE comparables de CABA; no cuenta personas únicas ni usa los totales de toda la concesión.',
  'Los cortes programados se excluyen. La ausencia de un registro no significa cero afectados ni servicio restablecido.',
  'No establece causa, responsabilidad de gobierno ni corroboración independiente.'
];

const TREND_LABELS = {
  desconocida: 'Sin dos capturas comparables',
  sube: 'Más usuarios informados entre estas dos capturas',
  baja: 'Menos usuarios informados entre estas dos capturas',
  sin_cambio: 'Mismo número de usuarios informados en estas dos capturas'
};

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const ms = Date.parse(value);
  const clock = value.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/i);
  if (Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] || 0) > 59) return null;
  // Date.parse normalizes impossible days (e.g. February 30); reject those too.
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(ms) || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return ms;
}

// ENRE's date-bearing local format is Argentine time (UTC-03:00). Clock-only
// values are deliberately unknown: inferring today's date could revive stale data.
export function parseEnreUpdatedAt(value) {
  const iso = timestamp(value);
  if (iso !== null) return iso;
  if (typeof value !== 'string') return null;
  const local = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!local) return null;
  const [, day, month, year, hour, minute, second = '00'] = local;
  return timestamp(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour}:${minute}:${second}-03:00`);
}

/**
 * Resolve ENRE's clock-only update using the source representation's dated
 * Last-Modified header, never fetch time or the HTTP Date response header.
 * Basis for a non-null result: enre_clock_and_http_last_modified_art.
 * Accept only an exact IMF-fixdate (RFC 7231) and an Argentine clock at most
 * ten minutes before it. Near midnight, the preceding Argentine calendar day
 * is eligible only under that same bound. Old headers intentionally produce
 * old timestamps: the normal freshness gate, not this resolver, rejects them.
 */
export function resolveEnreSourceUpdatedAt(clock, httpLastModified) {
  if (typeof clock !== 'string' || typeof httpLastModified !== 'string') return null;
  const clockMatch = clock.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!clockMatch || Number(clockMatch[1]) > 23 || Number(clockMatch[2]) > 59 || Number(clockMatch[3] || 0) > 59) return null;
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(httpLastModified)) return null;
  const modifiedAt = Date.parse(httpLastModified);
  // This also rejects impossible dates, invalid hours and incorrect weekdays.
  if (!Number.isFinite(modifiedAt) || new Date(modifiedAt).toUTCString() !== httpLastModified) return null;
  const argentineDate = modifiedAt - 3 * 60 * 60 * 1000;
  for (const dayOffset of [0, 1]) {
    const date = new Date(argentineDate - dayOffset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const candidate = timestamp(`${date}T${clockMatch[1].padStart(2, "0")}:${clockMatch[2]}:${clockMatch[3] || "00"}-03:00`);
    if (candidate !== null && candidate <= modifiedAt && modifiedAt - candidate <= 10 * 60 * 1000) {
      return new Date(candidate).toISOString();
    }
  }
  return null;
}

function validCount(value) {
  // Missing, string, negative, rounded or unsafe values must never become zero.
  return Number.isSafeInteger(value) && value >= 0;
}

function sourceIsEnre(record) {
  try {
    const url = new URL(record.url);
    return record.official === true && record.provider === 'ENRE' &&
      COMPANIES.includes(record.company) && url.protocol === 'https:' &&
      ['www.enre.gov.ar', 'enre.gov.ar'].includes(url.hostname) &&
      url.pathname === `/paginacorte/js/data_${record.company === 'EDENOR' ? 'EDN' : 'EDS'}.js`;
  } catch { return false; }
}

function inspectSnapshot(report, label, limits, now) {
  const errors = [];
  const add = (reason, detail) => errors.push({ snapshot: label, reason, ...(detail ? { detail } : {}) });
  const groups = new Map();
  const sources = {};
  if (!report || typeof report !== 'object') {
    add('missing_snapshot');
    return { errors, groups, sources, capturedAt: null, observedAffectedUsers: null };
  }
  const capturedAt = timestamp(report.finishedAt);
  if (capturedAt === null) add('invalid_snapshot_time');
  else if (capturedAt > now + limits.maxClockSkewMs) add('future_snapshot');
  else if (label === 'current' && now - capturedAt > limits.maxSnapshotAgeMs) add('stale_snapshot');

  let rawCount = 0;
  for (const company of COMPANIES) {
    const health = report.sourceHealth?.enre?.[company];
    if (health?.ok !== true || !validCount(health?.count)) add('incomplete_enre_health', company);
    else rawCount += health.count;
    const total = report.enreTotals?.[company];
    const updatedAt = parseEnreUpdatedAt(total?.sourceUpdatedAt ?? total?.updatedAt);
    sources[company] = updatedAt;
    if (updatedAt === null) add('unknown_source_update_time', company);
    else if (capturedAt !== null) {
      if (updatedAt > capturedAt + limits.maxClockSkewMs) add('future_source_update', company);
      else if (capturedAt - updatedAt > limits.maxSourceAgeMs ||
        (label === 'current' && now - updatedAt > limits.maxSourceAgeMs)) add('stale_source_update', company);
    }
  }
  const records = report.officialSignals;
  if (!Array.isArray(records) || !validCount(report.counts?.enreCaba) || report.counts.enreCaba !== records.length) {
    add('incomplete_official_records');
  }
  if (!validCount(report.counts?.enreRaw) || report.counts.enreRaw !== rawCount ||
    (Array.isArray(records) && records.length > rawCount)) add('incomplete_raw_coverage');

  const companyCounts = Object.fromEntries(COMPANIES.map(company => [company, 0]));
  const fingerprints = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || !sourceIsEnre(record)) { add('unverified_official_record'); continue; }
    companyCounts[record.company] += 1;
    const barrio = findBarrioExact(record.locality || '');
    if (!barrio || !CABA_DISTRICTS.has(normalizePlaceText(record.partido || ''))) {
      add('unverified_caba_record'); continue;
    }
    if (Array.isArray(record.barrios) && (record.barrios.length !== 1 || record.barrios[0]?.name !== barrio.name)) {
      add('ambiguous_barrio_assignment', barrio.name); continue;
    }
    if (SCHEDULED_TYPES.has(record.enreType)) continue;
    if (!ACTIVE_TYPES.has(record.enreType)) { add('unknown_outage_type', barrio.name); continue; }
    if (!validCount(record.affectedUsers)) { add('invalid_affected_users', barrio.name); continue; }
    const fingerprint = JSON.stringify([record.company, barrio.name, record.enreType, record.affectedUsers, record.title || '', record.snippet || '']);
    if (fingerprints.has(fingerprint)) { add('duplicate_official_record', barrio.name); continue; }
    fingerprints.add(fingerprint);
    const key = `${barrio.name}|${record.company}|${record.enreType}`;
    const group = groups.get(key) || { barrio: barrio.name, company: record.company, type: record.enreType, affectedUsers: 0, records: 0 };
    group.affectedUsers += record.affectedUsers;
    group.records += 1;
    if (!validCount(group.affectedUsers)) add('invalid_affected_users', barrio.name);
    groups.set(key, group);
  }
  for (const company of COMPANIES) {
    if (companyCounts[company] > (report.sourceHealth?.enre?.[company]?.count ?? 0)) add('incomplete_raw_coverage', company);
  }
  const sum = [...groups.values()].reduce((total, group) => total + group.affectedUsers, 0);
  if (!validCount(sum)) add('invalid_affected_users');
  return {
    errors, groups, sources, capturedAt,
    observedAffectedUsers: groups.size && !errors.length ? sum : null
  };
}

function comparison(current, previous, errors, extra = {}) {
  const missing = current.size === 0 || previous.size === 0;
  const sameCoverage = current.size === previous.size && [...current.keys()].every(key => previous.has(key));
  const reasons = [...errors];
  if (missing) reasons.push({ reason: 'missing_observed_coverage' });
  else if (!sameCoverage) reasons.push({ reason: 'changed_observed_coverage' });
  const sum = groups => groups.size ? [...groups.values()].reduce((total, group) => total + group.affectedUsers, 0) : null;
  const currentUsers = sum(current);
  const previousUsers = sum(previous);
  const comparable = reasons.length === 0;
  const delta = comparable ? currentUsers - previousUsers : null;
  const trend = !comparable ? 'desconocida' : delta > 0 ? 'sube' : delta < 0 ? 'baja' : 'sin_cambio';
  return {
    ...extra,
    status: comparable ? 'comparable' : 'unknown',
    trend,
    label: TREND_LABELS[trend],
    reason: reasons[0]?.reason || 'comparable_official_snapshots',
    reasonCodes: [...new Set(reasons.map(item => item.reason))],
    observedCoverage: { common: [...current.keys()].filter(key => previous.has(key)), currentOnly: [...current.keys()].filter(key => !previous.has(key)), previousOnly: [...previous.keys()].filter(key => !current.has(key)) },
    // With invalid coverage even the visible partial sums could mislead; expose
    // counts only once collection validity has been established.
    currentAffectedUsers: errors.length ? null : currentUsers,
    previousAffectedUsers: errors.length ? null : previousUsers,
    deltaAffectedUsers: delta,
    deltaPercent: comparable && previousUsers > 0 ? Math.round(delta / previousUsers * 10000) / 100 : null,
    evidence: reasons
  };
}

/**
 * Compare two saved live-electricidad report objects, without external I/O.
 * Pass the complete officialSignals (never a sample), counts, sourceHealth.enre,
 * enreTotals and finishedAt. Unknown is a first-class result, not a zero.
 * `now` is injectable for replay/tests; historical freshness is checked at each
 * capture, and current source freshness is additionally checked against `now`.
 */
export function compareElectricitySnapshots({ current, previous = null, now = Date.now(), limits = {} } = {}) {
  const policy = { ...ELECTRICITY_TREND_LIMITS, ...limits };
  for (const [key, value] of Object.entries(policy)) {
    if (!Object.hasOwn(ELECTRICITY_TREND_LIMITS, key) || !Number.isFinite(value) || value < 0) throw new TypeError(`Invalid trend limit: ${key}`);
  }
  if (policy.minIntervalMs <= 0 || policy.maxIntervalMs < policy.minIntervalMs) throw new TypeError('Invalid trend interval limits');
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'string' ? timestamp(now) : now;
  if (nowMs === null || !Number.isFinite(nowMs)) throw new TypeError('Invalid trend now');
  const present = inspectSnapshot(current, 'current', policy, nowMs);
  const past = inspectSnapshot(previous, 'previous', policy, nowMs);
  const errors = [...present.errors, ...past.errors];
  const intervalMs = present.capturedAt !== null && past.capturedAt !== null ? present.capturedAt - past.capturedAt : null;
  if (intervalMs !== null) {
    if (intervalMs <= 0) errors.push({ reason: 'non_increasing_snapshots' });
    else if (intervalMs < policy.minIntervalMs) errors.push({ reason: 'snapshot_interval_too_short' });
    else if (intervalMs > policy.maxIntervalMs) errors.push({ reason: 'snapshot_interval_too_long' });
  }
  for (const company of COMPANIES) {
    const currentTime = present.sources[company];
    const previousTime = past.sources[company];
    if (Number.isFinite(currentTime) && Number.isFinite(previousTime)) {
      const difference = currentTime - previousTime;
      if (difference <= 0) errors.push({ reason: 'source_update_not_advanced', detail: company });
      else if (difference < policy.minIntervalMs) errors.push({ reason: 'source_interval_too_short', detail: company });
      else if (difference > policy.maxIntervalMs) errors.push({ reason: 'source_interval_too_long', detail: company });
    }
  }
  const barrios = [...new Set([...present.groups.values(), ...past.groups.values()].map(item => item.barrio))].sort();
  const filter = (groups, barrio) => new Map([...groups].filter(([, group]) => group.barrio === barrio));
  return {
    version: 'enre-caba-two-snapshots-v1',
    metric: 'reported_unplanned_affected_users_in_matching_enre_caba_groups',
    ...comparison(present.groups, past.groups, errors),
    intervalMs,
    currentCapturedAt: present.capturedAt === null ? null : new Date(present.capturedAt).toISOString(),
    previousCapturedAt: past.capturedAt === null ? null : new Date(past.capturedAt).toISOString(),
    limits: policy,
    caveats: [...CAVEATS],
    byBarrio: barrios.map(barrio => comparison(filter(present.groups, barrio), filter(past.groups, barrio), errors, { barrio }))
  };
}


export function assessOfficialSnapshot(report, now = Date.now()) {
  const inspected = inspectSnapshot(report, 'current', ELECTRICITY_TREND_LIMITS, now);
  return { valid: inspected.errors.length === 0, reasons: inspected.errors,
    observedGroups: inspected.groups.size, affectedUsers: inspected.observedAffectedUsers,
    interpretation: 'Only observed, unplanned CABA groups; not a city total or population count.' };
}
