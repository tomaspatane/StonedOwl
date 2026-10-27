import { assessOfficialSnapshot } from './electricidad-trend.js';

export function assessCapture(report, { now = Date.now(), previousCapturedAt = null, persisted = true } = {}) {
  const topicReports = report.topics ? Object.values(report.topics) : null;
  const candidates = topicReports ? topicReports.flatMap(t => t.editorialCases || []) : report.editorialCases || [];
  const feeds = topicReports ? topicReports.flatMap(t => t.sourceHealth || []) : [...(report.sourceHealth?.googleWeb?.diagnostics || []), ...(report.sourceHealth?.territorialWeb?.diagnostics || [])];
  const uniqueFeeds = [...new Map(feeds.map(f => [f.url || f.feedId, f])).values()];
  const staleFeeds = uniqueFeeds.filter(f => f.stale === true).map(f => f.feedId);
  const undatedFeeds = uniqueFeeds.filter(f => f.ok && f.rawCount > 0 && !f.latestPublishedAt).map(f => f.feedId);
  const official = topicReports ? null : assessOfficialSnapshot(report, now);
  const sourceStatus = report.captureHealth?.status || report.coverage?.status || 'unknown';
  const ready = candidates.filter(c => c.readyToPublish === true).length;
  const prior = Date.parse(previousCapturedAt || '');
  const current = Date.parse(report.fetchedAt || report.finishedAt || '');
  const intervalMs = Number.isFinite(prior) && Number.isFinite(current) ? current - prior : null;
  const comparisons = topicReports ? Object.values(report.snapshotComparisons || {}) : [report.snapshotComparison].filter(Boolean);
  return {
    version: 'capture-assessment-v1',
    execution: { status: persisted ? 'completed' : 'persistence_failed' },
    sources: { status: sourceStatus, freshness: staleFeeds.length || undatedFeeds.length ? 'degraded' : 'no_feed_date_rejections', staleFeeds, undatedFeeds, distinctFeeds: uniqueFeeds.length },
    evidence: { status: candidates.length || official?.affectedUsers !== null && official?.valid ? 'partial' : 'insufficient', candidates: candidates.length, officialSnapshot: official },
    publication: { status: ready ? 'review_required' : 'blocked', readyCandidates: ready, automaticPublicationAllowed: false },
    comparison: { status: comparisons.length && comparisons.every(c => c.status === 'comparable') ? 'comparable' : 'insufficient', reasons: [...new Set(comparisons.flatMap(c => c.reasonCodes || c.reasons || []))] },
    cadence: { expectedIntervalMs: 3600000, observedIntervalMs: intervalMs, status: intervalMs === null ? 'unknown' : intervalMs > 5400000 ? 'gap' : 'within_tolerance' }
  };
}
