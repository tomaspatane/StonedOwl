import baseWorker from './worker-v09.js';
import { detectBarrios } from './data/caba-barrios.js';
import { matchElectricSignals } from './data/electricidad.js';
import { fetchRedditElectricidad } from './sources/reddit-electricidad.js';
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
  if (mention.sourceType === 'citizen' && mention.author) return `${mention.provider || 'citizen'}:${mention.author}`;
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

function redditMentions(articles = []) {
  const mentions = [];
  for (const article of articles) {
    const text = `${article.title || ''} ${article.snippet || ''}`;
    const barrios = detectBarrios(text);
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
        provider: 'Reddit',
        date: article.date,
        author: article.author || '',
        sourceType: 'citizen',
        signalIds: meaningful.map((signal) => signal.id),
        signalPhrases: meaningful.map((signal) => signal.phrase),
        maxWeight
      });
    }
  }
  return mentions;
}

function enreMentions(records = []) {
  const mentions = [];
  for (const record of records) {
    const locationText = `${record.locality || ''} ${record.partido || ''} ${record.title || ''}`;
    const barrios = detectBarrios(locationText);
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
        maxWeight: record.maxWeight || 4
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
      mention.provider,
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
  return radar.flatMap((row) => (row.evidence || []).map((evidence) => ({
    ...evidence,
    barrio: evidence.barrio || row.barrio,
    comuna: evidence.comuna || row.comuna,
    sourceType: evidence.sourceType || 'media'
  })));
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

async function handleElectricidadV10(request, env) {
  const baseResponse = await baseWorker.fetch(request, env);
  let base;
  try { base = await baseResponse.json(); }
  catch { return baseResponse; }
  if (!base?.ok) return json(base, baseResponse.status || 500);

  const span = base.span || '1d';
  const [redditResult, enreResult] = await Promise.allSettled([
    fetchRedditElectricidad(span),
    fetchEnreElectricidad()
  ]);

  const reddit = redditResult.status === 'fulfilled'
    ? redditResult.value
    : { articles: [], diagnostics: { error: String(redditResult.reason?.message || redditResult.reason) } };
  const enre = enreResult.status === 'fulfilled'
    ? enreResult.value
    : { records: [], diagnostics: { error: String(enreResult.reason?.message || enreResult.reason) }, totals: {} };

  const inherited = existingMentionsFromRadar(base.radar || []);
  const fromReddit = redditMentions(reddit.articles || []);
  const fromEnre = enreMentions(enre.records || []);
  const mentions = dedupeMentions([...inherited, ...fromReddit, ...fromEnre]);

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

  return json({
    ...base,
    version: '0.10-electricidad-sources',
    provisional: true,
    methodology: 'El score exploratorio combina web/noticias con relatos ciudadanos de Reddit y confirmación oficial del ENRE. Intensidad y confianza siguen separadas. Todavía no usa baseline histórico, por lo que los colores deben leerse como señales operativas del piloto.',
    coverage: {
      ...(base.coverage || {}),
      redditRaw: (reddit.articles || []).length,
      redditUsableMentions: fromReddit.length,
      enreRawRecords: (enre.records || []).length,
      enreUsableMentions: fromEnre.length,
      totalUsableMentions: mentions.length
    },
    directSources: {
      reddit: { diagnostics: reddit.diagnostics || {}, query: reddit.query || null },
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
