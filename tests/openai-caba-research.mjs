import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchRequest, parseResearchResponse, researchCaba, researchMarkdown, researchUrl } from '../sources/openai-caba-research.js';

const now = Date.parse('2026-11-17T18:00:00Z');
const url = 'https://medio.example/caballito/';
const item = () => ({ title: 'Reclamo por recorridos', topic: 'transporte', summary: 'Una fuente informa sobre cambios anunciados en CABA.',
  location: 'Ambrosetti, Caballito', publishedDate: '2026-11-17', eventDate: null, status: 'anunciado',
  sources: [{ url, publisher: 'Nombre del modelo' }], nextCheck: 'Consultar el recorrido oficial.' });
const response = (cases = [item()], urls = [url]) => ({ status: 'completed', model: 'fixture', usage: { input_tokens: 100, output_tokens: 50 },
  output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: urls.map(url => ({ url })) } },
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ cases, gaps: [] }) }] }] });

test('calendar window uses Buenos Aires dates; requests are bounded and omit account data', () => {
  const r = buildResearchRequest({ now: '2026-11-18T01:00:00Z', days: 1 });
  assert.match(r.input, /entre 2026-11-17 y 2026-11-17/);
  assert.equal(r.store, false); assert.equal(r.max_tool_calls, 4); assert.equal(r.max_output_tokens, 3800);
  assert.ok(!r.tools[0].filters); assert.equal(r.tool_choice, 'required');
  assert.throws(() => buildResearchRequest({ days: 31 }));
});
test('only actual returned source URLs survive; generated annotations are insufficient', () => {
  const fake = item(); fake.sources[0].url = 'https://invented.example/article';
  assert.equal(parseResearchResponse(response([fake]), { now }).editorialLeads.length, 0);
  const payload = response([item()], []);
  payload.output[1].content[0].annotations = [{ type: 'url_citation', url }];
  assert.equal(parseResearchResponse(payload, { now }).diagnostics.rejected.no_search_backed_source, 1);
});
test('canonical URLs remove tracking but preserve document identifiers', () => {
  assert.equal(researchUrl(`${url}?utm_source=openai#section`), url);
  assert.equal(researchUrl('https://legislatura.example/download?IdDoc=123&utm_source=web'), 'https://legislatura.example/download?IdDoc=123');
  for (const u of ['javascript:alert(1)', 'http://medio.example/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://a.local/b', 'https://u:p@medio.example/a', 'https://medio.example:444/a', 'https://medio.example/']) assert.equal(researchUrl(u), null);
});
test('source-backed drafts never become confirmed incidents or political profiles', () => {
  const r = parseResearchResponse(response(), { now }); const lead = r.editorialLeads[0];
  assert.equal(r.status, 'draft_for_review'); assert.deepEqual(lead.proposedLocation.comunas, [6]);
  assert.equal(lead.sources[0].publisher, 'medio.example'); assert.equal(lead.confirmed, false);
  assert.equal(lead.readyToPublish, false); assert.equal(lead.activeIncident, null); assert.equal(lead.affectsThermometer, false);
  assert.equal(lead.eventDate, null); assert.deepEqual(r.editorialCases, []);
});
test('invalid, old and future publication dates are excluded; future announcements are preserved', () => {
  for (const publishedDate of ['2026-11-18', '2026-11-01', '2026-02-30', null]) {
    assert.equal(parseResearchResponse(response([{ ...item(), publishedDate }]), { now }).editorialLeads.length, 0);
  }
  const r = parseResearchResponse(response([{ ...item(), eventDate: '2026-12-02' }]), { now });
  assert.equal(r.editorialLeads[0].reportedStatus, 'anunciado');
  assert.equal(r.editorialLeads[0].activeIncident, null);
});
test('geography is not inferred from hospital or station names; duplicate sources do not multiply cases', () => {
  for (const location of ['Hospital Belgrano', 'Estación Belgrano', 'Rosario', 'Caballito, provincia de Buenos Aires']) {
    assert.equal(parseResearchResponse(response([{ ...item(), location }]), { now }).editorialLeads.length, 0);
  }
  const r = parseResearchResponse(response([item(), { ...item(), title: 'Otro título del mismo artículo' }]), { now });
  assert.equal(r.editorialLeads.length, 1); assert.equal(r.diagnostics.rejected.duplicate_source_case_requires_review, 1);
});
test('empty retrieval, incomplete responses and malformed output remain distinct', () => {
  assert.equal(parseResearchResponse(response([], []), { now }).status, 'insufficient_retrieval');
  const broken = response(); broken.status = 'incomplete';
  assert.equal(parseResearchResponse(broken, { now }).code, 'incomplete_response');
  const invalid = response(); invalid.output[1].content[0].text = '{bad';
  assert.equal(parseResearchResponse(invalid, { now }).code, 'invalid_response_json');
  assert.equal(parseResearchResponse(response([{ ...item(), sources: [null] }]), { now }).editorialLeads.length, 0);
});
test('missing opt-in, missing key and expired credit guard make no paid request', async () => {
  const never = () => assert.fail('Unexpected API request');
  assert.equal((await researchCaba({ now, apiKey: 'fixture', allowLive: 'false' }, never)).code, 'live_opt_in_required');
  assert.equal((await researchCaba({ now, allowLive: true }, never)).code, 'missing_openai_api_key');
  assert.equal((await researchCaba({ now, apiKey: 'fixture', allowLive: true, creditsExpireAt: '2026-11-16T00:00:00Z' }, never)).code, 'credit_expiry_guard');
});
test('errors do not retry or expose credentials; only OpenAI receives the credential', async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    const r = await researchCaba({ now, allowLive: true, apiKey: 'secret-fixture' }, async (target, init) => {
      calls++; assert.equal(target, 'https://api.openai.com/v1/responses'); assert.equal(init.redirect, 'error');
      assert.equal(init.headers.authorization, 'Bearer secret-fixture');
      return new Response('secret-fixture', { status });
    });
    assert.equal(calls, 1); assert.equal(r.code, `openai_http_${status}`); assert.ok(!JSON.stringify(r).includes('secret-fixture'));
  }
});
test('Markdown cannot turn model markup into extra hyperlinks or HTML', () => {
  const r = parseResearchResponse(response([{ ...item(), title: '<img onerror=alert(1)>', summary: '[unsafe](https://evil.example/path)' }]), { now });
  const markdown = researchMarkdown(r);
  assert.ok(markdown.includes('\\<img')); assert.ok(markdown.includes('\\[unsafe\\]'));
  assert.ok(markdown.includes(`[medio.example](${url})`));
});
