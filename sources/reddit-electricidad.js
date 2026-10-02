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
  if (!Number.isFinite(ms)) return true;
  return Date.now() - ms <= spanMs(span) + 3600000;
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
    headers: {
      accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*',
      'user-agent': 'StonedOwl/0.10 (public urban-signal research; contact via repository)'
    }
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Reddit r/${subreddit} HTTP ${response.status}: ${raw.slice(0, 160)}`);
  return { subreddit, url: url.toString(), articles: parseRedditAtom(raw, subreddit, span) };
}

export async function fetchRedditElectricidad(span = '1d', fetchImpl = fetch) {
  const settled = await Promise.allSettled(SUBREDDITS.map((subreddit) => fetchOne(subreddit, span, fetchImpl)));
  const articles = [];
  const diagnostics = {};

  settled.forEach((result, index) => {
    const subreddit = SUBREDDITS[index];
    if (result.status === 'fulfilled') {
      articles.push(...result.value.articles);
      diagnostics[subreddit] = { ok: true, count: result.value.articles.length, url: result.value.url };
    } else {
      diagnostics[subreddit] = { ok: false, error: String(result.reason?.message || result.reason) };
    }
  });

  const seen = new Set();
  const deduped = articles.filter((article) => {
    const key = String(article.url || article.title).toLowerCase().replace(/[?#].*$/, '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { articles: deduped, diagnostics, query: ELECTRIC_QUERY };
}
