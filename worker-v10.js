import baseWorker from './worker-v09.js';
import { detectBarrios, findBarrioExact, resolveBarriosFromResult } from './data/caba-barrios.js';
import { classifyElectricEvidence } from './data/electricidad-evidence.js';
import { matchElectricSignals } from './data/electricidad.js';
import { fetchRedditElectricidad } from './sources/reddit-electricidad.js';
import { fetchSerperRedditElectricidad } from './sources/serper-reddit.js';
import { fetchSerperElectricidad } from './sources/serper-electricidad.js';
import { fetchSerperElectricidadTerritorial } from './sources/serper-electricidad-territorial.js';
import { fetchEnreElectricidad } from './sources/enre-electricidad.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function normalizeText(value = '') {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function safeDomain(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function parseDateMs(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
}

function freshnessPoints(date) {
  const ms = parseDateMs(date);
  if (!ms) return 0;
  const ageH = Math.max(0, (Date.now() - ms) / 3600000);
  if (ageH <= 3) return 4;
  if (ageH <= 12) return 3;
  if (ageH <= 24) return 2;
  if (ageH <= 72) return 1;
  return 0;
}

function statusFromScore(score) {
  if (score >= 65) return 'rojo';
  if (score >= 40) return 'naranja';
  if (score >= 20) return 'amarillo';
  return 'verde';
}

function sourceIdentity(mention) {
  if (mention.sourceType === 'citizen' || mention.sourceType === 'territorial_web') {
    if (mention.author) return `${mention.provider || 'citizen'}:${mention.author}`;
    if (mention.url) return `${mention.sourceType}:${normalizeText(String(mention.url).replace(/[?#].*$/, ''))}`;
  }
  return mention.source || mention.provider || safeDomain(mention.url) || mention.url || mention.title;
}

function confidenceFor(mentions, independentSources) {
  const hasOfficial = mentions.some((m) => m.official || m.sourceType === 'official');
  if (hasOfficial) return 'alta';
  if (independentSources >= 3 && mentions.length >= 4) return 'alta';
  if (independentSources >= 2 && mentions.length >= 2) return 'media';
  return 'baja';
}

function scoreBarrio(mentions) {
  const independentSources = new Set(mentions.map(sourceIdentity).filter(Boolean)).size;
  const providers = new Set(mentions.map((m) => m.provider).filter(Boolean)).size;
  const hasOfficial = mentions.some((m) => m.official || m.sourceType === 'official');
  const volume = Math.min(25, mentions.length * 4);
  const diversity = Math.min(20, independentSources * 5);
  const avgWeight = mentions.length ? mentions.reduce((sum, m) => sum + (Number(m.maxWeight) || 0), 0) / mentions.length : 0;
  const affectedUsers = mentions.reduce((sum, m) => sum + (Number(m.affectedUsers) || 0), 0);
  const impactSeverity = affectedUsers >= 5000 ? 15 : affectedUsers >= 1000 ? 12 : affectedUsers >= 250 ? 9 : affectedUsers >= 50 ? 6 : 0;
  const severity = Math.min(15, Math.max(Math.round(avgWeight * 3), impactSeverity));
  const velocity = Math.min(20, mentions.reduce((sum, m) => sum + freshnessPoints(m.date), 0));
  const dates = mentions.map((m) => parseDateMs(m.date)).filter(Boolean).sort((a, b) => a - b);
  const spanHours = dates.length >= 2 ? (dates[dates.length - 1] - dates[0]) / 3600000 : 0;
  const persistence = spanHours >= 24 ? 12 : spanHours >= 12 ? 9 : spanHours >= 6 ? 6 : spanHours >= 2 ? 3 : 0;
  const confirmation = hasOfficial ? 5 : Math.min(5, providers * 2);
  const score = Math.min(100, volume + diversity + severity + velocity + persistence + confirmation);
  return {
    score,
    status: statusFromScore(score),
    confidence: confidenceFor(mentions, independentSources),
    components: { volume, velocity, diversity, persistence, severity, confirmation },
    independentSources,
    affectedUsers,
    officialConfirmation: hasOfficial
  };
}

