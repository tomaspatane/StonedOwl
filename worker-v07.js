import { tag, normalizeArticles, groupStories, relevantArticles } from './src/articles.js';
const SPAN_MAP = { '1d': '1d', '3d': '3d', '1w': '7d', '1m': '30d' };
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
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
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}
export function parseRss(xml, provider) {
  if (!/<rss(?:\s|>)/i.test(xml) || !/<channel(?:\s|>)/i.test(xml) || !/<\/rss>/i.test(xml)) throw new Error('La fuente no devolvió un RSS válido');
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,100).map(([,block]) => ({
    title: tag(block,'title'), url: tag(block,'link'), date: tag(block,'pubDate'),
    source: tag(block,'source') || tag(block,'News:Source'), description: tag(block,'description'), provider
  }));
}
async function fetchBingNews(q,scope) {
  const query = scope === 'argentina' ? `${q} Argentina` : q;
  const u = new URL('https://www.bing.com/news/search');
  for (const [key,value] of Object.entries({q:query,format:'RSS',mkt:'es-AR',setlang:'es',cc:'AR',qft:'sortbydate="1"'})) u.searchParams.set(key,value);
  return {articles:parseRss(await fetchText(u.toString(),'application/rss+xml, application/xml'),'Bing News'),query};
}
async function fetchGoogleNews(q,scope,span) {
  const days = ({'1d':1,'3d':3,'1w':7,'1m':30})[span];
  const query = `${q}${scope === 'argentina' ? ' Argentina' : ''} when:${days}d`;
  const u = new URL('https://news.google.com/rss/search');
  for (const [key,value] of Object.entries({q:query,hl:'es-419',gl:'AR',ceid:'AR:es-419'})) u.searchParams.set(key,value);
  return {articles:parseRss(await fetchText(u.toString(),'application/rss+xml, application/xml'),'Google News'),query};
}
async function fetchGdelt(q,scope,span) {
  const query = scope === 'argentina' ? `${q} sourcecountry:argentina sourcelang:spanish` : q;
  const u = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  for (const [key,value] of Object.entries({query,mode:'ArtList',format:'json',maxrecords:'100',sort:'DateDesc',timespan:SPAN_MAP[span]})) u.searchParams.set(key,value);
  const data = JSON.parse(await fetchText(u.toString(),'application/json',2500));
  if (!Array.isArray(data.articles)) throw new Error('Respuesta de GDELT sin lista de artículos');
  return {query,articles:data.articles.map(a=>({title:a.title,url:a.url,source:a.domain,date:a.seendate,provider:'GDELT'}))};
}
export async function runSources(q,scope,span) {
  const results = await Promise.allSettled([fetchBingNews(q,scope,span),fetchGdelt(q,scope,span),fetchGoogleNews(q,scope,span)]);
  const diagnostics = {};
  const names = ['bingNews','gdelt','googleNews'];
  const items = [];
  results.forEach((r,i) => {
    diagnostics[names[i]] = r.status === 'fulfilled' ? {ok:true,count:r.value.articles.length,query:r.value.query} : {ok:false,error:String(r.reason?.message || r.reason)};
    if (r.status === 'fulfilled') items.push(...r.value.articles);
  });
  const normalized = normalizeArticles(items,span);
  const articles = relevantArticles(normalized,q);
  return {articles,diagnostics,excludedCount:normalized.length - articles.length,activeProviderCount:results.filter(r=>r.status==='fulfilled').length};
}
async function handleNews(request) {
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') || '').trim();
  const scope = u.searchParams.get('scope') === 'world' ? 'world' : 'argentina';
  const span = Object.hasOwn(SPAN_MAP,u.searchParams.get('span')) ? u.searchParams.get('span') : '1w';
  if (q.length < 2 || q.length > 300) return json({ok:false,error:'Escribí un tema de entre 2 y 300 caracteres.'},400);
  const data = await runSources(q,scope,span);
  const ok = data.activeProviderCount > 0;
  return json({ok,error:ok?null:'No pudimos consultar las fuentes. Reintentá en unos minutos.',query:q,scope,span,
    ...data,count:data.articles.length,stories:groupStories(data.articles),
    coverage:data.activeProviderCount===3?'complete':ok?'partial':'unavailable',
    fetchedAt:new Date().toISOString()},ok?200:503);
}
export default {async fetch(request,env) {
  const u = new URL(request.url);
  if (u.pathname === '/api/health') {
    const {diagnostics,activeProviderCount} = await runSources('milei','argentina','1w');
    return json({ok:activeProviderCount>0,version:'0.7.1-stories',checks:{worker:{ok:true,time:new Date().toISOString()},...diagnostics}},activeProviderCount?200:503);
  }
  if (['/api/news','/api/gdelt','/api/stories'].includes(u.pathname)) return handleNews(request);
  if (u.pathname.startsWith('/api/')) return json({ok:false,error:'Esta función no está disponible en esta versión.'},404);
  return env.ASSETS.fetch(request);
}};
