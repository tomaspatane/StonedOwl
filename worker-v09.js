import { CABA_BARRIOS, detectBarrios, normalizePlaceText } from './data/caba-barrios.js';
import { ELECTRICIDAD_VOCAB, ELECTRICIDAD_QUERY_TERMS, matchElectricSignals, normalizeElectricText } from './data/electricidad.js';

const SPAN_MAP = { '6h': '1d', '1d': '1d', '3d': '3d', '1w': '7d' };
const SPAN_MS = { '6h': 21600000, '1d': 86400000, '3d': 259200000, '1w': 604800000 };

const CABA_TAXONOMY = [
  {
    id: 'transporte', label: 'Transporte y movilidad',
    query: '(subte OR colectivo OR tránsito OR transito OR vereda OR ciclovía OR ciclovia) CABA',
    subtopics: {
      subte_demoras: ['subte','demora','interrupción','interrupcion','frecuencia','servicio'],
      subte_saturacion: ['subte','lleno','saturado','aglomeración','aglomeracion','hora pico'],
      estaciones: ['estación','estacion','escalera','filtración','filtracion','andén','anden'],
      colectivos: ['colectivo','bondi','parada','recorrido','frecuencia'],
      transito: ['tránsito','transito','embotellamiento','semáforo','semaforo','corte'],
      peaton_ciclista: ['vereda','rampa','ciclovía','ciclovia','peatón','peaton']
    }
  },
  {
    id: 'limpieza', label: 'Limpieza urbana',
    query: '(basura OR contenedor OR recolección OR recoleccion OR ratas OR suciedad) CABA',
    subtopics: {
      contenedores: ['contenedor','rebalsado','desbordado'], basura: ['basura','residuos','suciedad','mugre'],
      recoleccion: ['recolección','recoleccion','no pasan','camión','camion'], plagas: ['ratas','roedores','plaga'], poda: ['poda','ramas','restos verdes']
    }
  },
  {
    id: 'infraestructura', label: 'Infraestructura y espacio público',
    query: '(bache OR vereda OR luminaria OR plaza OR inundación OR inundacion OR obra) CABA',
    subtopics: {
      baches: ['bache','pozo','calzada'], veredas: ['vereda','baldosa','rampa'], iluminacion: ['luminaria','luz','oscuro','alumbrado'],
      plazas: ['plaza','juegos','espacio público','espacio publico'], inundaciones: ['inundación','inundacion','desagüe','desague','anegado'], obras: ['obra','obra parada','obra eterna','vallado']
    }
  },
  {
    id: 'seguridad', label: 'Seguridad y convivencia',
    query: '(robo OR inseguridad OR motochorro OR arrebato OR entradera OR trapito OR ruido) CABA',
    subtopics: {
      robos: ['robo','robos','choreo','inseguridad'], arrebatos: ['arrebato','motochorro','motochorros'], entraderas: ['entradera','entraderas'],
      espacio_publico: ['pelea','violencia','trapito','trapitos'], nocturnidad: ['ruido','ruidos molestos','boliche','nocturnidad']
    }
  }
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function decodeXml(s = '') {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decodeXml(m[1]) : '';
}
function sourceFromTitle(title = '') {
  const parts = String(title).split(' - ');
  return parts.length > 1 ? parts[parts.length - 1].trim() : '';
}
function cleanBingUrl(url = '') {
  try {
    const u = new URL(url);
    if (u.hostname.includes('bing.com') && u.pathname.includes('apiclick')) return u.searchParams.get('url') || url;
  } catch {}
  return url;
}
function withinSpan(date, span) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return true;
  return Date.now() - d.getTime() <= (SPAN_MS[span] || SPAN_MS['1d']) + 3600000;
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort('timeout'), timeoutMs);
  try { return await fetch(url, { ...options, signal: c.signal }); }
  finally { clearTimeout(t); }
}
function normalizeText(s = '') { return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

async function fetchBingNews(q, scope, span) {
  let query = q;
  if (scope === 'argentina') query += ' Argentina';
  const u = new URL('https://www.bing.com/news/search');
  u.searchParams.set('q', query); u.searchParams.set('format', 'RSS'); u.searchParams.set('mkt', 'es-AR');
  u.searchParams.set('setlang', 'es'); u.searchParams.set('cc', 'AR'); u.searchParams.set('qft', 'sortbydate="1"');
  const r = await fetchWithTimeout(u.toString(), { headers: { accept: 'application/rss+xml, application/xml, text/xml, */*', 'user-agent': 'Mozilla/5.0 (compatible; StonedOwl/0.9)' } });
  const xml = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${xml.slice(0, 220)}`);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 80);
  const articles = items.map((m) => {
    const b = m[1]; const title = tag(b, 'title'); const url = cleanBingUrl(tag(b, 'link')); const date = tag(b, 'pubDate');
    return { title, snippet: tag(b, 'description'), url, source: sourceFromTitle(title), date, provider: 'Bing News' };
  }).filter((a) => a.url && a.title && withinSpan(a.date, span));
  return { articles, query };
}

async function fetchGdelt(q, scope, span) {
  let query = q;
  if (scope === 'argentina') query += ' sourcecountry:argentina sourcelang:spanish';
  const u = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  u.searchParams.set('query', query); u.searchParams.set('mode', 'ArtList'); u.searchParams.set('format', 'json');
  u.searchParams.set('maxrecords', '100'); u.searchParams.set('sort', 'DateDesc'); u.searchParams.set('timespan', SPAN_MAP[span] || '1d');
  const r = await fetchWithTimeout(u.toString(), { headers: { accept: 'application/json' } });
  const raw = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${raw.slice(0, 220)}`);
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`respuesta no JSON: ${raw.slice(0, 220)}`); }
  const articles = Array.isArray(data.articles) ? data.articles.map((a) => ({
    title: a.title || 'Sin título', snippet: '', url: a.url || '', source: a.domain || '', date: a.seendate || '', provider: 'GDELT'
  })).filter((a) => a.url && withinSpan(a.date, span)) : [];
  return { articles, query };
}

