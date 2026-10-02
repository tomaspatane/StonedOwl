import { mkdir, writeFile } from 'node:fs/promises';
import { fetchRedditElectricidad } from '../sources/reddit-electricidad.js';
import { fetchSerperRedditElectricidad } from '../sources/serper-reddit.js';
import { fetchSerperElectricidad } from '../sources/serper-electricidad.js';
import { fetchSerperElectricidadTerritorial } from '../sources/serper-electricidad-territorial.js';
import { fetchEnreElectricidad } from '../sources/enre-electricidad.js';
import { detectBarrios, findBarrioExact, resolveBarriosFromResult } from '../data/caba-barrios.js';
import { matchElectricSignals } from '../data/electricidad.js';

const TERRITORIAL_PILOT = ['Flores', 'Caballito', 'Almagro', 'Villa Lugano', 'Villa Riachuelo', 'Constitución'];

function summarizeSignal(article, sourceType = 'web') {
  const text = `${article.title || ''} ${article.snippet || ''}`.trim();
  const geo = resolveBarriosFromResult({ title: article.title || '', snippet: article.snippet || '' });
  let resolved = geo.barrios;
  let geoPrecision = geo.precision;
  let geoReason = geo.reason;

  if (article.targetBarrio) {
    const targeted = resolved.find((barrio) => barrio.name === article.targetBarrio);
    if (!targeted) return null;
    resolved = [targeted];
    geoPrecision = 'high';
    geoReason = 'territorial_query_confirmed_in_result';
  }

  const barrios = resolved.map((b) => ({ name: b.name, comuna: b.comuna }));
  const signals = matchElectricSignals(text).filter((s) => !['entity', 'context'].includes(s.signalType));
  if (!barrios.length || !signals.length) return null;
  return {
    source: article.source,
    provider: article.provider,
    sourceType,
    date: article.date,
    title: article.title,
    url: article.url,
    barrios,
    targetBarrio: article.targetBarrio || null,
    query: article.query || null,
    geoPrecision,
    geoReason,
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
    sourceType: 'official',
    date: record.date,
    title: record.title,
    url: record.url,
    barrios,
    geoPrecision: 'high',
    geoReason: 'structured_locality',
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

async function fetchGeneralWebSource() {
  if (!process.env.SERPER_API_KEY) return { articles: [], diagnostics: { disabled: true }, queries: [], disabled: true };
  return fetchSerperElectricidad('1d', process.env.SERPER_API_KEY);
}

async function fetchTerritorialWebSource() {
  if (!process.env.SERPER_API_KEY) return { articles: [], diagnostics: { disabled: true }, plan: { barrios: [], queryCount: 0 }, disabled: true };
  return fetchSerperElectricidadTerritorial('1d', process.env.SERPER_API_KEY, { barrios: TERRITORIAL_PILOT });
}

const startedAt = new Date().toISOString();
const [redditResult, webResult, territorialResult, enreResult] = await Promise.allSettled([
  fetchCitizenSource(),
  fetchGeneralWebSource(),
  fetchTerritorialWebSource(),
  fetchEnreElectricidad()
]);

const reddit = redditResult.status === 'fulfilled'
  ? redditResult.value
  : { articles: [], diagnostics: { fatal: String(redditResult.reason?.message || redditResult.reason) }, query: null, mode: 'error' };
const web = webResult.status === 'fulfilled'
  ? webResult.value
  : { articles: [], diagnostics: { fatal: String(webResult.reason?.message || webResult.reason) }, queries: [] };
const territorial = territorialResult.status === 'fulfilled'
  ? territorialResult.value
  : { articles: [], diagnostics: { fatal: String(territorialResult.reason?.message || territorialResult.reason) }, plan: { barrios: [], queryCount: 0 } };
const enre = enreResult.status === 'fulfilled'
  ? enreResult.value
  : { records: [], diagnostics: { fatal: String(enreResult.reason?.message || enreResult.reason) }, totals: {} };

const citizenSignals = reddit.articles.map((article) => summarizeSignal(article, 'citizen')).filter(Boolean);
const webSignals = web.articles.map((article) => summarizeSignal(article, 'web')).filter(Boolean);
const territorialSignals = territorial.articles.map((article) => summarizeSignal(article, 'territorial_web')).filter(Boolean);
const officialSignals = enre.records.map(summarizeOfficial).filter(Boolean);

const byBarrio = new Map();
for (const item of [...citizenSignals, ...webSignals, ...territorialSignals, ...officialSignals]) {
  for (const barrio of item.barrios) {
    const current = byBarrio.get(barrio.name) || {
      barrio: barrio.name,
      comuna: barrio.comuna,
      citizenMentions: 0,
      webMentions: 0,
      territorialWebMentions: 0,
      officialRecords: 0,
      affectedUsers: 0,
      maxWeight: 0,
      sources: new Set()
    };
    if (item.official) {
      current.officialRecords += 1;
      current.affectedUsers += Number(item.affectedUsers || 0);
    } else if (item.sourceType === 'citizen') {
      current.citizenMentions += 1;
    } else if (item.sourceType === 'territorial_web') {
      current.territorialWebMentions += 1;
    } else {
      current.webMentions += 1;
    }
    current.maxWeight = Math.max(current.maxWeight, Number(item.maxWeight || 0));
    if (item.source) current.sources.add(item.source);
    byBarrio.set(barrio.name, current);
  }
}

const radar = [...byBarrio.values()]
  .map((item) => ({ ...item, sources: [...item.sources] }))
  .sort((a, b) => b.affectedUsers - a.affectedUsers || b.citizenMentions - a.citizenMentions || b.territorialWebMentions - a.territorialWebMentions || b.webMentions - a.webMentions || b.maxWeight - a.maxWeight);

const report = {
  ok: redditResult.status === 'fulfilled' || webResult.status === 'fulfilled' || territorialResult.status === 'fulfilled' || enreResult.status === 'fulfilled',
  version: 'live-smoke-v5-territorial-search',
  startedAt,
  finishedAt: new Date().toISOString(),
  sourceHealth: {
    reddit: { mode: reddit.mode || null, diagnostics: reddit.diagnostics },
    googleWeb: { diagnostics: web.diagnostics, queries: web.queries || [] },
    territorialWeb: { diagnostics: territorial.diagnostics, plan: territorial.plan },
    enre: enre.diagnostics
  },
  enreTotals: enre.totals,
  counts: {
    redditRaw: reddit.articles.length,
    redditUsefulCaba: citizenSignals.length,
    googleWebRaw: web.articles.length,
    googleWebUsefulCaba: webSignals.length,
    territorialWebRaw: territorial.articles.length,
    territorialWebUsefulCaba: territorialSignals.length,
    territorialQueries: territorial.plan?.queryCount || 0,
    enreRaw: enre.records.length,
    enreCaba: officialSignals.length,
    barriosWithSignal: radar.length
  },
  radar,
  citizenSignals: citizenSignals.slice(0, 30),
  webSignals: webSignals.slice(0, 50),
  territorialSignals: territorialSignals.slice(0, 50),
  officialSignals: officialSignals.slice(0, 50)
};

await mkdir('tmp', { recursive: true });
await writeFile('tmp/live-electricidad-report.json', JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));

if (redditResult.status === 'rejected' && webResult.status === 'rejected' && territorialResult.status === 'rejected' && enreResult.status === 'rejected') {
  process.exitCode = 1;
}
