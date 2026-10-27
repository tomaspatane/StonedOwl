import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEnreSourceUpdatedAt, compareElectricitySnapshots } from '../data/electricidad-trend.js';
import { fetchRedditElectricidad, parseRedditAtom } from '../sources/reddit-electricidad.js';
import { fetchCitizenElectricity, fetchWebElectricity } from '../sources/electricidad-capture.js';
import { assessCapture } from '../data/capture-assessment.js';
const atom = '<feed xmlns="http://www.w3.org/2005/Atom"></feed>';

test('observed ENRE one-digit clocks resolve only against compatible dated headers', () => {
  for (const [clock, header, iso] of [
    ['3:15','Tue, 27 Oct 2026 06:17:59 GMT','2026-10-27T06:15:00.000Z'],
    ['1:45','Sun, 25 Oct 2026 04:45:58 GMT','2026-10-25T04:45:00.000Z'],
    ['6:45','Sun, 25 Oct 2026 09:46:59 GMT','2026-10-25T09:45:00.000Z'],
    ['0:01','Tue, 27 Oct 2026 03:02:00 GMT','2026-10-27T03:01:00.000Z']
  ]) assert.equal(resolveEnreSourceUpdatedAt(clock, header), iso);
  for(const [clock,header] of [['3:15',null],['3:15','Tue, 27 Oct 2026 07:17:59 GMT'],['24:00','Tue, 27 Oct 2026 06:17:59 GMT'],['3:60','Tue, 27 Oct 2026 06:17:59 GMT']]) assert.equal(resolveEnreSourceUpdatedAt(clock,header),null);
});

test('Reddit serializes requests and honors Retry-After before its single retry', async () => {
  let calls=0, active=0, peak=0; const sleeps=[];
  const result=await fetchRedditElectricidad('1w',async()=>{
    active++;peak=Math.max(peak,active);await Promise.resolve();active--;calls++;
    return calls===1?new Response('',{status:429,headers:{'retry-after':'2'}}):new Response(atom);
  },{sleep:async ms=>sleeps.push(ms)});
  assert.equal(peak,1);assert.equal(calls,4);assert.deepEqual(sleeps,[2000]);
  assert.equal(result.diagnostics.BuenosAires.ok,true);
});

test('persistent 429 stops the batch and records missing coverage', async()=>{
  let calls=0;
  const result=await fetchRedditElectricidad('1w',async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'1'}});},{sleep:async()=>{}});
  assert.equal(calls,2);assert.equal(result.diagnostics.BuenosAires.code,'rate_limited');
  assert.equal(result.diagnostics.argentina.attempted,false);assert.equal(result.diagnostics.argentina.ok,false);
});

test('403 and long Retry-After do not trigger retries or other subreddit calls',async()=>{
  for(const status of [403,429]){
    let calls=0;
    const result=await fetchRedditElectricidad('1w',async()=>{calls++;return new Response('',{status,headers:{'retry-after':'120'}});},{sleep:async()=>assert.fail('must not wait/retry')});
    assert.equal(calls,1);assert.equal(result.articles.length,0);assert.equal(result.diagnostics.AskArgentina.ok,false);
  }
});

test('holding a Serper key alone cannot activate paid fallback',async()=>{
  const urls=[];
  const fail=async url=>{urls.push(String(url));return new Response('',{status:403});};
  await fetchCitizenElectricity('1w','present-but-not-authorized',fail);
  await fetchWebElectricity('1w','present-but-not-authorized',{feeds:[{id:'test',url:'https://publisher.test/feed'}]},fail);
  assert.ok(urls.length>0);assert.equal(urls.some(u=>u.includes('serper')),false);
});

test('undated, future and just-outside-window Reddit items are rejected',()=>{
  for(const date of ['', 'bad-date',new Date(Date.now()+3600000).toISOString(),new Date(Date.now()-86400001).toISOString()]){
    const xml=`<feed><entry><title>Sin luz en Flores</title><link href="https://www.reddit.com/r/test/comments/test"/><published>${date}</published></entry></feed>`;
    assert.equal(parseRedditAtom(xml,'test','1d').length,0);
  }
});

const now=Date.parse('2026-10-27T13:16:35Z');
const report=()=>({finishedAt:new Date(now).toISOString(),coverage:{status:'healthy'},
 sourceHealth:{enre:{EDENOR:{ok:true,count:0},EDESUR:{ok:true,count:1}},googleWeb:{diagnostics:[]},territorialWeb:{diagnostics:[]}},
 enreTotals:{EDENOR:{sourceUpdatedAt:'2026-10-27T13:10:00Z'},EDESUR:{sourceUpdatedAt:'2026-10-27T13:10:00Z'}},
 counts:{enreRaw:1,enreCaba:1},editorialCases:[],officialSignals:[{official:true,provider:'ENRE',company:'EDESUR',url:'https://www.enre.gov.ar/paginacorte/js/data_EDS.js',locality:'SAN TELMO',partido:'CAPITAL',barrios:[{name:'San Telmo'}],enreType:'baja_tension',affectedUsers:105}]
});

test('completed execution and valid official evidence do not authorize publishing',()=>{
  const q=assessCapture(report(),{now,previousCapturedAt:'2026-10-27T06:21:00Z'});
  assert.equal(q.execution.status,'completed');assert.equal(q.evidence.officialSnapshot.valid,true);
  assert.equal(q.evidence.status,'partial');assert.equal(q.publication.status,'blocked');
  assert.equal(q.cadence.status,'gap');assert.equal(q.comparison.status,'insufficient');
});

test('stale source date, unknown clock and missing coverage never become current evidence',()=>{
  for(const date of ['2026-10-26T13:10:00Z',null,'3:15']){
    const r=report();r.enreTotals.EDESUR.sourceUpdatedAt=date;
    const q=assessCapture(r,{now});assert.equal(q.evidence.officialSnapshot.valid,false);assert.equal(q.evidence.status,'insufficient');
  }
  const previous=report();previous.finishedAt='2026-10-27T12:16:35Z';
  for(const c of ['EDENOR','EDESUR'])previous.enreTotals[c].sourceUpdatedAt='2026-10-27T12:10:00Z';
  previous.officialSignals[0].locality='FLORES';previous.officialSignals[0].barrios=[{name:'Flores'}];
  const c=compareElectricitySnapshots({current:report(),previous,now});
  assert.equal(c.status,'unknown');assert.equal(c.deltaAffectedUsers,null);assert.ok(c.reasonCodes.includes('changed_observed_coverage'));
});

test('empty topic capture is insufficient even with all feeds reachable',()=>{
  const q=assessCapture({fetchedAt:new Date(now).toISOString(),captureHealth:{status:'healthy'},topics:{basura:{editorialCases:[],sourceHealth:[]}}},{now});
  assert.equal(q.execution.status,'completed');assert.equal(q.evidence.status,'insufficient');assert.equal(q.publication.status,'blocked');
});

test('persisted provider cooldown prevents another run from retrying early', async () => {
  const r=await fetchCitizenElectricity('1w','',async()=>assert.fail('cooldown must prevent network'),{cooldownUntil:new Date(Date.now()+600000).toISOString()});
  assert.equal(r.diagnostics.cooldown.code,'provider_cooldown');assert.equal(r.diagnostics.cooldown.ok,false);
});
