import { buildTerritorialPlan } from './serper-electricidad-territorial.js';
import { detectBarrios } from '../data/caba-barrios.js';
import { matchElectricSignals } from '../data/electricidad.js';

// Publisher-owned public feeds: no account, API key or paid search credits.
// These are discovery feeds, not a complete archive or permission to republish
// full articles. Google News RSS is deliberately excluded: its feed restricts
// use to a personal, non-commercial reader. Only titles/summaries are retained.
export const FREE_ELECTRICIDAD_FEEDS = Object.freeze([
  { id: 'pura_ciudad', name: 'Pura Ciudad', url: 'https://www.puraciudad.com.ar/?s=luz&feed=rss2' },
  { id: 'el_abasto', name: 'Revista El Abasto', url: 'https://www.revistaelabasto.com.ar/?s=corte+de+luz&feed=rss2' },
  { id: 'parque_chas', name: 'Parque Chas Web', url: 'https://www.parquechasweb.com.ar/?s=luz&feed=rss2' },
  { id: 'clarin_sociedad', name: 'Clarín', url: 'https://www.clarin.com/rss/sociedad/' },
  { id: 'pagina12_sociedad', name: 'Página/12', url: 'https://www.pagina12.com.ar/arc/outboundfeeds/rss/secciones/sociedad/notas/' }
].map((feed) => Object.freeze(feed)));

const WINDOWS = { '6h': 21600000, '1d': 86400000, '3d': 259200000, '1w': 604800000 };
const MAX_XML_LENGTH = 2_000_000;
const inflight = new WeakMap();

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function decodeXml(text) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(text)) {
    throw failure('invalid_xml', 'RSS contiene una entidad XML inválida');
  }
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) return named[entity];
    const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      throw failure('invalid_xml', 'RSS contiene un carácter XML inválido');
    }
    return String.fromCodePoint(code);
  });
}

// Small non-expanding XML reader. Validates nesting, quoted attributes and a
// single RSS root, rather than treating an HTML error page as an empty feed.
// No DTD, external entity expansion, network access or eval is supported.
function readRssTree(raw) {
  if (!raw || raw.length > MAX_XML_LENGTH) throw failure('invalid_rss', 'RSS vacío o demasiado grande');
  const document = { name: '#document', children: [], text: '' };
  const stack = [document];
  const token = /<!--[\s\S]*?-->|<\?[^?]*\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w.:-]*(?:\s+[^<>]*?)?\s*\/?>|[^<]+/gy;
  let offset = 0;
  while (offset < raw.length) {
    token.lastIndex = offset;
    const match = token.exec(raw);
    if (!match) throw failure('invalid_xml', 'RSS mal formado o declaración XML no permitida');
    offset = token.lastIndex;
    const part = match[0];
    const parent = stack.at(-1);
    if (part.startsWith('<!--') || part.startsWith('<?')) continue;
    if (part.startsWith('<![CDATA[')) {
      if (stack.length === 1) throw failure('invalid_xml', 'CDATA fuera del documento RSS');
      parent.text += part.slice(9, -3);
    } else if (part.startsWith('</')) {
      const name = part.slice(2, -1).trim();
      if (stack.length === 1 || parent.name !== name) throw failure('invalid_xml', 'Etiquetas RSS desbalanceadas');
      stack.pop();
    } else if (part.startsWith('<')) {
      const parsed = part.match(/^<([A-Za-z_][\w.:-]*)([\s\S]*?)\/?\s*>$/);
      const attributes = {};
      let rest = parsed[2];
      while (rest.trim()) {
        const attr = rest.match(/^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/);
        if (!attr || Object.hasOwn(attributes, attr[1])) throw failure('invalid_xml', 'Atributos RSS inválidos');
        attributes[attr[1]] = decodeXml(attr[2] ?? attr[3]);
        rest = rest.slice(attr[0].length);
      }
      const node = { name: parsed[1], attributes, children: [], text: '' };
      parent.children.push(node);
      if (!/\/\s*>$/.test(part)) stack.push(node);
    } else {
      const text = decodeXml(part);
      if (stack.length === 1 && text.replace(/^\uFEFF/, '').trim()) throw failure('invalid_xml', 'Contenido fuera del documento RSS');
      parent.text += text;
    }
  }
  if (stack.length !== 1 || document.children.length !== 1 || document.children[0].name !== 'rss') {
    throw failure('invalid_rss', 'La respuesta no es un documento RSS completo');
  }
  const channels = document.children[0].children.filter((node) => node.name === 'channel');
  if (channels.length !== 1) throw failure('invalid_rss', 'RSS sin un canal válido');
  return channels[0];
}

