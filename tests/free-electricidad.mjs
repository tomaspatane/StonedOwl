import assert from 'node:assert/strict';
import { FREE_ELECTRICIDAD_FEEDS, parseFreeElectricidadRss, fetchFreeElectricidad, fetchFreeElectricidadTerritorial } from '../sources/free-electricidad.js';
import { classifyElectricEvidence } from '../data/electricidad-evidence.js';

const now = new Date('2026-10-19T18:00:00Z');
const feed = { id: 'fixture', name: 'Medio barrial', url: 'https://barrio.example/feed/' };
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function item({ title = 'Vecinos de Almagro están sin luz', url = 'https://barrio.example/nota?story=10', date = 'Mon, 19 Oct 2026 17:00:00 GMT', description = 'El corte de luz continúa en Almagro, Ciudad de Buenos Aires.', extra = '' } = {}) {
  return `<item><title>${escape(title)}</title><link>${escape(url)}</link><pubDate>${date}</pubDate><description><![CDATA[${description}]]></description>${extra}</item>`;
}
function rss(items = '') {
  return `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Medio &amp; Barrio</title><link>https://barrio.example/</link><description>Noticias</description>${items}</channel></rss>`;
}
const response = (raw, headers = 'application/rss+xml') => ({ ok: true, status: 200, headers: { get: () => headers }, text: async () => raw });
const parse = (raw, span = '1d') => parseFreeElectricidadRss(raw, { feed, now, span });

assert.ok(FREE_ELECTRICIDAD_FEEDS.length >= 4);
assert.ok(FREE_ELECTRICIDAD_FEEDS.every((f) => new URL(f.url).protocol === 'https:'));
assert.ok(FREE_ELECTRICIDAD_FEEDS.every((f) => !/google|serper/.test(f.url)), 'Restricted/paid aggregators are not default feeds');
assert.ok(FREE_ELECTRICIDAD_FEEDS.find((f) => f.id === 'el_abasto').url.includes('s=corte+de+luz'), 'Search feed finds incidents not only the front page');

const parsed = parse(rss(item({
  description: '<p>Corte de luz en Almagro &amp; otras cuadras.</p><script>bad()</script>',
  extra: '<content:encoded><![CDATA[Body-only Flores must not enter evidence.]]></content:encoded>'
})));
assert.equal(parsed.articles.length, 1);
const article = parsed.articles[0];
assert.equal(article.date, '2026-10-19T17:00:00.000Z');
assert.equal(article.source, 'barrio.example');
assert.equal(article.publisherName, 'Medio barrial');
assert.equal(article.provenance.publicationDateRaw, 'Mon, 19 Oct 2026 17:00:00 GMT');
assert.equal(article.provenance.geoAssignment, 'unverified');
assert.equal(article.provenance.fullArticleRead, false);
assert.equal(article.provenance.evidenceScope, 'rss_title_and_summary');
assert.equal(article.official, undefined);
assert.equal(article.targetBarrio, undefined);
assert.equal(article.query, null);
assert.match(article.snippet, /Almagro & otras/);
assert.doesNotMatch(article.snippet, /Flores|bad\(\)|<p>/);
assert.equal(parsed.diagnostics.rawCount, 1);
assert.equal(parsed.diagnostics.feedTitle, 'Medio & Barrio');

const dates = parse(rss([
  item({ date: 'Sun, 18 Oct 2026 18:00:00 GMT', url: 'https://barrio.example/boundary' }),
  item({ date: 'Sun, 18 Oct 2026 17:59:59 GMT' }),
  item({ date: 'Mon, 19 Oct 2026 18:00:01 GMT' }),
  item({ date: '' }), item({ date: '1' }), item({ date: 'not a date' }),
  item({ title: 'Nueva plaza en Almagro', description: 'Obra en el barrio.', url: 'https://barrio.example/plaza' }),
  item({ url: 'javascript:alert(1)' })
].join('')));
assert.equal(dates.articles.length, 1, 'Only genuinely dated records within exact window survive');
assert.deepEqual(dates.diagnostics.rejected, { invalid_record: 1, missing_or_unparseable_date: 3, future_date: 1, outside_time_window: 1, no_electric_signal: 1 });
assert.equal(parse(rss(item({ date: '2026-10-19T17:00:00' }))).diagnostics.rejected.missing_or_unparseable_date, 1, 'Do not invent a timezone');
assert.equal(parse(rss(item({ date: 'Thu, 15 Oct 2026 17:00:00 GMT' }))).articles.length, 0);
assert.equal(parse(rss(item({ date: 'Thu, 15 Oct 2026 17:00:00 GMT' })), '1w').articles.length, 1);
assert.equal(parse(rss(item({ date: 'Mon, 19 Oct 2026 11:59:59 GMT' })), '6h').articles.length, 0);
assert.equal(parse(rss(item({ date: 'Mon, 19 Oct 2026 12:00:00 GMT' })), '6h').articles.length, 1);
assert.equal(parse(rss()).diagnostics.rawCount, 0, 'A genuinely empty RSS is valid');
assert.equal(parse(rss(item({ date: 'Mon, 19 Oct 2020 17:00:00 GMT' }))).diagnostics.stale, true);

