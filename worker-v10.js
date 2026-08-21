const SPAN_MAP = { '1d': '1d', '3d': '3d', '1w': '7d', '1m': '30d' };
const SPAN_MS = { '1d': 86400000, '3d': 259200000, '1w': 604800000, '1m': 2592000000 };
const BATCH_SIZE = 40;

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function decodeXml(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}
function sourceFromTitle(title = '') {
  const parts = String(title).split(' - ');
  return parts.length > 1 ? parts[parts.length - 1].trim() : '';
}
function cleanBingUrl(value = '') {
  try {
    const url = new URL(value);
    if (url.hostname.includes('bing.com') && url.pathname.includes('apiclick')) return url.searchParams.get('url') || value;
  } catch {}
  return value;
}
function withinSpan(date, span) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return true;
  return Date.now() - parsed.getTime() <= (SPAN_MS[span] || SPAN_MS['1w']) + 3600000;
}
function normalizeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function fetchBingNews(q, scope, span) {
  let query = q;
  if (scope === 'argentina') query += ' Argentina';
  const url = new URL('https://www.bing.com/news/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'RSS');
  url.searchParams.set('mkt', 'es-AR');
  url.searchParams.set('setlang', 'es');
  url.searchParams.set('cc', 'AR');
  url.searchParams.set('qft', 'sortbydate="1"');
  const response = await fetchWithTimeout(url.toString(), {
    headers: { accept: 'application/rss+xml, application/xml, text/xml, */*', 'user-agent': 'Mozilla/5.0 (compatible; StonedOwl/1.0)' }
  });
  const xml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${xml.slice(0, 180)}`);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 80);
  const articles = items.map(match => {
    const block = match[1];
    const title = tag(block, 'title');
    const articleUrl = cleanBingUrl(tag(block, 'link'));
    const date = tag(block, 'pubDate');
    return { title, url: articleUrl, source: sourceFromTitle(title), date, provider: 'Bing News' };
  }).filter(article => article.url && article.title && withinSpan(article.date, span));
  if (!articles.length) throw new Error('RSS válido pero sin items recientes.');
  return { articles, query };
}

async function fetchGdelt(q, scope, span) {
  let query = q;
  if (scope === 'argentina') query += ' sourcecountry:argentina sourcelang:spanish';
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', '100');
  url.searchParams.set('sort', 'DateDesc');
  url.searchParams.set('timespan', SPAN_MAP[span] || '7d');
  const response = await fetchWithTimeout(url.toString(), { headers: { accept: 'application/json' } });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 180)}`);
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('respuesta no JSON'); }
  const articles = Array.isArray(data.articles) ? data.articles.map(article => ({
    title: article.title || 'Sin título', url: article.url || '', source: article.domain || '', date: article.seendate || '', provider: 'GDELT'
  })).filter(article => article.url) : [];
  return { articles, query };
}

