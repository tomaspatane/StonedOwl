const PERIODS = { '1d': 864e5, '3d': 2592e5, '1w': 6048e5, '1m': 25920e5 };
export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function decodeXml(value = '') {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : entity;
    }).replace(/&(lt|gt|quot|apos|amp);/g, (_, key) => ({lt:'<',gt:'>',quot:'"',apos:"'",amp:'&'}[key])).trim();
}
export function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}
export function plain(value) { return decodeXml(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
export function safeUrl(value) {
  try {
    let url = new URL(value);
    if ((url.hostname === 'bing.com' || url.hostname.endsWith('.bing.com')) && url.pathname.includes('apiclick')) {
      url = new URL(url.searchParams.get('url') || value);
    }
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return ''; }
}
export function parseDate(value) {
  const text = String(value || '').replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function normalizeArticles(items, span, now = Date.now()) {
  const seen = new Set();
  return items.flatMap(item => {
    const url = safeUrl(item.url), title = plain(item.title), date = parseDate(item.date);
    // An unknown date cannot establish that an article belongs to the requested period.
    if (!url || !title || !date || Date.parse(date) < now - (PERIODS[span] || PERIODS['1w']) || Date.parse(date) > now + 36e5) return [];
    if (seen.has(url)) return [];
    seen.add(url);
    const source = plain(item.source) || new URL(url).hostname.replace(/^www\./, '');
    return [{ ...item, title, url, date, source, description: plain(item.description) }];
  }).sort((a, b) => b.date.localeCompare(a.date));
}
const STOP = new Set('el la los las un una unos unas de del en y o a al por para con sin sobre ante tras que se su sus es fue son ser como mas este esta estos estas hoy argentina'.split(' '));
export function tokens(text) { return [...new Set(normalize(text).match(/[a-z0-9]+/g) || [])].filter(t => t.length > 2 && !STOP.has(t)); }
// Conservative title grouping: a common topic alone is not sufficient evidence of the same event.
export function groupStories(articles) {
  const groups = [];
  for (const article of articles) {
    const title = article.title.endsWith(' - ' + article.source) ? article.title.slice(0, -article.source.length - 3) : article.title;
    const terms = tokens(title);
    const group = groups.find(g => {
      if (Math.abs(Date.parse(article.date) - Date.parse(g.articles[0].date)) > 72 * 36e5) return false;
      const common = terms.filter(t => g.terms.includes(t)).length;
      const union = new Set([...terms, ...g.terms]).size;
      const numbers = terms.filter(t => /^\d+$/.test(t));
      const otherNumbers = g.terms.filter(t => /^\d+$/.test(t));
      if (numbers.length && otherNumbers.length && numbers.join() !== otherNumbers.join()) return false;
      return (normalize(title) === normalize(g.title)) || (common >= 3 && union > 0 && common / union >= 0.55);
    });
    if (group) group.articles.push(article);
    else groups.push({ title, terms, articles: [article] });
  }
  return groups.map(({title, articles}) => {
    const sources = [...new Set(articles.map(a => normalize(a.source)))];
    return { title, articleCount: articles.length, sourceCount: sources.length,
      sources: [...new Set(articles.map(a => a.source))], latestPublishedAt: articles[0].date,
      grouping: 'title-similarity', articles };
  }).sort((a, b) => b.sourceCount - a.sourceCount || b.latestPublishedAt.localeCompare(a.latestPublishedAt));
}
// Providers sometimes broaden queries silently. Require topical terms in title/summary.
// Missing geographic evidence is flagged rather than silently dropping relevant local stories.
// Advanced provider syntax is passed through rather than reinterpreted locally.
export function relevantArticles(articles, query) {
  if (/["():]|\b(?:OR|AND|NOT)\b/.test(query)) return articles;
  const terms = tokens(query);
  if (!terms.length || terms.length > 6) return articles;
  const aliases = {
    caba: /\b(caba|buenos aires|capital federal|porten[oa]s?)\b/,
    hospital: /\b(hospital(?:es)?|hospitalari[oa]s?)\b/,
    hospitales: /\b(hospital(?:es)?|hospitalari[oa]s?)\b/,
    universidad: /\b(universidad(?:es)?|universitari[oa]s?|uba)\b/
  };
  return articles.flatMap(a => {
    const text = normalize(a.title + ' ' + a.description);
    const words = new Set(text.match(/[a-z0-9]+/g) || []);
    const topical = terms.filter(t => t !== 'caba');
    const matches = topical.every(t => aliases[t] ? aliases[t].test(text) : words.has(t));
    const locationMatched = terms.includes('caba') ? aliases.caba.test(text) : null;
    if (!matches || (!topical.length && locationMatched === false)) return [];
    return [{...a, locationMatched}];
  });
}
