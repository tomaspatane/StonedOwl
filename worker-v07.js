import { tag, normalizeArticles, groupStories, relevantArticles } from './src/articles.js';

const SPAN_MAP = { '1d': '1d', '3d': '3d', '1w': '7d', '1m': '30d' };
const BATCH_SIZE = 40;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

// Keep the deadline active until the body is consumed, not only until headers arrive.
export async function fetchText(url, accept, timeoutMs = 6500) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const r = await fetch(url, { headers: { accept }, signal: controller.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.text();
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('timeout'));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function parseRss(xml, provider) {
  if (!/<rss(?:\s|>)/i.test(xml) || !/<channel(?:\s|>)/i.test(xml) || !/<\/rss>/i.test(xml)) {
    throw new Error('La fuente no devolvió un RSS válido');
  }
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 100).map(([, block]) => ({
    title: tag(block, 'title'),
    url: tag(block, 'link'),
    date: tag(block, 'pubDate'),
    source: tag(block, 'source') || tag(block, 'News:Source'),
    description: tag(block, 'description'),
    provider
  }));
}

async function fetchBingNews(q, scope) {
  const query = scope === 'argentina' ? `${q} Argentina` : q;
  const u = new URL('https://www.bing.com/news/search');
  for (const [key, value] of Object.entries({ q: query, format: 'RSS', mkt: 'es-AR', setlang: 'es', cc: 'AR', qft: 'sortbydate="1"' })) {
    u.searchParams.set(key, value);
  }
  return {
    articles: parseRss(await fetchText(u.toString(), 'application/rss+xml, application/xml'), 'Bing News'),
    query
  };
}

async function fetchGoogleNews(q, scope, span) {
  const days = ({ '1d': 1, '3d': 3, '1w': 7, '1m': 30 })[span];
  const query = `${q}${scope === 'argentina' ? ' Argentina' : ''} when:${days}d`;
  const u = new URL('https://news.google.com/rss/search');
  for (const [key, value] of Object.entries({ q: query, hl: 'es-419', gl: 'AR', ceid: 'AR:es-419' })) {
    u.searchParams.set(key, value);
  }
  return {
    articles: parseRss(await fetchText(u.toString(), 'application/rss+xml, application/xml'), 'Google News'),
    query
  };
}

async function fetchGdelt(q, scope, span) {
  const query = scope === 'argentina' ? `${q} sourcecountry:argentina sourcelang:spanish` : q;
  const u = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  for (const [key, value] of Object.entries({ query, mode: 'ArtList', format: 'json', maxrecords: '100', sort: 'DateDesc', timespan: SPAN_MAP[span] })) {
    u.searchParams.set(key, value);
  }
  const data = JSON.parse(await fetchText(u.toString(), 'application/json', 2500));
  if (!Array.isArray(data.articles)) throw new Error('Respuesta de GDELT sin lista de artículos');
  return {
    query,
    articles: data.articles.map(a => ({ title: a.title, url: a.url, source: a.domain, date: a.seendate, provider: 'GDELT' }))
  };
}

export async function runSources(q, scope, span) {
  const results = await Promise.allSettled([
    fetchBingNews(q, scope, span),
    fetchGdelt(q, scope, span),
    fetchGoogleNews(q, scope, span)
  ]);
  const diagnostics = {};
  const names = ['bingNews', 'gdelt', 'googleNews'];
  const items = [];
  results.forEach((r, i) => {
    diagnostics[names[i]] = r.status === 'fulfilled'
      ? { ok: true, count: r.value.articles.length, query: r.value.query }
      : { ok: false, error: String(r.reason?.message || r.reason) };
    if (r.status === 'fulfilled') items.push(...r.value.articles);
  });
  const normalized = normalizeArticles(items, span);
  const articles = relevantArticles(normalized, q);
  return {
    articles,
    diagnostics,
    excludedCount: normalized.length - articles.length,
    activeProviderCount: results.filter(r => r.status === 'fulfilled').length
  };
}

