import { confirmTargetBarrioInResult, detectBarrios, normalizePlaceText, resolveBarriosFromResult } from './caba-barrios.js';
import { matchElectricSignals } from './electricidad.js';

const FIRST_PERSON_PATTERNS = [
  /\bme quede sin luz\b/,
  /\bestoy sin luz\b/,
  /\bno tengo luz\b/,
  /\bestamos sin luz\b/,
  /\bnos quedamos sin luz\b/,
  /\bseguimos sin luz\b/,
  /\bsigo sin luz\b/,
  /\bse me corto la luz\b/,
  /\bse nos corto la luz\b/,
  /\bno vuelve la luz\b/,
  /\bno volvio la luz\b/
];

const PERSISTENCE_PATTERNS = [
  /\bdesde anoche\b/,
  /\bdesde ayer\b/,
  /\bhace (?:una|dos|tres|cuatro|cinco|seis|\d+) horas?\b/,
  /\bhace dias\b/,
  /\bsegundo dia\b/,
  /\btercer dia\b/,
  /\btodavia (?:sin luz|no volvio)\b/
];

const REPETITION_PATTERNS = [
  /\botra vez sin luz\b/,
  /\bnuevamente sin luz\b/,
  /\bse volvio a cortar\b/,
  /\btodos los dias se corta\b/,
  /\bcortes constantes\b/,
  /\bse corta siempre\b/
];

const CITYWIDE_PATTERNS = [
  /\bapag[oó]n masivo\b/,
  /\bvarios barrios\b/,
  /\bm[aá]s de (?:\d+|una docena) de? barrios\b/,
  /\bbarrios porte[nñ]os\b/,
  /\bgran parte de la ciudad\b/
];

function any(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

function meaningfulSignals(text) {
  return matchElectricSignals(text).filter((signal) => !['entity', 'context'].includes(signal.signalType));
}

function sourceKind(source = '', provider = '') {
  const s = `${source} ${provider}`.toLowerCase();
  if (/facebook\.com|instagram\.com|x\.com|twitter\.com|reddit/.test(s)) return 'social';
  if (/enre|edesur|edenor/.test(s)) return 'official';
  return 'web';
}

// Search-engine time filters do not establish a publication date for a result.
export function evidenceDateStatus(date = '', now = Date.now(), span = '1d') {
  const value = normalizePlaceText(date);
  const relative = value.match(/^(?:hace )?(\d+)\s+(minutos?|minutes?|horas?|hours?|dias?|days?)(?: ago)?$/);
  let ms = NaN;
  if (relative) {
    const unit = /min/.test(relative[2]) ? 60000 : /hora|hour/.test(relative[2]) ? 3600000 : 86400000;
    ms = Number(now) - Number(relative[1]) * unit;
  } else if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/i.test(value) ||
             /^(?:[a-z]{3,9} \d{1,2},? \d{4}|\d{1,2} [a-z]{3,9} \d{4})$/.test(value)) {
    ms = Date.parse(value);
  }
  const windowMs = (span === '1w' ? 7 : span === '3d' ? 3 : 1) * 86400000;
  if (!value || !Number.isFinite(ms)) return 'missing_or_unparseable_date';
  if (ms > Number(now)) return 'future_date';
  return Number(now) - ms > windowMs ? 'outside_time_window' : 'recent';
}

function localIncident({ title, snippet, targetBarrio }) {
  // Keep ellipsis-separated search fragments apart: unrelated snippets are not corroboration.
  const fragments = `${title}\n${snippet}`.split(/\n|\.{3,}|…|[.!?;]+/);
  return fragments.some((fragment) => {
    const t = normalizePlaceText(fragment);
    if (/\b(si se corta|si hay|en caso de|podria|podrian|puede haber|ante un|que hacer|como actuar|simulacro|sin cortes|no hay cortes)\b/.test(t)) return false;
    const incident = /\b(sin luz|sin electricidad|sin suministro|corte de luz|cortes de luz|apagon|baja tension|microcortes|se (?:me |nos )?corto la luz|no (?:tengo|tenemos|volvio|vuelve) (?:la )?luz|exploto un transformador)\b/.test(t);
    const local = resolveBarriosFromResult({ title: fragment === title ? fragment : '', snippet: fragment }).barrios;
    return incident && local.some((b) => b.name === targetBarrio);
  });
}

