import { rankTfidfCosine } from "./retrieval-benchmark.js";

// Experimental Spanish headline rules, NOT a general semantic parser or a truth score.
// Every extracted value points to an exact UTF-16 span in the immutable source text.
const RULES = [
  ["restore_service", "restored", /retomaron el servicio|funcionan todas las l[ií]neas|se normaliz[oó] (?:el servicio|la circulaci[oó]n)/iu],
  ["end_measure", "ended", /levantaron el paro|se levant[oó] la medida gremial/iu],
  ["announce_strike", "planned", /anunci(?:aron|[oó]) un paro|este (?:martes|mi[eé]rcoles|jueves|viernes|lunes) desde las \d+/iu],
  ["extend_hours", "planned", /extender[aá] su horario|estar[aá] abierta de madrugada/iu],
  ["report_strike", "reported", /paro (?:total|sorpresivo)/iu]
];
const CAUTION = /\bno\b|\bsin\b|\bposible\b|podr[ií]a|niega|desmiente|recuerda|año pasado|ayer|ma[ñn]ana/iu;

function field(source, value, match, capture = 0) {
  if (!match) return null;
  const text = match[capture];
  const start = match.index + (capture ? match[0].indexOf(text) : 0);
  return { value, evidence: { sourceId: source.id, start, end: start + text.length } };
}

export function evidenceText(source, extracted) {
  const span = extracted?.evidence;
  if (!span || span.sourceId !== source.id || !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start ||
      span.end > source.text.length) throw new Error("Invalid source evidence span");
  return source.text.slice(span.start, span.end);
}

function publicationDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  if (!Number.isFinite(Date.parse(value))) return null;
  const day = value.slice(0, 10);
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time : null;
}

export function extractSourceFrame(source) {
  if (!source?.id || typeof source.text !== "string" || !source.text.trim() || source.text.length > 500) {
    throw new Error("Each source needs a unique id and original headline (1–500 characters)");
  }
  const fields = { actor: null, action: null, object: null, place: null, state: null, eventTime: null };
  const cautions = [];
  const scopeMatches = [...source.text.matchAll(/\bl[ií]nea ([ABCDEH])\b/giu)];
  const scopes = new Set(scopeMatches.map(match => match[1].toUpperCase()));
  const network = source.text.match(/todas las l[ií]neas(?: del? subte| de subte)?(?: porteño)? y (?:el |al )?Premetro|paro total de subtes y Premetro/iu);
  if (scopes.size === 1 && !network) {
    fields.place = field(source, `line_${[...scopes][0]}`, scopeMatches[0]);
  } else if (network && !scopes.size) {
    fields.place = field(source, "subte_network_and_premetro", network);
  } else if (scopes.size > 1 || (network && scopes.size)) cautions.push("ambiguous_scope");

  const matched = RULES.map(([action, state, regex]) => ({ action, state, match: source.text.match(regex) }))
    .filter(rule => rule.match);
  // A recovery headline can mention the strike it ended; prefer the explicit recovery.
  const actionable = matched.filter(rule => rule.action !== "report_strike" || matched.length === 1);
  const states = new Set(actionable.map(rule => rule.state));
  const restoredAndEnded = states.size === 2 && states.has("restored") && states.has("ended");
  if (states.size > 1 && !restoredAndEnded) cautions.push("multiple_states");
  const rule = actionable[0];
  if (rule) {
    fields.action = field(source, rule.action, rule.match);
    fields.state = field(source, rule.state, rule.match);
    const strike = source.text.match(/paro|medida gremial/iu);
    const object = rule.action === "extend_hours" ? source.text.match(/horario|madrugada/iu) : strike || source.text.match(/servicio/iu);
    fields.object = field(source, rule.action === "extend_hours" ? "service_hours" : strike ? "strike_episode" : "service_status", object);
  }
  // Only explicit grammatical subjects; mentioning an arrested delegate is not assigning agency.
  const actor = source.text.match(/\b(Metrodelegados|AGTSyP|Emova)\s+(?:anunciaron|anunci[oó]|levantaron|levant[oó])/iu);
  if (actor) fields.actor = field(source, actor[1], actor, 1);
  const eventDates = [...source.text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)];
  if (eventDates.length === 1 && publicationDay(eventDates[0][0]) !== null) {
    fields.eventTime = field(source, eventDates[0][0], eventDates[0]);
  } else if (eventDates.length) cautions.push("ambiguous_or_invalid_event_date");
  if (CAUTION.test(source.text)) cautions.push("negation_modality_or_relative_time");
  if (!fields.action) cautions.push("unsupported_action");
  if (!fields.object) cautions.push("missing_object");
  if (!fields.place) cautions.push("missing_specific_scope");

  const framing = [
    ["surprise", /sorpresivo/iu],
    ["neighborhood_impact", /impacto en [^:.,]+/iu],
    ["station_focus", /estaci[oó]n Once/iu],
    ["detention_context", /detenci[oó]n de trabajadores(?: y delegados)?/iu],
    ["concert_context", /Iron Maiden/iu]
  ].map(([label, regex]) => field(source, label, source.text.match(regex))).filter(Boolean);
  for (const item of [...Object.values(fields), ...framing].filter(Boolean)) evidenceText(source, item);
  return {
    sourceId: source.id, url: source.url || null, publisher: source.publisher || null,
    publicationDate: source.publicationDate || null,
    fields, framing, cautions,
    eventTimeStatus: fields.eventTime ? "explicit_iso_date_in_text" : "not_extracted", independentCorroboration: false,
    activeIncident: null, affectsThermometer: false
  };
}

