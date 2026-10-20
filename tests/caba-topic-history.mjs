import assert from 'node:assert/strict';
import { captureTopic } from '../sources/caba-topic-capture.js';
import { compareTopicSnapshots, snapshotTime } from '../data/caba-topic-history.js';
const t0 = Date.parse('2026-10-20T12:00:00Z'), t1 = t0 + 600000;
const feed = { id: 'a', name: 'Publicador', url: 'https://example.test/?s=basura&feed=rss2' };
const rss = `<rss><channel><title>Noticias</title><item><title>Basura acumulada en Almagro</title><link>https://example.test/case</link><description>Vecinos de Almagro reclaman por contenedores desbordados.</description><pubDate>Tue, 20 Oct 2026 11:00:00 GMT</pubDate></item></channel></rss>`;
const base = await captureTopic('basura', { now: t0, feeds: [feed] }, async () => new Response(rss));
const clone = x => structuredClone(x);
function setClock(x, now) {
  x.fetchedAt = new Date(now).toISOString();
  for (const item of x.editorialCases) for (const evidence of item.evidence) evidence.provenance.retrievedAt = x.fetchedAt;
  return x;
}
function current() { return setClock(clone(base), t1); }
function compare(a = base, b = current(), extra = {}) { return compareTopicSnapshots(a, b, { now: t1, ...extra }); }
function addCase(x, url, date = '2026-10-20T11:00:00.000Z') {
  const c = clone(x.editorialCases[0]); c.id = url; c.evidence = [{ ...c.evidence[0], url, date, publicationDate: date }]; x.editorialCases.push(c); x.counts.acceptedCount = x.editorialCases.length;
  x.sourceHealth[0].rawCount++; x.sourceHealth[0].acceptedCount++; x.counts.candidateCount++;
}
let r = compare();
assert.equal(r.status, 'comparable'); assert.equal(r.counts.inventoryDelta, 0); assert.equal(r.incidentTrend, 'unknown'); assert.equal(r.problemGrowth, null);
assert.equal(compare(null).eligible, false);
assert.equal(compare(base, clone(base)).status, 'unknown', 'Same capture does not form a pair');
const more = current(); addCase(more, 'https://example.test/second');
r = compare(base, more); assert.equal(r.counts.addedSincePrevious, 1); assert.equal(r.counts.inventoryDelta, 1); assert.equal(r.changes.addedSincePrevious[0].publicationPredatesPreviousCapture, true);
assert.equal(r.incidentTrend, 'unknown'); assert.match(r.caveats.join(' '), /no incidentes/);
const syndicated = current(); syndicated.editorialCases[0].evidence.push({ ...syndicated.editorialCases[0].evidence[0], url: 'https://another.test/same-incident' });
syndicated.sourceHealth[0].rawCount++; syndicated.sourceHealth[0].acceptedCount++; syndicated.counts.candidateCount++; syndicated.counts.duplicates++;
assert.equal(compare(base, syndicated).counts.addedSincePrevious, 1, 'Another publication is not another event');
const representative = clone(syndicated); representative.editorialCases[0].id = 'another-representative'; representative.editorialCases[0].title = 'Another title'; representative.editorialCases[0].evidence.reverse();
const oldGroup = setClock(clone(syndicated), t0);
assert.equal(compare(oldGroup, representative).counts.addedSincePrevious, 0);
assert.equal(compare(oldGroup, representative).counts.updated, 0, 'Changing representative/group order does not imply the publication changed');
const tracked = current(); addCase(tracked, 'https://example.test/case?utm_source=rss#fragment');
assert.equal(compare(base, tracked).counts.currentPublications, 1, 'Canonical URLs deduplicate tracking variants');
const edited = current(); edited.editorialCases[0].reportedStatus = 'resuelto_segun_fuente'; edited.editorialCases[0].evidence[0].publicationDate = edited.editorialCases[0].evidence[0].date = '2026-10-20T11:30:00Z';
edited.sourceHealth[0].latestPublishedAt = '2026-10-20T11:30:00Z';
r = compare(base, edited); assert.equal(r.counts.addedSincePrevious, 0); assert.equal(r.counts.updated, 1); assert.equal(r.incidentTrend, 'unknown');
const missing = current(); missing.editorialCases = []; missing.counts.acceptedCount = 0;
r = compare(base, missing); assert.equal(r.counts.notObserved, 1); assert.equal(r.counts.outsideWindow, 0); assert.match(r.caveats.join(' '), /No demuestra resolución/);
const old = clone(base); old.editorialCases[0].evidence[0].date = old.editorialCases[0].evidence[0].publicationDate = '2026-10-13T12:05:00Z';
r = compare(old, missing); assert.equal(r.counts.outsideWindow, 1); assert.equal(r.counts.notObserved, 0);
const emptyBefore = clone(missing); emptyBefore.fetchedAt = base.fetchedAt;
assert.equal(compare(emptyBefore, missing).counts.currentPublications, 0);
for (const change of [x => { x.span = '1d'; }, x => { x.analysisVersion = 'new'; }, x => { x.sourceHealth[0].url += '&other=1'; }, x => { x.sourceHealth[0].publisher = 'Other'; }, x => { x.sourceHealth[0].feedId = 'other'; }]) {
  const changed = current(); change(changed); r = compare(base, changed); assert.equal(r.eligible, false); assert.equal(r.counts, null);
}
const oldFeed = { id: 'old', name: 'Another publisher', url: 'https://old.test/feed' };
const oldRss = rss.replace('Tue, 20 Oct 2026 11:00:00 GMT', 'Sun, 11 Oct 2026 11:00:00 GMT');
const withStaleFeed = now => captureTopic('basura', { now, feeds: [feed, oldFeed] }, async url => new Response(url === oldFeed.url ? oldRss : rss));
const staleBefore = await withStaleFeed(t0), staleAfter = await withStaleFeed(t1);
assert.equal(compare(staleBefore, staleAfter).status, 'partial');
const recovered = clone(staleAfter);
Object.assign(recovered.sourceHealth[1], { status: 'healthy', stale: false, latestPublishedAt: '2026-10-20T12:00:00Z' });
Object.assign(recovered.captureHealth, { status: 'healthy', stale: 0 });
assert.equal(compare(staleBefore, recovered).status, 'unknown', 'Stale to healthy source coverage is not report growth');
assert.ok(compare(staleBefore, recovered).coverageChanges.some(change => change.kind === 'health_changed'));
const reordered = clone(staleAfter); reordered.sourceHealth.reverse();
assert.equal(compare(staleBefore, reordered).status, 'partial', 'Feed order is not coverage change');
const failed = current(); failed.sourceHealth[0].ok = false; failed.sourceHealth[0].status = 'failed'; failed.captureHealth = { status: 'failed', successful: 0, failed: 1, stale: 0, undated: 0 };
assert.equal(compare(base, failed).counts, null);
const bad = current(); bad.counts.acceptedCount = 5; assert.equal(compare(base, bad).eligible, false);
const futurePublication = current(); futurePublication.editorialCases[0].evidence[0].date = futurePublication.editorialCases[0].evidence[0].publicationDate = '2026-10-21T11:00:00Z'; assert.equal(compare(base, futurePublication).eligible, false);
assert.equal(snapshotTime('2026-02-30T12:00:00Z'), null); assert.equal(snapshotTime('2026-10-20T12:00:00'), null); assert.equal(snapshotTime('2026-10-20T25:00:00Z'), null);
assert.equal(compare(base, current(), { now: t1 + 7200001 }).eligible, false);
const shortWindowBefore = clone(base), shortWindowAfter = current(); shortWindowBefore.span = shortWindowAfter.span = '6h'; setClock(shortWindowAfter, t0 + 21600000);
assert.ok(compare(shortWindowBefore, shortWindowAfter, { now: t0 + 21600000 }).reasons.includes('non_overlapping_windows'));