async function handleNews(request) {
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') || '').trim();
  const scope = u.searchParams.get('scope') === 'world' ? 'world' : 'argentina';
  const span = Object.hasOwn(SPAN_MAP, u.searchParams.get('span')) ? u.searchParams.get('span') : '1w';
  if (q.length < 2 || q.length > 300) return json({ ok: false, error: 'Escribí un tema de entre 2 y 300 caracteres.' }, 400);
  const data = await runSources(q, scope, span);
  const ok = data.activeProviderCount > 0;
  return json({
    ok,
    error: ok ? null : 'No pudimos consultar las fuentes. Reintentá en unos minutos.',
    query: q,
    scope,
    span,
    ...data,
    count: data.articles.length,
    stories: groupStories(data.articles),
    coverage: data.activeProviderCount === 3 ? 'complete' : ok ? 'partial' : 'unavailable',
    fetchedAt: new Date().toISOString()
  }, ok ? 200 : 503);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function runBatches(db, statements) {
  for (let start = 0; start < statements.length; start += BATCH_SIZE) {
    await db.batch(statements.slice(start, start + BATCH_SIZE));
  }
}

async function captureMonitor(db, monitor) {
  const capturedAt = new Date().toISOString();
  const { articles, diagnostics, activeProviderCount } = await runSources(monitor.query, monitor.scope, monitor.span);
  const sourceCount = new Set(articles.map(article => article.source).filter(Boolean)).size;
  const statements = [];

  for (const article of articles) {
    const articleId = await sha256(article.url);
    statements.push(db.prepare(`
      INSERT INTO articles (
        id, title, url, source, provider, published_at, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        title = excluded.title,
        source = excluded.source,
        provider = excluded.provider,
        published_at = COALESCE(excluded.published_at, articles.published_at),
        last_seen_at = excluded.last_seen_at
    `).bind(
      articleId,
      article.title,
      article.url,
      article.source || '',
      article.provider || '',
      article.date || null,
      capturedAt,
      capturedAt
    ));
    statements.push(db.prepare(`
      INSERT INTO monitor_articles (monitor_id, article_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(monitor_id, article_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at
    `).bind(monitor.id, articleId, capturedAt, capturedAt));
  }

  await runBatches(db, statements);
  await db.prepare(`
    INSERT INTO monitor_snapshots (
      id, monitor_id, captured_at, article_count, source_count,
      active_provider_count, diagnostics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    monitor.id,
    capturedAt,
    articles.length,
    sourceCount,
    activeProviderCount,
    JSON.stringify(diagnostics)
  ).run();

  return { monitorId: monitor.id, capturedAt, articleCount: articles.length, sourceCount, activeProviderCount };
}

async function captureEnabledMonitors(db) {
  const { results: monitors } = await db.prepare(`
    SELECT id, name, query, scope, span
    FROM monitors
    WHERE enabled = 1
    ORDER BY created_at ASC
  `).all();

  const results = [];
  for (const monitor of monitors) {
    try {
      results.push({ ok: true, ...(await captureMonitor(db, monitor)) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ message: 'monitor capture failed', monitorId: monitor.id, error: message }));
      results.push({ ok: false, monitorId: monitor.id, error: message });
    }
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
  if (!db) return json({ ok: false, error: 'Radar sin base de datos disponible.' }, 503);
  const { results: monitors } = await db.prepare(`
    SELECT id, name, query, scope, span
    FROM monitors
    WHERE enabled = 1
    ORDER BY name ASC
  `).all();

  const radar = [];
  for (const monitor of monitors) {
    const { results: snapshots } = await db.prepare(`
      SELECT captured_at, article_count, source_count, active_provider_count, diagnostics_json
      FROM monitor_snapshots
      WHERE monitor_id = ?
      ORDER BY captured_at DESC
      LIMIT 2
    `).bind(monitor.id).all();
    const latest = snapshots[0] || null;
    const previous = snapshots[1] || null;
    radar.push({
      ...monitor,
      latest,
      previous,
      growthPercent: latest ? growthPercent(latest.article_count, previous?.article_count) : null
    });
  }
  return json({ ok: true, monitors: radar, generatedAt: new Date().toISOString() });
}

async function handleMonitor(request, db) {
  if (!db) return json({ ok: false, error: 'Radar sin base de datos disponible.' }, 503);
  const u = new URL(request.url);
  const id = (u.searchParams.get('id') || '').trim();
  if (!id) return json({ ok: false, error: 'Falta el identificador del monitoreo.' }, 400);
  const monitor = await db.prepare(`
    SELECT id, name, query, scope, span, enabled
    FROM monitors
    WHERE id = ?
  `).bind(id).first();
  if (!monitor) return json({ ok: false, error: 'Monitoreo no encontrado.' }, 404);

  const { results: snapshots } = await db.prepare(`
    SELECT captured_at, article_count, source_count, active_provider_count, diagnostics_json
    FROM monitor_snapshots
    WHERE monitor_id = ?
    ORDER BY captured_at DESC
    LIMIT 48
  `).bind(id).all();
  const { results: articles } = await db.prepare(`
    SELECT a.title, a.url, a.source, a.provider, a.published_at, ma.first_seen_at, ma.last_seen_at
    FROM monitor_articles ma
    JOIN articles a ON a.id = ma.article_id
    WHERE ma.monitor_id = ?
    ORDER BY ma.last_seen_at DESC
    LIMIT 50
  `).bind(id).all();
  return json({ ok: true, monitor, snapshots, articles });
}

async function handleHealth(env) {
  const { diagnostics, activeProviderCount } = await runSources('milei', 'argentina', '1w');
  const checks = { worker: { ok: true, time: new Date().toISOString() }, ...diagnostics };
  if (env.DB) {
    try {
      const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM monitors').first();
      checks.database = { ok: true, monitors: Number(row?.count || 0) };
    } catch (error) {
      checks.database = { ok: false, error: String(error?.message || error) };
    }
  } else {
    checks.database = { ok: false, error: 'DB binding no disponible' };
  }
  return json({ ok: activeProviderCount > 0, version: '0.7.2-radar-foundation', checks }, activeProviderCount ? 200 : 503);
}

export default {
  async fetch(request, env) {
    try {
      const u = new URL(request.url);
      if (u.pathname === '/api/health') return handleHealth(env);
      if (['/api/news', '/api/gdelt', '/api/stories'].includes(u.pathname)) return handleNews(request);
      if (u.pathname === '/api/radar') return handleRadar(env.DB);
      if (u.pathname === '/api/monitor') return handleMonitor(request, env.DB);
      if (u.pathname.startsWith('/api/')) return json({ ok: false, error: 'Esta función no está disponible en esta versión.' }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ message: 'request failed', error: message, path: new URL(request.url).pathname }));
      return json({ ok: false, error: 'Error interno de StonedOwl.' }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    console.log(JSON.stringify({ message: 'scheduled capture started', cron: controller.cron }));
    if (!env.DB) {
      console.error(JSON.stringify({ message: 'scheduled capture skipped', error: 'DB binding no disponible' }));
      return;
    }
    ctx.waitUntil(captureEnabledMonitors(env.DB));
  }
};
