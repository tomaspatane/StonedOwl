import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker, {parseRss,fetchText} from '../worker-v07.js';
import {decodeXml,normalizeArticles,relevantArticles,groupStories,safeUrl} from '../src/articles.js';
const now = Date.now();
const article = (overrides={}) => ({title:'Hospital Rocca renovó sus áreas de rehabilitación y farmacia central',url:'https://medio.test/nota',source:'Medio',date:new Date(now-3600000).toISOString(),...overrides});
const rss = entries => `<rss><channel>${entries.map(a=>`<item><title>${a.title}</title><link>${a.url}</link><pubDate>${a.date}</pubDate><description>${a.description||''}</description></item>`).join('')}</channel></rss>`;
test('numeric entities, CDATA and unsafe URLs',()=>{
  assert.equal(decodeXml('operaci&#243;n &#xE9; &amp; <![CDATA[UBA]]>'),'operación é & UBA');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://www.bing.com/news/apiclick?url=javascript%3Aalert(1)'), '');
});
test('all providers obey date limits; invalid/future dates excluded; GDELT dates normalized',()=>{
  const rows=normalizeArticles([article(),article({url:'https://x.test/old',date:new Date(now-8*864e5).toISOString()}),article({url:'https://x.test/no',date:'bad'}),article({url:'https://x.test/future',date:new Date(now+864e5).toISOString()}),article({url:'https://x.test/gdelt',date:new Date(now).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')})],'1w',now);
  assert.equal(rows.length,2);
});
test('dedupe canonical URLs while retaining separate publishers covering identical titles',()=>{
  const rows=normalizeArticles([article(),article({url:'https://medio.test/nota?utm_source=x'}),article({url:'https://otro.test/nota',source:'Otro'})],'1w',now);
  assert.equal(rows.length,2); assert.equal(groupStories(rows)[0].sourceCount,2);
});
test('query relevance rejects actual unrelated kinds of results and accepts aliases',()=>{
  const rows=[article({description:'Hospitales de la Ciudad de Buenos Aires'}),article({title:'Messi llegó a Miss Mundo',description:'Argentina'}),article({title:'Choques en CABA',description:'Tránsito'})];
  assert.equal(relevantArticles(rows,'hospitales CABA').length,1);
});
test('grouping requires event overlap and a 72h publication window',()=>{
  const rows=[article(),article({title:'Hospital Rocca renovó áreas de rehabilitación y farmacia central',url:'https://otro.test/1',source:'Otro'}),article({title:'Hospital Rocca: denuncian falta de médicos en las guardias',url:'https://otro.test/2'}),article({date:new Date(now-5*864e5).toISOString(),url:'https://otro.test/old'})];
  const stories=groupStories(normalizeArticles(rows,'1w',now));
  assert.equal(stories.length,3); assert.equal(stories[0].articleCount,2);
});
test('valid empty RSS differs from an HTML error page',()=>{
  assert.deepEqual(parseRss('<rss><channel></channel></rss>','Bing'),[]);
  assert.throws(()=>parseRss('<html>Blocked</html>','Bing'));
});
test('deadline covers a stalled body, not only response headers', async()=>{
  const original=global.fetch;
  global.fetch=async()=>({ok:true,text:()=>new Promise(()=>{})});
  try {await assert.rejects(fetchText('https://x.test','text/plain',15),/timeout/);}finally{global.fetch=original;}
});
test('API returns 503 on total failure and 200 for valid empty results',async()=>{
  const original=global.fetch;
  try {
    global.fetch=async()=>new Response('unavailable',{status:503});
    let response=await worker.fetch(new Request('https://owl.test/api/news?q=salud'),{});
    assert.equal(response.status,503); assert.equal((await response.json()).coverage,'unavailable');
    global.fetch=async url=>new Response(String(url).includes('gdelt')?'{"articles":[]}':rss([]));
    response=await worker.fetch(new Request('https://owl.test/api/news?q=salud'),{});
    const data=await response.json();assert.equal(response.status,200);assert.equal(data.ok,true);assert.equal(data.count,0);assert.equal(data.activeProviderCount,3);
  }finally{global.fetch=original;}
});
test('partial provider failure preserves articles and stories with explicit coverage',async()=>{
  const original=global.fetch;
  try{
    global.fetch=async url=>String(url).includes('bing.com')?new Response(rss([article({description:'CABA'})])):new Response('unavailable',{status:503});
    const response=await worker.fetch(new Request('https://owl.test/api/stories?q=hospitales%20CABA'),{});
    const data=await response.json();assert.equal(response.status,200);assert.equal(data.coverage,'partial');assert.equal(data.stories.length,1);
  }finally{global.fetch=original;}
});
test('radar is an explicit API and reports missing D1 instead of serving the app shell',async()=>{
  const response=await worker.fetch(new Request('https://owl.test/api/radar'),{ASSETS:{fetch(){throw Error('must not serve assets');}}});
  assert.equal(response.status,503);assert.equal((await response.json()).ok,false);
});
test('unknown APIs still return JSON 404 rather than the app shell',async()=>{
  const response=await worker.fetch(new Request('https://owl.test/api/unknown'),{ASSETS:{fetch(){throw Error('must not serve assets');}}});
  assert.equal(response.status,404);assert.equal((await response.json()).ok,false);
});