for (const bad of ['<html><body>No news</body></html>', rss(item()).replace('</rss>', ''), rss(item()).replace('</item>', '</other>'), '<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///etc/passwd">]>'+rss(item()), rss(item()).replace('Medio &amp;', 'Medio &bad;'), rss(item())+rss(), rss().replace('version="2.0"', 'version=2.0')]) {
  assert.throws(() => parse(bad), /RSS|XML|documento|Contenido|Etiquetas|Atributos/);
}
assert.throws(() => parse(rss(item()), '1y'), /Ventana/);
assert.throws(() => parseFreeElectricidadRss(rss(item()), { now: 'not a date' }), /Fecha/);
const xmlEntities = parse(rss(item({ title: 'Corte de luz en Almagro &#x26; zonas próximas' }))).articles[0];
assert.match(xmlEntities.title, /& zonas/);

const general = await fetchFreeElectricidad('1d', { now, feeds: [feed] }, async (url, options) => {
  assert.equal(url, feed.url);
  assert.equal(options.method, undefined);
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.headers['X-API-KEY'], undefined);
  return response(rss(item()+item({ url: 'https://barrio.example/nota?story=10&utm_source=x' })+item({ url: 'https://barrio.example/nota?story=11' })));
});
assert.equal(general.articles.length, 2, 'Strip tracking only, preserve article identity query parameters');
assert.equal(general.provider, 'publisher_rss');
assert.equal(general.disabled, false);
assert.equal(general.plan, null);
assert.equal(general.diagnostics[0].ok, true);
assert.deepEqual(general.queries, []);

const territorial = await fetchFreeElectricidad('1d', { now, feeds: [feed], barrios: ['Almagro', 'Flores'] }, async () => response(rss(item())));
assert.equal(territorial.articles.length, 1);
assert.equal(territorial.articles[0].targetBarrio, 'Almagro');
assert.equal(territorial.articles[0].targetComuna, 5);
assert.equal(territorial.articles[0].query, null);
assert.equal(territorial.articles[0].snippet, general.articles[0].snippet);
assert.equal(territorial.plan.queryCount, 0);
assert.equal(territorial.plan.localFilterCount, 2);
assert.equal(territorial.articles[0].provenance.targetBasis, 'name_mentioned_in_feed_not_confirmed_location');

const conflicting = await fetchFreeElectricidadTerritorial('1d', { now, feeds: [feed], barrios: ['Caballito'] }, async () => response(rss(item({ title: 'Apagón masivo en San Juan', description: 'El texto también menciona Caballito.' }))));
assert.equal(conflicting.articles.length, 1, 'Keep explicitly unverified location candidates for downstream rejection');
assert.equal(classifyElectricEvidence({ ...conflicting.articles[0], now: now.getTime() }).acceptedForBarrio, false);
assert.equal(classifyElectricEvidence({ ...conflicting.articles[0], now: now.getTime() }).evidenceQuality, 'conflicting_geo');

const badFeeds = [{ ...feed, id: 'html', url: 'https://barrio.example/html' }, { ...feed, id: 'broken', url: 'https://barrio.example/broken' }, { ...feed, id: 'http', url: 'https://barrio.example/http' }, { ...feed, id: 'good', url: 'https://barrio.example/good' }];
const mixed = await fetchFreeElectricidad('1d', { now, feeds: badFeeds }, async (url) => {
  if (url.endsWith('html')) return response('<html>bot challenge</html>', 'text/html');
  if (url.endsWith('broken')) return response('<rss><channel>');
  if (url.endsWith('http')) return { ok: false, status: 503 };
  return response(rss(item()));
});
assert.equal(mixed.articles.length, 1);
assert.deepEqual(mixed.diagnostics.map((d) => d.ok), [false, false, false, true]);
assert.equal(mixed.diagnostics[2].code, 'http_error');
assert.ok(mixed.diagnostics[0].error.includes('HTML'));

const hung = await fetchFreeElectricidad('1d', { now, feeds: [feed], timeoutMs: 10 }, () => new Promise(() => {}));
assert.equal(hung.diagnostics[0].code, 'timeout');
const hungBody = await fetchFreeElectricidad('1d', { now, feeds: [feed], timeoutMs: 10 }, async () => ({ ok: true, text: () => new Promise(() => {}) }));
assert.equal(hungBody.diagnostics[0].code, 'timeout', 'Body read shares timeout bound');

let calls = 0;
const concurrentFetch = async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 15)); return response(rss(item())); };
const [sharedGeneral, sharedTerritorial] = await Promise.all([
  fetchFreeElectricidad('1d', { now, feeds: [feed] }, concurrentFetch),
  fetchFreeElectricidadTerritorial('1d', { now, feeds: [feed], barrios: ['Almagro'] }, concurrentFetch)
]);
assert.equal(calls, 1, 'Concurrent general/territorial capture shares network request');
assert.equal(sharedGeneral.articles.length, 1);
assert.equal(sharedTerritorial.articles.length, 1);
await fetchFreeElectricidad('1d', { now, feeds: [feed] }, concurrentFetch);
assert.equal(calls, 2, 'Do not silently reuse cached/stale feeds for later captures');

console.log('Free electricity RSS: parsing, date window, provenance, territorial uncertainty, failures, timeouts and in-flight dedup OK');
