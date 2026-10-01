import { mkdir, writeFile } from 'node:fs/promises';
import { fetchRedditElectricidad } from '../sources/reddit-electricidad.js';
import { fetchSerperRedditElectricidad } from '../sources/serper-reddit.js';
import { fetchEnreElectricidad } from '../sources/enre-electricidad.js';
import { detectBarrios, findBarrioExact } from '../data/caba-barrios.js';
import { matchElectricSignals } from '../data/electricidad.js';

function summarizeCitizen(article) {
  const text = `${article.title || ''} ${article.snippet || ''}`.trim();
  const barrios = detectBarrios(text).map((b) => ({ name: b.name, comuna: b.comuna }));
  const signals = matchElectricSignals(text).filter((s) => !['entity', 'context'].includes(s.signalType));
  if (!barrios.length || !signals.length) return null;
  return {
    source: article.source,
    provider: article.provider,
    date: article.date,
    title: article.title,
    url: article.url,
    barrios,
    signals: signals.map((s) => ({ phrase: s.phrase, subfamily: s.subfamily, weight: s.baseWeight })),
    maxWeight: Math.max(...signals.map((s) => s.baseWeight))
  };
}

function summarizeOfficial(record) {
  const exact = findBarrioExact(record.locality || '');
  const matches = exact ? [exact] : detectBarrios(record.locality || '');
  const barrios = matches.map((b) => ({ name: b.name, comuna: b.comuna }));
  if (!barrios.length) return null;
  return {
    source: record.source,
    provider: record.provider,
    date: record.date,
    title: record.title,
    url: record.url,
    barrios,
    official: true,
    company: record.company,
    enreType: record.enreType,
    affectedUsers: record.affectedUsers,
    locality: record.locality,
    partido: record.partido,
    maxWeight: record.maxWeight
  };
}

async function fetchCitizenSource() {
  if (process.env.SERPER_API_KEY) {
    const result = await fetchSerperRedditElectricidad('1d', process.env.SERPER_API_KEY);
    return { ...result, mode: 'google-web-reddit' };
  }
  const result = await fetchRedditElectricidad('1d');
  return { ...result, mode: 'direct-reddit-fallback' };
}

const startedAt = new Date().toISOString();
const [redditResult, enreResult] = await Promise.allSettled([
  fetchCitizenSource(),
  fetchEnreElectricidad()
]);

const reddit = redditResult.status === 'fulfilled'
  ? redditResult.value
  : { articles: [], diagnostics: { fatal: String(redditResult.reason?.message || redditResult.reason) }, query: null, mode: 'error' };
const enre = enreResult.status === 'fulfilled'
  ? enreResult.value
  : { records: [], diagnostics: { fatal: String(enreResult.reason?.message || enreResult.reason) }, totals: {} };

const citizenSignals = reddit.articles.map(summarizeCitizen).filter(Boolean);
const officialSignals = enre.records.map(summarizeOfficial).filter(Boolean);

const byBarrio = new Map();
for (const item of [...citizenSignals, ...officialSignals]) {
  for (const barrio of item.barrios) {
    const current = byBarrio.get(barrio.name) || {
      barrio: barrio.name,
      comuna: barrio.comuna,
      citizenMentions: 0,
      officialRecords: 0,
      affectedUsers: 0,
      maxWeight: 0,
      sources: new Set()
    };
    if (item.official) {
      current.officialRecords += 1;
      current.affectedUsers += Number(item.affectedUsers || 0);
    } else {
      current.citizenMentions += 1;
    }
    current.maxWeight = Math.max(current.maxWeight, Number(item.maxWeight || 0));
    if (item.source) current.sources.add(item.source);
    byBarrio.set(barrio.name, current);
  }
}

const radar = [...byBarrio.values()]
  .map((item) => ({ ...item, sources: [...item.sources] }))
  .sort((a, b) => b.affectedUsers - a.affectedUsers || b.citizenMentions - a.citizenMentions || b.maxWeight - a.maxWeight);

const report = {
  ok: redditResult.status === 'fulfilled' || enreResult.status === 'fulfilled',
  version: 'live-smoke-v2',
  startedAt,
  finishedAt: new Date().toISOString(),
  sourceHealth: {
    reddit: { mode: reddit.mode || null, diagnostics: reddit.diagnostics },
    enre: enre.diagnostics
  },
  enreTotals: enre.totals,
  counts: {
    redditRaw: reddit.articles.length,
    redditUsefulCaba: citizenSignals.length,
    enreRaw: enre.records.length,
    enreCaba: officialSignals.length,
    barriosWithSignal: radar.length
  },
  radar,
  citizenSignals: citizenSignals.slice(0, 30),
  officialSignals: officialSignals.slice(0, 50)
};

await mkdir('tmp', { recursive: true });
await writeFile('tmp/live-electricidad-report.json', JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));

if (redditResult.status === 'rejected' && enreResult.status === 'rejected') {
  process.exitCode = 1;
}