export function classifyElectricEvidence({
  title = '',
  snippet = '',
  targetBarrio = '',
  source = '',
  provider = '',
  official = false,
  date = '',
  now = Date.now(),
  span = '1d'
} = {}) {
  const text = normalizePlaceText(`${title} ${snippet}`);
  const signals = meaningfulSignals(`${title} ${snippet}`);
  const barrios = detectBarrios(`${title} ${snippet}`);
  const kind = official ? 'official' : sourceKind(source, provider);
  const cabaMarker = /\bcaba\b|\bcapital federal\b|\bciudad de buenos aires\b|\bporten[oa]s?\b/.test(text);
  const firstPerson = any(FIRST_PERSON_PATTERNS, text);
  const persistence = any(PERSISTENCE_PATTERNS, text);
  const repetition = any(REPETITION_PATTERNS, text);
  const citywideLanguage = any(CITYWIDE_PATTERNS, text);
  const multiBarrio = barrios.length >= 3;

  const base = {
    meaningfulSignals: signals.map((signal) => signal.phrase),
    maxWeight: signals.length ? Math.max(...signals.map((signal) => signal.baseWeight || 0)) : 0,
    mentionedBarrios: barrios.map((barrio) => barrio.name),
    firstPerson,
    persistence,
    repetition,
    sourceKind: kind
  };

  if (official) {
    return {
      ...base,
      evidenceQuality: 'official',
      assignmentScope: targetBarrio ? 'barrio' : 'unknown',
      acceptedForBarrio: !!targetBarrio,
      targetBarrio: targetBarrio || null,
      reasonCodes: ['official_source']
    };
  }

  if (!signals.length) {
    return {
      ...base,
      evidenceQuality: 'irrelevant',
      assignmentScope: 'unknown',
      acceptedForBarrio: false,
      targetBarrio: targetBarrio || null,
      reasonCodes: ['no_meaningful_electric_signal']
    };
  }

  if (!targetBarrio) {
    if ((multiBarrio || citywideLanguage) && cabaMarker) {
      return {
        ...base,
        evidenceQuality: 'citywide_event_mentions_barrio',
        assignmentScope: 'citywide',
        acceptedForBarrio: false,
        targetBarrio: null,
        reasonCodes: ['citywide_caba_event', multiBarrio ? 'multiple_barrios' : 'citywide_language']
      };
    }
    if (barrios.length !== 1) return {
      ...base, evidenceQuality: 'ambiguous_index_result', assignmentScope: 'unknown',
      acceptedForBarrio: false, targetBarrio: null, reasonCodes: ['no_target_or_ambiguous_geo']
    };
    targetBarrio = barrios[0].name;
  }

  const target = confirmTargetBarrioInResult({ targetBarrio, title, snippet });
  if (!target.barrio) {
    const citywideTargetMention = barrios.some((barrio) => barrio.name === targetBarrio) && (multiBarrio || citywideLanguage) && cabaMarker;
    if (citywideTargetMention) {
      return {
        ...base,
        evidenceQuality: 'citywide_event_mentions_barrio',
        assignmentScope: 'citywide',
        acceptedForBarrio: false,
        targetBarrio,
        reasonCodes: ['target_in_citywide_caba_event', 'do_not_assign_locally']
      };
    }
    return {
      ...base,
      evidenceQuality: target.reason === 'conflicting_non_caba_title' ? 'conflicting_geo' : 'ambiguous_index_result',
      assignmentScope: 'unknown',
      acceptedForBarrio: false,
      targetBarrio,
      reasonCodes: [target.reason || 'target_not_confirmed']
    };
  }

  if ((multiBarrio || citywideLanguage) && cabaMarker && !firstPerson) {
    return {
      ...base,
      evidenceQuality: 'citywide_event_mentions_barrio',
      assignmentScope: 'citywide',
      acceptedForBarrio: false,
      targetBarrio,
      reasonCodes: ['target_in_citywide_caba_event', 'do_not_assign_locally']
    };
  }

  const reject = (reason) => ({
    ...base, evidenceQuality: 'ambiguous_index_result', assignmentScope: 'unknown',
    acceptedForBarrio: false, targetBarrio, reasonCodes: [reason]
  });
  const normalizedTitle = normalizePlaceText(title);
  if (/\b(en venta|en alquiler|vendo|alquilo|alternador|h4 de lupa|entrega a domicilio|envio gratis|propiedades|monoambiente|departamentos en)\b/.test(normalizedTitle)) {
    return reject('commercial_result');
  }
  if (/\b(ultimas noticias|noticias de|todo sobre|portal de|resultados de busqueda)\b/.test(normalizedTitle)) {
    return reject('index_result');
  }
  if (!localIncident({ title, snippet, targetBarrio })) return reject('no_concrete_local_incident');
  const dateStatus = evidenceDateStatus(date, now, span);
  if (dateStatus !== 'recent') return reject(dateStatus);

  const strongExperience = firstPerson || persistence || repetition;
  const titleAnchored = target.reason === 'target_barrio_in_title';
  const quality = strongExperience && kind === 'social'
    ? 'direct_local_report'
    : (titleAnchored || strongExperience ? 'local_report' : 'weak_local_report');

  const acceptedForBarrio = quality !== 'weak_local_report';

  return {
    ...base,
    evidenceQuality: quality,
    assignmentScope: 'barrio',
    acceptedForBarrio,
    targetBarrio,
    geoPrecision: target.precision,
    geoReason: target.reason,
    reasonCodes: [
      target.reason,
      ...(firstPerson ? ['first_person'] : []),
      ...(persistence ? ['persistence'] : []),
      ...(repetition ? ['repetition'] : []),
      ...(kind === 'social' ? ['social_source'] : [])
    ]
  };
}