function child(node, name) { return node.children.find((item) => item.name === name); }
function value(node, name) { return child(node, name)?.text || ''; }
function plainText(text = '') {
  // RSS summaries can contain escaped HTML or HTML inside CDATA. Do not read
  // content:encoded here: that is often the entire copyrighted article body.
  return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity) => {
      try { return decodeXml(entity); } catch { return ''; }
    })
    .replace(/&(?:nbsp|ensp|emsp);/g, ' ').replace(/&(?:ndash|mdash);/g, '–')
    .replace(/\s+/g, ' ').trim();
}
function httpUrl(value) {
  try {
    const parsed = new URL(value.trim());
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : '';
  } catch { return ''; }
}
function domain(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function publicationMs(raw) {
  // Dates need an explicit zone. Never reinterpret a publisher-local clock as UTC.
  // Date.parse alone also accepts ambiguous numerals such as "1" as January 2001.
  const iso = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const rfc = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(raw) && /(?:[+-]\d{4}|GMT|UTC|UT|[ECMP][SD]T)$/i.test(raw);
  if (!iso && !rfc) return NaN;
  return Date.parse(raw);
}
function clockMs(now = new Date()) {
  const ms = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(ms)) throw failure('invalid_options', 'Fecha de captura inválida');
  return ms;
}

export function parsePublisherRss(raw, { feed = {}, span = '1d', now = new Date(), matches = () => true, rejectionKey = 'no_topic_signal' } = {}) {
  const nowMs = clockMs(now);
  if (!WINDOWS[span]) throw failure('invalid_options', `Ventana no soportada: ${span}`);
  const channel = readRssTree(String(raw));
  const items = channel.children.filter((node) => node.name === 'item');
  const rejected = { invalid_record: 0, missing_or_unparseable_date: 0, future_date: 0, outside_time_window: 0, [rejectionKey]: 0 };
  const articles = [];
  let latestPublishedMs = null;
  for (const item of items) {
    const title = plainText(value(item, 'title'));
    const url = httpUrl(value(item, 'link'));
    const rawDate = value(item, 'pubDate').trim() || value(item, 'dc:date').trim();
    const dateMs = publicationMs(rawDate);
    if (Number.isFinite(dateMs) && dateMs <= nowMs) latestPublishedMs = Math.max(latestPublishedMs ?? dateMs, dateMs);
    if (!title || !url) { rejected.invalid_record++; continue; }
    if (!Number.isFinite(dateMs)) { rejected.missing_or_unparseable_date++; continue; }
    if (dateMs > nowMs) { rejected.future_date++; continue; }
    if (nowMs - dateMs > WINDOWS[span]) { rejected.outside_time_window++; continue; }
    const summary = plainText(value(item, 'description'));
    const snippet = summary.slice(0, 500);
    if (!matches(`${title} ${snippet}`)) { rejected[rejectionKey]++; continue; }
    const publisherUrl = httpUrl(child(item, 'source')?.attributes?.url || '') || httpUrl(feed.url || '') || httpUrl(value(channel, 'link'));
    const publisherName = plainText(value(item, 'source')) || feed.name || plainText(value(channel, 'title'));
    const source = domain(publisherUrl) || domain(url);
    articles.push({
      title, snippet, url, source, publisherName, publisherUrl,
      provider: 'Publisher RSS', sourceType: 'web', date: new Date(dateMs).toISOString(),
      query: null,
      provenance: {
        provider: 'publisher_rss', feedId: feed.id || null, feedUrl: feed.url || null,
        publisher: publisherName, publicationDateRaw: rawDate,
        retrievedAt: new Date(nowMs).toISOString(), evidenceScope: 'rss_title_and_summary',
        summaryTruncated: summary.length > snippet.length, fullArticleRead: false,
        geoAssignment: 'unverified', independentSourceKey: source
      }
    });
  }
  return {
    articles,
    diagnostics: {
      rawCount: items.length, acceptedCount: articles.length, rejected,
      feedTitle: plainText(value(channel, 'title')),
      copyright: plainText(value(channel, 'copyright')) || null,
      latestPublishedAt: latestPublishedMs === null ? null : new Date(latestPublishedMs).toISOString(),
      stale: latestPublishedMs !== null && nowMs - latestPublishedMs > WINDOWS[span]
    }
  };
}

// Preserve the original electricity contract and rejection diagnostics.
export function parseFreeElectricidadRss(raw, options = {}) {
  return parsePublisherRss(raw, { ...options, rejectionKey: 'no_electric_signal',
    matches: (text) => matchElectricSignals(text).some(signal => !['entity', 'context'].includes(signal.signalType)) });
}