// Corrupt or incoherent artifacts must return unknown, never throw or publish
// numeric changes from an inventory that the reported feeds could not supply.
for (const mutate of [
  x => { x.editorialCases = [null]; },
  x => { x.editorialCases = [[]]; },
  x => { x.editorialCases[0].evidence = [null]; },
  x => { x.editorialCases[0].evidence = [[]]; },
  x => { x.editorialCases[0].barrios = [null]; },
  x => { x.editorialCases[0].reportedStatus = {}; },
  x => { x.sourceHealth = [null]; },
  x => { x.sourceHealth[0].rawCount = 0; },
  x => { Object.assign(x.sourceHealth[0], { rawCount: 0, acceptedCount: 0, latestPublishedAt: null }); },
  x => { x.sourceHealth[0].acceptedCount = 0; },
  x => { x.sourceHealth[0].latestPublishedAt = '2026-10-20T10:00:00Z'; },
  x => { delete x.editorialCases[0].evidence[0].provenance; },
  x => { x.editorialCases[0].evidence[0].provenance = null; },
  x => { x.editorialCases[0].evidence[0].provenance.feedId = 'unknown'; },
  x => { x.editorialCases[0].evidence[0].provenance.feedUrl = 'https://another.test/feed'; },
  x => { x.editorialCases[0].evidence[0].provenance.provider = 'unknown'; },
  x => { x.editorialCases[0].evidence[0].provenance.retrievedAt = base.fetchedAt; },
  x => { x.editorialCases[0].evidence[0].provenance.retrievedAt = '2026-10-21T12:00:00Z'; },
  x => { Object.assign(x.sourceHealth[0], { status: 'stale', stale: true }); Object.assign(x.captureHealth, { status: 'degraded', stale: 1 }); },
  x => { x.sourceHealth[0].latestPublishedAt = '2026-10-01T12:00:00Z'; },
  x => { x.editorialCases[0].evidence.push({ ...x.editorialCases[0].evidence[0], url: 'https://example.test/invented' }); }
]) {
  const damaged = current(); mutate(damaged);
  const comparison = compare(base, damaged);
  assert.equal(comparison.status, 'unknown');
  assert.equal(comparison.counts, null);
  assert.equal(comparison.incidentTrend, 'unknown');
}
for (const now of [NaN, Infinity, -Infinity, 1e100, -1e100, null, '2026-10-20T12:10:00Z']) {
  const comparison = compare(base, current(), { now });
  assert.ok(comparison.reasons.includes('invalid_comparison_time'));
  assert.equal(comparison.comparedAt, null);
  assert.equal(comparison.counts, null);
}
for (const limits of [null, [], { maxIntervalMs: NaN }, { minIntervalMs: 0 }, { maxIntervalMs: 1 }, { unexpected: 1 }]) {
  assert.ok(compare(base, current(), { limits }).reasons.includes('invalid_comparison_limits'));
}
const trackingFeedChanged = current(); trackingFeedChanged.sourceHealth[0].url += '&utm_source=changed-feed-config';
assert.equal(compare(base, trackingFeedChanged).status, 'unknown', 'Feed configuration is compared exactly, separate from publication URL cleanup');
console.log('Topic history comparisons: publication identity, temporal/source eligibility, partial coverage, expiry and non-incident semantics OK');
