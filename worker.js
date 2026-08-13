const ALLOWED_SPANS = new Set(['1d', '3d', '1w', '1m']);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60'
    }
  });
}

async function handleGdelt(request) {
  const requestUrl = new URL(request.url);
  const q = (requestUrl.searchParams.get('q') || '').trim();
  const scope = requestUrl.searchParams.get('scope') || 'argentina';
  const requestedSpan = requestUrl.searchParams.get('span');
  const span = ALLOWED_SPANS.has(requestedSpan) ? requestedSpan : '1w';

  if (q.length < 2) return json({ error: 'Falta un término de búsqueda.' }, 400);
  if (q.length > 220) return json({ error: 'La búsqueda es demasiado larga.' }, 400);

  let query = q;
  if (scope === 'argentina') query += ' sourcecountry:argentina sourcelang:spanish';

  const gdelt = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  gdelt.searchParams.set('query', query);
  gdelt.searchParams.set('mode', 'artlist');
  gdelt.searchParams.set('format', 'json');
  gdelt.searchParams.set('maxrecords', '100');
  gdelt.searchParams.set('sort', 'datedesc');
  gdelt.searchParams.set('timespan', span);

  try {
    const upstream = await fetch(gdelt.toString(), {
      headers: { accept: 'application/json', 'user-agent': 'StonedOwl/0.5' }
    });

    if (!upstream.ok) {
      return json({ error: `GDELT respondió ${upstream.status}`, upstreamStatus: upstream.status }, 502);
    }

    const data = await upstream.json();
    const articles = Array.isArray(data.articles)
      ? data.articles.map(a => ({
          title: a.title || 'Sin título',
          url: a.url || '',
          domain: a.domain || '',
          sourcecountry: a.sourcecountry || '',
          language: a.language || '',
          seendate: a.seendate || '',
          socialimage: a.socialimage || ''
        })).filter(a => a.url)
      : [];

    return json({
      ok: true,
      provider: 'GDELT DOC 2.0',
      query,
      span,
      scope,
      count: articles.length,
      articles,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    return json({ error: 'No se pudo consultar GDELT.', detail: String(error?.message || error) }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/gdelt') return handleGdelt(request);
    return env.ASSETS.fetch(request);
  }
};