function extractMentions(articles = [], sourceType = 'web') {
  const mentions = [];
  for (const article of articles) {
    const text = `${article.title || ''} ${article.snippet || ''}`;
    const geo = resolveBarriosFromResult({ title: article.title || '', snippet: article.snippet || '' });
    const barrios = geo.barrios;
    const signals = matchElectricSignals(text);
    const meaningful = signals.filter((signal) => !['entity', 'context'].includes(signal.signalType));
    if (!barrios.length || !meaningful.length) continue;
    const maxWeight = Math.max(...meaningful.map((signal) => signal.baseWeight));
    for (const barrio of barrios) {
      mentions.push({
        barrio: barrio.name,
        comuna: barrio.comuna,
        title: article.title,
        snippet: article.snippet || '',
        url: article.url,
        source: article.source || safeDomain(article.url),
        provider: article.provider || 'Web',
        date: article.date,
        author: article.author || '',
        sourceType,
        signalIds: meaningful.map((signal) => signal.id),
        signalPhrases: meaningful.map((signal) => signal.phrase),
        maxWeight,
        geoPrecision: geo.precision,
        geoReason: geo.reason
      });
    }
  }
  return mentions;
}

function extractTerritorialMentions(articles = []) {
  const mentions = [];
  const evaluations = [];
  for (const article of articles) {
    const classification = classifyElectricEvidence({
      title: article.title || '',
      snippet: article.snippet || '',
      targetBarrio: article.targetBarrio || '',
      source: article.source || '',
      provider: article.provider || ''
    });
    evaluations.push({
      targetBarrio: article.targetBarrio || null,
      query: article.query || null,
      title: article.title,
      snippet: article.snippet || '',
      url: article.url,
      source: article.source || safeDomain(article.url),
      evidenceQuality: classification.evidenceQuality,
      assignmentScope: classification.assignmentScope,
      acceptedForBarrio: classification.acceptedForBarrio,
      reasonCodes: classification.reasonCodes || [],
      mentionedBarrios: classification.mentionedBarrios || []
    });
    if (!classification.acceptedForBarrio) continue;

    const barrio = findBarrioExact(article.targetBarrio || classification.targetBarrio || '');
    if (!barrio) continue;
    const text = `${article.title || ''} ${article.snippet || ''}`;
    const meaningful = matchElectricSignals(text).filter((signal) => !['entity', 'context'].includes(signal.signalType));
    if (!meaningful.length) continue;
    mentions.push({
      barrio: barrio.name,
      comuna: barrio.comuna,
      title: article.title,
      snippet: article.snippet || '',
      url: article.url,
      source: article.source || safeDomain(article.url),
      provider: article.provider || 'Google Web Territorial (Serper)',
      date: article.date,
      sourceType: 'territorial_web',
      signalIds: meaningful.map((signal) => signal.id),
      signalPhrases: meaningful.map((signal) => signal.phrase),
      maxWeight: Math.max(...meaningful.map((signal) => signal.baseWeight)),
      geoPrecision: classification.geoPrecision || null,
      geoReason: classification.geoReason || null,
      evidenceQuality: classification.evidenceQuality,
      assignmentScope: classification.assignmentScope,
      reasonCodes: classification.reasonCodes || [],
      searchQuery: article.query || null
    });
  }
  return { mentions, evaluations };
}

function enreMentions(records = []) {
  const mentions = [];
  for (const record of records) {
    const exact = findBarrioExact(record.locality || '');
    const barrios = exact ? [exact] : detectBarrios(record.locality || '');
    if (!barrios.length) continue;
    for (const barrio of barrios) {
      mentions.push({
        barrio: barrio.name,
        comuna: barrio.comuna,
        title: record.title,
        snippet: record.snippet || '',
        url: record.url,
        source: record.source,
        provider: 'ENRE',
        date: record.date,
        sourceType: 'official',
        official: true,
        affectedUsers: record.affectedUsers || 0,
        signalIds: [`enre_${record.enreType || 'interrupcion'}`],
        signalPhrases: [`ENRE: ${(record.enreType || 'interrupción').replace(/_/g, ' ')}`],
        maxWeight: record.maxWeight || 4,
        geoPrecision: 'high',
        geoReason: 'structured_locality',
        evidenceQuality: 'official',
        assignmentScope: 'barrio'
      });
    }
  }
  return mentions;
}