export function compareSourceFrames(left, right, { windowDays = 2 } = {}) {
  const result = reason => ({ decision: reason, autoMerge: false, independentCorroboration: false });
  if (left.cautions.length || right.cautions.length) return result("needs_review");
  const a = left.fields, b = right.fields;
  if (a.place.value !== b.place.value || a.object.value !== b.object.value) return result("different_scope_or_event");
  if (a.eventTime && b.eventTime && a.eventTime.value !== b.eventTime.value) return result("different_event_date");
  if (a.actor && b.actor && a.actor.value.toLowerCase() !== b.actor.value.toLowerCase()) return result("actor_difference_review");
  const dates = [publicationDay(left.publicationDate), publicationDay(right.publicationDate)];
  if (dates.some(date => date === null)) return result("needs_review");
  if (Math.abs(dates[0] - dates[1]) > windowDays * 86400000) return result("outside_publication_window");
  if (a.state.value !== b.state.value) return result("state_difference_review");
  // Publication proximity is only a candidate filter. It NEVER proves identical event time.
  return result("candidate_same_stage");
}

function metrics(pairs, predicted) {
  let truePositives = 0, falsePositives = 0, falseNegatives = 0;
  for (const pair of pairs) {
    if (predicted(pair)) pair.expectedSameStage ? truePositives++ : falsePositives++;
    else if (pair.expectedSameStage) falseNegatives++;
  }
  const precision = truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : null;
  const recall = truePositives + falseNegatives ? truePositives / (truePositives + falseNegatives) : null;
  return { truePositives, falsePositives, falseNegatives, precision, recall };
}

export function runNarrativePilot({ documents, labels = null, threshold = 0.35 }) {
  if (!Array.isArray(documents) || documents.length < 2) throw new Error("At least two sources are required");
  if (documents.length > 200) throw new Error("Pilot limit: 200 headlines per batch");
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("Invalid cosine threshold");
  if (new Set(documents.map(doc => doc.id)).size !== documents.length) throw new Error("Duplicate source id");
  if (labels && documents.some(doc => !labels[doc.id]?.episode || !labels[doc.id]?.stage)) {
    throw new Error("Every evaluated source needs separate episode and stage labels");
  }
  // Whitelist inputs: no label, summary, place annotation or event identity reaches extraction.
  const sources = documents.map(({ id, text, url, retrievedFrom, publisher, publicationDate }) => ({ id, text, url, retrievedFrom, publisher, publicationDate }));
  const frames = sources.map(extractSourceFrame);
  const rankings = sources.map(source => new Map(rankTfidfCosine(source.text, sources).map(entry => [entry.id, entry.score])));
  const pairs = [];
  for (let i = 0; i < sources.length; i++) for (let j = i + 1; j < sources.length; j++) {
    const left = sources[i], right = sources[j];
    const cosine = rankings[i].get(right.id);
    const decision = compareSourceFrames(frames[i], frames[j]);
    const leftFraming = frames[i].framing.map(item => item.value);
    const rightFraming = frames[j].framing.map(item => item.value);
    const days = [publicationDay(left.publicationDate), publicationDay(right.publicationDate)];
    const withinPublicationWindow = days.every(day => day !== null) && Math.abs(days[0] - days[1]) <= 2 * 86400000;
    pairs.push({
      left: left.id, right: right.id, cosine, textCandidate: cosine >= threshold,
      withinPublicationWindow,
      ...decision,
      framingDifferences: { leftOnly: leftFraming.filter(value => !rightFraming.includes(value)),
        rightOnly: rightFraming.filter(value => !leftFraming.includes(value)) },
      ...(labels ? { expectedSameStage: labels[left.id].episode === labels[right.id].episode && labels[left.id].stage === labels[right.id].stage } : {})
    });
  }
  return {
    status: labels ? "exploratory_not_held_out" : "unlabelled_review_only",
    recommendedMethod: null, productionReady: false, automaticMerges: 0,
    documentCount: sources.length, pairCount: pairs.length, threshold,
    episodeCount: labels ? new Set(sources.map(source => labels[source.id].episode)).size : null,
    summary: labels ? {
      textCosine: metrics(pairs, pair => pair.textCandidate),
      textCosineWithWindow: metrics(pairs, pair => pair.textCandidate && pair.withinPublicationWindow),
      structuredCandidates: metrics(pairs, pair => pair.decision === "candidate_same_stage")
    } : null,
    baselineSensitivity: labels ? [0.25, 0.35, 0.5].map(cutoff => ({ threshold: cutoff,
      ...metrics(pairs, pair => pair.cosine >= cutoff && pair.withinPublicationWindow) })) : null,
    reviewPairCount: pairs.filter(pair => pair.decision.includes("review")).length,
    // No connected components: A~B and B~C must not silently make A~C.
    sources, frames, pairs
  };
}
