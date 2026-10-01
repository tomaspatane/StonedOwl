const SUBREDDITS = ['BuenosAires', 'argentina', 'AskArgentina'];
const TERMS = '("sin luz" OR "corte de luz" OR apagón OR apagon OR microcortes OR "baja tensión" OR "baja tension" OR Edesur OR Edenor)';

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

async function searchOne(subreddit, span, apiKey, fetchImpl) {
  const q = `site:reddit.com/r/${subreddit} ${TERMS}`;
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
  const articles = (data.organic || []).map((item) => {
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
      domain: safeDomain(url)
    };
  }).filter((item) => item.title && item.url && /(^|\.)reddit\.com$/i.test(item.domain));

  return { subreddit, query: q, articles };
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
      queries.push(result.value.query);
      diagnostics[subreddit] = { ok: true, count: result.value.articles.length, query: result.value.query };
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
