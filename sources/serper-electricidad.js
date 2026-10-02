const QUERIES = [
  'sin luz CABA',
  'corte de luz CABA',
  'baja tension CABA',
  'apagon CABA'
];

function safeDomain(url = '') {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function canonicalUrl(url = '') {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url || '').replace(/[?#].*$/, '');
  }
}

function timeFilter(span) {
  if (span === '1w') return 'qdr:w';
  if (span === '3d') return 'qdr:d3';
  return 'qdr:d';
}

async function searchOne(q, span, apiKey, fetchImpl) {
  const response = await fetchImpl('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({ q, gl: 'ar', hl: 'es', num: 20, tbs: timeFilter(span) })
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Serper Web HTTP ${response.status}: ${raw.slice(0, 180)}`);
  const data = JSON.parse(raw);
  const organic = Array.isArray(data.organic) ? data.organic : [];
  const articles = organic.map((item) => {
    const url = canonicalUrl(item.link || '');
    return {
      title: item.title || '',
      snippet: item.snippet || '',
      url,
      source: safeDomain(url),
      provider: 'Google Web (Serper)',
      date: item.date || '',
      sourceType: 'web',
      query: q
    };
  }).filter((item) => item.title && item.url);

  return { q, rawCount: organic.length, articles };
}

export async function fetchSerperElectricidad(span = '1d', apiKey = '', fetchImpl = fetch) {
  if (!apiKey) {
    return {
      articles: [],
      diagnostics: { disabled: true, reason: 'SERPER_API_KEY no configurada' },
      queries: [],
      disabled: true
    };
  }

  const settled = await Promise.allSettled(QUERIES.map((q) => searchOne(q, span, apiKey, fetchImpl)));
  const articles = [];
  const diagnostics = [];

  settled.forEach((result, index) => {
    const q = QUERIES[index];
    if (result.status === 'fulfilled') {
      articles.push(...result.value.articles);
      diagnostics.push({ q, ok: true, rawCount: result.value.rawCount });
    } else {
      diagnostics.push({ q, ok: false, error: String(result.reason?.message || result.reason) });
    }
  });

  const seen = new Set();
  const deduped = articles.filter((article) => {
    const key = canonicalUrl(article.url).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { articles: deduped, diagnostics, queries: QUERIES, disabled: false };
}
