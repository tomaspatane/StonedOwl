import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, { value: id === 'problemFilter' ? 'electricidad' : id === 'spanFilter' ? '1w' : 'all', innerHTML: '', textContent: '', style: {}, hidden: false, disabled: false, appendChild() {}, setAttribute() {}, classList: { add() {}, remove() {} } });
  return nodes.get(id);
}
const pending = [];
const sandbox = {
  document: { getElementById: node, createElement: () => node(Symbol()), querySelector: node, querySelectorAll: () => [], addEventListener() {} },
  fetch: (url, options) => new Promise(resolve => pending.push({ url, options, resolve })),
  AbortController, URL, console: { error() {} }, Intl, Date,
  setTimeout: fn => fn(), requestAnimationFrame: fn => fn()
};
vm.runInNewContext(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'), sandbox);
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
function data(topic, title) { return { ok: true, fetchedAt: '2026-10-20T14:00:00Z', topicId: topic, captureHealth: { status: 'healthy' }, coverage: { successfulPublishers: ['Example'] }, radar: [], editorialCases: [{ topicId: topic, title, reportedFact: 'Reporte', barrios: ['Almagro'], evidenceLabel: 'Fuente', evidence: [{ url: 'https://example.test/case', source: 'Example', date: '2026-10-20' }], responsibility: {}, confidence: { level: 'media' } }] }; }
node('problemFilter').value = 'basura';
node('problemFilter').onchange();
assert.match(pending[1].url, /api\/basura/);
assert.equal(pending[0].options.signal.aborted, true);
pending[1].resolve({ ok: true, json: async () => data('basura', 'Caso de basura') });
await flush();
assert.match(node('editorialCases').innerHTML, /Caso de basura/);
assert.match(node('editorialCases').innerHTML, /Publicado: 20\/10\/2026/);
assert.match(node('updatedAt').textContent, /20\/10\/2026.*11:00.*ART/);
assert.equal(node('topicCoverage').hidden, false);
assert.equal(node('.dashboard').hidden, true);
assert.equal(node('statusFilter').disabled, true);
pending[0].resolve({ ok: true, json: async () => data('electricidad', 'Respuesta vieja') });
await flush();
assert.doesNotMatch(node('editorialCases').innerHTML, /Respuesta vieja/);
node('problemFilter').value = 'seguridad';
node('problemFilter').onchange();
assert.doesNotMatch(node('editorialCases').innerHTML, /Caso de basura/);
assert.match(node('editorialCases').innerHTML, /Consultando/);
node('comunaFilter').onchange();
assert.doesNotMatch(node('editorialCases').innerHTML, /Caso de basura/);
pending[2].resolve({ ok: false, json: async () => ({ error: 'Down' }) });
await flush();
assert.match(node('editorialCases').innerHTML, /No se pudo consultar/);
assert.doesNotMatch(node('editorialCases').innerHTML, /Caso de basura/);
node('problemFilter').value = 'electricidad';
node('problemFilter').onchange();
pending[3].resolve({ ok: true, json: async () => data('electricidad', '<script>bad()</script>') });
await flush();
assert.equal(node('.dashboard').hidden, false);
assert.equal(node('statusFilter').disabled, false);
assert.match(node('editorialCases').innerHTML, /&lt;script&gt;/);
assert.doesNotMatch(node('editorialCases').innerHTML, /<script>/);
assert.equal(node('refreshBtn').disabled, false);
assert.equal(node('topicCoverage').hidden, true);
node('problemFilter').value = 'basura';
node('problemFilter').onchange();
pending[4].resolve({ ok: true, json: async () => ({
  ...data('basura', 'Cobertura parcial'),
  ok: false, coverage: { successful: 2, failed: 1 },
  sourceHealth: [
    { publisher: 'Medio A', status: 'stale' },
    { publisher: 'Medio B', status: 'failed' },
    { publisher: 'Medio C', status: 'undated' }
  ]
}) });
await flush();
assert.match(node('topicCoverage').textContent, /2 consultas respondieron, 1 fallaron/);
assert.match(node('topicCoverage').textContent, /Medio A: sin publicaciones dentro/);
assert.match(node('topicCoverage').textContent, /Medio B: no se pudo consultar/);
assert.match(node('topicCoverage').textContent, /Medio C: sin fechas utilizables/);
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
assert.equal((html.match(/id="refreshBtn"/g) || []).length, 1);
assert.ok(html.indexOf('id="refreshBtn"') < html.indexOf('<main class="dashboard"'), 'Refresh remains available when the map is hidden');
assert.ok(html.indexOf('id="problemFilter"') < html.indexOf('id="editorialCases"'), 'Topic switcher remains above long case lists');
assert.match(await readFile(new URL('../public/style.css', import.meta.url), 'utf8'), /\[hidden\]\s*\{\s*display:\s*none !important/);
console.log('Topic frontend: changing filters during requests, stale responses, failures, escaping and electricity restoration OK');