function dedupeMentions(mentions = []) {
  const seen = new Set();
  return mentions.filter((mention) => {
    const url = normalizeText(String(mention.url || '').replace(/[?#].*$/, ''));
    const key = [
      mention.barrio,
      url,
      normalizeText(mention.title),
      normalizeText(mention.snippet).slice(0, 180)
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function existingMentionsFromRadar(radar = []) {
  const mentions = [];
  for (const row of radar) {
    for (const evidence of (row.evidence || [])) {
      const geo = resolveBarriosFromResult({ title: evidence.title || '', snippet: evidence.snippet || '' });
      if (!geo.barrios.some((barrio) => barrio.name === row.barrio)) continue;
      mentions.push({
        ...evidence,
        barrio: row.barrio,
        comuna: row.comuna,
        sourceType: evidence.sourceType || 'media',
        geoPrecision: geo.precision,
        geoReason: geo.reason
      });
    }
  }
  return mentions;
}

function summarizeSignals(local = []) {
  const counts = local.flatMap((m) => m.signalPhrases || []).reduce((acc, phrase) => {
    acc[phrase] = (acc[phrase] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([phrase, count]) => ({ phrase, count }));
}

function sourceMix(local = []) {
  return Object.entries(local.reduce((acc, mention) => {
    const key = mention.provider || 'Otro';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).map(([provider, count]) => ({ provider, count }));
}

async function fetchCitizenElectricity(span, env) {
  if (env?.SERPER_API_KEY) {
    const result = await fetchSerperRedditElectricidad(span, env.SERPER_API_KEY);
    return { ...result, mode: 'google-web-reddit' };
  }
  const result = await fetchRedditElectricidad(span);
  return { ...result, mode: 'direct-reddit-fallback' };
}

async function handleElectricidadV10(request, env) {
  const url = new URL(request.url);
  const territorialEnabled = url.searchParams.get('territorial') === '1';
  const baseResponse = await baseWorker.fetch(request, env);
  let base;
  try { base = await baseResponse.json(); }
  catch { return baseResponse; }
  if (!base?.ok) return json(base, baseResponse.status || 500);

  const span = base.span || '1d';
  const sourceTasks = [
    fetchCitizenElectricity(span, env),
    fetchSerperElectricidad(span, env?.SERPER_API_KEY || ''),
    fetchEnreElectricidad()
  ];
  if (territorialEnabled) {
    sourceTasks.push(fetchSerperElectricidadTerritorial(span, env?.SERPER_API_KEY || '', { batchSize: 12 }));
  }
  const settled = await Promise.allSettled(sourceTasks);
  const [redditResult, webResult, enreResult, territorialResult] = settled;

  const reddit = redditResult.status === 'fulfilled'
    ? redditResult.value
    : { articles: [], diagnostics: { error: String(redditResult.reason?.message || redditResult.reason) }, mode: 'error' };
  const web = webResult.status === 'fulfilled'
    ? webResult.value
    : { articles: [], diagnostics: { error: String(webResult.reason?.message || webResult.reason) }, queries: [] };
  const enre = enreResult.status === 'fulfilled'
    ? enreResult.value
    : { records: [], diagnostics: { error: String(enreResult.reason?.message || enreResult.reason) }, totals: {} };
  const territorial = territorialEnabled && territorialResult?.status === 'fulfilled'
    ? territorialResult.value
    : { articles: [], diagnostics: territorialEnabled ? { error: String(territorialResult?.reason?.message || territorialResult?.reason || 'sin resultado') } : { disabled: true }, plan: { barrios: [], queryCount: 0 }, disabled: !territorialEnabled };

  const inheritedRawCount = (base.radar || []).reduce((sum, row) => sum + (row.evidence || []).length, 0);
  const inherited = existingMentionsFromRadar(base.radar || []);
  const fromReddit = extractMentions(reddit.articles || [], 'citizen');
  const fromWeb = extractMentions(web.articles || [], 'web');
  const territorialExtracted = extractTerritorialMentions(territorial.articles || []);
  const fromTerritorial = territorialExtracted.mentions;
  const fromEnre = enreMentions(enre.records || []);
  const mentions = dedupeMentions([...inherited, ...fromReddit, ...fromWeb, ...fromTerritorial, ...fromEnre]);

  const radar = (base.radar || []).map((row) => {
    const local = mentions.filter((mention) => mention.barrio === row.barrio);
    const scored = scoreBarrio(local);
    return {
      ...row,
      mentions: local.length,
      independentSources: scored.independentSources,
      score: scored.score,
      status: scored.status,
      confidence: scored.confidence,
      components: scored.components,
      affectedUsers: scored.affectedUsers,
      officialConfirmation: scored.officialConfirmation,
      topSignals: summarizeSignals(local),
      sourceMix: sourceMix(local),
      evidence: local.sort((a, b) => (parseDateMs(b.date) || 0) - (parseDateMs(a.date) || 0)).slice(0, 12)
    };
  }).sort((a, b) => b.score - a.score || b.mentions - a.mentions);

  const territorialCitywide = territorialExtracted.evaluations.filter((item) => item.assignmentScope === 'citywide');
  const territorialRejected = territorialExtracted.evaluations.filter((item) => !item.acceptedForBarrio && item.assignmentScope !== 'citywide');
  const territorialQuality = territorialExtracted.evaluations.reduce((acc, item) => {
    const key = item.evidenceQuality || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return json({
    ...base,
    version: '0.13-electricidad-territorial-evidence',
    provisional: true,
    methodology: 'El score exploratorio combina web/noticias, Google Web, relatos ciudadanos encontrados en Reddit y confirmación oficial del ENRE. Con ?territorial=1 se agrega un barrido rotativo de 12 barrios con búsquedas específicas y un clasificador de evidencia que separa reportes barriales, eventos citywide, geografía conflictiva y ruido. Sólo la evidencia aceptada con alcance barrio entra al score. Intensidad y confianza siguen separadas. Todavía no usa baseline histórico.',
    coverage: {
      ...(base.coverage || {}),
      inheritedRawEvidence: inheritedRawCount,
      inheritedGeoAccepted: inherited.length,
      inheritedGeoRejected: Math.max(0, inheritedRawCount - inherited.length),
      redditRaw: (reddit.articles || []).length,
      redditUsableMentions: fromReddit.length,
      redditMode: reddit.mode || null,
      serperWebRaw: (web.articles || []).length,
      serperWebUsableMentions: fromWeb.length,
      territorialEnabled,
      territorialQueries: territorial.plan?.queryCount || 0,
      territorialBarrios: territorial.plan?.barrios || [],
      territorialRaw: (territorial.articles || []).length,
      territorialUsableBarrioMentions: fromTerritorial.length,
      territorialCitywideSignals: territorialCitywide.length,
      territorialRejected: territorialRejected.length,
      territorialEvidenceQuality: territorialQuality,
      enreRawRecords: (enre.records || []).length,
      enreUsableMentions: fromEnre.length,
      totalUsableMentions: mentions.length
    },
    directSources: {
      reddit: { mode: reddit.mode || null, diagnostics: reddit.diagnostics || {}, query: reddit.query || null },
      googleWeb: { diagnostics: web.diagnostics || {}, queries: web.queries || [] },
      territorialWeb: {
        enabled: territorialEnabled,
        diagnostics: territorial.diagnostics || {},
        plan: territorial.plan || {},
        citywide: territorialCitywide.slice(0, 12),
        rejectedSample: territorialRejected.slice(0, 12)
      },
      enre: { diagnostics: enre.diagnostics || {}, totals: enre.totals || {} }
    },
    radar,
    fetchedAt: new Date().toISOString()
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/electricidad') return handleElectricidadV10(request, env);
    return baseWorker.fetch(request, env);
  }
};
