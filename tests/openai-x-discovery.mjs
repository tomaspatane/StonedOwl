import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildXRequest, captureX, parseXResponse, xPost, X_LIMITS } from '../sources/openai-x-discovery.js';

const now = Date.parse('2026-11-17T17:00:00Z');
const idAt = time => ((BigInt(time) - 1288834974657n) << 22n).toString();
const id = idAt(now - 3600000);
const url = `https://x.com/fixture/status/${id}`;
const summary = 'Vecinos reclaman por basura acumulada en Almagro, CABA.';
const options = { now, span: '1d' };
function response(candidates = [{ url, summary }], sources = [url]) {
  return { id: 'resp_test_fixture', status: 'completed', model: 'gpt-6.1-terra',
    usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 },
    output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: sources.map(url => ({ type: 'url', url })) } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ candidates }) }] }
    ] };
}

test('request restricts domains, calls and output; no API key or storage', () => {
  const request = buildXRequest(options);
  assert.deepEqual(request.tools[0].filters.allowed_domains, ['x.com', 'twitter.com']);
  assert.equal(request.max_tool_calls, 2);
  assert.equal(request.max_output_tokens, 2500);
  assert.equal(request.tool_choice, 'required');
  assert.equal(request.store, false);
  assert.match(request.input, /2026-11-16T17:00:00.000Z/);
  assert.throws(() => buildXRequest({ span: '__proto__' }), /invalid_options/);
  assert.throws(() => buildXRequest({ topic: 'inventado' }), /invalid_options/);
  assert.throws(() => buildXRequest({ now: 'bad-date' }), /invalid_options/);
});

test('URLs preserve exact large IDs and reject unsafe targets', () => {
  assert.equal(xPost(url).publicationDate, '2026-11-17T16:00:00.000Z');
  assert.equal(xPost(`https://twitter.com/fixture/status/${id}/photo/1?s=20`).url, xPost(url).url);
  for (const bad of ['javascript:alert(1)', `http://x.com/a/status/${id}`, `https://x.com.evil.test/a/status/${id}`,
    `https://x.com@evil.test/a/status/${id}`, `https://u:p@x.com/a/status/${id}`, `https://x.com:444/a/status/${id}`,
    'https://x.com/search?q=CABA', 'https://x.com/fixture', 'https://x.com/a/status/18446744073709551616']) assert.equal(xPost(bad), null);
});

test('search-backed posts become review leads, not confirmed incidents', () => {
  const report = parseXResponse(response(), options);
  assert.equal(report.status, 'leads_for_review');
  assert.equal(report.editorialLeads.length, 1);
  const lead = report.editorialLeads[0];
  assert.deepEqual(lead.topics, ['basura']);
  assert.deepEqual(lead.proposedLocation.comunas, [5]);
  assert.equal(lead.proposedLocation.basis, 'model_summary_requires_source_review');
  assert.equal(lead.incidentDate, null);
  assert.equal(lead.activeIncident, null);
  assert.equal(lead.confirmed, false);
  assert.equal(lead.readyToPublish, false);
  assert.equal(lead.affectsThermometer, false);
  assert.deepEqual(report.editorialCases, []);
  assert.equal(report.usage.totalTokens, 1100);
  assert.equal(report.usage.actualCostUsd, null);
});

test('fabricated citations cannot replace returned search sources', () => {
  const payload = response([{ url, summary }], []);
  payload.output[1].content[0].annotations = [{ type: 'url_citation', url }];
  const report = parseXResponse(payload, options);
  assert.equal(report.ok, false);
  assert.equal(report.code, 'missing_search_sources');
  const unknown = `https://x.com/a/status/${idAt(now - 7200000)}`;
  const ungrounded = parseXResponse(response([{ url: unknown, summary }]), options);
  assert.equal(ungrounded.diagnostics.rejected.url_not_in_search_sources, 1);
});

test('deduplication uses post ID across domains, handles and media URLs', () => {
  const alternate = `https://twitter.com/other/status/${id}/video/1`;
  const report = parseXResponse(response([{ url, summary }, { url: alternate, summary }]), options);
  assert.equal(report.editorialLeads.length, 1);
  assert.equal(report.diagnostics.rejected.duplicate_post, 1);
});

