const SUBREDDITS = ['BuenosAires', 'argentina', 'AskArgentina'];
const SIMPLE_QUERIES = [
  'sin luz',
  'corte de luz',
  'baja tension Edesur'
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

function belongsToSubreddit(url = '', subreddit = '') {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (domain !== 'reddit.com' && !domain.endsWith('.reddit.com')) return false;
    return parsed.pathname.toLowerCase().includes(`/r/${subreddit.toLowerCase()}/`);
  } catch {
    return false;
  }
}

async function searchQuery(subreddit, phrase, span, apiKey, fetchImpl) {
  // Free Serper accounts reject some advanced Google operator patterns (site:, nested ORs).
  // Keep the query deliberately simple and filter Reddit/subreddit URLs after retrieval.
  const q = `reddit r/${subreddit} ${phrase}`;
  const response = await fetchImpl('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({ q, gl: 'ar', hl: 'es', num: 20, tbs: timeFilter(span) })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Serper Reddit r/${subreddit} HTTP ${response.status}: ${raw.slice(0, 180)}`);
  const data = JSON.parse(raw);
  const organic = Array.isArray(data.organic) ? data.organic : [];
  const articles = organic.map((item) => {
    const url = canonicalUrl(item.link || '');
    return {
      title: item.title || '',
      snippet: item.snippet || '',
      url,
      source: url || `reddit:r/${subreddit}`,
      provider: 'Google Web / Reddit',
      date: item.date || '',
      author: '',
      sourceType: 'citizen',
      subreddit,
      domain: safeDomain(url),
      query: q
    };
  }).filter((item) => item.title && item.url && belongsToSubreddit(item.url, subreddit));

  return { subreddit, phrase, query: q, rawCount: organic.length, articles };
}

async function searchOne(subreddit, span, apiKey, fetchImpl) {
  const settled = await Promise.allSettled(
    SIMPLE_QUERIES.map((phrase) => searchQuery(subreddit, phrase, span, apiKey, fetchImpl))
  );

  const articles = [];
  const queries = [];
  const queryDiagnostics = [];

  settled.forEach((result, index) => {
    const phrase = SIMPLE_QUERIES[index];
    if (result.status === 'fulfilled') {
      articles.push(...result.value.articles);
      queries.push(result.value.query);
      queryDiagnostics.push({
        phrase,
        ok: true,
        rawCount: result.value.rawCount,
        redditCount: result.value.articles.length
      });
    } else {
      queryDiagnostics.push({
        phrase,
        ok: false,
        error: String(result.reason?.message || result.reason)
      });
    }
  });

  return { subreddit, queries, queryDiagnostics, articles };
}

export async function fetchSerperRedditElectricidad(span = '1d', apiKey = '', fetchImpl = fetch) {
  if (!apiKey) {
    return {
      articles: [],
      diagnostics: { disabled: true, reason: 'SERPER_API_KEY no configurada' },
      query: null,
      disabled: true
    };
  }

  const settled = await Promise.allSettled(SUBREDDITS.map((subreddit) => searchOne(subreddit, span, apiKey, fetchImpl)));
  const articles = [];
  const diagnostics = {};
  const queries = [];

  settled.forEach((result, index) => {
    const subreddit = SUBREDDITS[index];
    if (result.status === 'fulfilled') {
      articles.push(...result.value.articles);
      queries.push(...result.value.queries);
      diagnostics[subreddit] = {
        ok: result.value.queryDiagnostics.some((item) => item.ok),
        count: result.value.articles.length,
        queries: result.value.queryDiagnostics
      };
    } else {
      diagnostics[subreddit] = { ok: false, error: String(result.reason?.message || result.reason) };
    }
  });

  const seen = new Set();
  const deduped = articles.filter((article) => {
    const key = canonicalUrl(article.url).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { articles: deduped, diagnostics, query: queries, disabled: false };
}
