import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// Exercise the real event handlers against minimal DOM controls, without a browser dependency.
function harness(fetch) {
  const ids=[...readFileSync(new URL('../public/index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const nodes=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',innerHTML:'',disabled:false,addEventListener(){},setAttribute(){},focus(){}}]));
  nodes.q.value='hospitales CABA';nodes.scope.value='argentina';nodes.span.value='1w';
  const context=vm.createContext({document:{getElementById:id=>nodes[id],querySelectorAll:()=>[]},fetch,URL,URLSearchParams,AbortController,setTimeout,clearTimeout});
  vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
  return {nodes,search:()=>vm.runInContext('search()',context)};
}
test('malformed success response is an error, clears previous media, and permits retry',async()=>{
  const {nodes,search}=harness(async()=>({ok:true,json:async()=>{throw new Error('invalid JSON');}}));
  nodes.media.innerHTML='stale media';nodes.label.textContent='old result';
  await search();
  assert.match(nodes.articles.innerHTML,/No pude traer resultados/);
  assert.doesNotMatch(nodes.media.innerHTML,/stale/);
  assert.equal(nodes.label.textContent,'Consulta sin completar');
  assert.equal(nodes.go.disabled,false);assert.equal(nodes.q.disabled,false);
});
test('partial results render evidence; unsafe links and markup never become executable',async()=>{
  const a={title:'<img src=x onerror=alert(1)>',url:'javascript:alert(1)',date:new Date().toISOString(),source:'__proto__',locationMatched:false};
  const {nodes,search}=harness(async()=>({ok:true,json:async()=>({ok:true,articles:[a],stories:[{title:a.title,sourceCount:1,articleCount:1,latestPublishedAt:a.date,articles:[a]}],activeProviderCount:1,coverage:'partial',fetchedAt:a.date})}));
  await search();
  assert.equal(nodes.m1.textContent,1);assert.match(nodes.status.textContent,/Algunas fuentes/);
  assert.doesNotMatch(nodes.articles.innerHTML,/<img|href="javascript:/);
  assert.match(nodes.articles.innerHTML,/Ubicación por verificar/);
  assert.equal(nodes.go.disabled,false);
});