test('old/future posts cannot be made fresh by model-supplied dates', () => {
  for (const time of [now - 86400001, now + 1]) {
    const dated = `https://x.com/a/status/${idAt(time)}`;
    const report = parseXResponse(response([{ url: dated, summary, publicationDate: new Date(now).toISOString() }], [dated]), options);
    assert.equal(report.editorialLeads.length, 0);
    assert.equal(report.diagnostics.rejected.publication_outside_window, 1);
  }
});

test('geography and signal checks reject irrelevant posts', () => {
  for (const text of ['Basura acumulada en Rosario.', 'Ganó el club Belgrano.', 'La ciudad está hermosa.']) {
    const report = parseXResponse(response([{ url, summary: text }]), options);
    assert.equal(report.editorialLeads.length, 0);
  }
  assert.equal(parseXResponse(response(), { ...options, topic: 'transporte' }).editorialLeads.length, 0);
  const electricity = parseXResponse(response([{ url, summary: 'Vecinos sin luz en Caballito, CABA.' }]), options);
  assert.deepEqual(electricity.editorialLeads[0].topics, ['electricidad']);
});

test('completed empty searches differ from failures and incomplete output', () => {
  const empty = parseXResponse(response([], []), options);
  assert.equal(empty.ok, true);
  assert.equal(empty.captureUsable, false);
  assert.equal(empty.status, 'no_usable_results');
  const incomplete = response(); incomplete.status = 'incomplete';
  assert.equal(parseXResponse(incomplete, options).code, 'incomplete_response');
  const noSearch = response(); noSearch.output.shift();
  assert.equal(parseXResponse(noSearch, options).code, 'search_not_completed');
  const badJson = response(); badJson.output[1].content[0].text = '{';
  assert.equal(parseXResponse(badJson, options).code, 'invalid_response_json');
  const tooMany = response(Array.from({ length: X_LIMITS.candidates + 1 }, () => ({ url, summary })));
  assert.equal(parseXResponse(tooMany, options).code, 'invalid_candidates');
});

test('disabled or unconfigured capture never calls the network', async () => {
  const never = () => assert.fail('unexpected network request');
  assert.equal((await captureX({ ...options, apiKey: 'test-secret' }, never)).code, 'live_opt_in_required');
  assert.equal((await captureX({ ...options, allowLive: true }, never)).code, 'missing_openai_api_key');
});

test('one live request uses fixed origin, no redirects and no secret in report', async () => {
  let calls = 0;
  const report = await captureX({ ...options, apiKey: 'test-secret', allowLive: true }, async (endpoint, init) => {
    calls++;
    assert.equal(endpoint, 'https://api.openai.com/v1/responses');
    assert.equal(init.headers.authorization, 'Bearer test-secret');
    assert.equal(init.redirect, 'error');
    return new Response(JSON.stringify(response()), { headers: { 'content-type': 'application/json' } });
  });
  assert.equal(calls, 1);
  assert.equal(report.ok, true);
  assert.ok(!JSON.stringify(report).includes('test-secret'));
});

test('401, 429 and 5xx fail once, without retries or echoing bodies', async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    const report = await captureX({ ...options, apiKey: 'secret-value', allowLive: true }, async () => {
      calls++;
      return new Response('secret-value', { status });
    });
    assert.equal(calls, 1);
    assert.equal(report.code, `openai_http_${status}`);
    assert.ok(!JSON.stringify(report).includes('secret-value'));
  }
});

test('network exceptions and malformed content are explicit safe failures', async () => {
  const live = { ...options, apiKey: 'secret-value', allowLive: true };
  const failed = await captureX(live, async () => { throw new Error('secret-value'); });
  assert.equal(failed.code, 'request_failed_billing_unknown');
  assert.ok(!JSON.stringify(failed).includes('secret-value'));
  const timeout = await captureX(live, async () => { throw new DOMException('secret-value', 'TimeoutError'); });
  assert.equal(timeout.code, 'request_timeout_billing_unknown');
  const html = await captureX(live, async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }));
  assert.equal(html.code, 'invalid_content_type');
});

test('CLI without credentials writes a blocked report and exits nonzero', () => {
  const result = spawnSync(process.execPath, ['scripts/capture-x-openai.mjs', '--live'], {
    cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH }, encoding: 'utf8'
  });
  assert.equal(result.status, 2);
  const report = JSON.parse(readFileSync(new URL('../tmp/x-openai-report.json', import.meta.url), 'utf8'));
  assert.equal(report.code, 'missing_openai_api_key');
  assert.deepEqual(report.editorialLeads, []);
});
