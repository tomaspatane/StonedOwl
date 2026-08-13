const SPAN_MAP = { '1d': '1d', '3d': '3d', '1w': '7d', '1m': '30d' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60'
    }
  });
}

function decodeXml(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decodeXml(m[1]) : '';
}

async function fetchGdelt(q, scope, span) {
  let query = q;
  if (scope === 'argentina') query += ' sourcecountry:AR sourcelang:spanish';

  const gdelt = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  gdelt.searchParams.set('query', query);
  gdelt.searchParams.set('mode', 'ArtList');
  gdelt.searchParams.set('format', 'json');
  gdelt.searchParams.set('maxrecords', '100');
  gdelt.searchParams.set('sort', 'DateDesc');
  gdelt.searchParams.set('timespan', SPAN_MAP[span] || '7d');

  const r = await fetch(gdelt.toString(), {
    headers: {
      accept: 'application/json,text/plain;q=0.8,*/*;q=0.5',
      'user-agent': 'Mozilla/5.0 (compatible; StonedOwl/0.6)'
    }
  });

  const raw = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${raw.slice(0, 180)}`);

  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`respuesta no JSON: ${raw.slice(0, 180)}`); }

  const articles = Array.isArray(data.articles) ? data.articles.map(a => ({
    title: a.title || 'Sin título',
    url: a.url || '',
    source: a.domain || '',
    date: a.seendate || '',
    provider: 'GDELT'
  })).filter(a => a.url) : [];

  return { articles, query };
}

async function fetchGoogleNews(q, scope, span) {
  const days = ({ '1d': 1, '3d': 3, '1w': 7, '1m': 30 })[span] || 7;
  let query = q;
  if (scope === 'argentina') query += ' Argentina';
  query += ` when:${days}d`;

  const u = new URL('https://news.google.com/rss/search');
  u.searchParams.set('q', query);
  u.searchParams.set('hl', 'es-419');
  u.searchParams.set('gl', 'AR');
  u.searchParams.set('ceid', 'AR:es-419');

  const r = await fetch(u.toString(), {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; StonedOwl/0.6)' }
  });
  const xml = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${xml.slice(0, 180)}`);

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 100);
  const articles = items.map(m => {
    const block = m[1];
    const title = tag(block, 'title');
    const url = tag(block, 'link');
    const source = tag(block, 'source');
    const date = tag(block, 'pubDate');
    return { title, url, source, date, provider: 'Google News' };
  }).filter(a => a.url && a.title);

  return { articles, query };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(a => {
    const key = (a.title || a.url).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function handleNews(request) {
  const requestUrl = new URL(request.url);
  const q = (requestUrl.searchParams.get('q') || '').trim();
  const scope = requestUrl.searchParams.get('scope') || 'argentina';
  const span = SPAN_MAP[requestUrl.searchParams.get('span')] ? requestUrl.searchParams.get('span') : '1w';

  if (q.length < 2) return json({ error: 'Falta un término de búsqueda.' }, 400);
  if (q.length > 220) return json({ error: 'La búsqueda es demasiado larga.' }, 400);

  const diagnostics = {};
  let gdelt = { articles: [], query: '' };
  let google = { articles: [], query: '' };

  try {
    gdelt = await fetchGdelt(q, scope, span);
    diagnostics.gdelt = { ok: true, count: gdelt.articles.length };
  } catch (e) {
    diagnostics.gdelt = { ok: false, error: String(e.message || e) };
  }

  try {
    google = await fetchGoogleNews(q, scope, span);
    diagnostics.googleNews = { ok: true, count: google.articles.length };
  } catch (e) {
    diagnostics.googleNews = { ok: false, error: String(e.message || e) };
  }

  const articles = dedupe([...gdelt.articles, ...google.articles]);
  if (!articles.length) {
    return json({
      error: 'Las fuentes no devolvieron resultados.',
      diagnostics,
      fetchedAt: new Date().toISOString()
    }, 502);
  }

  return json({
    ok: true,
    query: q,
    scope,
    span,
    count: articles.length,
    articles,
    diagnostics,
    fetchedAt: new Date().toISOString()
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/news' || url.pathname === '/api/gdelt') return handleNews(request);
    return env.ASSETS.fetch(request);
  }
};