export async function readPublisherFeed(feed, timeoutMs, fetchImpl) {
  let requests = inflight.get(fetchImpl);
  if (!requests) { requests = new Map(); inflight.set(fetchImpl, requests); }
  const key = `${feed.url}|${timeoutMs}`;
  if (requests.has(key)) return requests.get(key);
  const pending = (async () => {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(feed.url, {
            headers: { accept: 'application/rss+xml, application/xml, text/xml', 'user-agent': 'StonedOwl/0.12 (public RSS discovery)' },
            signal: controller.signal
          });
          if (!response.ok) throw failure('http_error', `RSS ${feed.id} HTTP ${response.status}`);
          const contentType = response.headers?.get?.('content-type') || '';
          if (/text\/html/i.test(contentType)) throw failure('invalid_rss', `RSS ${feed.id} devolvió HTML`);
          const raw = await response.text();
          return { raw, contentType, responseUrl: response.url || feed.url };
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(failure('timeout', `RSS ${feed.id}: tiempo de espera agotado (${timeoutMs} ms)`));
            controller.abort();
          }, timeoutMs);
        })
      ]);
    } finally { clearTimeout(timer); }
  })();
  requests.set(key, pending);
  try { return await pending; } finally { requests.delete(key); }
}

function dedupeArticles(articles) {
  const seen = new Set();
  return articles.filter((article) => {
    const url = new URL(article.url);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    // Keep query parameters that identify real articles and case-sensitive paths.
    const key = `${article.targetBarrio || ''}|${url.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchFreeElectricidad(span = '1d', options = {}, fetchImpl = fetch) {
  const nowMs = clockMs(options.now);
  if (!WINDOWS[span]) throw failure('invalid_options', `Ventana no soportada: ${span}`);
  const feeds = options.feeds ?? FREE_ELECTRICIDAD_FEEDS;
  const timeoutMs = Math.min(30000, Math.max(1, Number(options.timeoutMs) || 12000));
  const territorial = options.territorial === true || (Array.isArray(options.barrios) && options.barrios.length > 0);
  const selectedPlan = territorial ? buildTerritorialPlan({ ...options, now: new Date(nowMs) }) : null;
  const settled = await Promise.all(feeds.map(async (feed) => {
    try {
      const response = await readPublisherFeed(feed, timeoutMs, fetchImpl);
      const parsed = parseFreeElectricidadRss(response.raw, { feed, span, now: nowMs });
      return { articles: parsed.articles, diagnostic: { q: null, feedId: feed.id, url: feed.url, ok: true, ...parsed.diagnostics, contentType: response.contentType, responseUrl: response.responseUrl } };
    } catch (error) {
      return { articles: [], diagnostic: { q: null, feedId: feed.id, url: feed.url, ok: false, rawCount: 0, acceptedCount: 0, code: error.code || 'network_error', error: String(error.message || error) } };
    }
  }));
  let articles = dedupeArticles(settled.flatMap((result) => result.articles));
  if (selectedPlan) {
    articles = articles.flatMap((article) => {
      const mentioned = new Set(detectBarrios(`${article.title} ${article.snippet}`).map((barrio) => barrio.name));
      return selectedPlan.barrios.filter((barrio) => mentioned.has(barrio.name)).map((barrio) => ({
        ...article, sourceType: 'territorial_web', targetBarrio: barrio.name, targetComuna: barrio.comuna,
        query: null, queryTemplateId: 'publisher_rss_local_filter',
        provenance: { ...article.provenance, targetBasis: 'name_mentioned_in_feed_not_confirmed_location' }
      }));
    });
  }
  return {
    articles: dedupeArticles(articles), diagnostics: settled.map((result) => result.diagnostic),
    queries: [], disabled: false, provider: 'publisher_rss',
    plan: selectedPlan ? {
      bucketIndex: selectedPlan.bucketIndex, bucketCount: selectedPlan.bucketCount,
      barrios: selectedPlan.barrios.map(({ name, comuna }) => ({ name, comuna })),
      queryCount: 0, localFilterCount: selectedPlan.barrios.length, feedCount: feeds.length,
      mode: 'publisher_rss_local_filter'
    } : null,
    limitations: ['Limited publisher feed coverage, not a complete news archive.', 'RSS publication time is not necessarily incident time.', 'Geography and independent corroboration require downstream validation.']
  };
}

export async function fetchFreeElectricidadTerritorial(span = '1d', options = {}, fetchImpl = fetch) {
  return fetchFreeElectricidad(span, { ...options, territorial: true }, fetchImpl);
}