async function fetchGoogleNews(q, scope, span) {
  const days = ({ '6h': 1, '1d': 1, '3d': 3, '1w': 7 })[span] || 1;
  let query = q;
  if (scope === 'argentina') query += ' Argentina';
  query += ` when:${days}d`;
  const u = new URL('https://news.google.com/rss/search');
  u.searchParams.set('q', query); u.searchParams.set('hl', 'es-419'); u.searchParams.set('gl', 'AR'); u.searchParams.set('ceid', 'AR:es-419');
  const r = await fetchWithTimeout(u.toString(), { headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' } });
  const xml = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${xml.slice(0, 220)}`);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 100);
  const articles = items.map((m) => {
    const b = m[1];
    return { title: tag(b, 'title'), snippet: tag(b, 'description'), url: tag(b, 'link'), source: tag(b, 'source'), date: tag(b, 'pubDate'), provider: 'Google News' };
  }).filter((a) => a.url && a.title && withinSpan(a.date, span));
  return { articles, query };
}

async function fetchSerperWeb(q, env, span) {
  if (!env?.SERPER_API_KEY) return { articles: [], query: q, disabled: true };
  const r = await fetchWithTimeout('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-KEY': env.SERPER_API_KEY },
    body: JSON.stringify({ q, gl: 'ar', hl: 'es', num: 20, tbs: span === '1w' ? 'qdr:w' : span === '3d' ? 'qdr:d3' : 'qdr:d' })
  }, 12000);
  const raw = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${raw.slice(0, 220)}`);
  const data = JSON.parse(raw);
  const articles = (data.organic || []).map((a) => ({
    title: a.title || '', snippet: a.snippet || '', url: a.link || '', source: safeDomain(a.link), date: a.date || '', provider: 'Google Web (Serper)'
  })).filter((a) => a.url && a.title);
  return { articles, query: q };
}

function safeDomain(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function dedupe(items) {
  const seen = new Set();
  return items.filter((a) => {
    const key = normalizeText(a.url || a.title).replace(/[?#].*$/, '').replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function diag(result) {
  if (result.status === 'fulfilled') return { ok: true, count: result.value.articles.length, query: result.value.query, disabled: !!result.value.disabled };
  return { ok: false, error: String(result.reason?.message || result.reason) };
}
async function runSources(q, scope, span, env, includeWeb = false) {
  const tasks = [fetchBingNews(q, scope, span), fetchGdelt(q, scope, span), fetchGoogleNews(q, scope, span)];
  if (includeWeb) tasks.push(fetchSerperWeb(q, env, span));
  const settled = await Promise.allSettled(tasks);
  const articles = dedupe(settled.flatMap((r) => r.status === 'fulfilled' ? r.value.articles : []));
  return {
    articles,
    diagnostics: {
      bingNews: diag(settled[0]), gdelt: diag(settled[1]), googleNews: diag(settled[2]),
      ...(includeWeb ? { googleWeb: diag(settled[3]) } : {})
    }
  };
}

function classifyArticles(articles, category) {
  const counts = {};
  for (const key of Object.keys(category.subtopics)) counts[key] = 0;
  for (const article of articles) {
    const text = normalizeText(`${article.title || ''} ${article.snippet || ''}`);
    for (const [key, terms] of Object.entries(category.subtopics)) {
      if (terms.some((term) => text.includes(normalizeText(term)))) counts[key]++;
    }
  }
  return Object.entries(counts).map(([id, count]) => ({ id, label: id.replace(/_/g, ' '), count })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
}
function signalLevel(count, sources) {
  if (count >= 18 && sources >= 6) return 'alta';
  if (count >= 8 && sources >= 3) return 'media';
  return 'baja';
}

async function handleCaba(request, env) {
  const u = new URL(request.url);
  const span = SPAN_MAP[u.searchParams.get('span')] ? u.searchParams.get('span') : '1w';
  const settled = await Promise.allSettled(CABA_TAXONOMY.map(async (category) => {
    const { articles, diagnostics } = await runSources(category.query, 'argentina', span, env, false);
    const cabaArticles = articles.filter((a) => {
      const t = normalizeText(`${a.title || ''} ${a.snippet || ''}`);
      return t.includes('caba') || t.includes('buenos aires') || t.includes('porten') || t.includes('ciudad');
    });
    const usable = cabaArticles.length ? cabaArticles : articles;
    const sources = new Set(usable.map((a) => a.source).filter(Boolean)).size;
    return { id: category.id, label: category.label, query: category.query, count: usable.length, sources, signal: signalLevel(usable.length, sources), subtopics: classifyArticles(usable, category), articles: usable.slice(0, 12), diagnostics };
  }));
  const categories = settled.map((r, i) => r.status === 'fulfilled' ? r.value : { id: CABA_TAXONOMY[i].id, label: CABA_TAXONOMY[i].label, count: 0, sources: 0, signal: 'baja', subtopics: [], articles: [], error: String(r.reason?.message || r.reason) });
  return json({ ok: true, span, scope: 'CABA', categories, fetchedAt: new Date().toISOString(), note: 'Radar general v0.8 preservado. El MVP de electricidad vive en /api/electricidad.' });
}

function buildElectricQuery(barrios) {
  const terms = ELECTRICIDAD_QUERY_TERMS.slice(0, 7).join(' OR ');
  const places = barrios.map((b) => `"${b.name}"`).join(' OR ');
  return `(${terms}) (${places}) (CABA OR "Ciudad de Buenos Aires" OR Buenos Aires)`;
}
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
function parseDateMs(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
}
function freshnessPoints(date) {
  const ms = parseDateMs(date);
  if (!ms) return 0;
  const ageH = (Date.now() - ms) / 3600000;
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
function confidenceFor(mentions, sources) {
  if (sources >= 3 && mentions >= 4) return 'alta';
  if (sources >= 2 && mentions >= 2) return 'media';
  return 'baja';
}
function scoreBarrio(mentions) {
  const independentSources = new Set(mentions.map((m) => m.source || m.provider).filter(Boolean)).size;
  const providers = new Set(mentions.map((m) => m.provider).filter(Boolean)).size;
  const volume = Math.min(25, mentions.length * 4);
  const diversity = Math.min(20, independentSources * 5);
  const avgWeight = mentions.length ? mentions.reduce((sum, m) => sum + m.maxWeight, 0) / mentions.length : 0;
  const severity = Math.min(15, Math.round(avgWeight * 3));
  const velocity = Math.min(20, mentions.reduce((sum, m) => sum + freshnessPoints(m.date), 0));
  const dates = mentions.map((m) => parseDateMs(m.date)).filter(Boolean).sort((a, b) => a - b);
  const spanHours = dates.length >= 2 ? (dates[dates.length - 1] - dates[0]) / 3600000 : 0;
  const persistence = spanHours >= 24 ? 12 : spanHours >= 12 ? 9 : spanHours >= 6 ? 6 : spanHours >= 2 ? 3 : 0;
  const confirmation = Math.min(5, providers * 2);
  const score = Math.min(100, volume + diversity + severity + velocity + persistence + confirmation);
  return { score, status: statusFromScore(score), confidence: confidenceFor(mentions.length, independentSources), components: { volume, velocity, diversity, persistence, severity, confirmation }, independentSources };
}

function extractElectricMentions(articles) {
  const mentions = [];
  for (const article of articles) {
    const text = `${article.title || ''} ${article.snippet || ''}`;
    const barrios = detectBarrios(text);
    const signals = matchElectricSignals(text);
    if (!barrios.length || !signals.length) continue;
    const maxWeight = Math.max(...signals.map((s) => s.baseWeight));
    for (const barrio of barrios) {
      mentions.push({
        barrio: barrio.name, comuna: barrio.comuna,
        title: article.title, snippet: article.snippet || '', url: article.url,
        source: article.source || safeDomain(article.url), provider: article.provider, date: article.date,
        signalIds: signals.map((s) => s.id), signalPhrases: signals.map((s) => s.phrase), maxWeight
      });
    }
  }
  return mentions;
}

async function handleElectricidad(request, env) {
  const u = new URL(request.url);
  const span = SPAN_MS[u.searchParams.get('span')] ? u.searchParams.get('span') : '1d';
  const requested = (u.searchParams.get('barrios') || '').split(',').map((x) => normalizePlaceText(x.trim())).filter(Boolean);
  const barrios = requested.length ? CABA_BARRIOS.filter((b) => requested.includes(normalizePlaceText(b.name)) || (b.aliases || []).some((a) => requested.includes(normalizePlaceText(a)))) : CABA_BARRIOS;
  if (!barrios.length) return json({ ok: false, error: 'No se reconocieron barrios válidos.' }, 400);

  const batches = chunk(barrios, 8);
  const settled = await Promise.allSettled(batches.map(async (batch) => {
    const query = buildElectricQuery(batch);
    const { articles, diagnostics } = await runSources(query, 'argentina', span, env, true);
    return { batch: batch.map((b) => b.name), query, articles, diagnostics };
  }));

  const batchResults = settled.map((r, i) => r.status === 'fulfilled' ? r.value : { batch: batches[i].map((b) => b.name), query: buildElectricQuery(batches[i]), articles: [], diagnostics: {}, error: String(r.reason?.message || r.reason) });
  const allArticles = dedupe(batchResults.flatMap((b) => b.articles));
  const mentions = extractElectricMentions(allArticles);

  const radar = barrios.map((barrio) => {
    const local = mentions.filter((m) => m.barrio === barrio.name);
    const scored = scoreBarrio(local);
    const topSignals = Object.entries(local.flatMap((m) => m.signalPhrases).reduce((acc, phrase) => { acc[phrase] = (acc[phrase] || 0) + 1; return acc; }, {}))
      .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([phrase, count]) => ({ phrase, count }));
    return {
      barrio: barrio.name, comuna: barrio.comuna,
      mentions: local.length, independentSources: scored.independentSources,
      score: scored.score, status: scored.status, confidence: scored.confidence,
      components: scored.components, topSignals,
      evidence: local.sort((a, b) => (parseDateMs(b.date) || 0) - (parseDateMs(a.date) || 0)).slice(0, 8)
    };
  }).sort((a, b) => b.score - a.score || b.mentions - a.mentions);

  return json({
    ok: true,
    version: '0.9-electricidad-mvp',
    family: 'electricidad', span,
    provisional: true,
    methodology: 'El score actual usa volumen, recencia, diversidad, persistencia, gravedad y confirmación. Aún no usa baseline histórico; por eso debe leerse como señal exploratoria, no como medición definitiva de anomalía.',
    vocabulary: { phrases: ELECTRICIDAD_VOCAB.length, tiers: ELECTRICIDAD_VOCAB.reduce((acc, v) => { acc[v.searchTier] = (acc[v.searchTier] || 0) + 1; return acc; }, {}) },
    coverage: { barriosRequested: barrios.length, batches: batches.length, rawArticles: allArticles.length, usableMentions: mentions.length, googleWebEnabled: !!env?.SERPER_API_KEY },
    radar,
    diagnostics: batchResults.map((b) => ({ batch: b.batch, query: b.query, diagnostics: b.diagnostics, error: b.error || null })),
    fetchedAt: new Date().toISOString()
  });
}

async function handleHealth(env) {
  const checks = { worker: { ok: true, version: '0.9', time: new Date().toISOString() }, serper: { configured: !!env?.SERPER_API_KEY } };
  try { const r = await fetchWithTimeout('https://example.com/', {}, 8000); checks.internet = { ok: r.ok, status: r.status }; }
  catch (e) { checks.internet = { ok: false, error: String(e?.message || e) }; }
  const { diagnostics } = await runSources('subte CABA', 'argentina', '1d', env, false);
  Object.assign(checks, diagnostics);
  return json({ ok: true, checks });
}

async function handleNews(request, env) {
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') || '').trim();
  const scope = u.searchParams.get('scope') || 'argentina';
  const span = SPAN_MAP[u.searchParams.get('span')] ? u.searchParams.get('span') : '1w';
  if (q.length < 2) return json({ error: 'Falta un término de búsqueda.' }, 400);
  const { articles, diagnostics } = await runSources(q, scope, span, env, true);
  return json({ ok: articles.length > 0, error: articles.length ? null : 'Las fuentes no devolvieron resultados.', query: q, scope, span, count: articles.length, articles, diagnostics, fetchedAt: new Date().toISOString() });
}

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === '/api/health') return handleHealth(env);
    if (u.pathname === '/api/caba') return handleCaba(request, env);
    if (u.pathname === '/api/electricidad') return handleElectricidad(request, env);
    if (u.pathname === '/api/news' || u.pathname === '/api/gdelt') return handleNews(request, env);
    return env.ASSETS.fetch(request);
  }
};
