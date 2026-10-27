const SUBREDDITS = ['BuenosAires', 'argentina', 'AskArgentina'];
const ELECTRIC_QUERY = '"sin luz" OR "corte de luz" OR apagón OR apagon OR microcortes OR "baja tensión" OR "baja tension" OR Edesur OR Edenor';

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .trim();
}

function stripHtml(value = '') {
  return decodeXml(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const match = String(block).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function linkFromEntry(block = '') {
  const alt = String(block).match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (alt) return decodeXml(alt[1]);
  const any = String(block).match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return any ? decodeXml(any[1]) : '';
}

function timeRange(span) {
  if (span === '1w') return 'week';
  if (span === '3d') return 'week';
  return 'day';
}

function spanMs(span) {
  return ({ '6h': 21600000, '1d': 86400000, '3d': 259200000, '1w': 604800000 })[span] || 86400000;
}

function withinSpan(date, span) {
  const ms = Date.parse(date || '');
  if (!Number.isFinite(ms)) return false;
  const age = Date.now() - ms;
  return age >= 0 && age <= spanMs(span);
}

export function parseRedditAtom(xml = '', subreddit = 'unknown', span = '1d') {
  const entries = [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
  return entries.map((match) => {
    const block = match[1];
    const title = stripHtml(tag(block, 'title'));
    const content = stripHtml(tag(block, 'content') || tag(block, 'summary'));
    const date = tag(block, 'published') || tag(block, 'updated');
    const authorBlock = tag(block, 'author');
    const author = stripHtml(tag(authorBlock, 'name'));
    return {
      title,
      snippet: content,
      url: linkFromEntry(block),
      source: `reddit:r/${subreddit}`,
      provider: 'Reddit',
      date,
      author,
      sourceType: 'citizen'
    };
  }).filter((item) => item.title && item.url && withinSpan(item.date, span));
}

async function fetchOne(subreddit, span, fetchImpl) {
  const url = new URL(`https://www.reddit.com/r/${subreddit}/search.rss`);
  url.searchParams.set('q', ELECTRIC_QUERY);
  url.searchParams.set('restrict_sr', '1');
  url.searchParams.set('sort', 'new');
  url.searchParams.set('t', timeRange(span));

  const response = await fetchImpl(url.toString(), {
    signal: AbortSignal.timeout(12000),
    headers: {
      accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*',
      'user-agent': 'StonedOwl/0.10 (public urban-signal research; contact via repository)'
    }
  });
  const raw = await response.text();
  if (!response.ok) throw Object.assign(new Error(`Reddit r/${subreddit} HTTP ${response.status}`), {
    status: response.status, retryAfter: response.headers?.get?.('retry-after') || null
  });
  if (!/<feed(?:\s|>)/i.test(raw) || !/<\/feed>/i.test(raw)) throw new Error('Reddit no devolvió un feed Atom válido');
  return { subreddit, url: url.toString(), articles: parseRedditAtom(raw, subreddit, span) };
}

export function redditRetryDelay(value, now = Date.now()) {
  if (!value) return 2000;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 2000;
}

// One request at a time, at most one retry. A provider block stops the batch;
// skipped requests remain explicit missing coverage, never valid empty feeds.
export async function fetchRedditElectricidad(span = '1d', fetchImpl = fetch, {
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now
} = {}) {
  const articles = [];
  const diagnostics = {};
  let blocked = null;
  for (const subreddit of SUBREDDITS) {
    if (blocked) {
      diagnostics[subreddit] = { ok: false, code: 'provider_cooldown', ...blocked, attempted: false };
      continue;
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await fetchOne(subreddit, span, fetchImpl);
        articles.push(...result.articles);
        diagnostics[subreddit] = { ok: true, count: result.articles.length, url: result.url, attempts: attempt };
        break;
      } catch (error) {
        const delay = redditRetryDelay(error.retryAfter, now());
        if (error.status === 429 && attempt === 1 && Number.isFinite(delay) && delay <= 10000) {
          await sleep(delay);
          continue;
        }
        const code = error.status === 429 ? 'rate_limited' : error.status === 403 ? 'access_denied' : 'request_failed';
        diagnostics[subreddit] = { ok: false, code, httpStatus: error.status || null, attempts: attempt, error: String(error.message || error) };
        if (error.status === 429 || error.status === 403) {
          const retryAt = Math.min(8.64e15, now() + Math.max(60000, Number.isFinite(delay) ? delay : 86400000));
          blocked = { httpStatus: error.status, retryAt: new Date(retryAt).toISOString(), error: 'Reddit coverage unavailable after provider block' };
          Object.assign(diagnostics[subreddit], { retryAt: blocked.retryAt });
        }
        break;
      }
    }
  }

  const seen = new Set();
  const deduped = articles.filter((article) => {
    const key = String(article.url || article.title).toLowerCase().replace(/[?#].*$/, '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { articles: deduped, diagnostics, query: ELECTRIC_QUERY };
}