async function fetchGoogleNews(q, scope, span) {
  const days = ({ '1d': 1, '3d': 3, '1w': 7, '1m': 30 })[span] || 7;
  let query = q;
  if (scope === 'argentina') query += ' Argentina';
  query += ` when:${days}d`;
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', 'es-419');
  url.searchParams.set('gl', 'AR');
  url.searchParams.set('ceid', 'AR:es-419');
  const response = await fetchWithTimeout(url.toString(), { headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' } });
  const xml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${xml.slice(0, 180)}`);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 100);
  const articles = items.map(match => {
    const block = match[1];
    return { title: tag(block, 'title'), url: tag(block, 'link'), source: tag(block, 'source'), date: tag(block, 'pubDate'), provider: 'Google News' };
  }).filter(article => article.url && article.title);
  if (!articles.length) throw new Error('RSS válido pero sin items.');
  return { articles, query };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(article => {
    const key = (article.title || article.url).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function diagnostic(result) {
  return result.status === 'fulfilled'
    ? { ok: true, count: result.value.articles.length, query: result.value.query }
    : { ok: false, error: String(result.reason?.message || result.reason) };
}
async function runSources(q, scope, span) {
  const [bing, gdelt, google] = await Promise.allSettled([
    fetchBingNews(q, scope, span), fetchGdelt(q, scope, span), fetchGoogleNews(q, scope, span)
  ]);
  return {
    articles: dedupe([
      ...(bing.status === 'fulfilled' ? bing.value.articles : []),
      ...(gdelt.status === 'fulfilled' ? gdelt.value.articles : []),
      ...(google.status === 'fulfilled' ? google.value.articles : [])
    ]),
    diagnostics: { bingNews: diagnostic(bing), gdelt: diagnostic(gdelt), googleNews: diagnostic(google) }
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function runBatches(db, statements) {
  for (let start = 0; start < statements.length; start += BATCH_SIZE) await db.batch(statements.slice(start, start + BATCH_SIZE));
}

async function captureMonitor(db, monitor) {
  const capturedAt = new Date().toISOString();
  const { articles, diagnostics } = await runSources(monitor.query, monitor.scope, monitor.span);
  const sourceCount = new Set(articles.map(article => article.source).filter(Boolean)).size;
  const activeProviderCount = Object.values(diagnostics).filter(item => item.ok).length;
  const statements = [];
  for (const article of articles) {
    const articleId = await sha256(article.url);
    statements.push(db.prepare(`
      INSERT INTO articles (id,title,url,source,provider,published_at,first_seen_at,last_seen_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(url) DO UPDATE SET title=excluded.title,source=excluded.source,provider=excluded.provider,
      published_at=COALESCE(excluded.published_at,articles.published_at),last_seen_at=excluded.last_seen_at
    `).bind(articleId, article.title, article.url, article.source || '', article.provider || '', normalizeDate(article.date), capturedAt, capturedAt));
    statements.push(db.prepare(`
      INSERT INTO monitor_articles (monitor_id,article_id,first_seen_at,last_seen_at) VALUES (?,?,?,?)
      ON CONFLICT(monitor_id,article_id) DO UPDATE SET last_seen_at=excluded.last_seen_at
    `).bind(monitor.id, articleId, capturedAt, capturedAt));
  }
  await runBatches(db, statements);
  await db.prepare(`
    INSERT INTO monitor_snapshots (id,monitor_id,captured_at,article_count,source_count,active_provider_count,diagnostics_json)
    VALUES (?,?,?,?,?,?,?)
  `).bind(crypto.randomUUID(), monitor.id, capturedAt, articles.length, sourceCount, activeProviderCount, JSON.stringify(diagnostics)).run();
  return { monitorId: monitor.id, capturedAt, articleCount: articles.length, sourceCount, activeProviderCount, diagnostics };
}

async function captureEnabledMonitors(db) {
  const { results: monitors } = await db.prepare('SELECT id,name,query,scope,span FROM monitors WHERE enabled=1 ORDER BY created_at ASC').all();
  const results = [];
  for (const monitor of monitors) {
    try { results.push({ ok: true, ...(await captureMonitor(db, monitor)) }); }
    catch (error) { results.push({ ok: false, monitorId: monitor.id, error: String(error?.message || error) }); }
  }
  console.log(JSON.stringify({ message: 'scheduled capture completed', results }));
  return results;
}
function growthPercent(current, previous) {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

async function handleRadar(db) {
  const { results: monitors } = await db.prepare('SELECT id,name,query,scope,span FROM monitors WHERE enabled=1 ORDER BY name ASC').all();
  const radar = [];
  for (const monitor of monitors) {
    const { results: snapshots } = await db.prepare(`
      SELECT captured_at,article_count,source_count,active_provider_count FROM monitor_snapshots
      WHERE monitor_id=? ORDER BY captured_at DESC LIMIT 2
    `).bind(monitor.id).all();
    const latest = snapshots[0] || null;
    const previous = snapshots[1] || null;
    radar.push({ ...monitor, latest, previous, growthPercent: latest ? growthPercent(latest.article_count, previous?.article_count) : null });
  }
  return json({ ok: true, monitors: radar, generatedAt: new Date().toISOString() });
}

async function handleMonitor(request, db) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return json({ error: 'Falta el identificador del monitoreo.' }, 400);
  const monitor = await db.prepare('SELECT id,name,query,scope,span,enabled FROM monitors WHERE id=?').bind(id).first();
  if (!monitor) return json({ error: 'Monitoreo no encontrado.' }, 404);
  const { results: snapshots } = await db.prepare(`
    SELECT captured_at,article_count,source_count,active_provider_count,diagnostics_json
    FROM monitor_snapshots WHERE monitor_id=? ORDER BY captured_at DESC LIMIT 48
  `).bind(id).all();
  const { results: articles } = await db.prepare(`
    SELECT a.title,a.url,a.source,a.provider,a.published_at,ma.first_seen_at,ma.last_seen_at
    FROM monitor_articles ma JOIN articles a ON a.id=ma.article_id
    WHERE ma.monitor_id=? ORDER BY ma.last_seen_at DESC LIMIT 60
  `).bind(id).all();
  return json({ ok: true, monitor, snapshots, articles });
}

async function handleCreateMonitor(request, db) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }
  const name = String(body.name || '').trim();
  const query = String(body.query || '').trim();
  const scope = ['argentina', 'world'].includes(body.scope) ? body.scope : 'argentina';
  const span = SPAN_MAP[body.span] ? body.span : '1d';
  if (name.length < 2 || name.length > 80) return json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' }, 400);
  if (query.length < 2 || query.length > 220) return json({ error: 'La consulta debe tener entre 2 y 220 caracteres.' }, 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO monitors (id,name,query,scope,span,enabled,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)
  `).bind(id, name, query, scope, span, now, now).run();
  let capture = null;
  let warning = null;
  try { capture = await captureMonitor(db, { id, name, query, scope, span }); }
  catch (error) { warning = String(error?.message || error); }
  return json({ ok: true, monitor: { id, name, query, scope, span, enabled: 1 }, capture, warning }, 201);
}

async function handleCapture(request, db) {
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const url = new URL(request.url);
  if (url.searchParams.get('all') === '1') {
    const results = await captureEnabledMonitors(db);
    return json({ ok: true, results, capturedAt: new Date().toISOString() });
  }
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return json({ error: 'Falta id o all=1.' }, 400);
  const monitor = await db.prepare('SELECT id,name,query,scope,span FROM monitors WHERE id=? AND enabled=1').bind(id).first();
  if (!monitor) return json({ error: 'Monitoreo no encontrado o desactivado.' }, 404);
  try { return json({ ok: true, capture: await captureMonitor(db, monitor) }); }
  catch (error) { return json({ error: String(error?.message || error) }, 502); }
}

async function handleHealth(db) {
  const checks = { worker: { ok: true, time: new Date().toISOString() } };
  try {
    const response = await fetchWithTimeout('https://example.com/', {}, 8000);
    checks.internet = { ok: response.ok, status: response.status };
  } catch (error) { checks.internet = { ok: false, error: String(error?.message || error) }; }
  try {
    const row = await db.prepare('SELECT COUNT(*) AS count FROM monitors').first();
    checks.database = { ok: true, monitors: Number(row?.count || 0) };
  } catch (error) { checks.database = { ok: false, error: String(error?.message || error) }; }
  const { diagnostics } = await runSources('milei', 'argentina', '1w');
  Object.assign(checks, diagnostics);
  return json({ ok: true, checks });
}

async function handleNews(request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const scope = ['argentina', 'world'].includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : 'argentina';
  const span = SPAN_MAP[url.searchParams.get('span')] ? url.searchParams.get('span') : '1w';
  if (q.length < 2) return json({ error: 'Falta un término de búsqueda.' }, 400);
  if (q.length > 220) return json({ error: 'La búsqueda es demasiado larga.' }, 400);
  const { articles, diagnostics } = await runSources(q, scope, span);
  return json({ ok: articles.length > 0, error: articles.length ? null : 'Las fuentes no devolvieron resultados.', query: q, scope, span, count: articles.length, articles, diagnostics, fetchedAt: new Date().toISOString() });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/') return env.ASSETS.fetch(new Request(new URL('/v10.html', request.url), request));
      if (url.pathname === '/api/health') return handleHealth(env.DB);
      if (url.pathname === '/api/news' || url.pathname === '/api/gdelt') return handleNews(request);
      if (url.pathname === '/api/radar' && request.method === 'GET') return handleRadar(env.DB);
      if (url.pathname === '/api/monitor' && request.method === 'GET') return handleMonitor(request, env.DB);
      if (url.pathname === '/api/monitors' && request.method === 'POST') return handleCreateMonitor(request, env.DB);
      if (url.pathname === '/api/capture') return handleCapture(request, env.DB);
      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ message: 'request failed', error: message, path: new URL(request.url).pathname }));
      return json({ error: 'Error interno de StonedOwl.', detail: message }, 500);
    }
  },
  async scheduled(controller, env, ctx) {
    console.log(JSON.stringify({ message: 'scheduled capture started', cron: controller.cron }));
    ctx.waitUntil(captureEnabledMonitors(env.DB));
  }
};
