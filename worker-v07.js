const SPAN_MAP = { '1d': '1d', '3d': '3d', '1w': '7d', '1m': '30d' };
const SPAN_MS = { '1d': 86400000, '3d': 259200000, '1w': 604800000, '1m': 2592000000 };

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function decodeXml(s=''){return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();}
function tag(block,name){const m=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));return m?decodeXml(m[1]):'';}
function sourceFromTitle(title=''){const parts=String(title).split(' - ');return parts.length>1?parts[parts.length-1].trim():'';}
function cleanBingUrl(url=''){try{const u=new URL(url);if(u.hostname.includes('bing.com')&&u.pathname.includes('apiclick'))return u.searchParams.get('url')||url;}catch{}return url;}
function withinSpan(date,span){const d=new Date(date);if(Number.isNaN(d.getTime()))return true;return Date.now()-d.getTime()<=(SPAN_MS[span]||SPAN_MS['1w'])+3600000;}
async function fetchWithTimeout(url,options={},timeoutMs=9000){const c=new AbortController();const t=setTimeout(()=>c.abort('timeout'),timeoutMs);try{return await fetch(url,{...options,signal:c.signal});}finally{clearTimeout(t);}}

async function fetchBingNews(q,scope,span){
  let query=q;if(scope==='argentina')query+=' Argentina';
  const u=new URL('https://www.bing.com/news/search');
  u.searchParams.set('q',query);u.searchParams.set('format','RSS');u.searchParams.set('mkt','es-AR');u.searchParams.set('setlang','es');u.searchParams.set('cc','AR');u.searchParams.set('qft','sortbydate="1"');
  const r=await fetchWithTimeout(u.toString(),{headers:{accept:'application/rss+xml, application/xml, text/xml, */*','user-agent':'Mozilla/5.0 (compatible; StonedOwl/0.7)'}});
  const xml=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${xml.slice(0,220)}`);
  const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0,80);
  const articles=items.map(m=>{const b=m[1];const title=tag(b,'title');const url=cleanBingUrl(tag(b,'link'));const date=tag(b,'pubDate');return{title,url,source:sourceFromTitle(title),date,provider:'Bing News'};}).filter(a=>a.url&&a.title&&withinSpan(a.date,span));
  if(!articles.length)throw new Error(`RSS válido pero sin items recientes. Inicio: ${xml.slice(0,220)}`);
  return{articles,query};
}

async function fetchGdelt(q,scope,span){
  let query=q;if(scope==='argentina')query+=' sourcecountry:argentina sourcelang:spanish';
  const u=new URL('https://api.gdeltproject.org/api/v2/doc/doc');u.searchParams.set('query',query);u.searchParams.set('mode','ArtList');u.searchParams.set('format','json');u.searchParams.set('maxrecords','100');u.searchParams.set('sort','DateDesc');u.searchParams.set('timespan',SPAN_MAP[span]||'7d');
  const r=await fetchWithTimeout(u.toString(),{headers:{accept:'application/json'}});const raw=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${raw.slice(0,220)}`);let data;try{data=JSON.parse(raw)}catch{throw new Error(`respuesta no JSON: ${raw.slice(0,220)}`)}
  const articles=Array.isArray(data.articles)?data.articles.map(a=>({title:a.title||'Sin título',url:a.url||'',source:a.domain||'',date:a.seendate||'',provider:'GDELT'})).filter(a=>a.url):[];return{articles,query};
}

async function fetchGoogleNews(q,scope,span){
  const days=({'1d':1,'3d':3,'1w':7,'1m':30})[span]||7;let query=q;if(scope==='argentina')query+=' Argentina';query+=` when:${days}d`;
  const u=new URL('https://news.google.com/rss/search');u.searchParams.set('q',query);u.searchParams.set('hl','es-419');u.searchParams.set('gl','AR');u.searchParams.set('ceid','AR:es-419');
  const r=await fetchWithTimeout(u.toString(),{headers:{accept:'application/rss+xml, application/xml, text/xml, */*'}});const xml=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${xml.slice(0,220)}`);
  const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0,100);const articles=items.map(m=>{const b=m[1];return{title:tag(b,'title'),url:tag(b,'link'),source:tag(b,'source'),date:tag(b,'pubDate'),provider:'Google News'};}).filter(a=>a.url&&a.title);if(!articles.length)throw new Error('RSS válido pero sin items');return{articles,query};
}
function dedupe(items){const seen=new Set();return items.filter(a=>{const key=(a.title||a.url).toLowerCase().replace(/\s+/g,' ').trim();if(seen.has(key))return false;seen.add(key);return true;});}
function diag(result){return result.status==='fulfilled'?{ok:true,count:result.value.articles.length,query:result.value.query}:{ok:false,error:String(result.reason?.message||result.reason)};}
async function runSources(q,scope,span){const [bing,gdelt,google]=await Promise.allSettled([fetchBingNews(q,scope,span),fetchGdelt(q,scope,span),fetchGoogleNews(q,scope,span)]);return{articles:dedupe([...(bing.status==='fulfilled'?bing.value.articles:[]),...(gdelt.status==='fulfilled'?gdelt.value.articles:[]),...(google.status==='fulfilled'?google.value.articles:[])]),diagnostics:{bingNews:diag(bing),gdelt:diag(gdelt),googleNews:diag(google)}};}
async function handleHealth(){const checks={worker:{ok:true,time:new Date().toISOString()}};try{const r=await fetchWithTimeout('https://example.com/',{},8000);checks.internet={ok:r.ok,status:r.status};}catch(e){checks.internet={ok:false,error:String(e?.message||e)}}const {diagnostics}=await runSources('milei','argentina','1w');Object.assign(checks,diagnostics);return json({ok:true,checks});}
async function handleNews(request){const u=new URL(request.url);const q=(u.searchParams.get('q')||'').trim();const scope=u.searchParams.get('scope')||'argentina';const span=SPAN_MAP[u.searchParams.get('span')]?u.searchParams.get('span'):'1w';if(q.length<2)return json({error:'Falta un término de búsqueda.'},400);const {articles,diagnostics}=await runSources(q,scope,span);return json({ok:articles.length>0,error:articles.length?null:'Las fuentes no devolvieron resultados.',query:q,scope,span,count:articles.length,articles,diagnostics,fetchedAt:new Date().toISOString()});}
export default{async fetch(request,env){const u=new URL(request.url);if(u.pathname==='/api/health')return handleHealth();if(u.pathname==='/api/news'||u.pathname==='/api/gdelt')return handleNews(request);return env.ASSETS.fetch(request);}};
